/**
 * Memory Manager
 * Wraps Mem0 to provide user-isolated semantic memory for the Discord bot
 * Implements three-tier memory architecture:
 * 1. Active Context (Valkey) - Current conversation
 * 2. User Profile (Mem0) - Preferences, facts
 * 3. Episodic Sessions (Mem0) - Past conversations
 *
 * CRITICAL SECURITY: User memories are strictly isolated by user_id.
 * Each user can only access their own memories.
 */

import { getMem0Client } from "./mem0.js";
import { createLogger } from "../../utils/logger.js";
import { config } from "../../config.js";
import { conversationStore, type ConversationMessage } from "./conversation-store.js";

const log = createLogger("MemoryManager");

// Special user ID for the bot's own memories
export const BOT_USER_ID = "bot";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface MemoryResult {
  id: string;
  memory: string;
  score?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export class MemoryManager {
  private static instance: MemoryManager;

  private constructor() {}

  public static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  /**
   * Add memories from a conversation
   * Mem0 automatically extracts relevant facts from the messages
   *
   * @param userId - Discord user ID (strict isolation)
   * @param messages - Conversation messages to extract memories from
   * @param metadata - Optional metadata to attach to memories
   */
  async addFromConversation(
    userId: string,
    messages: Message[],
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    if (!userId) {
      log.warn("Attempted to add memory without userId - skipping");
      return;
    }

    try {
      const mem0 = getMem0Client();
      await mem0.add(messages, { userId, metadata });
      log.debug(`Added memories from conversation for user ${userId}`);
    } catch (error) {
      log.error(`Failed to add memories for user ${userId}:`, error as Error);
      // Don't throw - memory failures shouldn't break the conversation
    }
  }

  /**
   * Add a single memory fact
   *
   * @param userId - Discord user ID (strict isolation)
   * @param content - The memory content to store
   * @param metadata - Optional metadata
   */
  async addMemory(
    userId: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<boolean> {
    if (!userId) {
      log.warn("Attempted to add memory without userId - skipping");
      return false;
    }

    try {
      const mem0 = getMem0Client();
      await mem0.add(content, { userId, metadata });
      log.debug(`Added memory for user ${userId}`);
      return true;
    } catch (error) {
      log.error(`Failed to add memory for user ${userId}:`, error as Error);
      return false;
    }
  }

  /**
   * Search for relevant memories
   * Uses semantic search to find memories related to the query
   *
   * SECURITY: Results are strictly filtered to the specified userId
   *
   * @param userId - Discord user ID (strict isolation)
   * @param query - The query to search for
   * @param limit - Maximum number of results
   */
  async searchMemories(userId: string, query: string, limit = 5): Promise<MemoryResult[]> {
    if (!userId) {
      log.warn("Attempted to search memories without userId - returning empty");
      return [];
    }

    try {
      const mem0 = getMem0Client();
      const results = await mem0.search(query, { userId, limit });

      // Map to our interface - Mem0 returns MemoryItem[]
      return (results.results || []).map((r) => ({
        id: r.id,
        memory: r.memory,
        score: r.score,
        metadata: r.metadata,
      }));
    } catch (error) {
      log.error(`Failed to search memories for user ${userId}:`, error as Error);
      return [];
    }
  }

  /**
   * Get all memories for a user
   *
   * SECURITY: Only returns memories for the specified userId
   *
   * @param userId - Discord user ID (strict isolation)
   */
  async getAllMemories(userId: string): Promise<MemoryResult[]> {
    if (!userId) {
      log.warn("Attempted to get memories without userId - returning empty");
      return [];
    }

    try {
      const mem0 = getMem0Client();
      const results = await mem0.getAll({ userId });

      // Map to our interface - Mem0 returns MemoryItem[]
      return (results.results || []).map((r) => ({
        id: r.id,
        memory: r.memory,
        score: r.score,
        metadata: r.metadata,
      }));
    } catch (error) {
      log.error(`Failed to get memories for user ${userId}:`, error as Error);
      return [];
    }
  }

  /**
   * Delete a specific memory by ID
   *
   * Note: Memory IDs are unique, so this is safe across users
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    try {
      const mem0 = getMem0Client();
      await mem0.delete(memoryId);
      log.debug(`Deleted memory ${memoryId}`);
      return true;
    } catch (error) {
      log.error(`Failed to delete memory ${memoryId}:`, error as Error);
      return false;
    }
  }

  /**
   * Delete all memories for a user
   *
   * SECURITY: Only deletes memories for the specified userId
   *
   * @param userId - Discord user ID (strict isolation)
   */
  async deleteAllMemories(userId: string): Promise<number> {
    if (!userId) {
      log.warn("Attempted to delete memories without userId - skipping");
      return 0;
    }

    try {
      const mem0 = getMem0Client();

      // Get count before deletion
      const existing = await this.getAllMemories(userId);
      const count = existing.length;

      await mem0.deleteAll({ userId });
      log.info(`Deleted ${count} memories for user ${userId}`);
      return count;
    } catch (error) {
      log.error(`Failed to delete memories for user ${userId}:`, error as Error);
      return 0;
    }
  }

  /**
   * Build context from user memories for injection into prompts
   *
   * @param userId - Discord user ID
   * @param query - Current query to find relevant memories
   * @returns Formatted memory context string
   */
  async buildMemoryContext(userId: string, query: string): Promise<string> {
    const memories = await this.searchMemories(userId, query, 10);

    if (memories.length === 0) {
      return "";
    }

    const memoryLines = memories.map((m) => `• ${m.memory}`).join("\n");

    return `## Recalled Memories About This User\n${memoryLines}`;
  }

  /**
   * Build context including both user and bot memories
   *
   * @param userId - Discord user ID
   * @param query - Current query
   * @returns Combined memory context
   */
  async buildFullContext(userId: string, query: string): Promise<string> {
    const [userContext, botContext] = await Promise.all([
      this.buildMemoryContext(userId, query),
      this.buildMemoryContext(BOT_USER_ID, query),
    ]);

    const parts: string[] = [];

    if (userContext) {
      parts.push(userContext);
    }

    if (botContext) {
      parts.push(
        `## My Own Memories & Knowledge\n${botContext.replace(
          "## Recalled Memories About This User\n",
          ""
        )}`
      );
    }

    return parts.join("\n\n");
  }

  /**
   * Build comprehensive context for chat using three-tier memory
   *
   * Tier allocation (from config):
   * - Active Context: 50% - Current conversation from Valkey
   * - User Profile: 30% - User preferences and facts from Mem0
   * - Episodic: 20% - Relevant past sessions from Mem0
   *
   * @param userId - Discord user ID
   * @param channelId - Discord channel ID
   * @param currentQuery - The current user message
   * @returns Formatted context for the LLM
   */
  async buildContextForChat(
    userId: string,
    channelId: string,
    currentQuery: string
  ): Promise<{
    systemContext: string;
    conversationHistory: ConversationMessage[];
  }> {
    const maxTokens = config.memory.maxContextTokens;
    const allocation = config.memory.tierAllocation;

    // Rough token estimation (4 chars per token average)
    const charsPerToken = 4;
    const activeTokens = Math.floor(maxTokens * allocation.activeContext);
    const profileTokens = Math.floor(maxTokens * allocation.userProfile);
    const episodicTokens = Math.floor(maxTokens * allocation.episodic);

    // Tier 1: Active Context (from Valkey)
    const recentMessages = await conversationStore.getRecentMessages(
      userId,
      channelId,
      20 // Get up to 20 recent messages
    );

    // Trim to token budget
    const conversationHistory = this.trimToTokenBudget(
      recentMessages,
      activeTokens * charsPerToken
    );

    // Tier 2: User Profile (from Mem0)
    const userProfileMemories = await this.searchMemories(
      userId,
      "user preferences personality facts",
      10
    );

    let profileContext = "";
    if (userProfileMemories.length > 0) {
      const profileLines = userProfileMemories.map((m) => `• ${m.memory}`).join("\n");
      profileContext = this.trimString(profileLines, profileTokens * charsPerToken);
    }

    // Tier 3: Episodic Sessions (relevant past conversations from Mem0)
    const episodicMemories = await this.searchMemories(userId, currentQuery, 5);

    let episodicContext = "";
    if (episodicMemories.length > 0) {
      const episodicLines = episodicMemories
        .filter((m) => !userProfileMemories.some((p) => p.id === m.id))
        .map((m) => `• ${m.memory}`)
        .join("\n");
      episodicContext = this.trimString(episodicLines, episodicTokens * charsPerToken);
    }

    // Build system context
    const contextParts: string[] = [];

    if (profileContext) {
      contextParts.push(`## About This User\n${profileContext}`);
    }

    if (episodicContext) {
      contextParts.push(`## Relevant Past Conversations\n${episodicContext}`);
    }

    // Check for previous conversation summary
    const metadata = await conversationStore.getMetadata(userId, channelId);
    if (metadata?.summarized && metadata.summary) {
      contextParts.push(`## Previous Session Summary\n${metadata.summary}`);
    }

    return {
      systemContext: contextParts.join("\n\n"),
      conversationHistory,
    };
  }

  /**
   * Trim messages to fit within token budget
   */
  private trimToTokenBudget(
    messages: ConversationMessage[],
    maxChars: number
  ): ConversationMessage[] {
    let totalChars = 0;
    const result: ConversationMessage[] = [];

    // Start from most recent and work backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;

      const msgChars = msg.content.length + 20; // Add overhead for role

      if (totalChars + msgChars > maxChars) {
        break;
      }

      result.unshift(msg);
      totalChars += msgChars;
    }

    return result;
  }

  /**
   * Trim a string to max characters
   */
  private trimString(str: string, maxChars: number): string {
    if (str.length <= maxChars) return str;
    return str.slice(0, maxChars - 3) + "...";
  }

  /**
   * Store episodic memory from a summarized session
   */
  async storeEpisodicMemory(userId: string, summary: string): Promise<boolean> {
    return this.addMemory(userId, summary, {
      type: "episodic",
      timestamp: Date.now(),
    });
  }
}
