/**
 * Intent Router
 *
 * Classifies user messages to determine optimal handling strategy.
 * Uses Cloudflare's granite-micro model for fast, low-cost classification.
 * Falls back to keyword matching if Cloudflare is unavailable.
 *
 * @module ai/router
 */

import { createLogger } from "../utils/logger.js";
import type { ClassificationResult, LLMProvider } from "./providers/index.js";
import { getRoutingProvider } from "./providers/index.js";

const logger = createLogger("IntentRouter");

/**
 * Intent categories for message routing
 */
export enum Intent {
  /** General conversation/chat */
  CHAT = "chat",
  /** Request for information/question */
  QUESTION = "question",
  /** Request to use a tool/capability */
  TOOL_USE = "tool_use",
  /** Image generation request */
  IMAGE_GENERATION = "image_generation",
  /** Memory-related (remember/recall) */
  MEMORY = "memory",
  /** Code generation/debugging */
  CODE = "code",
  /** Search/research request */
  SEARCH = "search",
  /** Command/action (non-conversational) */
  COMMAND = "command",
  /** Unclear/ambiguous intent */
  UNKNOWN = "unknown",
}

/**
 * Classification result with metadata
 */
export interface IntentClassification {
  /** Primary detected intent */
  intent: Intent;
  /** Confidence score (0-1) */
  confidence: number;
  /** All intent scores for debugging */
  scores: Record<Intent, number>;
  /** Whether classification used fallback (keyword matching) */
  usedFallback: boolean;
  /** Time taken for classification (ms) */
  durationMs: number;
  /** Any error that occurred */
  error?: string;
}

/**
 * Router configuration
 */
interface RouterConfig {
  /** Minimum confidence threshold for accepting classification */
  confidenceThreshold?: number;
  /** Whether to enable fallback on provider failure */
  enableFallback?: boolean;
  /** Cache TTL for classification results (ms) */
  cacheTtlMs?: number;
}

/**
 * Keyword patterns for fallback classification
 */
const FALLBACK_PATTERNS: Record<Intent, RegExp[]> = {
  [Intent.IMAGE_GENERATION]: [
    /\b(draw|paint|generate|create|make|imagine|visualize)\s+(?:an?\s+)?(?:image|picture|art|artwork|illustration)/i,
    /\b(draw|paint|sketch)\s+(?:me\s+)?(?:a|an)?\s*/i,
    /\bimagine\b/i,
  ],
  [Intent.MEMORY]: [
    /\b(remember|recall|forget|memorize)\b/i,
    /\bdo you (?:remember|recall)\b/i,
    /\bwhat do you (?:know|remember) about\b/i,
    /\bmy (?:name|birthday|favorite)\b/i,
  ],
  [Intent.CODE]: [
    /\b(code|program|script|function|class|debug|fix|implement|refactor)\b/i,
    /```[\s\S]*```/,
    /\b(javascript|typescript|python|rust|go|java|c\+\+|sql)\b/i,
  ],
  [Intent.SEARCH]: [
    /\b(search|look up|find|google|research)\b/i,
    /\bwhat is\b.*\?$/i,
    /\bwho is\b.*\?$/i,
  ],
  [Intent.TOOL_USE]: [
    /\b(use|run|execute|call|invoke)\s+(?:the\s+)?(?:\w+\s+)?tool\b/i,
    /\bweather\b/i,
    /\btime\s+(?:in|at)\b/i,
    /\bcalculate\b/i,
  ],
  [Intent.QUESTION]: [
    /^(?:what|who|where|when|why|how|is|are|can|could|would|should|do|does|did)\b/i,
    /\?$/,
  ],
  [Intent.COMMAND]: [/^(?:stop|start|restart|reset|clear|help|status)\b/i, /^\/\w+/],
  [Intent.CHAT]: [/^(?:hi|hello|hey|thanks|thank you|bye|goodbye|good morning|good night)/i],
  [Intent.UNKNOWN]: [], // Fallback when nothing matches
};

/**
 * Classification prompt template for LLM
 */
const CLASSIFICATION_PROMPT = `Classify the user's message into ONE of these categories:

- chat: General conversation, greetings, small talk
- question: Asking for information or explanation
- tool_use: Requesting to use a specific capability/tool
- image_generation: Requesting to create, draw, or generate an image
- memory: Asking to remember or recall something
- code: Code generation, debugging, or programming help
- search: Looking up information online
- command: Bot commands or actions

Respond with ONLY the category name, nothing else.

User message: {{MESSAGE}}

Category:`;

