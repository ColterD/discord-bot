/**
 * Orchestrator Type Definitions
 *
 * Core interfaces and type aliases for the AI orchestrator module.
 */

import type { GuildMember, User } from "discord.js";
import type { ChatMessage } from "../service.js";

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
 * Tool info for display
 */
export interface ToolInfo {
  name: string;
  description: string;
  server?: string;
}

/**
 * Options for orchestrator run
 */
export interface OrchestratorOptions {
  /** Discord user making the request */
  user: User;
  /** Guild member (for permission checks) */
  member?: GuildMember | null;
  /** Channel ID for conversation tracking */
  channelId: string;
  /** Guild ID for context */
  guildId?: string | null;
  /** Max tool iterations */
  maxIterations?: number;
  /** Temperature for LLM */
  temperature?: number;
  /** Callback when image generation starts */
  onImageGenerationStart?: () => Promise<void>;
  /** Callback to trigger typing indicator */
  onTyping?: () => Promise<void>;
}

/**
 * Response from orchestrator
 */
export interface OrchestratorResponse {
  content: string;
  toolsUsed: string[];
  iterations: number;
  blocked?: boolean | undefined;
  blockReason?: string | undefined;
  generatedImage?:
    | {
        buffer: Buffer;
        filename: string;
      }
    | undefined;
}

/**
 * Internal state for tool loop tracking
 */
export interface ToolLoopState {
  toolsUsed: string[];
  iterations: number;
  consecutiveThinkCalls: number;
  generatedImage: { buffer: Buffer; filename: string } | undefined;
  lastToolWasThink: boolean;
  fetchedUrls: Set<string>;
  gatheredInfo: string[];
  consecutiveToolFailures: Map<string, number>;
}

/**
 * Parameters for the tool loop
 */
export interface ToolLoopParams {
  messages: ChatMessage[];
  userId: string;
  channelId: string;
  guildId: string | null | undefined;
  maxIterations: number;
  temperature: number;
  originalMessage: string;
  onImageGenerationStart?: () => Promise<void>;
  onTyping?: () => Promise<void>;
}
