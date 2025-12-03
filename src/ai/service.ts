import axios, { type AxiosInstance, type AxiosError } from "axios";
import config from "../config.js";
import { createLogger } from "../utils/logger.js";
import {
  wrapUserInput,
  validateLLMOutput,
  buildSecureSystemPrompt,
} from "../utils/security.js";

const log = createLogger("AI");

// Callback for when model sleep state changes (for presence updates)
type SleepStateCallback = (isAsleep: boolean) => void;
let sleepStateCallback: SleepStateCallback | null = null;

/**
 * Set a callback to be notified when the model sleep state changes
 */
export function onSleepStateChange(callback: SleepStateCallback): void {
  sleepStateCallback = callback;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  keepAlive?: number;
  timeoutMs?: number;
}

/**
 * Ollama /generate response (non-streaming)
 */
interface OllamaResponse {
  readonly model: string;
  readonly created_at: string;
  readonly response: string;
  readonly done: boolean;
  // Optional extra metadata fields Ollama may return
  readonly done_reason?: string;
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_duration?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
}

/**
 * Chat message structure for Ollama /api/chat
 */
interface OllamaChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * Ollama /chat response (non-streaming)
 */
interface OllamaChatResponse {
  readonly model: string;
  readonly created_at: string;
  readonly message: OllamaChatMessage;
  readonly done: boolean;
  // Optional extra metadata
  readonly done_reason?: string;
  readonly total_duration?: number;
  readonly load_duration?: number;
  readonly prompt_eval_count?: number;
  readonly prompt_eval_duration?: number;
  readonly eval_count?: number;
  readonly eval_duration?: number;
}

/**
 * Safely convert unknown error to a loggable string.
 */
function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * AI Service for Local LLM Integration
 * Connects to Ollama running on your local machine (4090)
 * Using host.docker.internal to access host from within Docker container
 * Supports automatic sleep mode after inactivity
 */
export class AIService {
  private client: AxiosInstance;
  private model: string;
  private isPreloaded = false;
  private isAsleep = true; // Start asleep, wake on first request or preload
  private lastActivityTime: number = Date.now();

  // Concurrency guards for wake/sleep transitions
  private wakePromise: Promise<boolean> | null = null;
  private sleepPromise: Promise<void> | null = null;

  // Interval / lifecycle management
  private sleepInterval: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(client?: AxiosInstance) {
    this.model = config.llm.model;
    this.client =
      client ??
      axios.create({
        baseURL: config.llm.apiUrl,
        timeout: 120000, // 2 minutes timeout for LLM responses
        headers: {
          "Content-Type": "application/json",
        },
      });

    // Add response/error interceptors with retry logic for transient failures
    this.setupInterceptors();

    // Start sleep check interval
    this.startSleepChecker();
  }

  /**
   * Clean up background resources (intervals, etc.)
   * Call this when the service is no longer needed (e.g. on shutdown or in tests).
   */
  dispose(): void {
    this.disposed = true;
    if (this.sleepInterval) {
      clearInterval(this.sleepInterval);
      this.sleepInterval = null;
    }
  }

  /**
   * Get safe delay for retry - uses a fixed lookup table to prevent code injection
   * This is a pure function that only depends on the retry count index
   */
  private static getSafeRetryDelay(retryIndex: number): number {
    // Fixed delays in milliseconds - no external data influence
    const FIXED_DELAYS = [1000, 2000, 4000] as const;
    // Clamp index to valid range using only constants
    const safeIndex =
      retryIndex < 0 ? 0 : retryIndex > 2 ? 2 : Math.floor(retryIndex);
    // TypeScript needs explicit handling - we know the index is 0, 1, or 2
    return FIXED_DELAYS[safeIndex as 0 | 1 | 2];
  }

  /**
   * Sleep for a fixed duration based on retry attempt
   * Uses separate setTimeout calls with literal values to avoid code injection concerns
   */
  private static async safeDelay(attempt: number): Promise<void> {
    // Use explicit switch with literal delay values to avoid any taint analysis issues
    // This ensures no external data can influence the setTimeout parameter
    switch (attempt) {
      case 0:
        await new Promise<void>((r) => setTimeout(r, 1000));
        break;
      case 1:
        await new Promise<void>((r) => setTimeout(r, 2000));
        break;
      default:
        await new Promise<void>((r) => setTimeout(r, 4000));
        break;
    }
  }