/**
 * Intent Router Class
 *
 * Classifies user messages to determine handling strategy.
 */
export class IntentRouter {
  private provider: LLMProvider | null = null;
  private providerInitPromise: Promise<void> | null = null;
  private readonly config: Required<RouterConfig>;

  constructor(config?: RouterConfig) {
    this.config = {
      confidenceThreshold: config?.confidenceThreshold ?? 0.6,
      enableFallback: config?.enableFallback ?? true,
      cacheTtlMs: config?.cacheTtlMs ?? 60000,
    };
  }

  /**
   * Initialize the routing provider lazily
   */
  private async ensureProvider(): Promise<LLMProvider | null> {
    if (this.provider) {
      return this.provider;
    }

    this.providerInitPromise ??= (async () => {
      try {
        this.provider = await getRoutingProvider();
        const health = await this.provider.checkHealth();
        if (!health.available) {
          logger.warn("Routing provider not healthy, will use fallback");
          this.provider = null;
        }
      } catch (error) {
        logger.warn(
          `Failed to initialize routing provider: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        this.provider = null;
      }
    })();

    await this.providerInitPromise;
    return this.provider;
  }

  /**
   * Classify a user message to determine intent
   */
  async classify(message: string): Promise<IntentClassification> {
    const startTime = Date.now();

    // Try LLM-based classification first
    const provider = await this.ensureProvider();
    if (provider) {
      try {
        const result = await this.classifyWithLLM(provider, message);
        return {
          ...result,
          usedFallback: false,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        logger.warn(`LLM classification failed, falling back: ${errorMsg}`);

        if (!this.config.enableFallback) {
          return this.createUnknownResult(startTime, errorMsg);
        }
      }
    }

    // Use fallback keyword matching
    if (this.config.enableFallback) {
      const result = this.classifyWithKeywords(message);
      return {
        ...result,
        usedFallback: true,
        durationMs: Date.now() - startTime,
      };
    }

    return this.createUnknownResult(startTime, "No provider available");
  }

  /**
   * Classify using LLM provider
   */
  private async classifyWithLLM(
    provider: LLMProvider,
    message: string
  ): Promise<Omit<IntentClassification, "usedFallback" | "durationMs">> {
    // Use classification method if available
    if (provider.classify) {
      const labels = Object.values(Intent).filter((i) => i !== Intent.UNKNOWN);
      const result: ClassificationResult = await provider.classify(message, labels);

      const intent = this.parseIntent(result.intent);
      const scores = this.createScoresFromClassification(result);

      return {
        intent,
        confidence: result.confidence,
        scores,
      };
    }

    // Fall back to chat-based classification
    const prompt = CLASSIFICATION_PROMPT.replace("{{MESSAGE}}", message);
    const response = await provider.chat([{ role: "user", content: prompt }], {
      temperature: 0.1,
      maxTokens: 20,
    });

    const intent = this.parseIntent(response.content.trim().toLowerCase());
    const scores = this.createDefaultScores(intent);

    return {
      intent,
      confidence: 0.8, // Assume reasonable confidence for chat-based
      scores,
    };
  }

  /**
   * Classify using keyword patterns (fallback)
   */
  private classifyWithKeywords(
    message: string
  ): Omit<IntentClassification, "usedFallback" | "durationMs"> {
    const scores: Record<Intent, number> = this.createEmptyScores();
    const normalizedMessage = message.toLowerCase().trim();

    // Score each intent based on pattern matches
    for (const [intent, patterns] of Object.entries(FALLBACK_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(normalizedMessage)) {
          const intentKey = intent as Intent;
          scores[intentKey] = Math.min(1, (scores[intentKey] ?? 0) + 0.3);
        }
      }
    }

    // Find best match
    const entries = Object.entries(scores) as [Intent, number][];
    const [bestIntent, bestScore] = entries.reduce(
      (best, current) => (current[1] > best[1] ? current : best),
      [Intent.UNKNOWN, 0] as [Intent, number]
    );

    // Default to chat or question if nothing matched well
    let finalIntent: Intent;
    if (bestScore >= this.config.confidenceThreshold) {
      finalIntent = bestIntent;
    } else if (message.includes("?")) {
      finalIntent = Intent.QUESTION;
    } else {
      finalIntent = Intent.CHAT;
    }

    return {
      intent: finalIntent,
      confidence: Math.max(bestScore, 0.5),
      scores,
    };
  }

  /**
   * Parse intent string to Intent enum
   */
  private parseIntent(value: string): Intent {
    const normalized = value
      .toLowerCase()
      .trim()
      .replaceAll(/[^a-z_]/g, "");

    // Map common variations
    const variations: Record<string, Intent> = {
      chat: Intent.CHAT,
      conversation: Intent.CHAT,
      greeting: Intent.CHAT,
      question: Intent.QUESTION,
      ask: Intent.QUESTION,
      tool: Intent.TOOL_USE,
      tool_use: Intent.TOOL_USE,
      tooluse: Intent.TOOL_USE,
      image: Intent.IMAGE_GENERATION,
      image_generation: Intent.IMAGE_GENERATION,
      imagegeneration: Intent.IMAGE_GENERATION,
      draw: Intent.IMAGE_GENERATION,
      generate: Intent.IMAGE_GENERATION,
      memory: Intent.MEMORY,
      remember: Intent.MEMORY,
      recall: Intent.MEMORY,
      code: Intent.CODE,
      coding: Intent.CODE,
      programming: Intent.CODE,
      search: Intent.SEARCH,
      research: Intent.SEARCH,
      lookup: Intent.SEARCH,
      command: Intent.COMMAND,
      cmd: Intent.COMMAND,
    };

    return variations[normalized] ?? Intent.UNKNOWN;
  }

  /**
   * Create scores record from classification result
   */
  private createScoresFromClassification(result: ClassificationResult): Record<Intent, number> {
    const scores = this.createEmptyScores();

    if (result.scores) {
      for (const [key, value] of Object.entries(result.scores)) {
        const intent = this.parseIntent(key);
        if (intent !== Intent.UNKNOWN) {
          scores[intent] = value;
        }
      }
    }

    // Ensure the classified intent has its confidence
    const intent = this.parseIntent(result.intent);
    scores[intent] = result.confidence;

    return scores;
  }

  /**
   * Create default scores with primary intent highlighted
   */
  private createDefaultScores(primary: Intent): Record<Intent, number> {
    const scores = this.createEmptyScores();
    scores[primary] = 0.8;
    return scores;
  }

  /**
   * Create empty scores record
   */
  private createEmptyScores(): Record<Intent, number> {
    return Object.values(Intent).reduce(
      (acc, intent) => {
        acc[intent] = 0;
        return acc;
      },
      {} as Record<Intent, number>
    );
  }

  /**
   * Create unknown result for error cases
   */
  private createUnknownResult(startTime: number, error?: string): IntentClassification {
    const result: IntentClassification = {
      intent: Intent.UNKNOWN,
      confidence: 0,
      scores: this.createEmptyScores(),
      usedFallback: false,
      durationMs: Date.now() - startTime,
    };
    if (error) {
      result.error = error;
    }
    return result;
  }

  /**
   * Check if an intent requires tool access
   */
  static requiresTools(intent: Intent): boolean {
    return [Intent.TOOL_USE, Intent.IMAGE_GENERATION, Intent.SEARCH].includes(intent);
  }

  /**
   * Check if an intent requires memory access
   */
  static requiresMemory(intent: Intent): boolean {
    return [Intent.MEMORY, Intent.CHAT, Intent.QUESTION].includes(intent);
  }

  /**
   * Check if an intent should trigger agent mode
   */
  static shouldUseAgent(intent: Intent): boolean {
    return [Intent.TOOL_USE, Intent.IMAGE_GENERATION, Intent.CODE, Intent.SEARCH].includes(intent);
  }
}

// Singleton instance
let routerInstance: IntentRouter | null = null;

/**
 * Get the singleton intent router instance
 */
export function getIntentRouter(config?: RouterConfig): IntentRouter {
  routerInstance ??= new IntentRouter(config);
  return routerInstance;
}

/**
 * Classify a message using the singleton router
 */
export async function classifyIntent(message: string): Promise<IntentClassification> {
  return getIntentRouter().classify(message);
}
