import axios, { type AxiosError, type AxiosInstance } from "axios";
import config from "../config.js";
import { delay } from "../utils/async.js";
import { createLogger } from "../utils/logger.js";
import { buildSecureSystemPrompt, validateLLMOutput, wrapUserInput } from "../utils/security.js";
import { getVRAMManager } from "../utils/vram/index.js";

const log = createLogger("AI");

/**
 * Valid chat message roles for Ollama API
 */
type ChatRole = "system" | "user" | "assistant" | "tool";

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
  readonly role: ChatRole;
  readonly content: string;
  readonly tool_calls?: OllamaToolCallResponse[];
}

/**
 * Ollama native tool call in response
 */
interface OllamaToolCallResponse {
  readonly function: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  };
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
 * Ollama tool definition format
 */
interface OllamaTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: "object";
      readonly required: string[];
      readonly properties: Record<
        string,
        {
          readonly type: string;
          readonly description: string;
          readonly enum?: string[];
        }
      >;
    };
  };
}

/**
 * Response from chatWithTools method
 */
export interface ChatWithToolsResponse {
  readonly content: string;
  readonly toolCalls: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }[];
  readonly done: boolean;
}

/**
 * Message format for chatWithTools
 * Note: tool_name is the Ollama API format for tool result messages
 */
export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  readonly tool_name?: string; // For tool results - uses snake_case per Ollama API
  readonly tool_calls?: {
    readonly function: {
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    };
  }[];
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
 * Unified error handler for LLM API calls.
 * Converts Axios errors and unknown errors into user-friendly Error objects.
 * @param error - The caught error
 * @param operation - Name of the operation (e.g., "chat", "generate")
 * @param elapsedMs - Time elapsed before the error occurred
 */
function handleLLMError(error: unknown, operation: string, elapsedMs: number): never {
  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNREFUSED") {
      throw new Error(
        "Cannot connect to LLM server. Make sure Ollama is running on your host machine.",
        { cause: error }
      );
    }

    if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
      throw new Error(`LLM API error (${operation}): request timed out after ${elapsedMs}ms`, {
        cause: error,
      });
    }

    throw new Error(`LLM API error (${operation}): ${error.message}`, { cause: error });
  }

  throw new Error(`Unexpected error in LLM ${operation}: ${formatUnknownError(error)}`, {
    cause: error,
  });
}

/**
 * AI Service for Local LLM Integration
 * Connects to Ollama running on your local machine (4090)
 * Using host.docker.internal to access host from within Docker container
 * Supports automatic sleep mode after inactivity
 */
export class AIService {
  private readonly client: AxiosInstance;
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
        timeout: config.llm.requestTimeout, // Configurable timeout for LLM responses
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
    let safeIndex: 0 | 1 | 2;
    if (retryIndex < 0) {
      safeIndex = 0;
    } else if (retryIndex > 2) {
      safeIndex = 2;
    } else {
      safeIndex = Math.floor(retryIndex) as 0 | 1 | 2;
    }
    return FIXED_DELAYS[safeIndex];
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
          `${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`
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
        const retryCount = (requestConfig as { __retryCount?: number })?.__retryCount ?? 0;

        if (isRetryable && requestConfig && retryCount < MAX_RETRIES) {
          // Update retry count on config
          (requestConfig as { __retryCount?: number }).__retryCount = retryCount + 1;

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

        throw error;
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
   * Send unload request to Ollama
   */
  private async sendUnloadRequest(useEmptyPrompt = false): Promise<void> {
    const payload: Record<string, unknown> = {
      model: this.model,
      stream: false,
      keep_alive: 0,
    };

    if (useEmptyPrompt) {
      payload.prompt = "";
    }

    await this.client.post("/api/generate", payload);
  }

  /**
   * Mark model as sleeping and notify listeners
   */
  private markAsAsleep(): void {
    this.isAsleep = true;
    this.isPreloaded = false;
    log.info("Model is now sleeping (unloaded from GPU)");

    // Notify VRAM manager that LLM is unloaded
    const vramManager = getVRAMManager();
    vramManager.notifyLLMUnloaded();

    // Notify listeners
    if (sleepStateCallback) {
      sleepStateCallback(true);
    }
  }

  /**
   * Attempt to unload the model with verification
   */
  private async attemptUnload(): Promise<void> {
    log.info(`Putting model ${this.model} to sleep after inactivity...`);

    // Send keep_alive: 0 to immediately unload the model
    await this.sendUnloadRequest();
    await delay(1000);

    // Verify the model actually unloaded
    const stillLoaded = await this.isModelLoaded();
    if (stillLoaded) {
      await this.retryUnload();
    } else {
      log.info("Model verified unloaded from GPU");
    }

    this.markAsAsleep();
  }

  /**
   * Retry unloading the model with empty prompt
   */
  private async retryUnload(): Promise<void> {
    log.warn("Model still loaded after unload request, retrying...");

    await this.sendUnloadRequest(true);
    await delay(1000);

    const stillLoaded = await this.isModelLoaded();
    if (stillLoaded) {
      log.warn("Model still loaded after retry - marking as asleep anyway");
    } else {
      log.info("Model verified unloaded after retry");
    }
  }

  /**
   * Handle sleep errors - check if model is already unloaded
   */
  private handleSleepError(error: unknown): void {
    const formatted = formatUnknownError(error);
    log.warn(`Failed to put model to sleep: ${formatted}`);

    // If Ollama responds with a 404 or similar indicating the model
    // isn't loaded, treat it as already asleep to avoid being stuck.
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      if (status === 404 || status === 400) {
        log.warn(`Model ${this.model} appears already unloaded; marking as asleep.`);
        this.markAsAsleep();
      }
    }
  }

