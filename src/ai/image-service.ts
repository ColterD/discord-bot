/**
 * Image Generation Service
 * ComfyUI integration for Z-Image-Turbo based image generation
 */

import config from "../config.js";
import { createLogger } from "../utils/logger.js";

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

/**
 * ComfyUI Image Service
 * Handles image generation via ComfyUI with Z-Image-Turbo
 */
export class ImageService {
  private baseUrl: string;
  private clientId: string;
  private activeJobs = new Map<string, string>(); // promptId -> userId

  constructor() {
    this.baseUrl = config.comfyui.url;
    this.clientId = `discord-bot-${Date.now()}`;
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

      log.info(`Image generated for user ${userId}`);
      return result;
    } catch (error) {
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
      try {
        const historyResponse = await fetch(`${this.baseUrl}/history/${promptId}`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });

        if (!historyResponse.ok) {
          await this.sleep(pollInterval);
          continue;
        }

        const history = (await historyResponse.json()) as HistoryResponse;
        const promptHistory = history[promptId];

        if (!promptHistory) {
          await this.sleep(pollInterval);
          continue;
        }

        // Check if completed
        if (promptHistory.status?.completed) {
          // Find the output image
          for (const nodeOutput of Object.values(promptHistory.outputs)) {
            if (nodeOutput.images && nodeOutput.images.length > 0) {
              const image = nodeOutput.images[0];
              if (image) {
                return this.downloadImage(image.filename, image.subfolder, image.type);
              }
            }
          }

          return { success: false, error: "No image in output" };
        }

        await this.sleep(pollInterval);
      } catch (_error) {
        // Continue polling on transient errors
        await this.sleep(pollInterval);
      }
    }

    return { success: false, error: "Generation timed out" };
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
   * Build a ComfyUI workflow for Z-Image-Turbo
   * This is a minimal workflow that uses the model efficiently
   */
  private buildWorkflow(
    prompt: string,
    options: { width: number; height: number; steps: number; seed: number }
  ): Record<string, unknown> {
    // This workflow structure works with Z-Image-Turbo
    // Minimal nodes for fast generation
    return {
      "1": {
        class_type: "CheckpointLoaderSimple",
        inputs: {
          ckpt_name: "z-image-turbo.safetensors", // Z-Image-Turbo model
        },
      },
      "2": {
        class_type: "CLIPTextEncode",
        inputs: {
          clip: ["1", 1],
          text: prompt,
        },
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: {
          clip: ["1", 1],
          text: "", // Negative prompt (empty for turbo)
        },
      },
      "4": {
        class_type: "EmptyLatentImage",
        inputs: {
          batch_size: 1,
          height: options.height,
          width: options.width,
        },
      },
      "5": {
        class_type: "KSampler",
        inputs: {
          cfg: 1.0, // Low CFG for turbo models
          denoise: 1.0,
          latent_image: ["4", 0],
          model: ["1", 0],
          negative: ["3", 0],
          positive: ["2", 0],
          sampler_name: "euler", // Fast sampler
          scheduler: "simple",
          seed: options.seed,
          steps: options.steps,
        },
      },
      "6": {
        class_type: "VAEDecode",
        inputs: {
          samples: ["5", 0],
          vae: ["1", 2],
        },
      },
      "7": {
        class_type: "SaveImage",
        inputs: {
          filename_prefix: "discord",
          images: ["6", 0],
        },
      },
    };
  }

  /**
   * Sanitize prompt text
   */
  private sanitizePrompt(prompt: string): string | null {
    if (!prompt || typeof prompt !== "string") return null;

    // Remove control characters and excessive whitespace
    const cleaned = prompt
      .replace(/[\x00-\x1F\x7F]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Check length
    if (cleaned.length < 3 || cleaned.length > 1000) {
      return null;
    }

    return cleaned;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
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
  if (!instance) {
    instance = new ImageService();
  }
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
  void args.negative_prompt;

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
      message: `Successfully generated image for: "${args.prompt}"`,
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
