/**
 * Ollama API Client
 *
 * Handles communication with Ollama API for model status,
 * loading, and unloading operations.
 *
 * @module utils/vram/ollama-client
 * @security All HTTP requests use URLs from config (config.llm.apiUrl)
 * which are validated at config load time via validateInternalServiceUrl().
 * These are trusted internal Docker service URLs, not user input.
 */

import config from "../../config.js";
import {
  VRAM_RELOAD_TIMEOUT_MS,
  VRAM_STATUS_TIMEOUT_MS,
  VRAM_UNLOAD_TIMEOUT_MS,
} from "../../constants.js";
import { fetchWithTimeout } from "../fetch.js";
import type { OllamaModel } from "./types.js";

/**
 * Get VRAM status from Ollama
 */
export async function getOllamaVRAMStatus(): Promise<OllamaModel[] | null> {
  try {
    const response = await fetchWithTimeout(`${config.llm.apiUrl}/api/ps`, {
      method: "GET",
      timeout: VRAM_STATUS_TIMEOUT_MS,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { models: OllamaModel[] };
    return data.models || [];
  } catch {
    return null;
  }
}

/**
 * Unload a model from VRAM by setting keep_alive to 0
 * @param modelName The name of the model to unload
 */
export async function unloadModel(modelName: string): Promise<void> {
  await fetchWithTimeout(`${config.llm.apiUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      keep_alive: 0,
      stream: false,
    }),
    timeout: VRAM_UNLOAD_TIMEOUT_MS,
  });
}

/**
 * Reload a model with specified GPU layer configuration
 * @param modelName The name of the model to reload
 * @param numGpu Number of GPU layers (-1 = all on GPU, 0 = all in RAM)
 */
export async function reloadModel(modelName: string, numGpu: number): Promise<void> {
  await fetchWithTimeout(`${config.llm.apiUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      prompt: "",
      stream: false,
      keep_alive: config.llm.keepAlive,
      options: {
        num_gpu: numGpu,
      },
    }),
    timeout: VRAM_RELOAD_TIMEOUT_MS,
  });
}