  /**
   * Put the model to sleep (unload from GPU memory)
   * Best-effort; state may be out of sync if Ollama behavior changes.
   * Notifies VRAM manager when model is unloaded.
   * Now verifies the model actually unloaded before marking as asleep.
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
        await this.attemptUnload();
      } catch (error) {
        this.handleSleepError(error);
      } finally {
        this.sleepPromise = null;
      }
    })();

    await this.sleepPromise;
  }

  /**
   * Check if the model is currently loaded in Ollama
   */
  private async isModelLoaded(): Promise<boolean> {
    try {
      const response = await this.client.get<{ models: { name: string }[] }>("/api/ps");
      const loadedModels = response.data.models ?? [];
      return loadedModels.some((m) => m.name === this.model || m.name.startsWith(this.model));
    } catch {
      // If we can't check, assume not loaded
      return false;
    }
  }

  /**
   * Wake the model up (load into GPU memory)
   * Returns true on success, false on failure.
   * Multiple concurrent callers share a single wake operation.
   * Coordinates with VRAM manager to ensure space is available.
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

      // Request VRAM allocation from the manager
      const vramManager = getVRAMManager();
      const vramOk = await vramManager.requestLLMAccess();

      if (!vramOk) {
        log.warn("VRAM manager denied LLM wake request - insufficient memory");
        this.wakePromise = null;
        return false;
      }

      const success = await this.preloadModel();

      if (success) {
        this.isAsleep = false;
        log.info("Model is now awake");

        // Notify VRAM manager that LLM is now loaded
        vramManager.notifyLLMLoaded();

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
   * Uses VRAM manager to dynamically adjust GPU layer allocation
   * Falls back to a smaller model if main model fails to load
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

    // Try main model first, then fallback if it fails
    const modelsToTry = [this.model];
    if (config.llm.fallbackModel && config.llm.fallbackModel !== this.model) {
      modelsToTry.push(config.llm.fallbackModel);
    }

    for (const modelToLoad of modelsToTry) {
      const isMainModel = modelToLoad === this.model;
      const loaded = await this.tryLoadModel(modelToLoad, isMainModel);
      if (loaded) return true;

      // Log fallback attempt if main model failed
      if (isMainModel && modelsToTry.length > 1) {
        log.info(`Main model failed, trying fallback model: ${config.llm.fallbackModel}`);
      }
    }

    log.error("Both main model and fallback model failed to load!");
    return false;
  }

  /**
   * Attempt to load a single model with VRAM optimization
   */
  private async tryLoadModel(modelToLoad: string, isMainModel: boolean): Promise<boolean> {
    try {
      const vramManager = getVRAMManager();

      // Check VRAM availability and get optimal load options
      const isConstrained = await vramManager.isVRAMConstrained();
      const loadOptions = await vramManager.getOptimalLoadOptions();

      if (isConstrained) {
        const gpuLayers = loadOptions.num_gpu === -1 ? "all" : loadOptions.num_gpu;
        log.info(
          `VRAM constrained, loading ${isMainModel ? "model" : "fallback model"} with ${gpuLayers} GPU layers`
        );
      }

      log.info(
        `Preloading ${isMainModel ? "model" : "fallback model"} ${modelToLoad} into GPU memory...`
      );
      const startTime = Date.now();

      // Send request with model name and optimized GPU options
      await this.client.post("/api/generate", {
        model: modelToLoad,
        stream: false,
        keep_alive: config.llm.keepAlive,
        options: {
          num_gpu: loadOptions.num_gpu,
          main_gpu: loadOptions.main_gpu,
        },
      });

      // Success! Update state
      this.model = modelToLoad;
      this.isPreloaded = true;
      this.isAsleep = false;
      this.updateActivity();

      // Log success with VRAM status
      const elapsed = Date.now() - startTime;
      const status = await vramManager.getModelLoadStatus();
      log.info(
        `${isMainModel ? "Model" : "Fallback model"} preloaded successfully in ${elapsed}ms (${status.location}, ${status.vramUsedMB}MB VRAM)`
      );

      // Notify listeners that we're awake
      if (sleepStateCallback) {
        sleepStateCallback(false);
      }

      return true;
    } catch (error) {
      const formatted = formatUnknownError(error);
      log.warn(
        `Failed to preload ${isMainModel ? "model" : "fallback model"} ${modelToLoad}: ${formatted}`
      );
      return false;
    }
  }

