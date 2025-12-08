/**
 * Image Tools
 *
 * Image generation tool implementations using ComfyUI.
 */

import { config } from "../../../config.js";
import { createLogger } from "../../../utils/logger.js";
import { executeImageGenerationTool } from "../../image-service.js";
import { getStringArg } from "../argument-extractors.js";
import type { ToolResult } from "../types.js";

const log = createLogger("ImageTools");

/**
 * Generate image tool using ComfyUI
 */
export async function executeGenerateImage(
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  // Check if image generation is enabled
  if (!config.comfyui.enabled) {
    return {
      success: false,
      error: "Image generation is currently disabled.",
    };
  }

  const prompt = getStringArg(args, "prompt");
  if (!prompt) {
    return {
      success: false,
      error: "Prompt is required for image generation",
    };
  }

  log.info(`Image generation requested by ${userId}: ${prompt.slice(0, 50)}...`);

  try {
    // Build args object, only including defined properties
    const toolArgs: {
      prompt: string;
      negative_prompt?: string;
      style?: string;
    } = { prompt };
    if (typeof args.negative_prompt === "string") {
      toolArgs.negative_prompt = args.negative_prompt;
    }
    if (typeof args.style === "string") {
      toolArgs.style = args.style;
    }

    const result = await executeImageGenerationTool(
      toolArgs as Parameters<typeof executeImageGenerationTool>[0],
      userId
    );

    if (!result.success) {
      return { success: false, error: result.message };
    }

    // Build response object, only including defined properties
    const response: ToolResult = {
      success: true,
      result: result.message,
    };
    if (result.imageBuffer) {
      response.imageBuffer = result.imageBuffer;
    }
    if (result.filename) {
      response.filename = result.filename;
    }

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    log.error(`Image generation failed: ${errorMessage}`);
    return {
      success: false,
      error: `Image generation failed: ${errorMessage}`,
    };
  }
}
