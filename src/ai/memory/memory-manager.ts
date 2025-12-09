/**
 * Memory Manager
 * Wraps ChromaDB to provide user-isolated semantic memory for the Discord bot
 * Implements three-tier memory architecture:
 * 1. Active Context (Valkey) - Current conversation
 * 2. User Profile (ChromaDB) - Preferences, facts
 * 3. Episodic Sessions (ChromaDB) - Past conversations
 *
 * CRITICAL SECURITY: User memories are strictly isolated by user_id.
 * Each user can only access their own memories.
 */

import { config } from "../../config.js";
import {
  MEMORY_IMPORTANCE_EPISODIC_DEFAULT,
  MEMORY_IMPORTANCE_EPISODIC_SUBSTANTIVE,
  MEMORY_IMPORTANCE_LOW_VALUE,
  MEMORY_IMPORTANCE_PREFERENCE,
  MEMORY_IMPORTANCE_PROCEDURAL,
  MEMORY_IMPORTANCE_SHORT_MESSAGE,
  MEMORY_IMPORTANCE_USER_PROFILE,
} from "../../constants.js";
import { createLogger } from "../../utils/logger.js";
import { getChromaClient, type MemoryDocument } from "./chroma.js";
import { type ConversationMessage, conversationStore } from "./conversation-store.js";

const log = createLogger("MemoryManager");

// Special user ID for the bot's own memories
export const BOT_USER_ID = "bot";

/**
 * Discord snowflake ID validation pattern
 * Snowflakes are 17-19 digit numbers
 */
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,19}$/;

/**
 * Validate a Discord user ID (snowflake format or special BOT_USER_ID)
 */
function isValidUserId(userId: string): boolean {
  return userId === BOT_USER_ID || DISCORD_SNOWFLAKE_PATTERN.test(userId);
}

/**
 * Pattern sets for memory classification
 * Used to determine memory type and importance
 *
 * Memory types follow ENGRAM 3-type architecture:
 * - Episodic: Past events and conversations
 * - Semantic: Facts and knowledge (user_profile, fact)
 * - Procedural: How to interact with the user (preferences, communication style)
 */
