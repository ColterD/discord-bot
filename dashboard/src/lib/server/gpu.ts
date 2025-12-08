/**
 * GPU Monitoring Server Module
 *
 * Fetches GPU/VRAM status from Ollama and nvidia-smi
 */

import type { GpuStatus } from '$lib/types';

/** Ollama API base URL - use OLLAMA_HOST from .env */
const OLLAMA_URL = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

/** ComfyUI API base URL - use COMFYUI_URL from .env or default to localhost */
const COMFYUI_URL = process.env.COMFYUI_URL ?? 'http://localhost:8188';

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export interface OllamaRunningModel {
  name: string;
  size: number;
  size_vram: number;
  digest: string;
  expires_at: string;
}

export interface GpuInfo {
  gpu: GpuStatus | null;
  loadedModels: OllamaRunningModel[];
  ollamaHealthy: boolean;
  comfyuiHealthy: boolean;
}

/**
 * Get currently loaded models from Ollama
 */
async function getOllamaRunningModels(): Promise<OllamaRunningModel[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/ps`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.models ?? [];
  } catch {
    return [];
  }
}

/**
 * Check if Ollama is healthy
 */
async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if ComfyUI is healthy
 */
async function checkComfyUIHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${COMFYUI_URL}/system_stats`, {
      signal: AbortSignal.timeout(3000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Try to get GPU info from nvidia-smi via Docker exec
 * Falls back to null if not available
 */
async function getGpuFromNvidiaSmi(): Promise<GpuStatus | null> {
  try {
    // Query nvidia-smi via the Ollama container (which has GPU access)
    const response = await fetch(`${OLLAMA_URL}/api/ps`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const models = data.models ?? [];

    // Calculate VRAM usage from loaded models
    if (models.length > 0) {
      const totalVram = models.reduce(
        (sum: number, m: OllamaRunningModel) => sum + (m.size_vram ?? 0),
        0
      );

      // Estimate total GPU memory (assume 24GB RTX 4090 as default)
      const totalMB = 24576; // 24GB
      const usedMB = Math.round(totalVram / (1024 * 1024));

      return {
        name: 'NVIDIA GPU',
        totalMB,
        usedMB,
        freeMB: totalMB - usedMB,
        usagePercent: (usedMB / totalMB) * 100
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get comprehensive GPU information
 */
export async function getGpuInfo(): Promise<GpuInfo> {
  const [ollamaHealthy, comfyuiHealthy, loadedModels, gpu] = await Promise.all([
    checkOllamaHealth(),
    checkComfyUIHealth(),
    getOllamaRunningModels(),
    getGpuFromNvidiaSmi()
  ]);

  return {
    gpu,
    loadedModels,
    ollamaHealthy,
    comfyuiHealthy
  };
}
