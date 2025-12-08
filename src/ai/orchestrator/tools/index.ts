/**
 * Tool Executor Index
 *
 * Central registry and execution for all built-in tools.
 */

import { IMAGE_TOOL_TIMEOUT_MS, TOOL_TIMEOUT_MS } from "../../../constants.js";
import { mcpManager } from "../../../mcp/index.js";
import { getNumberArg, getStringArg, getStringArrayArg } from "../argument-extractors.js";
import type { ToolCall, ToolResult } from "../types.js";
import { executeCalculate } from "./calc-tools.js";
import { executeGenerateImage } from "./image-tools.js";
import {
  executeMemoryAppend,
  executeMemoryDelete,
  executeMemoryReplace,
  executeMemorySearch,
} from "./memory-tools.js";
// Tool implementations
import { executeGetTime } from "./time-tools.js";
import { executeDeepWebSearch, executeFetchUrl, executeWebSearch } from "./web-tools.js";

/**
 * State interface for tool execution
 */
export interface ToolExecutionState {
  fetchedUrls: Set<string>;
  gatheredInfo: string[];
}

/**
 * Execute a tool call with timeout
 */
export async function executeTool(
  toolCall: ToolCall,
  userId: string,
  state: ToolExecutionState
): Promise<ToolResult> {
  // Use longer timeout for image generation
  const timeout = toolCall.name === "generate_image" ? IMAGE_TOOL_TIMEOUT_MS : TOOL_TIMEOUT_MS;

  const timeoutPromise = new Promise<ToolResult>((_, reject) => {
    setTimeout(() => {
      reject(new Error("Tool execution timed out"));
    }, timeout);
  });

  const executionPromise = executeToolInternal(toolCall, userId, state);

  return Promise.race([executionPromise, timeoutPromise]);
}

/**
 * Internal tool execution - routes to appropriate tool handler
 */
async function executeToolInternal(
  toolCall: ToolCall,
  userId: string,
  state: ToolExecutionState
): Promise<ToolResult> {
  const { name, arguments: args } = toolCall;

  // Check if it's an MCP tool
  if (mcpManager.hasTool(name)) {
    try {
      const result = await mcpManager.callTool(name, args);
      return {
        success: true,
        result: typeof result === "string" ? result : JSON.stringify(result, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "MCP tool execution failed",
      };
    }
  }

  // Built-in tools
  switch (name) {
    case "think":
      return {
        success: true,
        result: `Thought recorded: ${getStringArg(args, "thought", true)}`,
      };

    case "get_time":
      return executeGetTime(getStringArg(args, "timezone"));

    case "calculate":
      return executeCalculate(getStringArg(args, "expression", true));

    case "generate_image":
      return executeGenerateImage(args, userId);

    case "web_search":
      return executeWebSearch(getStringArg(args, "query", true), state);

    case "deep_web_search":
      return executeDeepWebSearch(
        getStringArg(args, "query", true),
        state,
        getNumberArg(args, "max_results"),
        getStringArrayArg(args, "engines"),
        getStringArrayArg(args, "categories")
      );

    case "fetch_url":
      return executeFetchUrl(getStringArg(args, "url", true), state);

    // Memory self-editing tools (MemGPT pattern)
    case "memory_append":
      return executeMemoryAppend(userId, args);

    case "memory_replace":
      return executeMemoryReplace(userId, args);

    case "memory_search":
      return executeMemorySearch(userId, args);

    case "memory_delete":
      return executeMemoryDelete(userId, args);

    default:
      return {
        success: false,
        error: `Unknown tool: ${name}`,
      };
  }
}

export { executeCalculate } from "./calc-tools.js";
export { executeGenerateImage } from "./image-tools.js";
export {
  executeMemoryAppend,
  executeMemoryDelete,
  executeMemoryReplace,
  executeMemorySearch,
} from "./memory-tools.js";
// Re-export tool implementations for direct access if needed
export { executeGetTime } from "./time-tools.js";
export { executeDeepWebSearch, executeFetchUrl, executeWebSearch } from "./web-tools.js";
