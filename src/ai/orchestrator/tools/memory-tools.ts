/**
 * Memory Tools
 *
 * Memory self-editing tool implementations (MemGPT pattern).
 * These tools allow the LLM to manage its own long-term memory about users.
 */

import { createLogger } from "../../../utils/logger.js";
import { executeMemoryTool } from "../../memory/index.js";
import { getStringArg } from "../argument-extractors.js";
import type { ToolResult } from "../types.js";

const log = createLogger("MemoryTools");

/**
 * Memory Append Tool - Store new information about a user
 * The LLM uses this to save facts, preferences, and context for future conversations
 */
export async function executeMemoryAppend(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const content = getStringArg(args, "content");
    const memoryType = getStringArg(args, "type") ?? "fact";
    const importance = getStringArg(args, "importance") ?? "medium";

    if (!content) {
      return { success: false, error: "Content is required for memory_append" };
    }

    // Map importance to numeric value
    const importanceMap: Record<string, number> = {
      low: 0.5,
      medium: 0.7,
      high: 0.9,
    };

    const result = await executeMemoryTool(userId, "memory_append", {
      content,
      category: memoryType,
      importance: importanceMap[importance] ?? 0.7,
    });

    if (result.success) {
      log.debug(`Memory appended for user ${userId}: ${content.slice(0, 50)}...`);
      return { success: true, result: result.message };
    }
    return { success: false, error: result.message };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to append memory";
    log.error(`Memory append failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Memory Replace Tool - Update or correct existing memory
 * The LLM uses this to fix outdated information or update changing facts
 */
export async function executeMemoryReplace(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const memoryId = getStringArg(args, "memory_id");
    const newContent = getStringArg(args, "new_content");
    const reason = getStringArg(args, "reason");

    if (!memoryId || !newContent) {
      return { success: false, error: "memory_id and new_content are required" };
    }

    const result = await executeMemoryTool(userId, "memory_replace", {
      search_query: memoryId, // Use memoryId as search query to find the memory
      new_content: newContent,
      reason,
    });

    if (result.success) {
      log.debug(`Memory replaced for user ${userId}: ${memoryId}`);
      return { success: true, result: result.message };
    }
    return { success: false, error: result.message };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to replace memory";
    log.error(`Memory replace failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Memory Search Tool - Search for specific information about a user
 * The LLM uses this to recall stored facts and context
 */
export async function executeMemorySearch(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const query = getStringArg(args, "query");

    if (!query) {
      return { success: false, error: "Query is required for memory_search" };
    }

    const result = await executeMemoryTool(userId, "memory_search", { query });

    if (result.success) {
      log.debug(`Memory search for user ${userId}: "${query}"`);
      return { success: true, result: result.message || "No memories found matching the query." };
    }
    return { success: false, error: result.message };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to search memory";
    log.error(`Memory search failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Memory Delete Tool - Remove specific information from memory
 * The LLM uses this when information is explicitly requested to be forgotten or is invalid
 */
export async function executeMemoryDelete(
  userId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const memoryId = getStringArg(args, "memory_id");
    const reason = getStringArg(args, "reason");

    if (!memoryId) {
      return { success: false, error: "memory_id is required for memory_delete" };
    }

    const result = await executeMemoryTool(userId, "memory_delete", {
      memory_id: memoryId,
      reason,
    });

    if (result.success) {
      log.debug(`Memory deleted for user ${userId}: ${memoryId} (reason: ${reason ?? "none"})`);
      return { success: true, result: result.message };
    }
    return { success: false, error: result.message };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to delete memory";
    log.error(`Memory delete failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}
