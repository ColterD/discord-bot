/**
 * Base LLM Provider Interface
 *
 * Defines the contract for all LLM providers (Ollama, Cloudflare, etc.)
 * This abstraction allows swapping providers without changing consumer code.
 */

/**
 * Chat message for provider APIs
 */
export interface ProviderMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * Options for chat completion requests
 */
export interface ChatCompletionOptions {
  /** Temperature for response randomness (0-2) */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Custom timeout for this request (ms) */
  timeoutMs?: number;
}

/**
 * Response from chat completion
 */
export interface ChatCompletionResponse {
  /** The generated text content */
  content: string;
  /** Token usage statistics (if available) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Model used for generation */
  model: string;
  /** Time taken for generation (ms) */
  durationMs?: number;
}

/**
 * Options for embedding requests
 */
export interface EmbeddingOptions {
  /** Custom timeout for this request (ms) */
  timeoutMs?: number;
}

/**
 * Response from embedding generation
 */
export interface EmbeddingResponse {
  /** The embedding vector(s) */
  embeddings: number[][];
  /** Model used for embeddings */
  model: string;
  /** Dimension of the embedding vectors */
  dimensions: number;
}

/**
 * Intent classification result
 */
export interface ClassificationResult {
  /** The classified intent/category */
  intent: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** All classification scores */
  scores?: Record<string, number>;
}

/**
 * Provider health status
 */
export interface ProviderHealth {
  /** Whether the provider is reachable */
  available: boolean;
  /** Latency in ms (if available) */
  latencyMs?: number;
  /** Error message if unavailable */
  error?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  /** Supports chat completion */
  chat: boolean;
  /** Supports text embeddings */
  embeddings: boolean;
  /** Supports text classification */
  classification: boolean;
  /** Supports streaming responses */
  streaming: boolean;
  /** Maximum context length in tokens */
  maxContextLength: number;
  /** Embedding dimensions (if embeddings supported) */
  embeddingDimensions?: number;
}

/**
 * Base LLM Provider Interface
 *
 * All LLM providers must implement this interface to be used
 * interchangeably by the AI service layer.
 */
export interface LLMProvider {
  /** Provider name for logging and identification */
  readonly name: string;

  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;

  /**
   * Check provider health and availability
   */
  checkHealth(): Promise<ProviderHealth>;

  /**
   * Generate a chat completion
   * @param messages - Conversation messages
   * @param options - Generation options
   * @returns Generated response
   */
  chat(
    messages: ProviderMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse>;

  /**
   * Generate embeddings for text(s)
   * @param texts - Text(s) to embed
   * @param options - Embedding options
   * @returns Embedding vectors
   */
  embed?(texts: string | string[], options?: EmbeddingOptions): Promise<EmbeddingResponse>;

  /**
   * Classify text intent
   * @param text - Text to classify
   * @param labels - Possible classification labels
   * @returns Classification result
   */
  classify?(text: string, labels: string[]): Promise<ClassificationResult>;

  /**
   * Dispose of provider resources
   */
  dispose(): Promise<void>;
}

/**
 * Abstract base class with common provider functionality
 */
export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;

  abstract checkHealth(): Promise<ProviderHealth>;
  abstract chat(
    messages: ProviderMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse>;

  /**
   * Default embed implementation - throws if not supported
   */
  async embed(_texts: string | string[], _options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    throw new Error(`${this.name} provider does not support embeddings`);
  }

  /**
   * Default classify implementation - throws if not supported
   */
  async classify(_text: string, _labels: string[]): Promise<ClassificationResult> {
    throw new Error(`${this.name} provider does not support classification`);
  }

  /**
   * Default dispose implementation - no-op
   */
  async dispose(): Promise<void> {
    // No-op by default, override if cleanup needed
  }
}

/**
 * Error thrown when provider is unavailable
 */
export class ProviderUnavailableError extends Error {
  constructor(
    public readonly providerName: string,
    message: string,
    public readonly cause?: Error
  ) {
    super(`${providerName} provider unavailable: ${message}`);
    this.name = "ProviderUnavailableError";
  }
}

/**
 * Error thrown when provider rate limit is exceeded
 */
export class ProviderRateLimitError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly retryAfterMs?: number
  ) {
    const retryInfo = retryAfterMs ? ` (retry after ${retryAfterMs}ms)` : "";
    super(`${providerName} provider rate limit exceeded${retryInfo}`);
    this.name = "ProviderRateLimitError";
  }
}

/**
 * Error thrown when provider quota is exhausted
 */
export class ProviderQuotaExhaustedError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly quotaType = "daily"
  ) {
    super(`${providerName} provider ${quotaType} quota exhausted`);
    this.name = "ProviderQuotaExhaustedError";
  }
}
