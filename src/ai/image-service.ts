/**
 * Image Generation Service
 * ComfyUI integration for Z-Image-Turbo based image generation
 */

import config from "../config.js";
import { createLogger } from "../utils/logger.js";
import { getVRAMManager } from "../utils/vram-manager.js";

const log = createLogger("ImageService");

interface QueuePromptResponse {
  prompt_id: string;
  number: number;
}

type HistoryResponse = Record<
  string,
  {
    outputs: Record<
      string,
      {
        images?: {
          filename: string;
          subfolder: string;
          type: string;
        }[];
      }
    >;
    status: {
      completed: boolean;
      status_str: string;
    };
  }
>;

interface SystemStatsResponse {
  system: {
    os: string;
    python_version: string;
    embedded_python: boolean;
  };
  devices: {
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
  }[];
}

interface ImageResult {
  success: boolean;
  imageBuffer?: Buffer | undefined;
  filename?: string | undefined;
  error?: string | undefined;
}

interface QueueStatus {
  queueSize: number;
  running: number;
  pending: number;
}

// Callback for when image model sleep state changes (for presence updates)
type ImageSleepStateCallback = (isAsleep: boolean) => void;
let imageSleepStateCallback: ImageSleepStateCallback | null = null;

/**
 * Set a callback to be notified when the image model sleep state changes
 */
export function onImageSleepStateChange(callback: ImageSleepStateCallback): void {
  imageSleepStateCallback = callback;
}

/**
 * ComfyUI Image Service
 * Handles image generation via ComfyUI with Z-Image-Turbo
 * Supports automatic sleep mode after inactivity
 *
 * @security All HTTP requests to ComfyUI use config.comfyui.url which is validated
 * at config load time via validateInternalServiceUrl(). This is a trusted internal
 * Docker service URL set by administrators, not user input.
 */
export class ImageService {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly activeJobs = new Map<string, string>(); // promptId -> userId

  // Sleep state management
  private isAsleep = true; // Start asleep, wake on first request
  private lastActivityTime: number = Date.now();
  private sleepInterval: NodeJS.Timeout | null = null;
  private disposed = false;

  // Concurrency guards for sleep transitions
  private sleepPromise: Promise<void> | null = null;

  // Track failed sleep attempts for retry logic
  private sleepAttemptsFailed = 0;
  private static readonly MAX_SLEEP_RETRIES = 3;

  constructor() {
    this.baseUrl = config.comfyui.url;
    this.clientId = `discord-bot-${Date.now()}`;

    // Start sleep checker
    this.startSleepChecker();
  }

  /**
   * Clean up background resources
   */
  dispose(): void {
    this.disposed = true;
    if (this.sleepInterval) {
      clearInterval(this.sleepInterval);
      this.sleepInterval = null;
    }
  }

  /**
   * Start the background sleep checker
   */
  private startSleepChecker(): void {
    if (this.sleepInterval) {
      clearInterval(this.sleepInterval);
    }

    // Check every 30 seconds if we should put the models to sleep
    this.sleepInterval = setInterval(() => {
      if (this.disposed) {
        return;
      }
      void this.checkSleepStatus();
    }, 30_000);
  }

  /**
   * Check if models should be put to sleep due to inactivity
   */
  private async checkSleepStatus(): Promise<void> {
    if (this.isAsleep || this.disposed) return;

    // Don't sleep if there are active jobs
    if (this.activeJobs.size > 0) {
      this.updateActivity();
      return;
    }

    const inactiveMs = Date.now() - this.lastActivityTime;
    if (inactiveMs >= config.comfyui.sleepAfterMs) {
      await this.sleep();
    }
  }

  /**
   * Update last activity time
   */
  private updateActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Check if the image service is sleeping
   */
  isSleeping(): boolean {
    return this.isAsleep;
  }

