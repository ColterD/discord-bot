/**
 * Cloudflare Workers AI Provider
 *
 * Provides access to Cloudflare's free-tier AI models:
 * - Router: @cf/ibm-granite/granite-4.0-h-micro for intent classification
 * - Embeddings: @cf/qwen/qwen3-embedding-0.6b (1024 dims)
 *
 * Free tier: 10,000 neurons/day
 *
 * Supports two modes:
 * 1. REST API (default): Calls api.cloudflare.com directly (higher latency)
 * 2. Edge Worker (optional): Calls your deployed Worker for low latency
 */

import axios, { type AxiosError, type AxiosInstance } from "axios";
import { createLogger } from "../../utils/logger.js";
import {
  BaseLLMProvider,
  type ChatCompletionOptions,
  type ChatCompletionResponse,
  type ClassificationResult,
  type EmbeddingOptions,
  type EmbeddingResponse,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderMessage,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from "./base-provider.js";

const log = createLogger("CloudflareProvider");

/**
 * Cloudflare API response wrapper
 */
interface CloudflareResponse<T> {
  result: T;
  success: boolean;
  errors: { code: number; message: string }[];
  messages: string[];
}

/**
 * Cloudflare chat completion result
 * Supports both simple format and OpenAI-compatible format
 */
interface CloudflareChatResult {
  /** Simple format: direct response string */
  response?: string;
  /** OpenAI format: choices array with messages */
  choices?: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
}

/**
 * Extract content from Cloudflare chat result (handles both formats)
 */
function extractChatContent(result: CloudflareChatResult): string {
  // Try OpenAI format first (Granite 4.0 uses this)
  if (result.choices?.[0]?.message?.content) {
    return result.choices[0].message.content;
  }
  // Fall back to simple format
  if (result.response) {
    return result.response;
  }
  return "";
}

/**
 * Cloudflare embedding result
 */
interface CloudflareEmbeddingResult {
  shape: number[];
  data: number[][];
}

/**
 * Cloudflare provider configuration
 * All values should come from config.ts which reads from .env
 */
export interface CloudflareProviderConfig {
  /** Cloudflare account ID */
  accountId: string;
  /** Cloudflare API token with Workers AI permissions */
  apiToken: string;
  /** Chat/router model - from CLOUDFLARE_ROUTER_MODEL */
  chatModel: string;
  /** Embedding model - from CLOUDFLARE_EMBEDDING_MODEL */
  embeddingModel: string;
  /** Request timeout in ms */
  timeoutMs?: number;
  /** Edge Worker configuration (optional - for lower latency) */
  worker?: {
    /** Worker URL (e.g., https://discord-bot-ai-proxy.your-subdomain.workers.dev) */
    url: string;
    /** Secret for authenticating to the Worker */
    secret?: string;
  };
}

/**
 * Response metadata from Worker
 */
interface WorkerMeta {
  latencyMs: number;
  datacenter: string;
  edge: boolean;
}

/**
 * Cloudflare Workers AI Provider
 *
 * Implements LLMProvider for Cloudflare's free-tier AI models.
 * Designed for routing/classification and embeddings to offload from local GPU.
 */
export class CloudflareProvider extends BaseLLMProvider {
  readonly name = "Cloudflare";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    embeddings: true,
    classification: true,
    streaming: false, // Not implemented
    maxContextLength: 4096,
    embeddingDimensions: 1024,
  };

  private readonly restClient: AxiosInstance;
  private readonly workerClient: AxiosInstance | null;
  private readonly accountId: string;
  private readonly chatModel: string;
  private readonly embeddingModel: string;
  private readonly useWorker: boolean;

  // Track quota usage
  private quotaExhausted = false;
  private quotaResetTime: number | null = null;

  // Track last datacenter (for diagnostics)
  private lastDatacenter: string | null = null;

  constructor(config: CloudflareProviderConfig) {
    super();

    if (!config.accountId) {
      throw new Error("Cloudflare account ID is required");
    }
    if (!config.apiToken) {
      throw new Error("Cloudflare API token is required");
    }

    this.accountId = config.accountId;
    this.chatModel = config.chatModel;
    this.embeddingModel = config.embeddingModel;

    // REST API client (fallback)
    this.restClient = axios.create({
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run`,
      timeout: config.timeoutMs ?? 30000,
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
    });

    // Edge Worker client (optional - for lower latency)
    if (config.worker?.url) {
      this.useWorker = true;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (config.worker.secret) {
        headers.Authorization = `Bearer ${config.worker.secret}`;
      }
      this.workerClient = axios.create({
        baseURL: config.worker.url,
        timeout: config.timeoutMs ?? 30000,
        headers,
      });
      log.info(`Cloudflare provider using edge Worker: ${config.worker.url}`);
    } else {
      this.useWorker = false;
      this.workerClient = null;
      log.info("Cloudflare provider using REST API (no Worker configured)");
    }
  }

  /**
   * Get the last seen datacenter (for diagnostics)
   */
  getLastDatacenter(): string | null {
    return this.lastDatacenter;
  }

  /**
   * Check if quota has been reset (daily reset)
   */
  private checkQuotaReset(): void {
    if (this.quotaExhausted && this.quotaResetTime) {
      const now = Date.now();
      if (now >= this.quotaResetTime) {
        log.info("Cloudflare quota reset, re-enabling provider");
        this.quotaExhausted = false;
        this.quotaResetTime = null;
      }
    }
  }

  /**
   * Handle Cloudflare API errors
   */
  private handleError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<CloudflareResponse<unknown>>;
      const status = axiosError.response?.status;
      const cfErrors = axiosError.response?.data?.errors ?? [];

      // Check for rate limit (429)
      if (status === 429) {
        const retryAfter = axiosError.response?.headers["retry-after"];
        const retryMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined;
        throw new ProviderRateLimitError(this.name, retryMs);
      }

      // Check for quota exhaustion
      const quotaError = cfErrors.find((e) => e.message.toLowerCase().includes("quota"));
      if (quotaError || status === 402) {
        this.quotaExhausted = true;
        // Reset at midnight UTC
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setUTCHours(24, 0, 0, 0);
        this.quotaResetTime = tomorrow.getTime();
        throw new ProviderQuotaExhaustedError(this.name, "daily");
      }

      // Check for auth errors
      if (status === 401 || status === 403) {
        throw new ProviderUnavailableError(
          this.name,
          "Authentication failed - check API token",
          error
        );
      }

      // Generic API error
      const errorMsg = cfErrors.map((e) => e.message).join(", ") || axiosError.message;
      throw new ProviderUnavailableError(this.name, `${operation} failed: ${errorMsg}`, error);
    }

    throw new ProviderUnavailableError(
      this.name,
      `${operation} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Check provider health
   */
  async checkHealth(): Promise<ProviderHealth> {
    this.checkQuotaReset();

    if (this.quotaExhausted) {
      return {
        available: false,
        error: "Daily quota exhausted",
        metadata: { quotaResetTime: this.quotaResetTime },
      };
    }

    const startTime = Date.now();
    try {
      // Use Worker health endpoint if available
      if (this.useWorker && this.workerClient) {
        const response = await this.workerClient.get<{
          status: string;
          datacenter: string;
          edge: boolean;
        }>("/health");
        this.lastDatacenter = response.data.datacenter;
        return {
          available: true,
          latencyMs: Date.now() - startTime,
          metadata: {
            datacenter: response.data.datacenter,
            edge: response.data.edge,
          },
        };
      }

      // Fallback: REST API health check using a minimal embedding request
      await this.restClient.post(`/${this.embeddingModel}`, {
        text: "health check",
      });

      return {
        available: true,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        available: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Generate chat completion via Worker or REST API
   * Note: Granite micro is optimized for classification, not general chat
   */
  async chat(
    messages: ProviderMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    this.checkQuotaReset();

    if (this.quotaExhausted) {
      throw new ProviderQuotaExhaustedError(this.name, "daily");
    }

    const startTime = Date.now();
    const axiosConfig = options?.timeoutMs ? { timeout: options.timeoutMs } : undefined;

    try {
      // Use Worker if available
      if (this.useWorker && this.workerClient) {
        const response = await this.workerClient.post<{
          result: CloudflareChatResult;
          success: boolean;
          meta?: WorkerMeta;
        }>(
          "/chat",
          {
            model: this.chatModel,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            max_tokens: options?.maxTokens ?? 256,
            temperature: options?.temperature ?? 0.3,
          },
          axiosConfig
        );

        if (!response.data.success) {
          throw new Error("Worker chat request failed");
        }

        // Track datacenter for diagnostics
        if (response.data.meta?.datacenter) {
          this.lastDatacenter = response.data.meta.datacenter;
        }

        return {
          content: extractChatContent(response.data.result),
          model: this.chatModel,
          durationMs: Date.now() - startTime,
        };
      }

      // Fallback: REST API
      const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

      const response = await this.restClient.post<CloudflareResponse<CloudflareChatResult>>(
        `/${this.chatModel}`,
        {
          prompt,
          max_tokens: options?.maxTokens ?? 256,
          temperature: options?.temperature ?? 0.3,
        },
        axiosConfig
      );

      if (!response.data.success) {
        const errMsgs = response.data.errors.map((e: { message: string }) => e.message);
        throw new Error(errMsgs.join(", "));
      }

      return {
        content: extractChatContent(response.data.result),
        model: this.chatModel,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      this.handleError(error, "chat");
    }
  }

  /**
   * Generate embeddings via Worker or REST API
   */
  async embed(texts: string | string[], options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    this.checkQuotaReset();

    if (this.quotaExhausted) {
      throw new ProviderQuotaExhaustedError(this.name, "daily");
    }

    const textArray = Array.isArray(texts) ? texts : [texts];
    const axiosConfig = options?.timeoutMs ? { timeout: options.timeoutMs } : undefined;

    try {
      // Use Worker if available
      if (this.useWorker && this.workerClient) {
        const response = await this.workerClient.post<{
          result: CloudflareEmbeddingResult;
          success: boolean;
          meta?: WorkerMeta;
        }>(
          "/embed",
          {
            model: this.embeddingModel,
            text: textArray,
          },
          axiosConfig
        );

        if (!response.data.success) {
          throw new Error("Worker embed request failed");
        }

        // Track datacenter for diagnostics
        if (response.data.meta?.datacenter) {
          this.lastDatacenter = response.data.meta.datacenter;
        }

        return {
          embeddings: response.data.result.data,
          model: this.embeddingModel,
          dimensions: response.data.result.shape[1] ?? 1024,
        };
      }

      // Fallback: REST API
      const response = await this.restClient.post<CloudflareResponse<CloudflareEmbeddingResult>>(
        `/${this.embeddingModel}`,
        {
          text: textArray,
        },
        axiosConfig
      );

      if (!response.data.success) {
        const errMsgs = response.data.errors.map((e: { message: string }) => e.message);
        throw new Error(errMsgs.join(", "));
      }

      return {
        embeddings: response.data.result.data,
        model: this.embeddingModel,
        dimensions: response.data.result.shape[1] ?? 1024,
      };
    } catch (error) {
      this.handleError(error, "embed");
    }
  }

  /**
   * Classify text intent via Worker or REST API
   */
  async classify(text: string, labels: string[]): Promise<ClassificationResult> {
    this.checkQuotaReset();

    if (this.quotaExhausted) {
      throw new ProviderQuotaExhaustedError(this.name, "daily");
    }

    // For classification, we use the chat model with a classification prompt
    const classificationPrompt = `Classify the following text into exactly one of these categories: ${labels.join(", ")}.

Text: "${text}"

Respond with ONLY the category name, nothing else.`;

    try {
      let responseContent: string;

      // Use Worker if available
      if (this.useWorker && this.workerClient) {
        const response = await this.workerClient.post<{
          result: CloudflareChatResult;
          success: boolean;
          meta?: WorkerMeta;
        }>("/chat", {
          model: this.chatModel,
          messages: [{ role: "user", content: classificationPrompt }],
          max_tokens: 50,
          temperature: 0.1,
        });

        if (!response.data.success) {
          throw new Error("Worker classify request failed");
        }

        if (response.data.meta?.datacenter) {
          this.lastDatacenter = response.data.meta.datacenter;
        }

        responseContent = extractChatContent(response.data.result);
      } else {
        // Fallback: REST API
        const response = await this.restClient.post<CloudflareResponse<CloudflareChatResult>>(
          `/${this.chatModel}`,
          {
            messages: [{ role: "user", content: classificationPrompt }],
            max_tokens: 50,
            temperature: 0.1,
          }
        );

        if (!response.data.success) {
          throw new Error(response.data.errors.map((e) => e.message).join(", "));
        }

        responseContent = extractChatContent(response.data.result);
      }

      const predictedLabel = (responseContent ?? "").trim().toLowerCase();

      // Find the matching label (case-insensitive)
      const matchedLabel = labels.find((l) => l.toLowerCase() === predictedLabel) ?? labels[0];

      // Calculate confidence based on exact match
      const confidence = predictedLabel === matchedLabel?.toLowerCase() ? 0.9 : 0.5;

      return {
        intent: matchedLabel ?? "unknown",
        confidence,
        scores: labels.reduce(
          (acc, label) => {
            acc[label] =
              label === matchedLabel ? confidence : (1 - confidence) / (labels.length - 1);
            return acc;
          },
          {} as Record<string, number>
        ),
      };
    } catch (error) {
      this.handleError(error, "classify");
    }
  }

  /**
   * Check if using edge Worker
   */
  isUsingWorker(): boolean {
    return this.useWorker;
  }

  /**
   * Check if quota is exhausted
   */
  isQuotaExhausted(): boolean {
    this.checkQuotaReset();
    return this.quotaExhausted;
  }

  /**
   * Get time until quota resets (ms), or null if not exhausted
   */
  getQuotaResetTime(): number | null {
    if (!this.quotaExhausted || !this.quotaResetTime) return null;
    const remaining = this.quotaResetTime - Date.now();
    return remaining > 0 ? remaining : null;
  }
}