  /**
   * Set up Axios interceptors with retry logic for transient failures
   * Retries on 5xx errors and network issues with exponential backoff
   */
  private setupInterceptors(): void {
    const MAX_RETRIES = 3;

    this.client.interceptors.response.use(
      (response) => {
        log.debug(
          `${response.config.method?.toUpperCase()} ${response.config.url} - ${
            response.status
          }`
        );
        return response;
      },
      async (error: AxiosError) => {
        const requestConfig = error.config;
        const status = error.response?.status ?? 0;
        const url = requestConfig?.url ?? "unknown";

        // Only retry on server errors (5xx) or network issues
        const isRetryable =
          (status >= 500 && status < 600) ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT" ||
          error.code === "ECONNABORTED";

        // Get or initialize retry count - stored on config for tracking across retries
        const retryCount =
          (requestConfig as { __retryCount?: number })?.__retryCount ?? 0;

        if (isRetryable && requestConfig && retryCount < MAX_RETRIES) {
          // Update retry count on config
          (requestConfig as { __retryCount?: number }).__retryCount =
            retryCount + 1;

          // Get the delay value for logging (safe, from fixed array)
          const delayMs = AIService.getSafeRetryDelay(retryCount);

          log.warn(
            `Retrying request ${url} (attempt ${
              retryCount + 1
            }/${MAX_RETRIES}) after ${delayMs}ms - ${error.message}`
          );

          // Use safeDelay with explicit literal setTimeout values
          // This avoids code injection concerns as delays are hardcoded literals
          await AIService.safeDelay(retryCount);

          // Retry the request
          return this.client(requestConfig);
        }

        // Log final failure; distinguish timeout/connection cases for clarity
        const errorCode = error.code ?? status;
        if (
          error.code === "ETIMEDOUT" ||
          error.code === "ECONNABORTED" ||
          error.code === "ECONNRESET"
        ) {
          log.error(
            `Request timed out or connection aborted: ${url} - ${errorCode} - ${error.message}`
          );
        } else {
          log.error(`Request failed: ${url} - ${errorCode} - ${error.message}`);
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Start the background sleep checker
   */
  private startSleepChecker(): void {
    // Prevent multiple intervals in case of re-init
    if (this.sleepInterval) {
      clearInterval(this.sleepInterval);
    }

    // Check every 30 seconds if we should put the model to sleep
    this.sleepInterval = setInterval(() => {
      if (this.disposed) {
        return;
      }
      void this.checkSleepStatus();
    }, 30_000);
  }

  /**
   * Check if the model should be put to sleep due to inactivity
   */
  private async checkSleepStatus(): Promise<void> {
    if (this.isAsleep || this.disposed) return; // Already asleep or disposed

    const inactiveMs = Date.now() - this.lastActivityTime;
    if (inactiveMs >= config.llm.sleepAfterMs) {
      await this.sleep();
    }
  }

  /**
   * Put the model to sleep (unload from GPU memory)
   * Best-effort; state may be out of sync if Ollama behavior changes.
   */
  async sleep(): Promise<void> {
    if (this.isAsleep || this.disposed) return;

    // Coalesce concurrent sleep() calls
    if (this.sleepPromise) {
      await this.sleepPromise;
      return;
    }

    this.sleepPromise = (async () => {
      if (this.isAsleep || this.disposed) {
        this.sleepPromise = null;
        return;
      }

      try {
        log.info(`Putting model ${this.model} to sleep after inactivity...`);

        // Send keep_alive: 0 to immediately unload the model
        await this.client.post("/api/generate", {
          model: this.model,
          stream: false,
          keep_alive: 0,
        });

        this.isAsleep = true;
        this.isPreloaded = false;
        log.info("Model is now sleeping (unloaded from GPU)");

        // Notify listeners
        if (sleepStateCallback) {
          sleepStateCallback(true);
        }
      } catch (error) {
        const formatted = formatUnknownError(error);
        log.warn(`Failed to put model to sleep: ${formatted}`);

        // If Ollama responds with a 404 or similar indicating the model
        // isn't loaded, treat it as already asleep to avoid being stuck.
        if (axios.isAxiosError(error) && error.response) {
          const status = error.response.status;
          if (status === 404 || status === 400) {
            this.isAsleep = true;
            this.isPreloaded = false;
            log.warn(
              `Model ${this.model} appears already unloaded; marking as asleep.`
            );
            if (sleepStateCallback) {
              sleepStateCallback(true);
            }
          }
        }
      } finally {
        this.sleepPromise = null;
      }
    })();

    await this.sleepPromise;
  }

  /**
   * Wake the model up (load into GPU memory)
   * Returns true on success, false on failure.
   * Multiple concurrent callers share a single wake operation.
   */
  async wake(): Promise<boolean> {
    if (!this.isAsleep) {
      this.updateActivity();
      return true;
    }

    if (this.disposed) {
      log.warn("wake() called on disposed AIService instance");
      return false;
    }

    // Coalesce concurrent wake attempts
    if (this.wakePromise) {
      return this.wakePromise;
    }

    this.wakePromise = (async () => {
      log.info(`Waking up model ${this.model}...`);
      const success = await this.preloadModel();

      if (success) {
        this.isAsleep = false;
        log.info("Model is now awake");

        // Notify listeners
        if (sleepStateCallback) {
          sleepStateCallback(false);
        }
      } else {
        log.warn("Failed to wake LLM model (preloadModel returned false)");
      }

      this.wakePromise = null;
      return success;
    })();

    return this.wakePromise;
  }

  /**
   * Update the last activity timestamp
   */
  private updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Check if the model is currently asleep
   */
  isSleeping(): boolean {
    return this.isAsleep;
  }

  /**
   * Get time until sleep (in ms), or 0 if already asleep
   */
  getTimeUntilSleep(): number {
    if (this.isAsleep) return 0;
    const elapsed = Date.now() - this.lastActivityTime;
    return Math.max(0, config.llm.sleepAfterMs - elapsed);
  }

  /**
   * Preload the model into GPU memory for faster first response
   * This sends an empty request to warm up the model
   */
  async preloadModel(): Promise<boolean> {
    if (this.isPreloaded && !this.isAsleep) {
      this.updateActivity();
      return true;
    }

    if (this.disposed) {
      log.warn("preloadModel() called on disposed AIService instance");
      return false;
    }

    try {
      log.info(`Preloading model ${this.model} into GPU memory...`);
      const startTime = Date.now();

      // Send request with just model name to load into memory
      // Using /api/generate with stream:false loads the model
      await this.client.post("/api/generate", {
        model: this.model,
        stream: false,
        keep_alive: config.llm.keepAlive,
      });

      this.isPreloaded = true;
      this.isAsleep = false;
      this.updateActivity();
      const elapsed = Date.now() - startTime;
      log.info(`Model preloaded successfully in ${elapsed}ms`);

      // Notify listeners that we're awake
      if (sleepStateCallback) {
        sleepStateCallback(false);
      }

      return true;
    } catch (error) {
      const formatted = formatUnknownError(error);
      log.warn(`Failed to preload model: ${formatted}`);
      return false;
    }
  }

  /**
   * Clamp and sanitize numeric chat options.
   */
  private normalizeOptions(options: ChatOptions) {
    const {
      temperature = config.llm.temperature,
      maxTokens = config.llm.maxTokens,
      keepAlive = config.llm.keepAlive,
      timeoutMs,
      systemPrompt,
    } = options;

    // Clamp temperature to a safe range [0, 2]
    const clampedTemperature = Math.min(Math.max(temperature, 0), 2);

    // Ensure maxTokens doesn't exceed configured maximum
    const clampedMaxTokens = Math.min(
      Math.max(1, Math.floor(maxTokens)),
      config.llm.maxTokens
    );

    const effectiveTimeout =
      typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined;

    return {
      temperature: clampedTemperature,
      maxTokens: clampedMaxTokens,
      keepAlive,
      timeoutMs: effectiveTimeout,
      systemPrompt,
    };
  }

  /**
   * Send a chat message to the LLM
   * Automatically wakes the model if sleeping
   */
  async chat(prompt: string, options: ChatOptions = {}): Promise<string> {
    // Wake model if sleeping
    if (this.isAsleep) {
      const woke = await this.wake();
      if (!woke) {
        const err = new Error("Failed to wake LLM model before chat request");
        throw err;
      }
    }
    this.updateActivity();

    const { temperature, maxTokens, keepAlive, timeoutMs, systemPrompt } =
      this.normalizeOptions(options);

    const finalSystemPrompt = systemPrompt ?? "You are a helpful assistant.";

    // Apply prompt injection defense
    const secureSystemPrompt = buildSecureSystemPrompt(finalSystemPrompt);
    const wrappedPrompt = wrapUserInput(prompt);

    const messages: OllamaChatMessage[] = [
      { role: "system", content: secureSystemPrompt },
      { role: "user", content: wrappedPrompt },
    ];

    const startTime = Date.now();

    try {
      const response = await this.client.post<OllamaChatResponse>(
        "/api/chat",
        {
          model: this.model,
          messages,
          stream: false,
          keep_alive: keepAlive,
          options: {
            temperature,
            num_predict: maxTokens,
          },
        },
        timeoutMs ? { timeout: timeoutMs } : undefined
      );

      const elapsed = Date.now() - startTime;
      log.debug(
        `LLM chat completed in ${elapsed}ms using model ${this.model}, maxTokens=${maxTokens}, temperature=${temperature}`
      );

      this.updateActivity();

      // Validate LLM output before returning
      const outputValidation = validateLLMOutput(response.data.message.content);
      if (!outputValidation.valid) {
        log.warn(
          `LLM output contained suspicious content: ${outputValidation.issuesFound.join(
            ", "
          )}`
        );
      }

      return outputValidation.sanitized;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNREFUSED") {
          const err = new Error(
            "Cannot connect to LLM server. Make sure Ollama is running on your host machine."
          );
          (err as any).cause = error;
          throw err;
        }

        if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
          const err = new Error(
            `LLM API error (chat): request timed out after ${elapsed}ms`
          );
          (err as any).cause = error;
          throw err;
        }

        const err = new Error(`LLM API error (chat): ${error.message}`);
        (err as any).cause = error;
        throw err;
      }

      const err = new Error(
        `Unexpected error in LLM chat: ${formatUnknownError(error)}`
      );
      (err as any).cause = error;
      throw err;
    }
  }

  /**
   * Generate text completion (non-chat format)
   * Automatically wakes the model if sleeping
   */
  async generate(prompt: string, options: ChatOptions = {}): Promise<string> {
    // Wake model if sleeping
    if (this.isAsleep) {
      const woke = await this.wake();
      if (!woke) {
        const err = new Error(
          "Failed to wake LLM model before generate request"
        );
        throw err;
      }
    }
    this.updateActivity();

    const { temperature, maxTokens, keepAlive, timeoutMs } =
      this.normalizeOptions(options);

    // Wrap user input for safety
    const wrappedPrompt = wrapUserInput(prompt);
    const startTime = Date.now();

    try {
      const response = await this.client.post<OllamaResponse>(
        "/api/generate",
        {
          model: this.model,
          prompt: wrappedPrompt,
          stream: false,
          keep_alive: keepAlive,
          options: {
            temperature,
            num_predict: maxTokens,
          },
        },
        timeoutMs ? { timeout: timeoutMs } : undefined
      );

      const elapsed = Date.now() - startTime;
      log.debug(
        `LLM generate completed in ${elapsed}ms using model ${this.model}, maxTokens=${maxTokens}, temperature=${temperature}`
      );

      this.updateActivity();

      // Validate LLM output before returning
      const outputValidation = validateLLMOutput(response.data.response);
      if (!outputValidation.valid) {
        log.warn(
          `LLM output contained suspicious content: ${outputValidation.issuesFound.join(
            ", "
          )}`
        );
      }

      return outputValidation.sanitized;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNREFUSED") {
          const err = new Error(
            "Cannot connect to LLM server. Make sure Ollama is running on your host machine."
          );
          (err as any).cause = error;
          throw err;
        }

        if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
          const err = new Error(
            `LLM API error (generate): request timed out after ${elapsed}ms`
          );
          (err as any).cause = error;
          throw err;
        }

        const err = new Error(`LLM API error (generate): ${error.message}`);
        (err as any).cause = error;
        throw err;
      }