  /**
   * Put the ComfyUI models to sleep (unload from GPU memory)
   * Calls the /free endpoint to release VRAM
   * Will retry on next interval if unload fails
   */
  async sleep(): Promise<void> {
    if (this.isAsleep || this.disposed) return;

    // Don't sleep if there are active jobs
    if (this.activeJobs.size > 0) {
      log.debug("Cannot sleep - active jobs in progress");
      return;
    }

    // Coalesce concurrent sleep() calls
    if (this.sleepPromise) {
      await this.sleepPromise;
      return;
    }

    this.sleepPromise = (async () => {
      if (this.isAsleep || this.disposed || this.activeJobs.size > 0) {
        this.sleepPromise = null;
        return;
      }

      try {
        log.info("Putting ComfyUI models to sleep after inactivity...");

        let unloadSucceeded = true;

        if (config.comfyui.unloadOnSleep) {
          unloadSucceeded = await this.attemptModelUnload();
        }

        if (unloadSucceeded) {
          // Only mark as asleep if unload actually succeeded
          this.isAsleep = true;
          this.sleepAttemptsFailed = 0;
          log.info("ComfyUI models are now sleeping (unloaded from GPU)");

          // Notify VRAM manager
          const vramManager = getVRAMManager();
          vramManager.notifyImageModelsUnloaded();

          // Notify listeners (for presence updates)
          if (imageSleepStateCallback) {
            imageSleepStateCallback(true);
          }
        } else {
          // Unload failed - will retry on next interval
          this.sleepAttemptsFailed++;
          if (this.sleepAttemptsFailed >= ImageService.MAX_SLEEP_RETRIES) {
            log.warn(
              `Failed to unload ComfyUI models after ${ImageService.MAX_SLEEP_RETRIES} attempts, marking as asleep anyway`
            );
            // After max retries, mark as asleep to prevent infinite retries
            // but models may still be in VRAM
            this.isAsleep = true;
            this.sleepAttemptsFailed = 0;
            if (imageSleepStateCallback) {
              imageSleepStateCallback(true);
            }
          } else {
            log.info(
              `Unload failed (attempt ${this.sleepAttemptsFailed}/${ImageService.MAX_SLEEP_RETRIES}), will retry on next interval`
            );
          }
        }
      } catch (error) {
        log.warn(
          `Failed to put ComfyUI to sleep: ${error instanceof Error ? error.message : String(error)}`
        );
        // Track failed attempt for retry logic
        this.sleepAttemptsFailed++;
        if (this.sleepAttemptsFailed >= ImageService.MAX_SLEEP_RETRIES) {
          // After max retries, mark as asleep to prevent infinite retries
          this.isAsleep = true;
          this.sleepAttemptsFailed = 0;
          if (imageSleepStateCallback) {
            imageSleepStateCallback(true);
          }
        }
      } finally {
        this.sleepPromise = null;
      }
    })();

    await this.sleepPromise;
  }

