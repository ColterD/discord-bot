/**
 * Tool Loop
 *
 * Manages the iterative tool calling loop for the AI orchestrator.
 */

import { MAX_CONSECUTIVE_FAILURES, MAX_CONSECUTIVE_THINK_CALLS } from "../../constants.js";
import { checkToolAccess } from "../../security/tool-permissions.js";
import { createLogger } from "../../utils/logger.js";
import { conversationStore } from "../memory/conversation-store.js";
import { getMemoryManager } from "../memory/index.js";
import type { ChatMessage } from "../service.js";
import { getAIService } from "../service.js";
import { cleanResponse, sanitizeHarmonyTokens } from "./response-cleaner.js";
import { parseToolCallFromContent } from "./tool-parser.js";
import { executeTool } from "./tools/index.js";
import type { OrchestratorResponse, ToolCall, ToolLoopParams, ToolLoopState } from "./types.js";

const log = createLogger("ToolLoop");

/**
 * Create initial tool loop state
 */
export function createToolLoopState(): ToolLoopState {
  return {
    toolsUsed: [],
    iterations: 0,
    consecutiveThinkCalls: 0,
    generatedImage: undefined,
    lastToolWasThink: false,
    fetchedUrls: new Set<string>(),
    gatheredInfo: [],
    consecutiveToolFailures: new Map<string, number>(),
  };
}

/**
 * Check if the tool loop should continue or break
 * @returns 'continue' if loop should continue, 'break' if it should exit
 */
function updateIterationState(
  state: ToolLoopState,
  maxConsecutiveThinkCalls: number
): "continue" | "break" {
  if (state.lastToolWasThink) {
    state.consecutiveThinkCalls++;
    if (state.consecutiveThinkCalls >= maxConsecutiveThinkCalls) {
      log.warn(
        `Max consecutive think calls (${maxConsecutiveThinkCalls}) reached, forcing response`
      );
      return "break";
    }
  } else {
    state.iterations++;
    state.consecutiveThinkCalls = 0;
  }
  state.lastToolWasThink = false;
  return "continue";
}

/**
 * Get LLM response and sanitize it
 */
async function getLLMResponse(
  messages: ChatMessage[],
  temperature: number,
  state: ToolLoopState
): Promise<{ content: string } | { error: OrchestratorResponse }> {
  try {
    const aiService = getAIService();
    const responseContent = await aiService.chatWithMessages(messages, {
      temperature,
      maxTokens: 4096,
    });

    const sanitizedContent = sanitizeHarmonyTokens(responseContent);
    log.info(`[TOOL-DEBUG] LLM response: content=${sanitizedContent.slice(0, 100)}...`);

    return { content: sanitizedContent };
  } catch (error) {
    log.error(`LLM request failed: ${error instanceof Error ? error.message : "Unknown"}`);
    return {
      error: {
        content: "I'm having trouble thinking right now. Please try again in a moment.",
        toolsUsed: state.toolsUsed,
        iterations: state.iterations,
      },
    };
  }
}

/**
 * Append assistant and tool messages to the conversation
 */
function appendToolMessages(
  messages: ChatMessage[],
  assistantContent: string,
  toolName: string,
  toolResponse: string
): void {
  messages.push(
    { role: "assistant", content: assistantContent },
    // Use "user" role for tool outputs in prompt-based tool calling
    // This helps the model understand it as context/result rather than a new user query
    {
      role: "user",
      content: `[Tool Result] ${toolName}: ${toolResponse}`,
      tool_name: toolName,
    }
  );
}

/**
 * Handle tool execution exception
 */
function handleToolException(
  error: unknown,
  toolCall: ToolCall,
  sanitizedContent: string,
  messages: ChatMessage[],
  state: ToolLoopState
): void {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  log.error(
    `Tool ${toolCall.name} failed with exception: ${errorMessage}`,
    error instanceof Error ? error : undefined
  );

  // Increment consecutive failure counter for exceptions
  const currentFailures = state.consecutiveToolFailures.get(toolCall.name) ?? 0;
  state.consecutiveToolFailures.set(toolCall.name, currentFailures + 1);
  log.warn(`Tool ${toolCall.name} exception (consecutive failures: ${currentFailures + 1})`);

  // Provide more specific error message while avoiding information leakage
  let userMessage = "Error: Tool execution failed.";
  if (errorMessage.includes("timeout")) {
    userMessage = "Error: Tool execution timed out.";
  } else if (errorMessage.includes("permission") || errorMessage.includes("access")) {
    userMessage = "Error: Insufficient permissions.";
  }

  appendToolMessages(messages, sanitizedContent, toolCall.name, userMessage);
}