      const err = new Error(
        `Unexpected error in LLM generate: ${formatUnknownError(error)}`
      );
      (err as any).cause = error;
      throw err;
    }
  }

  /**
   * Chat with full message history
   * Used by the orchestrator for tool-enabled conversations
   * @param messages - Full conversation history including system prompt
   * @param options - Chat options
   * @returns The assistant's response
   */
  async chatWithMessages(
    messages: OllamaChatMessage[],
    options: ChatOptions = {}
  ): Promise<string> {
    // Wake model if sleeping
    if (this.isAsleep) {
      const woke = await this.wake();
      if (!woke) {
        const err = new Error("Failed to wake LLM model before chat request");
        throw err;
      }
    }
    this.updateActivity();

    const { temperature, maxTokens, keepAlive, timeoutMs } =
      this.normalizeOptions(options);

    const startTime = Date.now();

    try {
      const response = await this.client.post<OllamaChatResponse>(
        "/api/chat",
        {
          model: this.model,
          messages,
          stream: false,
          keep_alive: keepAlive,
          options: {
            temperature,
            num_predict: maxTokens,
          },
        },
        timeoutMs ? { timeout: timeoutMs } : undefined
      );

      const elapsed = Date.now() - startTime;
      log.debug(
        `LLM chatWithMessages completed in ${elapsed}ms using model ${this.model}`
      );

      this.updateActivity();

      // Validate LLM output before returning
      const outputValidation = validateLLMOutput(response.data.message.content);
      if (!outputValidation.valid) {
        log.warn(
          `LLM output contained suspicious content: ${outputValidation.issuesFound.join(
            ", "
          )}`
        );
      }

      return outputValidation.sanitized;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNREFUSED") {
          const err = new Error(
            "Cannot connect to LLM server. Make sure Ollama is running on your host machine."
          );
          (err as any).cause = error;
          throw err;
        }

        if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
          const err = new Error(
            `LLM API error (chatWithMessages): request timed out after ${elapsed}ms`
          );
          (err as any).cause = error;
          throw err;
        }

        const err = new Error(
          `LLM API error (chatWithMessages): ${error.message}`
        );
        (err as any).cause = error;
        throw err;
      }

      const err = new Error(
        `Unexpected error in LLM chatWithMessages: ${formatUnknownError(error)}`
      );
      (err as any).cause = error;
      throw err;
    }
  }

  /**
   * Check if the LLM server is available
   * Uses a short timeout to prevent slow responses from blocking
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get("/api/tags", { timeout: 5000 });
      return true;
    } catch (error) {
      // Avoid noisy logs on health checks; debug-level is enough
      log.debug(`healthCheck failed: ${formatUnknownError(error)}`);
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.get<{ models: { name: string }[] }>(
        "/api/tags"
      );
      return response.data.models.map((m) => m.name);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const err = new Error(`Failed to list models: ${error.message}`);
        (err as any).cause = error;
        throw err;
      }
      const err = new Error(
        `Unexpected error listing models: ${formatUnknownError(error)}`
      );
      (err as any).cause = error;
      throw err;
    }
  }

  /**
   * Set the model to use.
   * Does not automatically preload; subsequent calls will wake/preload as needed.
   */
  setModel(model: string): void {
    this.model = model;
    // Changing model invalidates preloaded state; require new preload
    this.isPreloaded = false;
    // Keep isAsleep as-is; next call will wake as needed.
  }

  /**
   * Get current model
   */
  getModel(): string {
    return this.model;
  }
}

// Singleton instance
let instance: AIService | null = null;

export function getAIService(): AIService {
  if (!instance) {
    instance = new AIService();
  }
  return instance;
}

export default AIService;