  /**
   * Attempt to unload models from ComfyUI and verify the result
   * Returns true if unload succeeded, false otherwise
   */
  private async attemptModelUnload(): Promise<boolean> {
    try {
      // Get VRAM status before unload
      const beforeStatus = await this.getVRAMStatus();
      const beforeUsed = beforeStatus?.used ?? 0;

      // Call ComfyUI's /free endpoint to unload models from VRAM
      // unload_models=true releases model weights, free_memory=true releases cached data
      const response = await fetch(`${this.baseUrl}/free`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          unload_models: true,
          free_memory: true,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        log.warn(`ComfyUI /free endpoint returned ${response.status}`);
        return false;
      }

      // Small delay to allow VRAM to be freed
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify that VRAM was actually freed
      const afterStatus = await this.getVRAMStatus();

      if (afterStatus && beforeStatus) {
        const freedMB = (beforeUsed - afterStatus.used) / (1024 * 1024);
        if (freedMB > 100) {
          // Freed at least 100MB, consider successful
          log.info(`ComfyUI models unloaded, freed ${Math.round(freedMB)}MB VRAM`);
          return true;
        } else if (beforeUsed < 500 * 1024 * 1024) {
          // Less than 500MB was in use, likely no models were loaded
          log.debug("ComfyUI had minimal VRAM usage, nothing significant to unload");
          return true;
        } else {
          // Had significant VRAM but didn't free much
          log.warn(
            `ComfyUI /free completed but only freed ${Math.round(freedMB)}MB (before: ${Math.round(beforeUsed / (1024 * 1024))}MB)`
          );
          return false;
        }
      }

      // Couldn't verify, but endpoint returned OK so assume success
      log.debug("Could not verify VRAM status, assuming unload succeeded");
      return true;
    } catch (error) {
      log.warn(
        `Error during model unload: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Wake up the ComfyUI service (models will load on first use)
   */
  wake(): void {
    if (!this.isAsleep) {
      this.updateActivity();
      return;
    }

    log.info("Waking up ComfyUI...");
    this.isAsleep = false;
    this.sleepAttemptsFailed = 0; // Reset failed attempts counter
    this.updateActivity();

    // Notify VRAM manager
    const vramManager = getVRAMManager();
    vramManager.notifyImageModelsLoaded();

    // Notify listeners
    if (imageSleepStateCallback) {
      imageSleepStateCallback(false);
    }
  }

  /**
   * Check if ComfyUI is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get VRAM status
   */
  async getVRAMStatus(): Promise<{
    total: number;
    free: number;
    used: number;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/system_stats`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as SystemStatsResponse;
      const gpu = data.devices?.find((d) => d.type === "cuda");

      if (!gpu) return null;

      return {
        total: gpu.vram_total,
        free: gpu.vram_free,
        used: gpu.vram_total - gpu.vram_free,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get queue status
   */
  async getQueueStatus(): Promise<QueueStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/queue`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { queueSize: 0, running: 0, pending: 0 };
      }

      const data = (await response.json()) as {
        queue_running: unknown[];
        queue_pending: unknown[];
      };

      return {
        queueSize: data.queue_running.length + data.queue_pending.length,
        running: data.queue_running.length,
        pending: data.queue_pending.length,
      };
    } catch {
      return { queueSize: 0, running: 0, pending: 0 };
    }
  }

  /**
   * Check if we can accept new jobs
   */
  async canAcceptJob(): Promise<{ allowed: boolean; reason?: string }> {
    const queueStatus = await this.getQueueStatus();

    if (queueStatus.queueSize >= config.comfyui.maxQueueSize) {
      return {
        allowed: false,
        reason: `Queue is full (${queueStatus.queueSize}/${config.comfyui.maxQueueSize})`,
      };
    }

    return { allowed: true };
  }

  /**
   * Generate an image from a text prompt
   * Uses Z-Image-Turbo workflow
   * Coordinates with VRAM manager to ensure GPU memory is available
   */
  async generateImage(
    prompt: string,
    userId: string,
    options: {
      width?: number;
      height?: number;
      steps?: number;
      seed?: number;
    } = {}
  ): Promise<ImageResult> {
    const { width = 1024, height = 1024, steps = 4, seed = -1 } = options;

    log.debug(`Image request from ${userId}: ${prompt.slice(0, 50)}...`);

    // Wake up if sleeping (models will load on first use)
    this.wake();

    // Request VRAM allocation from manager (may unload LLM if configured)
    const vramManager = getVRAMManager();
    const vramOk = await vramManager.requestImageGenerationAccess(userId);
    if (!vramOk) {
      log.warn(`VRAM manager denied image generation for ${userId} - insufficient memory`);
      return {
        success: false,
        error: "GPU memory is currently in use. Please try again in a moment.",
      };
    }

    // Check if we can accept the job
    const canAccept = await this.canAcceptJob();
    if (!canAccept.allowed) {
      log.warn(`Rejected image request: ${canAccept.reason}`);
      return { success: false, error: canAccept.reason ?? "Queue is full" };
    }

    // Check user's concurrent job limit (max 2 per user)
    const userJobs = this.getActiveJobsForUser(userId);
    if (userJobs >= 2) {
      log.warn(`User ${userId} hit concurrent job limit`);
      return {
        success: false,
        error: "You already have 2 images generating. Please wait.",
      };
    }

    // Sanitize prompt
    const sanitizedPrompt = this.sanitizePrompt(prompt);
    if (!sanitizedPrompt) {
      return { success: false, error: "Invalid or empty prompt" };
    }

    try {
      // Build the workflow for Z-Image-Turbo
      const workflow = this.buildWorkflow(sanitizedPrompt, {
        width,
        height,
        steps,
        seed: seed === -1 ? Math.floor(Math.random() * 1000000000) : seed,
      });

      // Queue the prompt
      const queueResponse = await fetch(`${this.baseUrl}/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: workflow,
          client_id: this.clientId,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!queueResponse.ok) {
        const errorText = await queueResponse.text();
        return {
          success: false,
          error: `Failed to queue prompt: ${errorText}`,
        };
      }

      const queueData = (await queueResponse.json()) as QueuePromptResponse;
      const promptId = queueData.prompt_id;

      // Track this job
      this.activeJobs.set(promptId, userId);

      // Wait for completion
      const result = await this.waitForCompletion(promptId);

      // Clean up tracking
      this.activeJobs.delete(promptId);

      // Notify VRAM manager that image generation is complete
      vramManager.notifyImageGenerationComplete(userId);

      log.info(`Image generated for user ${userId}`);
      return result;
    } catch (error) {
      // Make sure to notify VRAM manager even on error
      vramManager.notifyImageGenerationComplete(userId);

      log.error(
        `Image generation failed for user ${userId}`,
        error instanceof Error ? error : undefined
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Wait for an image generation to complete
   */
  private async waitForCompletion(promptId: string): Promise<ImageResult> {
    const startTime = Date.now();
    const timeout = config.comfyui.timeout;
    const pollInterval = 1000; // 1 second

    while (Date.now() - startTime < timeout) {
      const result = await this.pollHistory(promptId);
      if (result) return result;
      await this.delay(pollInterval);
    }

    return { success: false, error: "Generation timed out" };
  }

  /**
   * Poll the ComfyUI history for completion status
   * Returns ImageResult if complete, null if still pending
   */
  private async pollHistory(promptId: string): Promise<ImageResult | null> {
    try {
      const historyResponse = await fetch(`${this.baseUrl}/history/${promptId}`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (!historyResponse.ok) return null;

      const history = (await historyResponse.json()) as HistoryResponse;
      const promptHistory = history[promptId];

      if (!promptHistory?.status?.completed) return null;

      return this.extractImageFromHistory(promptHistory);
    } catch (error) {
      // Log transient errors but continue polling
      log.debug(
        `Transient polling error for ${promptId}: ${error instanceof Error ? error.message : "Unknown"}`
      );
      return null;
    }
  }

  /**
   * Extract the generated image from completed history
   */
  private extractImageFromHistory(promptHistory: HistoryResponse[string]): Promise<ImageResult> {
    for (const nodeOutput of Object.values(promptHistory.outputs)) {
      const image = nodeOutput.images?.[0];
      if (image) {
        return this.downloadImage(image.filename, image.subfolder, image.type);
      }
    }
    return Promise.resolve({ success: false, error: "No image in output" });
  }

  /**
   * Download the generated image
   */
  private async downloadImage(
    filename: string,
    subfolder: string,
    type: string
  ): Promise<ImageResult> {
    try {
      const params = new URLSearchParams({
        filename,
        subfolder,
        type,
      });

      const response = await fetch(`${this.baseUrl}/view?${params}`, {
        method: "GET",
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return { success: false, error: "Failed to download image" };
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return {
        success: true,
        imageBuffer: buffer,
        filename,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Download failed",
      };
    }
  }

  /**
   * Build a ComfyUI workflow for Z-Image-Turbo GGUF
   * Uses GGUF quantized model with separate text encoder and VAE
   */
  private buildWorkflow(
    prompt: string,
    options: { width: number; height: number; steps: number; seed: number }
  ): Record<string, unknown> {
    // Z-Image-Turbo GGUF workflow
    // Requires: UnetLoaderGGUF, CLIPLoaderGGUF, ModelSamplingAuraFlow
    return {
      // Load GGUF diffusion model
      "1": {
        class_type: "UnetLoaderGGUF",
        inputs: {
          unet_name: "z_image_turbo-Q8_0.gguf",
        },
      },
      // Load GGUF text encoder (Qwen3-4B)
      "2": {
        class_type: "CLIPLoaderGGUF",
        inputs: {
          clip_name: "Qwen3-4B-UD-Q8_K_XL.gguf",
          type: "lumina2",
        },
      },
      // Apply AuraFlow sampling (required for Z-Image)
      "3": {
        class_type: "ModelSamplingAuraFlow",
        inputs: {
          model: ["1", 0],
          shift: 3,
        },
      },
      // Positive prompt
      "4": {
        class_type: "CLIPTextEncode",
        inputs: {
          clip: ["2", 0],
          text: prompt,
        },
      },
      // Negative prompt
      "5": {
        class_type: "CLIPTextEncode",
        inputs: {
          clip: ["2", 0],
          text: "blurry ugly bad low quality",
        },
      },
      // SD3 latent (required for this architecture)
      "6": {
        class_type: "EmptySD3LatentImage",
        inputs: {
          width: options.width,
          height: options.height,
          batch_size: 1,
        },
      },
      // Load VAE
      "7": {
        class_type: "VAELoader",
        inputs: {
          vae_name: "ae.safetensors",
        },
      },
      // KSampler
      "8": {
        class_type: "KSampler",
        inputs: {
          model: ["3", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["6", 0],
          seed: options.seed,
          steps: options.steps,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1,
        },
      },
      // Decode latent to image
      "9": {
        class_type: "VAEDecode",
        inputs: {
          samples: ["8", 0],
          vae: ["7", 0],
        },
      },
      // Save image
      "10": {
        class_type: "SaveImage",
        inputs: {
          filename_prefix: "discord",
          images: ["9", 0],
        },
      },
    };
  }

  /**
   * Sanitize prompt text
   */
  private sanitizePrompt(prompt: string): string | null {
    if (!prompt || typeof prompt !== "string") return null;

    // Remove control characters (U+0000-U+001F and U+007F) and excessive whitespace
    const controlCharRegex = /[\u0000-\u001F\u007F]/g; // NOSONAR: Regex intentionally matches control characters to remove them
    const cleaned = prompt.replaceAll(controlCharRegex, "").replaceAll(/\s+/g, " ").trim();

    // Check length
    if (cleaned.length < 3 || cleaned.length > 1000) {
      return null;
    }

    return cleaned;
  }

  /**
   * Delay helper for polling
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cancel a running job
   */
  async cancelJob(promptId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/queue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          delete: [promptId],
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get active job count for a user
   */
  getActiveJobsForUser(userId: string): number {
    let count = 0;
    for (const [, jobUserId] of this.activeJobs) {
      if (jobUserId === userId) count++;
    }
    return count;
  }
}

// Singleton instance
let instance: ImageService | null = null;

export function getImageService(): ImageService {
  instance ??= new ImageService();
  return instance;
}

export type { ImageResult, QueueStatus };

// ============ Tool Wrapper Functions ============

/**
 * Style presets for image generation
 */
const STYLE_PRESETS: Record<string, string> = {
  realistic: "photorealistic, highly detailed, 8k, professional photography",
  anime: "anime style, vibrant colors, studio ghibli inspired, detailed",
  "digital-art": "digital art, concept art, artstation trending, highly detailed",
  "oil-painting": "oil painting, classical art style, textured, masterpiece",
  watercolor: "watercolor painting, soft colors, artistic, flowing",
  sketch: "pencil sketch, detailed line art, black and white, artistic",
  "3d-render": "3d render, octane render, unreal engine, highly detailed, volumetric lighting",
};

/**
 * Tool-callable image generation wrapper
 * Used by the orchestrator when the LLM calls generate_image tool
 */
export interface GenerateImageToolArgs {
  prompt: string;
  negative_prompt?: string;
  style?: keyof typeof STYLE_PRESETS;
}

export interface GenerateImageToolResult {
  success: boolean;
  message: string;
  imageBuffer?: Buffer | undefined;
  filename?: string | undefined;
}

/**
 * Execute image generation as a tool call
 * @param args - Tool arguments
 * @param userId - User ID making the request
 * @returns Result with success status and message
 */
export async function executeImageGenerationTool(
  args: GenerateImageToolArgs,
  userId: string
): Promise<GenerateImageToolResult> {
  const service = getImageService();

  // Check if service is available
  const isAvailable = await service.healthCheck();
  if (!isAvailable) {
    return {
      success: false,
      message: "Image generation service is currently unavailable. Please try again later.",
    };
  }

  // Check queue capacity
  const canAccept = await service.canAcceptJob();
  if (!canAccept.allowed) {
    return {
      success: false,
      message: `Cannot generate image: ${canAccept.reason}`,
    };
  }

  // Build enhanced prompt with style
  let enhancedPrompt = args.prompt;
  if (args.style && STYLE_PRESETS[args.style]) {
    enhancedPrompt = `${args.prompt}, ${STYLE_PRESETS[args.style]}`;
  }

  // Note: negative_prompt is available for future workflow enhancements
  // Currently Z-Image-Turbo doesn't use it directly
  // When workflow supports it, use: args.negative_prompt

  try {
    // Generate the image
    const result = await service.generateImage(enhancedPrompt, userId, {
      width: 1024,
      height: 1024,
      steps: 4,
      seed: -1, // Random seed
    });

    if (!result.success) {
      return {
        success: false,
        message: result.error ?? "Image generation failed",
      };
    }

    return {
      success: true,
      message: `Image successfully generated and attached. Prompt used: "${args.prompt}". The image is included with this response - do NOT call generate_image again.`,
      imageBuffer: result.imageBuffer,
      filename: result.filename,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      message: `Image generation failed: ${errorMessage}`,
    };
  }
}
