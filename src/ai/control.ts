/**
 * AI Control Service
 * Manages the Ollama service state (start/stop/status)
 */

import config from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("AIControl");

interface OllamaStatus {
  running: boolean;
  model: string | null;
  modelLoaded: boolean;
  error?: string;
}

/**
 * AI Control Service - manages Ollama lifecycle
 */
export class AIControlService {
  private readonly ollamaHost: string;
  private readonly modelName: string;
  private manuallyDisabled = false;

  constructor() {
    this.ollamaHost = config.llm.apiUrl;
    this.modelName = config.llm.model;
  }

  /**
   * Check if AI is manually disabled by admin
   */
  isManuallyDisabled(): boolean {
    return this.manuallyDisabled;
  }

  /**
   * Get comprehensive status of Ollama
   */
  async getStatus(): Promise<OllamaStatus> {
    if (this.manuallyDisabled) {
      return {
        running: false,
        model: this.modelName,
        modelLoaded: false,
        error: "Manually disabled by administrator",
      };
    }

    try {
      // Check if Ollama is running
      // SECURITY: this.ollamaHost is validated at config load time via validateInternalServiceUrl()
      // It points to a trusted internal Docker service, not user input
      const response = await fetch(`${this.ollamaHost}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return {
          running: false,
          model: this.modelName,
          modelLoaded: false,
          error: `Ollama returned status ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        models?: { name: string }[];
      };
      const models = data.models || [];
      const modelLoaded = models.some(
        (m) => m.name === this.modelName || m.name.startsWith(`${this.modelName}:`)
      );

      return {
        running: true,
        model: this.modelName,
        modelLoaded,
      };
    } catch (error) {
      return {
        running: false,
        model: this.modelName,
        modelLoaded: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Load the AI model (warm it up)
   */
  async loadModel(): Promise<{ success: boolean; message: string }> {
    if (this.manuallyDisabled) {
      return {
        success: false,
        message: "AI is manually disabled. Use /startai first.",
      };
    }

    try {
      // Send a minimal request to load the model into memory
      // SECURITY: this.ollamaHost is validated at config load time via validateInternalServiceUrl()
      const response = await fetch(`${this.ollamaHost}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          prompt: "Hello",
          stream: false,
          options: {
            num_predict: 1, // Generate just 1 token to load model
          },
        }),
        signal: AbortSignal.timeout(120000), // 2 minute timeout for model loading
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: `Failed to load model: ${errorText}`,
        };
      }

      return {
        success: true,
        message: `Model ${this.modelName} loaded successfully!`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error loading model: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Unload the model from GPU memory
   */
  async unloadModel(): Promise<{ success: boolean; message: string }> {
    try {
      // Ollama unloads models by setting keep_alive to 0
      // SECURITY: this.ollamaHost is validated at config load time via validateInternalServiceUrl()
      const response = await fetch(`${this.ollamaHost}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          prompt: "",
          keep_alive: 0, // Immediately unload
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        // Model might not be loaded, which is fine
        return {
          success: true,
          message: "Model unloaded (or was not loaded).",
        };
      }

      return {
        success: true,
        message: `Model ${this.modelName} unloaded from GPU memory.`,
      };
    } catch (error) {
      // Connection refused usually means Ollama is not running, which is fine
      // Log at debug level for troubleshooting
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("ECONNREFUSED")) {
        // Only log unexpected errors
        log.debug(`Unload model error (non-critical): ${message}`);
      }
      return {
        success: true,
        message: "Model unloaded (Ollama not responding).",
      };
    }
  }

  /**
   * Enable AI (allow responses)
   */
  async enable(): Promise<{ success: boolean; message: string }> {
    this.manuallyDisabled = false;

    // Optionally load the model
    const loadResult = await this.loadModel();
    if (loadResult.success) {
      return {
        success: true,
        message: "✅ AI enabled and model loaded!",
      };
    }

    return {
      success: true,
      message: `✅ AI enabled, but model loading had an issue: ${loadResult.message}`,
    };
  }

  /**
   * Disable AI (stop responding, unload model)
   */
  async disable(): Promise<{ success: boolean; message: string }> {
    this.manuallyDisabled = true;

    // Unload the model to free GPU memory
    const unloadResult = await this.unloadModel();

    return {
      success: true,
      message: `🛑 AI disabled. ${unloadResult.message}`,
    };
  }
}

// Singleton instance
let aiControlService: AIControlService | null = null;

export function getAIControlService(): AIControlService {
  aiControlService ??= new AIControlService();
  return aiControlService;
}
