/**
 * Memory Tools for LLM Self-Editing (MemGPT/Letta Pattern)
 *
 * Implements self-editing memory capabilities following MemGPT's core memory pattern:
 * - memory_append: Add new information to a memory block
 * - memory_replace: Update/correct existing memory
 * - memory_search: Query past memories
 * - memory_consolidate: Merge similar memories
 *
 * These tools enable the AI to directly modify its own memory, similar to how
 * MemGPT's core_memory_append and core_memory_replace functions work.
 *
 * Key differences from standard memory:
 * - AI-initiated updates (not just automatic extraction)
 * - Explicit consolidation and correction
 * - Self-improvement of memory quality
 *
 * @see https://docs.letta.com/concepts/memory
 */

import { config } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { getChromaClient, type MemorySearchResult, type MemoryType } from "./chroma.js";
import { type GraphExtractionResult, getGraphMemoryManager } from "./graph-memory.js";

const log = createLogger("MemoryTools");

/**
 * Memory block types that the AI can edit
 * Following MemGPT's block-based memory organization
 */
export type MemoryBlockType = "human" | "persona" | "preferences" | "facts" | "procedures";

/**
 * Result of a memory tool operation
 */
export interface MemoryToolResult {
  success: boolean;
  message: string;
  memoryId?: string;
  previousContent?: string;
}

/**
 * Memory Tools Manager
 * Provides tool implementations for AI self-editing memory
 */
export class MemoryToolsManager {
  private static instance: MemoryToolsManager;

  private constructor() {}

  public static getInstance(): MemoryToolsManager {
    if (!MemoryToolsManager.instance) {
      MemoryToolsManager.instance = new MemoryToolsManager();
    }
    return MemoryToolsManager.instance;
  }

