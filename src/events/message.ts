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
  type Message,
  AttachmentBuilder,
} from "discord.js";
import { client } from "../index.js";
import { getConversationService, type ConversationService } from "../ai/conversation.js";
import {
  getRateLimiter,
  getChannelQueue,
  formatCooldown,
  type RateLimiter,
  type ChannelQueue,
} from "../utils/rate-limiter.js";
import { recordResponseTime } from "../utils/presence.js";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";

const log = createLogger("MessageEvent");

/** Result of checking if AI is available and accessible */
interface AIAvailabilityResult {
  available: boolean;
  conversationService: ConversationService;
}

/** Result of queue acquisition attempt */
interface QueueResult {
  acquired: boolean;
  shouldReturn: boolean;
}

/** Result of AI response generation */
interface AIResponseResult {
  success: boolean;
  response?: string;
  generatedImage?: { buffer: Buffer; filename: string } | undefined;
  blocked?: boolean;
}

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
 * Check AI availability and notify user if offline (DMs only)
 */
async function checkAIAvailability(message: Message, isDM: boolean): Promise<AIAvailabilityResult> {
  const conversationService = getConversationService();
  const available = await conversationService.checkAvailability();

  if (!available && isDM) {
    await message.reply(
      "😴 I'm currently offline for AI chat, but I'll be back soon! You can still use my slash commands like `/ping` or `/info` in the meantime."
    );
  }

  return { available, conversationService };
}

/**
 * Check and handle rate limit cooldown for channel messages
 */
async function handleRateLimitCooldown(
  message: Message,
  rateLimiter: RateLimiter,
  isDM: boolean
): Promise<boolean> {
  const cooldownRemaining = rateLimiter.checkCooldown(message.author.id, message.channelId, isDM);

  if (cooldownRemaining > 0 && !isDM) {
    try {
      const cooldownMsg = await message.reply({
        content: `⏳ Please wait ${formatCooldown(cooldownRemaining)} before sending another message.`,
        allowedMentions: { repliedUser: false },
      });
      setTimeout(() => cooldownMsg.delete().catch(() => {}), 5000);
    } catch {
      // Ignore errors
    }
    return true; // Should return early
  }
  return false;
}

/**
 * Handle channel queue acquisition for concurrent request limiting
 */
async function acquireChannelQueue(
  message: Message,
  channelQueue: ChannelQueue
): Promise<QueueResult> {
  if (channelQueue.isQueueFull(message.channelId)) {
    try {
      await message.reply({
        content: "🚦 I'm a bit busy right now! Please try again in a moment.",
        allowedMentions: { repliedUser: false },
      });
    } catch {
      // Ignore errors
    }
    return { acquired: false, shouldReturn: true };
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
    return { acquired: false, shouldReturn: true };
  }

  return { acquired: true, shouldReturn: false };
}

/**
 * Extract message content, stripping bot mentions
 */
function extractMessageContent(message: Message): string {
  const content = message.content;
  const botMention = `<@${client.user?.id}>`;
  const botMentionNick = `<@!${client.user?.id}>`;
  return content.replace(botMention, "").replace(botMentionNick, "").trim();
}

/**
 * Generate AI response using orchestrator or standard conversation
 */
async function generateAIResponse(
  content: string,
  message: Message,
  conversationService: ConversationService,
  contextId: string
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

    if (result.blocked) {
      return { success: false, blocked: true };
    }

    return {
      success: true,
      response: result.response,
      generatedImage: result.generatedImage,
    };
  }

  // Use standard conversation (legacy mode)
  const response = await conversationService.chat(
    contextId,
    content,
    message.author.displayName || message.author.username,
    message.author.id
  );

  return { success: true, response };
}

/**
 * Send the AI response, handling long messages by splitting
 */
async function sendAIResponse(
  message: Message,
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
      // Cast is safe - we only get here for channels that support send
      await (message.channel as TextChannel).send(chunk);
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
    const rateLimiter = getRateLimiter();
    const channelQueue = getChannelQueue();

    // Check if AI is available
    const { available, conversationService } = await checkAIAvailability(message, isDM);
    if (!available) return;

    // Check rate limit (only enforced in channels, lenient in DMs)
    const isOnCooldown = await handleRateLimitCooldown(message, rateLimiter, isDM);
    if (isOnCooldown) return;

    // For channels, check concurrency and queue
    if (!isDM) {
      const queueResult = await acquireChannelQueue(message, channelQueue);
      if (queueResult.shouldReturn) return;
    }

    // Process the AI request
    await this.processAIRequest(message, isDM, conversationService, rateLimiter, channelQueue);
  }

  /**
   * Process the AI request after all checks have passed
   */
  private async processAIRequest(
    message: Message,
    isDM: boolean,
    conversationService: ConversationService,
    rateLimiter: RateLimiter,
    channelQueue: ChannelQueue
  ): Promise<void> {
    // Record the request for rate limiting
    rateLimiter.recordRequest(message.author.id, message.channelId, isDM);

    // Start continuous typing indicator
    const stopTyping = startContinuousTyping(message.channel as TypingChannel);

    // Small delay to feel more natural
    await new Promise((resolve) => setTimeout(resolve, TYPING_DELAY));

    // Generate context ID - PER USER even in channels to prevent cross-talk
    const contextId = isDM
      ? `dm-${message.author.id}`
      : `channel-${message.channelId}-user-${message.author.id}`;

    try {
      const content = extractMessageContent(message);

      if (!content) {
        stopTyping();
        await message.reply("Hey! What's up? 👋");
        if (!isDM) channelQueue.releaseSlot(message.channelId);
        return;
      }

      const startTime = Date.now();
      const aiResult = await generateAIResponse(content, message, conversationService, contextId);

      if (!aiResult.success || aiResult.blocked) {
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
      stopTyping();

      // Send the response
      await sendAIResponse(
        message,
        aiResult.response ?? "",
        aiResult.generatedImage,
        this.splitMessage.bind(this)
      );

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