/**
 * Execute a tool and record the result
 */
async function executeAndRecordTool(
  toolCall: ToolCall,
  sanitizedContent: string,
  messages: ChatMessage[],
  userId: string,
  state: ToolLoopState
): Promise<void> {
  try {
    const result = await executeTool(toolCall, userId, state);

    // Check for generated image
    if (result.imageBuffer && result.filename) {
      state.generatedImage = { buffer: result.imageBuffer, filename: result.filename };
    }

    if (result.success) {
      // Success - reset consecutive failure counter for this tool
      state.consecutiveToolFailures.delete(toolCall.name);
      const toolResponse = result.result ?? "Tool executed successfully.";
      appendToolMessages(messages, sanitizedContent, toolCall.name, toolResponse);
    } else {
      // Failure - increment consecutive failure counter
      const currentFailures = state.consecutiveToolFailures.get(toolCall.name) ?? 0;
      state.consecutiveToolFailures.set(toolCall.name, currentFailures + 1);
      log.warn(
        `Tool ${toolCall.name} failed (consecutive failures: ${currentFailures + 1}): ${result.error}`
      );
      const toolResponse = `Error: ${result.error ?? "Unknown error"}`;
      appendToolMessages(messages, sanitizedContent, toolCall.name, toolResponse);
    }
  } catch (error) {
    handleToolException(error, toolCall, sanitizedContent, messages, state);
  }
}

/**
 * Handle a tool call from the LLM
 */
async function handleToolCall(params: {
  toolCall: ToolCall;
  sanitizedContent: string;
  messages: ChatMessage[];
  userId: string;
  state: ToolLoopState;
  onImageGenerationStart?: () => Promise<void>;
}): Promise<void> {
  const { toolCall, sanitizedContent, messages, userId, state, onImageGenerationStart } = params;

  log.info(`[TOOL-DEBUG] Parsed JSON tool call: ${toolCall.name}`);
  log.info(
    `[TOOL-DEBUG] Executing tool: ${toolCall.name} with args: ${JSON.stringify(toolCall.arguments)}`
  );

  // Check for repeated tool failures (max 3 consecutive failures per tool)
  const failureCount = state.consecutiveToolFailures.get(toolCall.name) ?? 0;
  if (failureCount >= MAX_CONSECUTIVE_FAILURES) {
    log.warn(
      `Tool ${toolCall.name} has failed ${failureCount} times consecutively, blocking further attempts`
    );
    appendToolMessages(
      messages,
      sanitizedContent,
      toolCall.name,
      `[TOOL BLOCKED] The ${toolCall.name} tool has failed ${failureCount} times. Please try a different approach or respond to the user without using this tool.`
    );
    return;
  }

  // Handle duplicate image generation
  if (toolCall.name === "generate_image" && state.generatedImage) {
    log.debug("Skipping duplicate generate_image call - image already generated");
    appendToolMessages(
      messages,
      sanitizedContent,
      toolCall.name,
      "[IMAGE ALREADY ATTACHED] An image was already generated for this request. Provide your response to the user without generating another image."
    );
    return;
  }

  // Notify caller that image generation is starting
  if (toolCall.name === "generate_image" && onImageGenerationStart) {
    await onImageGenerationStart();
  }

  // Check tool access
  const toolAccess = checkToolAccess(userId, toolCall.name);
  if (!toolAccess.allowed) {
    const errorMsg = toolAccess.visible ? `Error: ${toolAccess.reason}` : "Error: Unknown tool.";
    appendToolMessages(messages, sanitizedContent, toolCall.name, errorMsg);
    return;
  }

  // Execute the tool
  state.toolsUsed.push(toolCall.name);
  await executeAndRecordTool(toolCall, sanitizedContent, messages, userId, state);
}

