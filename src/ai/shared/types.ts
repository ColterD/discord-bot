/**
 * Shared AI Types
 *
 * Common types used across agent, orchestrator, and tools modules
 */

/**
 * Tool call parsed from LLM response
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
  success: boolean;
  result?: string | undefined;
  error?: string | undefined;
  imageBuffer?: Buffer | undefined;
  filename?: string | undefined;
}

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required: boolean;
  enum?: string[];
}

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
}