  /**
   * Append new information to user's memory (MemGPT core_memory_append pattern)
   *
   * Used when the AI learns something NEW about the user that should be remembered.
   *
   * @param userId - Discord user ID
   * @param content - Information to remember
   * @param category - Memory category (preference, fact, procedure)
   * @param importance - Importance score 0-1 (default: 0.8)
   * @returns Operation result
   */
  async memoryAppend(
    userId: string,
    content: string,
    category: "preference" | "fact" | "procedure" = "fact",
    importance = 0.8
  ): Promise<MemoryToolResult> {
    if (!config.memory.enabled) {
      return { success: false, message: "Memory system is disabled" };
    }

    if (!userId || !content) {
      return { success: false, message: "Missing required parameters" };
    }

    // Validate userId format
    if (!/^\d{17,19}$/.test(userId)) {
      return { success: false, message: "Invalid user ID format" };
    }

    try {
      const chroma = getChromaClient();

      // Map category to MemoryType
      const typeMap: Record<string, MemoryType> = {
        preference: "preference",
        fact: "user_profile",
        procedure: "procedural",
      };
      const memoryType = typeMap[category] ?? "user_profile";

      // Use addOrUpdateMemory to prevent duplicates
      const result = await chroma.addOrUpdateMemory(
        userId,
        content,
        memoryType,
        "ai_tool", // Mark source as AI-initiated
        importance,
        0.85 // Higher similarity threshold for AI edits
      );

      if (result.updated) {
        log.info(`AI updated memory for user ${userId}: ${content.slice(0, 50)}...`);
        const updateResult: MemoryToolResult = {
          success: true,
          message: `Updated existing memory: "${result.previousContent?.slice(0, 50) ?? "unknown"}..." -> "${content.slice(0, 50)}..."`,
          memoryId: result.id,
        };
        if (result.previousContent) {
          updateResult.previousContent = result.previousContent;
        }
        return updateResult;
      }

      log.info(`AI appended new memory for user ${userId}: ${content.slice(0, 50)}...`);
      return {
        success: true,
        message: `Remembered: "${content.slice(0, 100)}..."`,
        memoryId: result.id,
      };
    } catch (error) {
      log.error(`Failed to append memory: ${error}`);
      return {
        success: false,
        message: `Failed to save memory: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Replace/update existing memory (MemGPT core_memory_replace pattern)
   *
   * Used when the AI needs to CORRECT or UPDATE previously stored information.
   *
   * @param userId - Discord user ID
   * @param searchQuery - Query to find the memory to update
   * @param newContent - New content to replace with
   * @param reason - Reason for the update (logged)
   * @returns Operation result
   */
  async memoryReplace(
    userId: string,
    searchQuery: string,
    newContent: string,
    reason?: string
  ): Promise<MemoryToolResult> {
    if (!config.memory.enabled) {
      return { success: false, message: "Memory system is disabled" };
    }

    if (!userId || !searchQuery || !newContent) {
      return { success: false, message: "Missing required parameters" };
    }

    try {
      const chroma = getChromaClient();

      // Find the memory to replace
      const results = await chroma.searchMemories(userId, searchQuery, 3, undefined, 0.7);

      if (results.length === 0) {
        return {
          success: false,
          message: `No memory found matching: "${searchQuery}"`,
        };
      }

      const targetMemory = results[0];
      if (!targetMemory) {
        return { success: false, message: "Failed to retrieve memory" };
      }

      const previousContent = targetMemory.content;

      // Update the memory
      const newId = await chroma.updateMemory(targetMemory.id, newContent, {
        importance: targetMemory.metadata.importance,
        source: "ai_tool_replace",
      });

      log.info(
        `AI replaced memory for user ${userId}. Reason: ${reason ?? "not specified"}. ` +
          `Old: "${previousContent.slice(0, 50)}..." -> New: "${newContent.slice(0, 50)}..."`
      );

      return {
        success: true,
        message: `Updated memory: "${previousContent.slice(0, 50)}..." -> "${newContent.slice(0, 50)}..."`,
        memoryId: newId,
        previousContent,
      };
    } catch (error) {
      log.error(`Failed to replace memory: ${error}`);
      return {
        success: false,
        message: `Failed to update memory: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Search user memories (MemGPT archival_memory_search pattern)
   *
   * Used when the AI needs to recall specific information about the user.
   *
   * @param userId - Discord user ID
   * @param query - Search query
   * @param limit - Maximum results (default: 5)
   * @returns Search results
   */
  async memorySearch(
    userId: string,
    query: string,
    limit = 5
  ): Promise<{ success: boolean; memories: MemorySearchResult[]; message: string }> {
    if (!config.memory.enabled) {
      return { success: false, memories: [], message: "Memory system is disabled" };
    }

    if (!userId || !query) {
      return { success: false, memories: [], message: "Missing required parameters" };
    }

    try {
      const chroma = getChromaClient();

      const results = await chroma.searchMemories(userId, query, limit);

      log.debug(`AI searched memories for user ${userId}: "${query}" -> ${results.length} results`);

      return {
        success: true,
        memories: results,
        message: `Found ${results.length} relevant memories`,
      };
    } catch (error) {
      log.error(`Failed to search memories: ${error}`);
      return {
        success: false,
        memories: [],
        message: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Consolidate similar memories (Memory consolidation pattern)
   *
   * Used to merge related memories into cleaner, unified entries.
   * This improves memory quality and reduces redundancy.
   *
   * @param userId - Discord user ID
   * @param topic - Topic area to consolidate (optional)
   * @returns Consolidation result
   */
  async memoryConsolidate(userId: string, topic?: string): Promise<MemoryToolResult> {
    if (!config.memory.enabled) {
      return { success: false, message: "Memory system is disabled" };
    }

    try {
      const chroma = getChromaClient();

      // If topic provided, consolidate just that area
      if (topic) {
        const results = await chroma.searchMemories(userId, topic, 20, undefined, 0.7);

        if (results.length <= 1) {
          return {
            success: true,
            message: `No memories to consolidate for topic: "${topic}"`,
          };
        }

        // Group by similarity and merge
        // For now, just trigger the general consolidation
        log.info(`AI requested consolidation for user ${userId} on topic: ${topic}`);
      }

      // Run full consolidation
      const { consolidated, removed } = await chroma.consolidateMemories(userId);

      return {
        success: true,
        message: `Consolidated ${consolidated} memory groups, removed ${removed} duplicates`,
      };
    } catch (error) {
      log.error(`Failed to consolidate memories: ${error}`);
      return {
        success: false,
        message: `Consolidation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Delete a specific memory
   *
   * Used when the AI determines a memory is incorrect or outdated.
   *
   * @param userId - Discord user ID
   * @param memoryId - ID of memory to delete
   * @param reason - Reason for deletion (logged)
   * @returns Operation result
   */
  async memoryDelete(userId: string, memoryId: string, reason?: string): Promise<MemoryToolResult> {
    if (!config.memory.enabled) {
      return { success: false, message: "Memory system is disabled" };
    }

    try {
      const chroma = getChromaClient();

      // Verify the memory belongs to this user
      const memory = await chroma.getMemoryById(memoryId);
      if (!memory) {
        return { success: false, message: "Memory not found" };
      }

      if (memory.metadata.userId !== userId) {
        log.warn(`Attempted to delete memory ${memoryId} belonging to different user`);
        return { success: false, message: "Access denied" };
      }

      await chroma.deleteMemory(memoryId);

      log.info(
        `AI deleted memory ${memoryId} for user ${userId}. Reason: ${reason ?? "not specified"}`
      );

      return {
        success: true,
        message: `Deleted memory: "${memory.content.slice(0, 50)}..."`,
        previousContent: memory.content,
      };
    } catch (error) {
      log.error(`Failed to delete memory: ${error}`);
      return {
        success: false,
        message: `Delete failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Extract and store entities/relations from text (Graph Memory integration)
   *
   * Called when the AI wants to update the knowledge graph.
   *
   * @param userId - Discord user ID
   * @param _text - Text to extract from (unused - extraction handled by orchestrator)
   * @param extractionResult - Pre-parsed extraction result (from LLM)
   * @returns Operation result
   */
  async extractAndStoreGraph(
    userId: string,
    _text: string,
    extractionResult?: GraphExtractionResult
  ): Promise<MemoryToolResult> {
    if (!config.memory.enabled) {
      return { success: false, message: "Memory system is disabled" };
    }

    try {
      const graphManager = getGraphMemoryManager();

      const result = extractionResult;

      // If no pre-parsed result, we need to call LLM for extraction
      // This would be handled by the orchestrator in real usage
      if (!result) {
        return {
          success: false,
          message:
            "Graph extraction requires LLM processing - use extractAndStoreGraph tool through orchestrator",
        };
      }

      await graphManager.processExtractionResult(userId, result);

      return {
        success: true,
        message: `Stored ${result.entities.length} entities and ${result.relations.length} relationships`,
      };
    } catch (error) {
      log.error(`Failed to extract graph: ${error}`);
      return {
        success: false,
        message: `Graph extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Query the knowledge graph
   *
   * @param userId - Discord user ID
   * @param question - Natural language question about relationships
   * @returns Graph query result
   */
  async queryGraph(
    userId: string,
    question: string
  ): Promise<{ success: boolean; context: string; message: string }> {
    if (!config.memory.enabled) {
      return { success: false, context: "", message: "Memory system is disabled" };
    }

    try {
      const graphManager = getGraphMemoryManager();

      const context = await graphManager.buildGraphContext(userId, question, 500);

      return {
        success: true,
        context,
        message: context ? "Found relevant knowledge graph data" : "No graph data found for query",
      };
    } catch (error) {
      log.error(`Failed to query graph: ${error}`);
      return {
        success: false,
        context: "",
        message: `Graph query failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}

/**
 * Get the singleton MemoryToolsManager instance
 */
export function getMemoryToolsManager(): MemoryToolsManager {
  return MemoryToolsManager.getInstance();
}

/**
 * Tool definitions for LLM prompt injection
 * These are the tools the AI can use to self-edit its memory
 */
export const MEMORY_SELF_EDIT_TOOLS = [
  {
    name: "memory_append",
    description:
      "Store new information about the user for future conversations. Use this when learning something important about the user that should be remembered long-term.",
    parameters: [
      {
        name: "content",
        type: "string",
        description: "The information to remember about the user (be specific and detailed)",
        required: true,
      },
      {
        name: "category",
        type: "string",
        description:
          "Category: 'preference' (likes/dislikes), 'fact' (personal info), 'procedure' (how they want to be responded to)",
        required: false,
        enum: ["preference", "fact", "procedure"],
      },
    ],
  },
  {
    name: "memory_replace",
    description:
      "Update or correct existing memory. Use when the user provides new information that supersedes something you previously remembered.",
    parameters: [
      {
        name: "search_query",
        type: "string",
        description: "Query to find the memory to update",
        required: true,
      },
      {
        name: "new_content",
        type: "string",
        description: "The corrected/updated information",
        required: true,
      },
      {
        name: "reason",
        type: "string",
        description: "Why this memory is being updated",
        required: false,
      },
    ],
  },
  {
    name: "memory_search",
    description:
      "Search your memories about this user. Use when you need to recall something the user told you previously.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "What to search for in your memories",
        required: true,
      },
    ],
  },
  {
    name: "graph_query",
    description:
      "Query the knowledge graph for relationships between entities. Use for questions like 'Who does X work with?' or 'What projects is Y involved in?'",
    parameters: [
      {
        name: "question",
        type: "string",
        description: "Natural language question about relationships",
        required: true,
      },
    ],
  },
];

/**
 * Execute a memory tool call
 *
 * @param userId - Discord user ID
 * @param toolName - Name of the memory tool
 * @param args - Tool arguments
 * @returns Tool result
 */
export async function executeMemoryTool(
  userId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<MemoryToolResult> {
  const manager = getMemoryToolsManager();

  switch (toolName) {
    case "memory_append":
      return manager.memoryAppend(
        userId,
        args.content as string,
        args.category as "preference" | "fact" | "procedure" | undefined,
        args.importance as number | undefined
      );

    case "memory_replace":
      return manager.memoryReplace(
        userId,
        args.search_query as string,
        args.new_content as string,
        args.reason as string | undefined
      );

    case "memory_search": {
      const result = await manager.memorySearch(userId, args.query as string);
      return {
        success: result.success,
        message:
          result.memories.length > 0
            ? result.memories.map((m) => `- ${m.content}`).join("\n")
            : "No memories found",
      };
    }

    case "memory_consolidate":
      return manager.memoryConsolidate(userId, args.topic as string | undefined);

    case "memory_delete":
      return manager.memoryDelete(
        userId,
        args.memory_id as string,
        args.reason as string | undefined
      );

    case "graph_query": {
      const graphResult = await manager.queryGraph(userId, args.question as string);
      return {
        success: graphResult.success,
        message: graphResult.context || graphResult.message,
      };
    }

    default:
      return { success: false, message: `Unknown memory tool: ${toolName}` };
  }
}
