import {
  AttachmentBuilder,
  ChannelType,
  type DMChannel,
  Events,
  type Message,
  type NewsChannel,
  type StageChannel,
  type TextChannel,
  type ThreadChannel,
  type VoiceChannel,
} from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { LRUCache } from "lru-cache";
import { getConversationService } from "../ai/conversation.js";
import { config } from "../config.js";
import {
  DEDUPE_WINDOW_MS,
  MAX_DEDUPE_ENTRIES,
  TYPING_DELAY_MS,
  TYPING_INTERVAL_MS,
} from "../constants.js";
import { createLogger } from "../utils/logger.js";
import { recordResponseTime } from "../utils/presence.js";
import { formatCooldown, getChannelQueue, getRateLimiter } from "../utils/rate-limiter.js";
import { splitMessage } from "../utils/text.js";

const log = createLogger("MessageEvent");

// Log module initialization to verify event file is being loaded
log.info(
  `MessageEvent module loaded, test mode: ${config.testing.enabled}, verbose logging: ${config.testing.verboseLogging}`
);
if (config.testing.enabled) {
  log.info(`Test channel IDs configured: [${config.testing.alwaysRespondChannelIds.join(", ")}]`);
  if (config.testing.webhookUrl) {
    log.info(`Test webhook URL configured: ${config.testing.webhookUrl.substring(0, 50)}...`);
  }
}

// Lazy-load the client to avoid circular dependency issues
let cachedClient: Client | null = null;
async function getClient(): Promise<Client> {
  if (!cachedClient) {
    const { client } = await import("../index.js");
    cachedClient = client;
  }
  return cachedClient;
}

// Message deduplication cache - prevents duplicate responses to rapid messages
interface DedupeEntry {
  messageId: string;
  content: string;
  channelId: string;
  authorId: string;
  timestamp: number;
  processing: boolean;
}

// LRU cache for content-based deduplication (channel:user -> DedupeEntry)
const recentMessages = new LRUCache<string, DedupeEntry>({
  max: MAX_DEDUPE_ENTRIES,
  ttl: DEDUPE_WINDOW_MS,
});

// LRU cache for message ID deduplication - prevents duplicate event processing
const processedMessageIds = new LRUCache<string, boolean>({
  max: MAX_DEDUPE_ENTRIES,
  ttl: DEDUPE_WINDOW_MS * 2, // Keep IDs a bit longer for safety
});

// Active processing tracker - prevents concurrent processing for same user/channel
const activeProcessing = new Set<string>();

// LRU cache handles TTL and max size cleanup automatically - no manual cleanup interval needed

/**
 * Clean up message deduplication resources
 * Should be called during application shutdown
 */
export function cleanupMessageDeduplication(): void {
  recentMessages.clear();
  activeProcessing.clear();
  processedMessageIds.clear();
}

/**
 * Check if a message is a duplicate and atomically record it if not
 * Uses message ID for true deduplication (handles Discord sending same event twice)
 * Also checks content-based deduplication for rapid-fire similar messages
 * Returns true if the message should be skipped (is duplicate)
 */
function checkAndRecordMessage(
  messageId: string,
  content: string,
  channelId: string,
  authorId: string
): boolean {
  // First check: Has this exact message ID been processed?
  if (processedMessageIds.has(messageId)) {
    log.info(`[DEDUPE] Ignoring duplicate event for message ID ${messageId}`);
    return true;
  }

  // Second check: Is there a recent message with same content from same user in same channel?
  const contentKey = `${channelId}:${authorId}`;
  const entry = recentMessages.get(contentKey);
  if (entry?.content === content && Date.now() - entry.timestamp < DEDUPE_WINDOW_MS) {
    log.info(
      `[DEDUPE] Ignoring duplicate content from ${authorId} in ${channelId} (original msg: ${entry.messageId})`
    );
    return true;
  }

  // Third check: Is there already a message being processed for this user/channel?
  if (activeProcessing.has(contentKey)) {
    log.info(
      `[DEDUPE] Already processing message for ${authorId} in ${channelId}, skipping msg ${messageId}`
    );
    return true;
  }

  // Not a duplicate - record it atomically
  log.info(`[DEDUPE] Recording message ${messageId} for processing`);
  processedMessageIds.set(messageId, true);
  recentMessages.set(contentKey, {
    messageId,
    content,
    channelId,
    authorId,
    timestamp: Date.now(),
    processing: true,
  });
  activeProcessing.add(contentKey);

  // LRU cache handles cleanup automatically - no manual cleanup needed

  return false;
}

/**
 * Mark message processing as complete
 */