const MEMORY_PATTERNS = {
  // Patterns that indicate user preferences (highest importance)
  preference: [
    /\bi (?:like|love|prefer|enjoy|hate|dislike)\b/i,
    /\bmy (?:favorite|favourite|preferred)\b/i,
    /\bi (?:always|never|usually)\b/i,
    /\bi'm (?:interested in|into|passionate about)\b/i,
    /\bcall me\b/i,
    /\bi want (?:you )?to\b/i,
  ],
  // Patterns that indicate facts about the user
  fact: [
    /\bi (?:am|work|live|have|own|study)\b/i,
    /\bmy (?:name|job|work|home|house|dog|cat|pet|car|hobby|hobbies)\b/i,
    /\bi'm (?:a|an|from)\b/i,
    /\bi (?:was|used to|grew up)\b/i,
    /\bi've (?:been|worked|lived)\b/i,
  ],
  // Patterns that indicate procedural memory (how to interact with user)
  // These capture communication style preferences and interaction patterns
  procedural: [
    // Response style preferences
    /\b(?:be|keep it|make it|stay) (?:brief|concise|short|detailed|thorough)\b/i,
    /\b(?:don't|do not|please|can you) (?:explain|elaborate|be verbose|give (?:me )?examples)\b/i,
    /\b(?:more|less) (?:formal|casual|technical|simple)\b/i,
    // Communication format preferences
    /\b(?:use|prefer|like) (?:bullet points|lists|code blocks|examples)\b/i,
    /\b(?:skip|no need for|don't need) (?:the )?(?:intro|introduction|explanation|preamble)\b/i,
    /\bjust (?:give me|show me|tell me)\b/i,
    // Interaction style
    /\b(?:ask me|check with me|confirm) (?:before|first)\b/i,
    /\bdon't assume\b/i,
    /\balways (?:ask|include|show)\b/i,
    /\bnever (?:ask|include|show)\b/i,
  ],
  // Patterns that indicate low-value content
  lowValue: [
    /^(?:ok|okay|sure|yes|no|yeah|nah|thanks|thank you|lol|haha|hmm|um|uh|idk)\.?$/i,
    /^(?:hi|hello|hey|bye|goodbye|good night|good morning)\.?$/i,
    /^(?:what|how|why|when|where|who)\?$/i, // Simple one-word questions
    /\btest(?:ing)?\b/i,
    /\bignore\b/i,
  ],
};

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
   * ChromaDB stores each message as a memory with semantic embeddings
   *
   * @param userId - Discord user ID (strict isolation)
   * @param messages - Conversation messages to extract memories from
   * @param metadata - Optional metadata to attach to memories
   */
  async addFromConversation(
    userId: string,
    messages: Message[],
    _metadata: Record<string, unknown> = {}
  ): Promise<void> {
    if (!config.memory.enabled) return;

    if (!userId) {
      log.warn("Attempted to add memory without userId - skipping");
      return;
    }

    // Validate userId format
    if (!isValidUserId(userId)) {
      log.warn(`Invalid userId format: ${userId} - skipping memory addition`);
      return;
    }

    try {
      const chroma = getChromaClient();

      // Process each message and classify it
      for (const msg of messages) {
        const content = `${msg.role === "user" ? "User said" : "Assistant replied"}: ${msg.content}`;

        // Classify the message content to determine memory type and importance
        const { type, importance } = this.classifyMemory(msg.content, msg.role);

        // Only store memories that meet the minimum importance threshold
        if (importance >= config.memory.minImportanceForStorage) {
          // Use addOrUpdateMemory to prevent duplicates and consolidate similar memories
          const result = await chroma.addOrUpdateMemory(
            userId,
            content,
            type,
            "conversation",
            importance
          );
          if (result.updated) {
            log.debug(`Updated existing memory instead of creating duplicate for user ${userId}`);
          }
        } else {
          log.debug(
            `Skipping low-importance memory (${importance.toFixed(2)}): ${content.slice(0, 50)}...`
          );
        }
      }

      log.debug(`Processed ${messages.length} messages for user ${userId}`);
    } catch (error) {
      log.error(`Failed to add memories for user ${userId}:`, error as Error);
      // Don't throw - memory failures shouldn't break the conversation
    }
  }

  /**
   * Classify a message to determine memory type and importance
   *
   * Uses heuristics to identify (ENGRAM 3-type pattern):
   * - Procedural: How user wants to be responded to (highest importance)
   * - Preferences: What user likes/dislikes (high importance)
   * - Facts/User Profile: Facts about the user (high importance)
   * - Episodic: Meaningful conversations (medium importance)
   * - Low-value: Chatter (low importance, may be filtered out)
   */
  private classifyMemory(
    content: string,
    role: "user" | "assistant"
  ): { type: MemoryDocument["metadata"]["type"]; importance: number } {
    // Check for low-value content first
    if (this.matchesAnyPattern(content.trim(), MEMORY_PATTERNS.lowValue)) {
      return { type: "episodic", importance: MEMORY_IMPORTANCE_LOW_VALUE };
    }

    // Very short messages are usually low value
    if (content.length < 20) {
      return { type: "episodic", importance: MEMORY_IMPORTANCE_SHORT_MESSAGE };
    }

    // Check for preferences, facts, and procedural (user messages only)
    if (role === "user") {
      // Procedural memories (how to interact) are highest priority
      // These tell us HOW to respond, not just what the user likes
      if (this.matchesAnyPattern(content, MEMORY_PATTERNS.procedural)) {
        return { type: "procedural", importance: MEMORY_IMPORTANCE_PROCEDURAL };
      }
      if (this.matchesAnyPattern(content, MEMORY_PATTERNS.preference)) {
        return { type: "preference", importance: MEMORY_IMPORTANCE_PREFERENCE };
      }
      if (this.matchesAnyPattern(content, MEMORY_PATTERNS.fact)) {
        return { type: "user_profile", importance: MEMORY_IMPORTANCE_USER_PROFILE };
      }
    }

    // Substantive content based on length
    if (content.length > 100 || (role === "user" && content.length > 50)) {
      return { type: "episodic", importance: MEMORY_IMPORTANCE_EPISODIC_SUBSTANTIVE };
    }

    // Default: low-medium importance episodic
    return { type: "episodic", importance: MEMORY_IMPORTANCE_EPISODIC_DEFAULT };
  }

  /**
   * Check if content matches any pattern in the list
   */
  private matchesAnyPattern(content: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(content));
  }

  /**
   * Add a single memory fact
   * Uses smart update logic - if a similar memory exists, updates it instead of creating duplicate
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

    // Validate userId format
    if (!isValidUserId(userId)) {
      log.warn(`Invalid userId format: ${userId} - skipping memory addition`);
      return false;
    }

    try {
      const chroma = getChromaClient();
      const memoryType =
        (metadata.type as "user_profile" | "episodic" | "fact" | "preference") ?? "fact";

      // Use addOrUpdateMemory to prevent duplicates
      const result = await chroma.addOrUpdateMemory(userId, content, memoryType, "manual");
      if (result.updated) {
        log.debug(`Updated existing memory for user ${userId}`);
      } else {
        log.debug(`Added new memory for user ${userId}`);
      }
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
   * @param types - Optional memory type filter (e.g., ["user_profile", "preference"])
   */
  async searchMemories(
    userId: string,
    query: string,
    limit = 5,
    types?: MemoryDocument["metadata"]["type"][]
  ): Promise<MemoryResult[]> {
    if (!userId) {
      log.warn("Attempted to search memories without userId - returning empty");
      return [];
    }

    // Validate userId format
    if (!isValidUserId(userId)) {
      log.warn(`Invalid userId format: ${userId} - returning empty results`);
      return [];
    }

    try {
      const chroma = getChromaClient();
      const results = await chroma.searchMemories(userId, query, limit, types);

      // Map ChromaDB results to our interface
      return results.map((r) => ({
        id: r.id,
        memory: r.content,
        score: r.relevanceScore,
        metadata: r.metadata as Record<string, unknown>,
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
      const chroma = getChromaClient();
      const results = await chroma.getAllMemories(userId);

      // Map ChromaDB results to our interface
      return results.map((r) => ({
        id: r.id,
        memory: r.content,
        score: r.relevanceScore,
        metadata: r.metadata as Record<string, unknown>,
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
      const chroma = getChromaClient();
      await chroma.deleteMemory(memoryId);
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
      const chroma = getChromaClient();
      const count = await chroma.deleteAllMemories(userId);
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
   * - User Profile: 30% - User preferences and facts from ChromaDB
   * - Episodic: 20% - Relevant past sessions from ChromaDB
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
    // If memory is disabled, return minimal context
    if (!config.memory.enabled) {
      const recentMessages = await conversationStore.getRecentMessages(userId, channelId, 20);
      return {
        systemContext: "",
        conversationHistory: recentMessages,
      };
    }

    const maxTokens = config.memory.maxContextTokens;
    const allocation = config.memory.tierAllocation;

    // Configurable token estimation (default 4 chars per token)
    const charsPerToken = config.memory.charsPerToken;
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

    // Tier 2a: Procedural memories - HOW to interact with this user (ENGRAM pattern)
    // These are highest priority as they directly affect response style
    const proceduralMemories = await this.searchMemories(userId, currentQuery, 3, ["procedural"]);

    // Tier 2b: User Profile - search for user preferences and facts
    // Use specific memory types for more accurate retrieval
    const userProfileMemories = await this.searchMemories(
      userId,
      currentQuery, // Use current query for relevance
      8,
      ["user_profile", "preference", "fact"] // Only profile-type memories
    );

    let proceduralContext = "";
    if (proceduralMemories.length > 0) {
      const proceduralLines = proceduralMemories.map((m) => `• ${m.memory}`).join("\n");
      proceduralContext = this.trimString(
        proceduralLines,
        Math.floor(profileTokens * 0.3 * charsPerToken)
      );
    }

    let profileContext = "";
    if (userProfileMemories.length > 0) {
      const profileLines = userProfileMemories.map((m) => `• ${m.memory}`).join("\n");
      profileContext = this.trimString(
        profileLines,
        Math.floor(profileTokens * 0.7 * charsPerToken)
      );
    }

    // Tier 3: Episodic Sessions - search past conversations
    // Only include episodic memories, avoiding duplicates from profile search
    const episodicMemories = await this.searchMemories(
      userId,
      currentQuery,
      5,
      ["episodic"] // Only episodic memories
    );

    let episodicContext = "";
    if (episodicMemories.length > 0) {
      // Filter out any duplicates that somehow appeared in both searches
      const episodicLines = episodicMemories
        .filter((m) => !userProfileMemories.some((p) => p.id === m.id))
        .map((m) => `• ${m.memory}`)
        .join("\n");
      episodicContext = this.trimString(episodicLines, episodicTokens * charsPerToken);
    }

    // Build system context
    const contextParts: string[] = [];

    // Procedural context comes first - it affects HOW to respond
    if (proceduralContext) {
      contextParts.push(`## How This User Prefers To Interact\n${proceduralContext}`);
    }

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
    return `${str.slice(0, maxChars - 3)}...`;
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
