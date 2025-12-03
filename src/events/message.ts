import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import {
  Events,
  ChannelType,
  type DMChannel,
  type TextChannel,
  type NewsChannel,
  type ThreadChannel,
  type VoiceChannel,
  type StageChannel,
  AttachmentBuilder,
} from "discord.js";
import { client } from "../index.js";
import { getConversationService } from "../ai/conversation.js";
import { getRateLimiter, getChannelQueue, formatCooldown } from "../utils/rate-limiter.js";
import { recordResponseTime } from "../utils/presence.js";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";

const log = createLogger("MessageEvent");

// Typing indicator delay to feel more natural
const TYPING_DELAY = 300;
// How often to refresh typing indicator (Discord typing lasts ~10 seconds)
const TYPING_INTERVAL = 8_000;

// Channels that support sendTyping
type TypingChannel =
  | DMChannel
  | TextChannel
  | NewsChannel
  | ThreadChannel
  | VoiceChannel
  | StageChannel;

/**
 * Helper to keep typing indicator active during long operations
 */
function startContinuousTyping(channel: TypingChannel): () => void {
  let stopped = false;

  // Send initial typing
  channel.sendTyping().catch(() => {});

  // Keep refreshing typing indicator every 8 seconds
  const interval = setInterval(() => {
    if (!stopped) {
      channel.sendTyping().catch(() => {});
    }
  }, TYPING_INTERVAL);

  // Return a cleanup function
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/**
 * Check if AI service is available, notify user in DMs if offline
 */
async function checkAIAvailability(
  message: ArgsOf<"messageCreate">[0],
  conversationService: ReturnType<typeof getConversationService>,
  isDM: boolean
): Promise<boolean> {
  const available = await conversationService.checkAvailability();
  if (!available && isDM) {
    await message.reply(
      "😴 I'm currently offline for AI chat, but I'll be back soon! You can still use my slash commands like `/ping` or `/info` in the meantime."
    );
  }
  return available;
}

/**
 * Handle rate limit cooldown for channel messages
 */
async function handleRateLimitCooldown(
  message: ArgsOf<"messageCreate">[0],
  cooldownRemaining: number
): Promise<void> {
  try {
    const cooldownMsg = await message.reply({
      content: `⏳ Please wait ${formatCooldown(cooldownRemaining)} before sending another message.`,
      allowedMentions: { repliedUser: false },
    });
    setTimeout(() => cooldownMsg.delete().catch(() => {}), 5000);
  } catch {
    // Ignore errors
  }
}

/**
 * Acquire a slot in the channel queue, handling full queue and timeout cases
 */
async function acquireChannelQueue(
  message: ArgsOf<"messageCreate">[0],
  channelQueue: ReturnType<typeof getChannelQueue>
): Promise<boolean> {
  if (channelQueue.isQueueFull(message.channelId)) {
    try {
      await message.reply({
        content: "🚦 I'm a bit busy right now! Please try again in a moment.",
        allowedMentions: { repliedUser: false },
      });
    } catch {
      // Ignore errors
    }
    return false;
  }

  const queuePosition = channelQueue.getQueuePosition(message.channelId);
  if (queuePosition > 0) {
    try {
      await message.react("⏳");
    } catch {
      // Ignore reaction errors
    }
  }

  const acquired = await channelQueue.acquireSlot(message.channelId, message.author.id, message.id);

  if (!acquired) {
    try {
      await message.reply({
        content: "⏰ Sorry, the queue timed out. Please try again!",
        allowedMentions: { repliedUser: false },
      });
    } catch {
      // Ignore errors
    }
  }

  return acquired;
}

/**
 * Extract message content, stripping bot mentions
 */
function extractMessageContent(message: ArgsOf<"messageCreate">[0], botId: string | undefined): string {
  let content = message.content;
  if (botId) {
    const botMention = `<@${botId}>`;
    const botMentionNick = `<@!${botId}>`;
    content = content.replace(botMention, "").replace(botMentionNick, "").trim();
  }
  return content;
}

interface AIResponseResult {
  response: string;
  generatedImage?: { buffer: Buffer; filename: string } | undefined;
  blocked?: boolean | undefined;
}

/**
 * Generate AI response using orchestrator or standard mode
 */
async function generateAIResponse(
  message: ArgsOf<"messageCreate">[0],
  content: string,
  contextId: string,
  conversationService: ReturnType<typeof getConversationService>
): Promise<AIResponseResult> {
  if (config.llm.useOrchestrator) {
    const member = message.guild
      ? await message.guild.members.fetch(message.author.id).catch(() => null)
      : null;

    const result = await conversationService.chatWithOrchestrator(
      content,
      message.author,
      member,
      message.channelId,
      message.guildId ?? undefined
    );

    return {
      response: result.response,
      generatedImage: result.generatedImage,
      blocked: result.blocked,
    };
  }

  const response = await conversationService.chat(
    contextId,
    content,
    message.author.displayName || message.author.username,
    message.author.id
  );

  return { response };
}

/**
 * Send AI response, handling long messages and attachments
 */
async function sendAIResponse(
  message: ArgsOf<"messageCreate">[0],
  response: string,
  generatedImage: { buffer: Buffer; filename: string } | undefined,
  splitMessage: (text: string, maxLength: number) => string[]
): Promise<void> {
  const files = generatedImage
    ? [new AttachmentBuilder(generatedImage.buffer, { name: generatedImage.filename })]
    : [];

  const maxLength = 2000;
  if (response.length <= maxLength) {
    await message.reply({
      content: response,
      files,
      allowedMentions: { repliedUser: true },
    });
    return;
  }

  // Split into multiple messages - attach image to first message only
  const chunks = splitMessage(response, maxLength);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    if (i === 0) {
      await message.reply({
        content: chunk,
        files,
        allowedMentions: { repliedUser: true },
      });
    } else {
      await message.channel.send(chunk);
    }
  }
}

