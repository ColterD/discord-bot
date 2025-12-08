/**
 * Ollama LLM Provider
 *
 * Provides local LLM access via Ollama API.
 * Supports chat completion with sleep/wake management for GPU efficiency.
 */

import axios, { type AxiosError, type AxiosInstance } from "axios";
import { createLogger } from "../../utils/logger.js";
import {
  BaseLLMProvider,
  type ChatCompletionOptions,
  type ChatCompletionResponse,
  type EmbeddingOptions,
  type EmbeddingResponse,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderMessage,
  ProviderUnavailableError,
} from "./base-provider.js";

const log = createLogger("OllamaProvider");

/**
 * Ollama chat message format
 */
interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Ollama chat response
 */
interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama embedding response
 */
interface OllamaEmbeddingResponse {
  model: string;
  embeddings: number[][];
}

/**
 * Ollama model info from /api/ps
 */
interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  details?: {
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Ollama provider configuration
 * All values should come from config.ts which reads from .env
 */
export interface OllamaProviderConfig {
  /** Ollama API URL - from OLLAMA_HOST */
  apiUrl: string;
  /** Model name - from LLM_MODEL */
  model: string;
  /** Fallback model for constrained VRAM - from LLM_FALLBACK_MODEL */
  fallbackModel?: string;
  /** Request timeout in ms - from LLM_REQUEST_TIMEOUT_MS */
  timeoutMs: number;
  /** Keep model alive (seconds, -1 = forever) - from LLM_KEEP_ALIVE */
  keepAlive: number;
  /** Embedding model - from EMBEDDING_MODEL */
  embeddingModel: string;
}

/**
 * Ollama LLM Provider
 *
 * Implements LLMProvider for local Ollama instance.
 * Handles model loading/unloading for GPU memory management.
 */
export class OllamaProvider extends BaseLLMProvider {
  readonly name = "Ollama";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    embeddings: true,
    classification: false,
    streaming: true, // Ollama supports streaming (not implemented here yet)
    maxContextLength: 32768, // Model-dependent, this is conservative
    embeddingDimensions: 1024, // nomic-embed-text default
  };

  private readonly client: AxiosInstance;
  private readonly model: string;
  private readonly fallbackModel: string | undefined;
  private readonly keepAlive: number;
  private readonly embeddingModel: string;

  private currentModel: string;
  private isModelLoaded = false;

  constructor(config: OllamaProviderConfig) {
    super();

    this.model = config.model;
    this.fallbackModel = config.fallbackModel;
    this.keepAlive = config.keepAlive;
    this.embeddingModel = config.embeddingModel;
    this.currentModel = config.model;

    this.client = axios.create({
      baseURL: config.apiUrl,
      timeout: config.timeoutMs,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Check if Ollama is reachable and get loaded models
   */
  async checkHealth(): Promise<ProviderHealth> {
    const startTime = Date.now();
    try {
      const response = await this.client.get<{ models: OllamaModelInfo[] }>("/api/ps");
      const loadedModels = response.data.models ?? [];

      this.isModelLoaded = loadedModels.some(
        (m) => m.name === this.currentModel || m.name.startsWith(this.currentModel)
      );

      return {
        available: true,
        latencyMs: Date.now() - startTime,
        metadata: {
          loadedModels: loadedModels.map((m) => m.name),
          isModelLoaded: this.isModelLoaded,
          currentModel: this.currentModel,
        },
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
   * Generate chat completion
   */
  async chat(
    messages: ProviderMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const startTime = Date.now();

    try {
      // Convert to Ollama message format
      const ollamaMessages: OllamaChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await this.client.post<OllamaChatResponse>(
        "/api/chat",
        {
          model: this.currentModel,
          messages: ollamaMessages,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.7,
            num_predict: options?.maxTokens ?? 4096,
          },
          keep_alive: this.keepAlive,
        },
        {
          ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
        }
      );

      const durationMs = Date.now() - startTime;
      const data = response.data;

      return {
        content: data.message.content,
        model: data.model,
        durationMs,
        usage: {
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
      };
    } catch (error) {
      this.handleError(error, "chat");
    }
  }

  /**
   * Generate embeddings
   */
  async embed(texts: string | string[], options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    const textArray = Array.isArray(texts) ? texts : [texts];

    try {
      // Ollama embedding API expects 'input' for batch
      const response = await this.client.post<OllamaEmbeddingResponse>(
        "/api/embed",
        {
          model: this.embeddingModel,
          input: textArray,
        },
        options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
      );

      return {
        embeddings: response.data.embeddings,
        model: response.data.model,
        dimensions: response.data.embeddings[0]?.length ?? 1024,
      };
    } catch (error) {
      this.handleError(error, "embed");
    }
  }

  /**
   * Load model into GPU memory
   */
  async loadModel(): Promise<boolean> {
    try {
      log.info(`Loading model ${this.currentModel}...`);

      // Send a minimal request to load the model
      await this.client.post("/api/generate", {
        model: this.currentModel,
        prompt: "",
        stream: false,
        keep_alive: this.keepAlive,
      });

      this.isModelLoaded = true;
      log.info(`Model ${this.currentModel} loaded`);
      return true;
    } catch (error) {
      log.error(`Failed to load model ${this.currentModel}:`, error);

      // Try fallback model if available
      if (this.fallbackModel && this.currentModel !== this.fallbackModel) {
        log.info(`Trying fallback model ${this.fallbackModel}...`);
        this.currentModel = this.fallbackModel;
        return this.loadModel();
      }

      return false;
    }
  }

  /**
   * Unload model from GPU memory
   */
  async unloadModel(): Promise<void> {
    try {
      log.info(`Unloading model ${this.currentModel}...`);

      await this.client.post("/api/generate", {
        model: this.currentModel,
        stream: false,
        keep_alive: 0,
      });

      this.isModelLoaded = false;
      log.info(`Model ${this.currentModel} unloaded`);
    } catch (error) {
      log.warn(`Failed to unload model:`, error);
    }
  }

  /**
   * Switch to fallback model
   */
  switchToFallback(): boolean {
    if (this.fallbackModel && this.currentModel !== this.fallbackModel) {
      log.info(`Switching from ${this.currentModel} to fallback ${this.fallbackModel}`);
      this.currentModel = this.fallbackModel;
      return true;
    }
    return false;
  }

  /**
   * Switch back to primary model
   */
  switchToPrimary(): void {
    if (this.currentModel !== this.model) {
      log.info(`Switching back to primary model ${this.model}`);
      this.currentModel = this.model;
    }
  }

  /**
   * Get current model name
   */
  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * Check if model is currently loaded
   */
  isLoaded(): boolean {
    return this.isModelLoaded;
  }

  /**
   * Handle Ollama API errors
   */
  private handleError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: string }>;

      if (axiosError.code === "ECONNREFUSED") {
        throw new ProviderUnavailableError(
          this.name,
          "Cannot connect to Ollama. Is it running?",
          axiosError
        );
      }

      if (axiosError.code === "ETIMEDOUT" || axiosError.code === "ECONNABORTED") {
        throw new ProviderUnavailableError(
          this.name,
          `Request timed out during ${operation}`,
          axiosError
        );
      }

      const errMsg = axiosError.response?.data?.error ?? axiosError.message;
      throw new ProviderUnavailableError(this.name, `${operation} failed: ${errMsg}`, axiosError);
    }

    throw new ProviderUnavailableError(
      this.name,
      `${operation} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  /**
   * Dispose of provider resources
   */
  async dispose(): Promise<void> {
    // Optionally unload model on dispose
    if (this.isModelLoaded) {
      await this.unloadModel();
    }
  }
}
