/**
 * Conversation Store
 * Valkey-backed conversation storage with automatic TTL and summarization triggers
 */

import { config } from "../../config.js";
import { getCache } from "../../utils/cache.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ConversationStore");

/**
 * Single message in a conversation
 */
export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
}

/**
 * Conversation metadata
 */
export interface ConversationMetadata {
  userId: string;
  channelId: string;
  guildId: string | null;
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
  summarized: boolean;
  summary?: string;
}

/**
 * Full conversation with messages and metadata
 */
export interface Conversation {
  id: string;
  metadata: ConversationMetadata;
  messages: ConversationMessage[];
}

/**
 * Generate a unique conversation key
 */
function getConversationKey(userId: string, channelId: string): string {
  return `conversation:${userId}:${channelId}`;
}

/**
 * ConversationStore - manages conversation state in Valkey
 */
export class ConversationStore {
  private readonly ttlMs: number;
  private readonly summarizeAfterMessages: number;
  private readonly summarizeAfterIdleMs: number;

  constructor() {
    this.ttlMs = config.valkey.conversationTtlMs;
    this.summarizeAfterMessages = config.memory.summarizeAfterMessages;
    this.summarizeAfterIdleMs = config.memory.summarizeAfterIdleMs;
  }

  /**
   * Get or create a conversation
   */
  async getOrCreate(
    userId: string,
    channelId: string,
    guildId: string | null
  ): Promise<Conversation> {
    const key = getConversationKey(userId, channelId);
    const cache = getCache();
    const existing = await cache.get(key);

    if (existing) {
      try {
        const conversation: Conversation = JSON.parse(existing);
        // Refresh TTL on access
        await cache.expire(key, this.ttlMs);
        return conversation;
      } catch (error) {
        log.warn(
          "Failed to parse conversation, creating new: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
    }

    // Create new conversation
    const conversation: Conversation = {
      id: `${userId}-${channelId}-${Date.now()}`,
      metadata: {
        userId,
        channelId,
        guildId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        messageCount: 0,
        summarized: false,
      },
      messages: [],
    };

    await this.save(conversation);
    return conversation;
  }

  /**
   * Add a message to the conversation
   */
  async addMessage(
    userId: string,
    channelId: string,
    guildId: string | null,
    message: Omit<ConversationMessage, "timestamp">
  ): Promise<{ conversation: Conversation; shouldSummarize: boolean }> {
    const conversation = await this.getOrCreate(userId, channelId, guildId);

    const fullMessage: ConversationMessage = {
      ...message,
      timestamp: Date.now(),
    };

    conversation.messages.push(fullMessage);
    conversation.metadata.lastActivityAt = Date.now();
    conversation.metadata.messageCount++;

    await this.save(conversation);

    // Check if summarization should be triggered
    const shouldSummarize = this.shouldTriggerSummarization(conversation);

    return { conversation, shouldSummarize };
  }

  /**
   * Get recent messages for context
   */
  async getRecentMessages(
    userId: string,
    channelId: string,
    maxMessages?: number
  ): Promise<ConversationMessage[]> {
    const key = getConversationKey(userId, channelId);
    const cache = getCache();
    const data = await cache.get(key);

    if (!data) return [];

    try {
      const conversation: Conversation = JSON.parse(data);
      const messages = conversation.messages;

      if (maxMessages !== undefined && messages.length > maxMessages) {
        return messages.slice(-maxMessages);
      }

      return messages;
    } catch {
      return [];
    }
  }

  /**
   * Save conversation to cache
   */
  private async save(conversation: Conversation): Promise<void> {
    const key = getConversationKey(conversation.metadata.userId, conversation.metadata.channelId);
    const cache = getCache();
    await cache.set(key, JSON.stringify(conversation), this.ttlMs);
  }

  /**
   * Mark conversation as summarized
   */
  async markSummarized(userId: string, channelId: string, summary: string): Promise<void> {
    const key = getConversationKey(userId, channelId);
    const cache = getCache();
    const data = await cache.get(key);

    if (!data) return;

    try {
      const conversation: Conversation = JSON.parse(data);
      conversation.metadata.summarized = true;
      conversation.metadata.summary = summary;
      // Keep only the summary context after summarization
      conversation.messages = [
        {
          role: "system",
          content: `[Previous conversation summary]\n${summary}`,
          timestamp: Date.now(),
        },
      ];
      conversation.metadata.messageCount = 1;
      await this.save(conversation);
      log.info(`Summarized conversation for user ${userId}`);
    } catch (error) {
      log.error(
        "Failed to mark conversation as summarized: " +
          (error instanceof Error ? error.message : String(error)),
        error
      );
    }
  }

  /**
   * Check if summarization should be triggered
   */
  private shouldTriggerSummarization(conversation: Conversation): boolean {
    // Don't summarize if already summarized recently
    if (conversation.metadata.summarized) {
      return false;
    }

    // Trigger if message count exceeds threshold
    if (conversation.metadata.messageCount >= this.summarizeAfterMessages) {
      return true;
    }

    // Trigger if idle for too long
    const idleTime = Date.now() - conversation.metadata.lastActivityAt;
    if (idleTime >= this.summarizeAfterIdleMs) {
      return true;
    }

    return false;
  }

  /**
   * Clear a conversation
   */
  async clear(userId: string, channelId: string): Promise<void> {
    const key = getConversationKey(userId, channelId);
    const cache = getCache();
    await cache.del(key);
    log.debug(`Cleared conversation for user ${userId} in channel ${channelId}`);
  }

  /**
   * Get all active conversation keys for a user
   */
  async getUserConversations(userId: string): Promise<string[]> {
    const cache = getCache();
    return cache.keys(`conversation:${userId}:*`);
  }

  /**
   * Check if a conversation exists
   */
  async exists(userId: string, channelId: string): Promise<boolean> {
    const key = getConversationKey(userId, channelId);
    const cache = getCache();
    return cache.exists(key);
  }

  /**
   * Get conversation metadata without full messages
   */
  async getMetadata(userId: string, channelId: string): Promise<ConversationMetadata | null> {
    const key = getConversationKey(userId, channelId);
    const cache = getCache();
    const data = await cache.get(key);

    if (!data) return null;

    try {
      const conversation: Conversation = JSON.parse(data);
      return conversation.metadata;
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const conversationStore = new ConversationStore();