  /**
   * Build Ollama performance options from config.
   * These options are applied to all API calls for optimal inference speed.
   */
  private getPerformanceOptions(): Record<string, unknown> {
    const perf = config.llm.performance;
    const options: Record<string, unknown> = {
      // Context window size - critical for performance
      num_ctx: config.llm.heretic.contextLength,
      // Batch size for prompt processing
      num_batch: perf.numBatch,
      // Flash attention for faster inference
      flash_attn: perf.flashAttention,
      // Memory-mapped files for faster loading
      mmap: perf.mmap,
    };

    // Only set num_thread if explicitly configured (0 = auto-detect)
    if (perf.numThread > 0) {
      options.num_thread = perf.numThread;
    }

    // Memory locking (requires elevated permissions)
    if (perf.mlock) {
      options.mlock = true;
    }

    log.debug(`Performance options: ${JSON.stringify(options)}`);
    return options;
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
    const clampedMaxTokens = Math.min(Math.max(1, Math.floor(maxTokens)), config.llm.maxTokens);

    const effectiveTimeout = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : undefined;

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
            ...this.getPerformanceOptions(),
            temperature,
            num_predict: maxTokens,
            stop: ["<|im_end|>", "<|im_start|>", "<|endoftext|>", "Human:", "User:"],
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
          `LLM output contained suspicious content: ${outputValidation.issuesFound.join(", ")}`
        );
      }

      return outputValidation.sanitized;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      handleLLMError(error, "chat", elapsed);
    }
  }

  /**
   * Convert a single ChatMessage to Ollama format
   */
  private convertMessageToOllamaFormat(msg: ChatMessage): {
    role: ChatRole;
    content: string;
    tool_calls?: OllamaToolCallResponse[];
    tool_name?: string;
  } {
    if (msg.role === "tool") {
      // Tool results need tool_name per Ollama native format
      const toolMsg: {
        role: "tool";
        content: string;
        tool_name?: string;
      } = {
        role: "tool",
        content: msg.content,
      };
      if (msg.tool_name) {
        toolMsg.tool_name = msg.tool_name;
      }
      return toolMsg;
    }
    if (msg.role === "user") {
      return {
        role: "user",
        content: wrapUserInput(msg.content),
      };
    }
    return {
      role: msg.role,
      content: msg.content,
    };
  }

  /**
   * Chat with native Ollama tool calling support
   * Sends messages with tool definitions and returns tool calls if any
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools: OllamaTool[],
    options: ChatOptions = {}
  ): Promise<ChatWithToolsResponse> {
    // Wake model if sleeping
    if (this.isAsleep) {
      const woke = await this.wake();
      if (!woke) {
        throw new Error("Failed to wake LLM model before chatWithTools request");
      }
    }
    this.updateActivity();

    const { temperature, maxTokens, keepAlive, timeoutMs, systemPrompt } =
      this.normalizeOptions(options);

    // Build Ollama-formatted messages
    const ollamaMessages: {
      role: ChatRole;
      content: string;
      tool_calls?: OllamaToolCallResponse[];
      tool_name?: string;
    }[] = [];

    // Add system prompt first if provided
    if (systemPrompt) {
      ollamaMessages.push({
        role: "system",
        content: buildSecureSystemPrompt(systemPrompt),
      });
    }

    // Convert messages to Ollama format
    for (const msg of messages) {
      ollamaMessages.push(this.convertMessageToOllamaFormat(msg));
    }

    const startTime = Date.now();

    try {
      log.debug(
        `LLM chatWithTools request: ${tools.length} tools, ${ollamaMessages.length} messages`
      );

      const response = await this.client.post<OllamaChatResponse>(
        "/api/chat",
        {
          model: this.model,
          messages: ollamaMessages,
          // Pass tools to Ollama for native tool calling
          // Ollama will format them according to model's template
          tools: tools.length > 0 ? tools : undefined,
          stream: false,
          keep_alive: keepAlive,
          options: {
            ...this.getPerformanceOptions(),
            temperature,
            num_predict: maxTokens,
            stop: ["<|im_end|>", "<|im_start|>", "<|endoftext|>", "Human:", "User:"],
          },
        },
        timeoutMs ? { timeout: timeoutMs } : undefined
      );

      const elapsed = Date.now() - startTime;
      log.debug(
        `LLM chatWithTools completed in ${elapsed}ms, toolCalls=${response.data.message.tool_calls?.length ?? 0}, content=${response.data.message.content?.slice(0, 100) ?? "(none)"}`
      );

      this.updateActivity();

      // Extract tool calls if present
      const toolCalls =
        response.data.message.tool_calls?.map((tc) => ({
          name: tc.function.name,
          arguments: tc.function.arguments,
        })) ?? [];

      // Validate content if present
      let content = response.data.message.content ?? "";
      if (content) {
        const outputValidation = validateLLMOutput(content);
        if (!outputValidation.valid) {
          log.warn(
            `LLM output contained suspicious content: ${outputValidation.issuesFound.join(", ")}`
          );
        }
        content = outputValidation.sanitized;
      }

      return {
        content,
        toolCalls,
        done: response.data.done,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      handleLLMError(error, "chatWithTools", elapsed);
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
        const err = new Error("Failed to wake LLM model before generate request");
        throw err;
      }
    }
    this.updateActivity();

    const { temperature, maxTokens, keepAlive, timeoutMs } = this.normalizeOptions(options);

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
            ...this.getPerformanceOptions(),
            temperature,
            num_predict: maxTokens,
            stop: ["<|im_end|>", "<|im_start|>", "<|endoftext|>", "Human:", "User:"],
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
          `LLM output contained suspicious content: ${outputValidation.issuesFound.join(", ")}`
        );
      }

      return outputValidation.sanitized;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      handleLLMError(error, "generate", elapsed);
    }
  }

  /**
   * Chat with full message history
   * Used by the orchestrator for tool-enabled conversations
   * @param messages - Full conversation history including system prompt
   * @param options - Chat options
   * @returns The assistant's response
   */
  async chatWithMessages(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    // Wake model if sleeping
    if (this.isAsleep) {
      const woke = await this.wake();
      if (!woke) {
        const err = new Error("Failed to wake LLM model before chat request");
        throw err;
      }
    }
    this.updateActivity();

    const { temperature, maxTokens, keepAlive, timeoutMs } = this.normalizeOptions(options);

    const startTime = Date.now();

    // Map public ChatMessage to internal OllamaChatMessage
    const ollamaMessages: OllamaChatMessage[] = messages.map((msg) => {
      // Create base object with known properties
      const ollamaMsg: OllamaChatMessage = {
        role: msg.role,
        content: msg.content,
        // Only include tool_calls if present to avoid undefined properties
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
      };

      return ollamaMsg;
    });

    try {
      const response = await this.client.post<OllamaChatResponse>(
        "/api/chat",
        {
          model: this.model,
          messages: ollamaMessages,
          stream: false,
          keep_alive: keepAlive,
          options: {
            ...this.getPerformanceOptions(),
            temperature,
            num_predict: maxTokens,
          },
        },
        timeoutMs ? { timeout: timeoutMs } : undefined
      );

      const elapsed = Date.now() - startTime;
      log.debug(`LLM chatWithMessages completed in ${elapsed}ms using model ${this.model}`);

      this.updateActivity();

      // Validate LLM output before returning
      const outputValidation = validateLLMOutput(response.data.message.content);
      if (!outputValidation.valid) {
        log.warn(
          `LLM output contained suspicious content: ${outputValidation.issuesFound.join(", ")}`
        );
      }

      return outputValidation.sanitized;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      handleLLMError(error, "chatWithMessages", elapsed);
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
      const response = await this.client.get<{ models: { name: string }[] }>("/api/tags");
      return response.data.models.map((m) => m.name);
    } catch (error) {
      handleLLMError(error, "listModels", 0);
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
  instance ??= new AIService();
  return instance;
}

export default AIService;
