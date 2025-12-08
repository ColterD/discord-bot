/**
 * AI Orchestrator
 *
 * Central orchestration for AI responses with:
 * - Intent routing via Cloudflare (when available)
 * - Prompt-based tool calling (JSON format in system prompt)
 * - MCP tool integration
 * - Security (impersonation detection, tool permissions)
 * - Three-tier memory (active context, user profile, episodic)
 *
 * Note: Native Ollama tool calling is disabled due to compatibility issues
 * with models that use harmony tokens (e.g., gpt-oss). Instead, tools are
 * defined in the system prompt and parsed from JSON in the response.
 */

import { config } from "../../config.js";
import { AI_MAX_ITERATIONS } from "../../constants.js";
import { detectImpersonation, type ThreatDetail } from "../../security/index.js";
import { createLogger } from "../../utils/logger.js";
import { conversationStore } from "../memory/conversation-store.js";
import { getMemoryManager } from "../memory/index.js";
import { SessionSummarizer } from "../memory/session-summarizer.js";
import { classifyIntent, type IntentClassification } from "../router.js";
import type { ChatMessage } from "../service.js";
import { AGENT_TOOLS } from "../tools.js";
import { buildSystemPromptWithTools } from "./system-prompt.js";
import { runToolLoop } from "./tool-loop.js";
import type { OrchestratorOptions, OrchestratorResponse, ToolInfo } from "./types.js";

// Re-export types
export type {
  OrchestratorOptions,
  OrchestratorResponse,
  ToolCall,
  ToolInfo,
  ToolResult,
} from "./types.js";

const log = createLogger("Orchestrator");

/**
 * Main AI Orchestrator class
 */
export class Orchestrator {
  private readonly summarizer: SessionSummarizer;

  constructor() {
    this.summarizer = new SessionSummarizer();
  }

  /**
   * Perform security check on incoming message
   */
  private performSecurityCheck(
    message: string,
    displayName: string,
    username: string,
    userTag: string
  ): OrchestratorResponse | null {
    const securityCheck = detectImpersonation(message, displayName, username);
    if (securityCheck.detected && securityCheck.confidence > 0.8) {
      const threatTypes = securityCheck.threats.map((t: ThreatDetail) => t.type).join(", ");
      log.warn(`Blocked message from ${userTag}: ${threatTypes}`);
      return {
        content: "I noticed something unusual in your message. Could you rephrase that?",
        toolsUsed: [],
        iterations: 0,
        blocked: true,
        blockReason: securityCheck.threats[0]?.description ?? "Security check failed",
      };
    }
    return null;
  }

  /**
   * Check and trigger summarization if needed
   */
  private async checkAndTriggerSummarization(userId: string, channelId: string): Promise<void> {
    const metadata = await conversationStore.getMetadata(userId, channelId);
    if (!metadata) return;

    // Check thresholds for summarization
    const shouldSummarize =
      !metadata.summarized &&
      (metadata.messageCount >= config.memory.summarizeAfterMessages ||
        Date.now() - metadata.lastActivityAt >= config.memory.summarizeAfterIdleMs);

    if (shouldSummarize) {
      const messages = await conversationStore.getRecentMessages(userId, channelId, 30);
      void this.summarizer.summarize(userId, channelId, messages).catch((err: Error) => {
        log.error(`Summarization failed: ${err.message}`);
      });
    }
  }

  /**
   * Run the orchestrator with a user message
   */
  async run(message: string, options: OrchestratorOptions): Promise<OrchestratorResponse> {
    const {
      user,
      member,
      channelId,
      guildId,
      maxIterations = AI_MAX_ITERATIONS,
      temperature = 0.7,
      onImageGenerationStart,
      onTyping,
    } = options;
    const userId = user.id;
    const displayName = member?.displayName ?? user.displayName ?? user.username;

    // Step 1: Security check
    const securityBlocked = this.performSecurityCheck(
      message,
      displayName,
      user.username,
      user.tag
    );
    if (securityBlocked) return securityBlocked;

    // Step 1.5: Intent classification (async, non-blocking for metrics)
    // Uses Cloudflare if available, falls back to keyword matching
    const intentPromise = classifyIntent(message).catch((err: Error) => {
      log.debug(`Intent classification failed: ${err.message}`);
      return null;
    });

    // Step 2: Build memory context
    const memoryManager = getMemoryManager();
    const memoryResult = await memoryManager.buildContextForChat(userId, channelId, message);
    const { systemContext, conversationHistory } = memoryResult;

    // Log intent classification result (non-blocking)
    void intentPromise.then((intent: IntentClassification | null) => {
      if (intent) {
        log.debug(
          `Intent: ${intent.intent} (confidence: ${intent.confidence.toFixed(2)}, fallback: ${intent.usedFallback}, ${intent.durationMs}ms)`
        );
      }
    });

    // Step 3: Build tool info list for prompt-based tool calling
    const toolInfoList: ToolInfo[] = AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
    }));

    // Step 4: Build system prompt with memory context and tool definitions
    const systemPrompt = buildSystemPromptWithTools(systemContext, toolInfoList);

    // Step 5: Add user message to store
    await conversationStore.addMessage(userId, channelId, guildId ?? null, {
      role: "user",
      content: message,
    });

    // Step 6: Build messages array with system prompt as first message
    const messages: ChatMessage[] = [];

    // Add system prompt first (contains memory context and tool definitions)
    messages.push({ role: "system", content: systemPrompt });

    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add current user message
    messages.push({ role: "user", content: message });

    // Step 7: Run tool loop with prompt-based tool calling
    const result = await runToolLoop({
      messages,
      userId,
      channelId,
      guildId,
      maxIterations,
      temperature,
      originalMessage: message,
      ...(onImageGenerationStart && { onImageGenerationStart }),
      ...(onTyping && { onTyping }),
    });

    // Trigger summarization check (non-blocking)
    void this.checkAndTriggerSummarization(userId, channelId).catch((err: Error) => {
      log.error(`Summarization check failed: ${err.message}`);
    });

    return result;
  }

  /**
   * Dispose of resources
   */
  async dispose(): Promise<void> {
    log.info("Orchestrator disposed");
  }
}

// Singleton instance
let orchestratorInstance: Orchestrator | null = null;

/**
 * Get the orchestrator singleton
 */
export function getOrchestrator(): Orchestrator {
  orchestratorInstance ??= new Orchestrator();
  return orchestratorInstance;
}

/**
 * Reset the orchestrator (for testing)
 */
export function resetOrchestrator(): void {
  if (orchestratorInstance) {
    void orchestratorInstance.dispose();
    orchestratorInstance = null;
  }
}