@Discord()
export class MessageEvent {
  @On({ event: Events.MessageCreate })
  async onMessage([message]: ArgsOf<"messageCreate">): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Execute simple commands (prefix-based) first
    await client.executeCommand(message);

    // Check if this is a message we should respond to with AI
    if (!this.shouldRespondWithAI(message)) return;

    const isDM = message.channel.type === ChannelType.DM;
    const conversationService = getConversationService();
    const rateLimiter = getRateLimiter();
    const channelQueue = getChannelQueue();

    // Check if AI is available
    const available = await checkAIAvailability(message, conversationService, isDM);
    if (!available) return;

    // Check rate limit (only enforced in channels, lenient in DMs)
    const cooldownRemaining = rateLimiter.checkCooldown(message.author.id, message.channelId, isDM);
    if (cooldownRemaining > 0 && !isDM) {
      await handleRateLimitCooldown(message, cooldownRemaining);
      return;
    }

    // For channels, check concurrency and queue
    if (!isDM) {
      const acquired = await acquireChannelQueue(message, channelQueue);
      if (!acquired) return;
    }

    // Record the request for rate limiting
    rateLimiter.recordRequest(message.author.id, message.channelId, isDM);

    await this.processAIRequest(message, isDM, conversationService, channelQueue);
  }

  /**
   * Process the AI request after initial validation
   */
  private async processAIRequest(
    message: ArgsOf<"messageCreate">[0],
    isDM: boolean,
    conversationService: ReturnType<typeof getConversationService>,
    channelQueue: ReturnType<typeof getChannelQueue>
  ): Promise<void> {
    // Start continuous typing indicator
    const stopTyping = startContinuousTyping(message.channel as TypingChannel);

    // Small delay to feel more natural
    await new Promise((resolve) => setTimeout(resolve, TYPING_DELAY));

    // Generate context ID - PER USER even in channels to prevent cross-talk
    const contextId = isDM
      ? `dm-${message.author.id}`
      : `channel-${message.channelId}-user-${message.author.id}`;

    try {
      // Get the message content (strip bot mention if present)
      const content = extractMessageContent(message, client.user?.id);

      if (!content) {
        stopTyping();
        await message.reply("Hey! What's up? 👋");
        if (!isDM) channelQueue.releaseSlot(message.channelId);
        return;
      }

      // Track response time
      const startTime = Date.now();

      // Get AI response
      const result = await generateAIResponse(message, content, contextId, conversationService);

      if (result.blocked) {
        stopTyping();
        await message.reply({
          content: "🛡️ I couldn't process that message. Could you rephrase it?",
          allowedMentions: { repliedUser: false },
        });
        if (!isDM) channelQueue.releaseSlot(message.channelId);
        return;
      }

      // Record response time for presence stats
      recordResponseTime(Date.now() - startTime);

      // Stop typing indicator before sending response
      stopTyping();

      // Send the response
      await sendAIResponse(message, result.response, result.generatedImage, this.splitMessage);

      // Remove queue reaction if we added one
      try {
        await message.reactions.cache.get("⏳")?.users.remove(client.user?.id);
      } catch {
        // Ignore
      }
    } catch (error) {
      log.error("AI chat error:", error);
      stopTyping();

      if (isDM) {
        try {
          await message.reply("😅 Oops, something went wrong on my end. Please try again!");
        } catch {
          // Ignore
        }
      }
    } finally {
      if (!isDM) {
        channelQueue.releaseSlot(message.channelId);
      }
    }
  }

  /**
   * Determine if the bot should respond with AI to this message
   * In channels: Only responds when @mentioned
   * In DMs: Always responds
   */
  private shouldRespondWithAI(message: ArgsOf<"messageCreate">[0]): boolean {
    // Always respond in DMs
    if (message.channel.type === ChannelType.DM) {
      return true;
    }

    // In channels, only respond if bot is @mentioned
    if (client.user && message.mentions.has(client.user.id)) {
      return true;
    }

    return false;
  }

  /**
   * Split a message into chunks for Discord's character limit
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf("\n", maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(" ", maxLength);
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trim();
    }

    return chunks;
  }

  @On({ event: Events.MessageReactionAdd })
  async onReactionAdd([reaction, user]: ArgsOf<"messageReactionAdd">): Promise<void> {
    // Execute reaction handlers
    await client.executeReaction(reaction, user);
  }
}