function markMessageComplete(channelId: string, authorId: string): void {
  const key = `${channelId}:${authorId}`;
  const entry = recentMessages.get(key);
  if (entry) {
    entry.processing = false;
  }
  activeProcessing.delete(key);
}

// Channels that support sendTyping
type TypingChannel =
  | DMChannel
  | TextChannel
  | NewsChannel
  | ThreadChannel
  | VoiceChannel
  | StageChannel;

/**
 * Maximum typing errors before stopping retry attempts
 */
const MAX_TYPING_ERRORS = 3;

/**
 * Helper to keep typing indicator active during long operations
 * Includes retry storm protection - stops retrying after MAX_TYPING_ERRORS failures
 */
function startContinuousTyping(channel: TypingChannel): () => void {
  let stopped = false;
  let errorCount = 0;

  // Send initial typing
  channel.sendTyping().catch((err) => {
    errorCount++;
    log.debug(
      `Typing indicator error (${errorCount}/${MAX_TYPING_ERRORS}): ${err instanceof Error ? err.message : String(err)}`
    );
  });

  // Keep refreshing typing indicator every 8 seconds
  const interval = setInterval(() => {
    if (!stopped && errorCount < MAX_TYPING_ERRORS) {
      channel.sendTyping().catch((err) => {
        errorCount++;
        log.debug(
          `Typing indicator error (${errorCount}/${MAX_TYPING_ERRORS}): ${err instanceof Error ? err.message : String(err)}`
        );
        if (errorCount >= MAX_TYPING_ERRORS) {
          log.debug("Stopping typing indicator retries after too many errors");
          clearInterval(interval);
        }
      });
    }
  }, TYPING_INTERVAL_MS);

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
    setTimeout(() => {
      cooldownMsg.delete().catch((err) => {
        log.debug(
          `Failed to delete cooldown message: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }, 5000);
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
function extractMessageContent(
  message: ArgsOf<"messageCreate">[0],
  botId: string | undefined
): string {
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
  conversationService: ReturnType<typeof getConversationService>,
  onImageGenerationStart?: () => Promise<void>,
  onTyping?: () => Promise<void>
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
      message.guildId ?? undefined,
      onImageGenerationStart,
      onTyping
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
  // Verbose logging for test channels (only when TEST_MODE is enabled)
  if (
    config.testing.enabled &&
    config.testing.alwaysRespondChannelIds.includes(message.channelId)
  ) {
    log.info(
      `[TEST] Sending response to ${message.author.username} in channel ${message.channelId}:`
    );
    log.info(
      `[TEST] Response (${response.length} chars): ${response.substring(0, 500)}${response.length > 500 ? "..." : ""}`
    );
    if (generatedImage) {
      log.info(`[TEST] Attached image: ${generatedImage.filename}`);
    }
  }

  const files = generatedImage
    ? [new AttachmentBuilder(generatedImage.buffer, { name: generatedImage.filename })]
    : [];

  const maxLength = 2000;
  if (response.length <= maxLength) {
    log.info(
      `[REPLY-TRACE] sendAIResponse: About to reply with "${response.substring(0, 50)}..." to message ${message.id}`
    );
    await message.reply({
      content: response,
      files,
      allowedMentions: { repliedUser: true },
    });
    log.info(`[REPLY-TRACE] sendAIResponse: Reply sent successfully for message ${message.id}`);
    return;
  }

  // Split into multiple messages - attach image to first message only
  const chunks = splitMessage(response, maxLength);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    if (i === 0) {
      log.info(`[REPLY-TRACE] sendAIResponse: About to reply chunk ${i} to message ${message.id}`);
      await message.reply({
        content: chunk,
        files,
        allowedMentions: { repliedUser: true },
      });
    } else {
      log.info(
        `[REPLY-TRACE] sendAIResponse: About to send chunk ${i} to channel ${message.channelId}`
      );
      await message.channel.send(chunk);
    }
  }
}

/**
 * Check if a message should be processed based on author and channel
 * Returns true if the message should be ignored
 */
function shouldIgnoreMessage(message: ArgsOf<"messageCreate">[0]): {
  ignore: boolean;
  isTestChannel: boolean;
} {
  const isTestChannel =
    config.testing.enabled && config.testing.alwaysRespondChannelIds.includes(message.channelId);
  const isWebhook = message.webhookId !== null;

  // Allow webhook messages in test channels
  if (message.author.bot && !(isTestChannel && isWebhook)) {
    return { ignore: true, isTestChannel };
  }

  return { ignore: false, isTestChannel };
}

@Discord()
export class MessageEvent {
  @On({ event: Events.MessageCreate })
  async onMessage([message]: ArgsOf<"messageCreate">): Promise<void> {
    // Debug entry logging for all messages
    if (config.testing.verboseLogging) {
      this.logMessageDebug(message);
    }

    // Check if message should be ignored (bot messages, unless webhook in test channel)
    const { ignore, isTestChannel } = shouldIgnoreMessage(message);
    if (ignore) return;

    // Log webhook processing in test mode
    if (isTestChannel && message.webhookId && config.testing.verboseLogging) {
      log.info(`[TEST] Processing webhook message in test channel ${message.channelId}`);
    }

    // Atomic check-and-record for deduplication
    // This prevents race conditions where two events for the same message both get through
    if (checkAndRecordMessage(message.id, message.content, message.channelId, message.author.id)) {
      if (config.testing.verboseLogging) {
        log.info(
          `[DEDUPE] Skipping duplicate message ${message.id} from ${message.author.username}`
        );
      }
      return;
    }

    // Get client lazily to avoid circular dependency
    const client = await getClient();

    // Execute simple commands (prefix-based) first
    await client.executeCommand(message);

    // Check if this is a message we should respond to with AI
    if (!this.shouldRespondWithAI(message, client)) {
      // Not responding with AI - clean up tracking
      markMessageComplete(message.channelId, message.author.id);
      return;
    }

    const isDM = message.channel.type === ChannelType.DM;
    const conversationService = getConversationService();
    const rateLimiter = getRateLimiter();
    const channelQueue = getChannelQueue();

    // Check if AI is available
    const available = await checkAIAvailability(message, conversationService, isDM);
    if (!available) {
      markMessageComplete(message.channelId, message.author.id);
      return;
    }

    // Check rate limit (only enforced in channels, lenient in DMs)
    const cooldownRemaining = rateLimiter.checkCooldown(message.author.id, message.channelId, isDM);
    if (cooldownRemaining > 0 && !isDM) {
      await handleRateLimitCooldown(message, cooldownRemaining);
      markMessageComplete(message.channelId, message.author.id);
      return;
    }

    // For channels, check concurrency and queue
    if (!isDM) {
      const acquired = await acquireChannelQueue(message, channelQueue);
      if (!acquired) {
        markMessageComplete(message.channelId, message.author.id);
        return;
      }
    }

    // Record the request for rate limiting
    rateLimiter.recordRequest(message.author.id, message.channelId, isDM);

    try {
      await this.processAIRequest(message, isDM, conversationService, channelQueue, client);
    } finally {
      // Always mark message as complete, even on error
      markMessageComplete(message.channelId, message.author.id);
    }
  }

  /**
   * Handle early exit scenarios (empty content, blocked, empty response)
   * Returns true if we should exit early
   * Note: Queue slot release and reaction cleanup are handled in finally block
   */
  private async handleEarlyExit(
    message: ArgsOf<"messageCreate">[0],
    result: AIResponseResult,
    content: string,
    _isDM: boolean,
    _channelQueue: ReturnType<typeof getChannelQueue>,
    stopTyping: () => void
  ): Promise<boolean> {
    // Empty content
    if (!content) {
      stopTyping();
      await message.reply("Hey! What's up? 👋");
      return true;
    }

    // Blocked response
    if (result.blocked) {
      stopTyping();
      await message.reply({
        content: "🛡️ I couldn't process that message. Could you rephrase it?",
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    // Empty AI response
    if (!result.response || result.response.trim().length === 0) {
      stopTyping();
      log.warn("AI returned empty response");
      await message.reply({
        content: "I'm having trouble thinking right now. Please try again in a moment.",
        allowedMentions: { repliedUser: false },
      });
      return true;
    }

    return false;
  }

  /**
   * Safely delete a message, ignoring errors
   */
  private async safeDeleteMessage(msg: Message | null): Promise<void> {
    if (!msg) return;
    try {
      await msg.delete();
    } catch {
      // Ignore deletion errors
    }
  }

  /**
   * Safely remove the queue reaction from a message
   */
  private async safeRemoveQueueReaction(
    message: ArgsOf<"messageCreate">[0],
    botUserId: string | undefined
  ): Promise<void> {
    // Guard against undefined botUserId - Discord API requires a valid ID
    if (!botUserId) return;

    try {
      await message.reactions.cache.get("⏳")?.users.remove(botUserId);
    } catch {
      // Ignore reaction removal errors
    }
  }

  /**
   * Process the AI request after initial validation
   */
  private async processAIRequest(
    message: ArgsOf<"messageCreate">[0],
    isDM: boolean,
    conversationService: ReturnType<typeof getConversationService>,
    channelQueue: ReturnType<typeof getChannelQueue>,
    client: Client
  ): Promise<void> {
    // Start continuous typing indicator
    const stopTyping = startContinuousTyping(message.channel as TypingChannel);

    // Small delay to feel more natural
    await new Promise((resolve) => setTimeout(resolve, TYPING_DELAY_MS));

    // Generate context ID - PER USER even in channels to prevent cross-talk
    const contextId = isDM
      ? `dm-${message.author.id}`
      : `channel-${message.channelId}-user-${message.author.id}`;

    // Track "generating image" message so we can delete it later
    const imageGenState: { message: Message | null } = { message: null };

    try {
      const content = extractMessageContent(message, client.user?.id);
      const startTime = Date.now();

      // Callback to notify user when image generation starts
      const onImageGenerationStart = async (): Promise<void> => {
        try {
          imageGenState.message = await message.reply({
            content: "🎨 Generating your image, this may take a minute or two...",
            allowedMentions: { repliedUser: false },
          });
        } catch (err) {
          log.warn("Failed to send image generation notice:", err);
        }
      };

      // Callback to trigger typing indicator
      const onTyping = async (): Promise<void> => {
        try {
          await (message.channel as TypingChannel).sendTyping();
        } catch (err) {
          log.debug(`Typing indicator error: ${err instanceof Error ? err.message : String(err)}`);
        }
      };

      // Get AI response (or empty result for content check)
      const result = content
        ? await generateAIResponse(
            message,
            content,
            contextId,
            conversationService,
            onImageGenerationStart,
            onTyping
          )
        : { response: "" };

      // Handle early exits
      const shouldExit = await this.handleEarlyExit(
        message,
        result,
        content,
        isDM,
        channelQueue,
        stopTyping
      );
      if (shouldExit) {
        await this.safeDeleteMessage(imageGenState.message);
        return;
      }

      // Record response time for presence stats
      recordResponseTime(Date.now() - startTime);
      stopTyping();

      // Delete the "generating image" notice before sending the actual response
      await this.safeDeleteMessage(imageGenState.message);

      // Send the response
      await sendAIResponse(message, result.response, result.generatedImage, splitMessage);
    } catch (error) {
      log.error("AI chat error:", error);
      stopTyping();
      await this.safeDeleteMessage(imageGenState.message);
      await this.handleAIError(message, isDM);
    } finally {
      // Always clean up: remove queue reaction and release slot
      await this.safeRemoveQueueReaction(message, client.user?.id);
      if (!isDM) {
        channelQueue.releaseSlot(message.channelId);
      }
    }
  }

  /**
   * Handle AI chat errors
   */
  private async handleAIError(message: ArgsOf<"messageCreate">[0], _isDM: boolean): Promise<void> {
    try {
      // Send error message in both DMs and channels (including test channels)
      await message.reply({
        content: "😅 Oops, something went wrong on my end. Please try again!",
        allowedMentions: { repliedUser: false },
      });
    } catch (error) {
      // Log if we can't even send the error message
      log.warn("Failed to send error message to user", error instanceof Error ? error : undefined);
    }
  }

  /**
   * Log debug info for incoming messages
   */
  private logMessageDebug(message: ArgsOf<"messageCreate">[0]): void {
    log.info(
      `[MSG-DEBUG] Received message from ${message.author.username} (bot: ${message.author.bot}, webhook: ${message.webhookId ?? "none"}) in channel ${message.channelId}: "${message.content.substring(0, 50)}"`
    );
    log.info(
      `[MSG-DEBUG] Test channels configured: [${config.testing.alwaysRespondChannelIds.join(", ")}]`
    );
  }

  /**
   * Determine if the bot should respond to this message with AI
   * In channels: Only responds when @mentioned (or in test channels when TEST_MODE=true)
   * In DMs: Always responds
   */
  private shouldRespondWithAI(message: ArgsOf<"messageCreate">[0], client: Client): boolean {
    // Always respond in DMs
    if (message.channel.type === ChannelType.DM) {
      return true;
    }

    // Always respond in designated test channels (only when TEST_MODE is enabled)
    if (
      config.testing.enabled &&
      config.testing.alwaysRespondChannelIds.includes(message.channelId)
    ) {
      if (config.testing.verboseLogging) {
        log.info(
          `[TEST] Responding to message in test channel ${message.channelId} from ${message.author.username}: ${message.content.substring(0, 100)}`
        );
      }
      return true;
    }

    // In channels, only respond if bot is @mentioned
    if (client.user && message.mentions.has(client.user.id)) {
      return true;
    }

    return false;
  }

  @On({ event: Events.MessageReactionAdd })
  async onReactionAdd([reaction, user]: ArgsOf<"messageReactionAdd">): Promise<void> {
    // Get client lazily to avoid circular dependency
    const client = await getClient();
    // Execute reaction handlers
    await client.executeReaction(reaction, user);
  }
}
