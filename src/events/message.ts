import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import {
  Events,
  ChannelType,
  DMChannel,
  TextChannel,
  NewsChannel,
  ThreadChannel,
  VoiceChannel,
  StageChannel,
  AttachmentBuilder,
} from "discord.js";
import { client } from "../index.js";
import { getConversationService } from "../ai/conversation.js";
import {
  getRateLimiter,
  getChannelQueue,
  formatCooldown,
} from "../utils/rate-limiter.js";
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

@Discord()
export class MessageEvent {
  @On({ event: Events.MessageCreate })
  async onMessage([message]: ArgsOf<"messageCreate">): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Execute simple commands (prefix-based) first
    await client.executeCommand(message);

    // Check if this is a message we should respond to with AI
    const shouldRespond = this.shouldRespondWithAI(message);
    if (!shouldRespond) return;

    const isDM = message.channel.type === ChannelType.DM;
    const conversationService = getConversationService();
    const rateLimiter = getRateLimiter();
    const channelQueue = getChannelQueue();

    // Check if AI is available
    const available = await conversationService.checkAvailability();
    if (!available) {
      // For DMs, let them know AI is offline
      if (isDM) {
        await message.reply(
          "😴 I'm currently offline for AI chat, but I'll be back soon! You can still use my slash commands like `/ping` or `/info` in the meantime."
        );
      }
      // For channels, stay silent - slash commands still work
      return;
    }

    // Check rate limit (only enforced in channels, lenient in DMs)
    const cooldownRemaining = rateLimiter.checkCooldown(
      message.author.id,
      message.channelId,
      isDM
    );

    if (cooldownRemaining > 0 && !isDM) {
      // User is on cooldown in channel
      try {
        const cooldownMsg = await message.reply({
          content: `⏳ Please wait ${formatCooldown(
            cooldownRemaining
          )} before sending another message.`,
          allowedMentions: { repliedUser: false },
        });
        // Delete cooldown message after a few seconds
        setTimeout(() => cooldownMsg.delete().catch(() => {}), 5000);
      } catch {
        // Ignore errors
      }
      return;
    }

    // For channels, check concurrency and queue
    if (!isDM) {
      if (channelQueue.isQueueFull(message.channelId)) {
        try {
          await message.reply({
            content:
              "🚦 I'm a bit busy right now! Please try again in a moment.",
            allowedMentions: { repliedUser: false },
          });
        } catch {
          // Ignore errors
        }
        return;
      }

      const queuePosition = channelQueue.getQueuePosition(message.channelId);
      if (queuePosition > 0) {
        // Let user know they're queued
        try {
          await message.react("⏳");
        } catch {
          // Ignore reaction errors
        }
      }

      // Acquire slot (may wait in queue)
      const acquired = await channelQueue.acquireSlot(
        message.channelId,
        message.author.id,
        message.id
      );

      if (!acquired) {
        try {
          await message.reply({
            content: "⏰ Sorry, the queue timed out. Please try again!",
            allowedMentions: { repliedUser: false },
          });
        } catch {
          // Ignore errors
        }
        return;
      }
    }

    // Record the request for rate limiting
    rateLimiter.recordRequest(message.author.id, message.channelId, isDM);

    // Start continuous typing indicator (refreshes every 8 seconds)
    // Cast is safe because we only reach here for DM/Text channels that support typing
    const stopTyping = startContinuousTyping(message.channel as TypingChannel);

    // Small delay to feel more natural
    await new Promise((resolve) => setTimeout(resolve, TYPING_DELAY));

    // Generate context ID - PER USER even in channels to prevent cross-talk
    const contextId = isDM
      ? `dm-${message.author.id}`
      : `channel-${message.channelId}-user-${message.author.id}`;

    try {
      // Get the message content (strip bot mention if present)
      let content = message.content;
      const botMention = `<@${client.user?.id}>`;
      const botMentionNick = `<@!${client.user?.id}>`;
      content = content
        .replace(botMention, "")
        .replace(botMentionNick, "")
        .trim();

      if (!content) {
        // Just a mention with no content
        stopTyping();
        await message.reply("Hey! What's up? 👋");
        if (!isDM) channelQueue.releaseSlot(message.channelId);
        return;
      }

      // Track response time
      const startTime = Date.now();

      // Get AI response (use Orchestrator for enhanced mode if enabled)
      let response: string;
      let generatedImage: { buffer: Buffer; filename: string } | undefined;

      if (config.llm.useOrchestrator) {
        // Use Orchestrator for tool-aware, security-enhanced responses
        const member = message.guild
          ? await message.guild.members
              .fetch(message.author.id)
              .catch(() => null)
          : null;

        const result = await conversationService.chatWithOrchestrator(
          content,
          message.author,
          member,
          message.channelId,
          message.guildId ?? undefined
        );

        if (result.blocked) {
          stopTyping();
          await message.reply({
            content:
              "🛡️ I couldn't process that message. Could you rephrase it?",
            allowedMentions: { repliedUser: false },
          });
          if (!isDM) channelQueue.releaseSlot(message.channelId);
          return;
        }

        response = result.response;
        generatedImage = result.generatedImage;
      } else {
        // Use standard conversation (legacy mode)
        response = await conversationService.chat(
          contextId,
          content,
          message.author.displayName || message.author.username,
          message.author.id
        );
      }

      // Record response time for presence stats
      const responseTime = Date.now() - startTime;
      recordResponseTime(responseTime);

      // Stop typing indicator before sending response
      stopTyping();

      // Build reply options with optional image attachment
      const files = generatedImage
        ? [
            new AttachmentBuilder(generatedImage.buffer, {
              name: generatedImage.filename,
            }),
          ]
        : [];

      // Split response if too long for Discord
      const maxLength = 2000;
      if (response.length <= maxLength) {
        await message.reply({
          content: response,
          files,
          allowedMentions: { repliedUser: true }, // Mention user in channels
        });
      } else {
        // Split into multiple messages - attach image to first message only
        const chunks = this.splitMessage(response, maxLength);
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (!chunk) continue;

          if (i === 0) {
            await message.reply({
              content: chunk,
              files, // Attach image to first message only
              allowedMentions: { repliedUser: true },
            });
          } else {
            await message.channel.send(chunk);
          }
        }
      }

      // Remove queue reaction if we added one
      try {
        await message.reactions.cache.get("⏳")?.users.remove(client.user?.id);
      } catch {
        // Ignore
      }
    } catch (error) {
      log.error("AI chat error:", error);

      // Stop typing indicator
      stopTyping();

      // For DMs, let them know something went wrong
      if (isDM) {
        try {
          await message.reply(
            "😅 Oops, something went wrong on my end. Please try again!"
          );
        } catch {
          // Ignore
        }
      }
    } finally {
      // Release channel slot
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
  async onReactionAdd([
    reaction,
    user,
  ]: ArgsOf<"messageReactionAdd">): Promise<void> {
    // Execute reaction handlers
    await client.executeReaction(reaction, user);
  }
}
