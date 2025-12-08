/**
 * ComfyUI API Client
 *
 * Handles communication with ComfyUI API for GPU status monitoring.
 *
 * @module utils/vram/comfyui-client
 * @security All HTTP requests use URLs from config (config.comfyui.url)
 * which are validated at config load time via validateInternalServiceUrl().
 * These are trusted internal Docker service URLs, not user input.
 */

import config from "../../config.js";
import { bytesToMB } from "./helpers.js";
import type { GPUMemoryStatus } from "./types.js";

/**
 * Get VRAM status from ComfyUI
 */
export async function getComfyUIVRAMStatus(): Promise<GPUMemoryStatus | null> {
  try {
    const response = await fetch(`${config.comfyui.url}/system_stats`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      devices?: {
        name: string;
        type: string;
        vram_total: number;
        vram_free: number;
      }[];
    };

    const gpu = data.devices?.find((d) => d.type === "cuda");
    if (!gpu) return null;

    const totalMB = bytesToMB(gpu.vram_total);
    const freeMB = bytesToMB(gpu.vram_free);
    const usedMB = totalMB - freeMB;

    return {
      totalMB,
      usedMB,
      freeMB,
      usagePercent: usedMB / totalMB,
    };
  } catch {
    return null;
  }
}