/**
 * Finalize response and save to memory
 */
async function finalizeResponse(params: {
  response: string;
  message: string;
  userId: string;
  channelId: string;
  guildId: string | null | undefined;
  toolsUsed: string[];
  iterations: number;
  generatedImage: { buffer: Buffer; filename: string } | undefined;
}): Promise<OrchestratorResponse> {
  const { response, message, userId, channelId, guildId, toolsUsed, iterations, generatedImage } =
    params;
  const finalResponse = cleanResponse(response);
  const memoryManager = getMemoryManager();

  await conversationStore.addMessage(userId, channelId, guildId ?? null, {
    role: "assistant",
    content: finalResponse,
  });

  void memoryManager
    .addFromConversation(userId, [
      { role: "user", content: message },
      { role: "assistant", content: finalResponse },
    ])
    .catch((err: Error) => {
      log.error(`Memory storage failed: ${err.message}`);
    });

  return {
    content: finalResponse,
    toolsUsed: [...new Set(toolsUsed)],
    iterations,
    generatedImage,
  };
}

/**
 * Handle max iterations reached - provide meaningful response using gathered info
 */
async function handleMaxIterationsReached(
  userId: string,
  channelId: string,
  guildId: string | null | undefined,
  state: ToolLoopState
): Promise<OrchestratorResponse> {
  // Build a response from gathered information if available
  let fallbackResponse: string;

  if (state.gatheredInfo.length > 0) {
    // Combine gathered info into a summary
    const infoSummary = state.gatheredInfo.slice(0, 5).join("\n\n");
    fallbackResponse = `Here's what I found:\n\n${infoSummary}`;

    // Truncate if too long
    if (fallbackResponse.length > 1900) {
      fallbackResponse = `${fallbackResponse.slice(0, 1897)}...`;
    }
  } else {
    fallbackResponse =
      "I searched but couldn't find the specific information you requested. Please try a more specific query.";
  }

  await conversationStore.addMessage(userId, channelId, guildId ?? null, {
    role: "assistant",
    content: fallbackResponse,
  });
  return {
    content: fallbackResponse,
    toolsUsed: [...new Set(state.toolsUsed)],
    iterations: state.iterations,
    generatedImage: state.generatedImage,
  };
}

/**
 * Run the tool calling loop
 */
export async function runToolLoop(params: ToolLoopParams): Promise<OrchestratorResponse> {
  const {
    messages,
    userId,
    channelId,
    guildId,
    maxIterations,
    temperature,
    originalMessage,
    onImageGenerationStart,
    onTyping,
  } = params;

  const state = createToolLoopState();

  while (state.iterations < maxIterations) {
    // Update iteration state and check if we should break
    const iterationResult = updateIterationState(state, MAX_CONSECUTIVE_THINK_CALLS);
    if (iterationResult === "break") {
      break;
    }

    // Trigger typing indicator
    if (onTyping) {
      await onTyping().catch((err) => {
        log.warn(
          `Typing indicator callback failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }

    // Get LLM response
    const responseResult = await getLLMResponse(messages, temperature, state);
    if ("error" in responseResult) {
      return responseResult.error;
    }

    const sanitizedContent = responseResult.content;

    // Parse and handle tool call
    const toolCall = parseToolCallFromContent(sanitizedContent);

    // If no tool call, return final response
    if (!toolCall) {
      log.info(`[TOOL-DEBUG] No tool call found, returning final response`);
      return finalizeResponse({
        response: sanitizedContent,
        message: originalMessage,
        userId,
        channelId,
        guildId,
        toolsUsed: state.toolsUsed,
        iterations: state.iterations,
        generatedImage: state.generatedImage,
      });
    }

    // Mark if this is a think tool call (doesn't count against iterations)
    if (toolCall.name === "think") {
      state.lastToolWasThink = true;
    }

    // Handle the tool call
    await handleToolCall({
      toolCall,
      sanitizedContent,
      messages,
      userId,
      state,
      ...(onImageGenerationStart && { onImageGenerationStart }),
    });
  }

  // Max iterations reached
  return handleMaxIterationsReached(userId, channelId, guildId, state);
}
