/**
 * VRAM Manager Module
 *
 * Centralized GPU memory management for coordinating between
 * Ollama (LLM inference) and ComfyUI (Image generation).
 *
 * @module utils/vram
 */

// Re-export configuration
export { VRAM_CONFIG } from "./config.js";
// Re-export helpers for external use
export { bytesToMB } from "./helpers.js";
// Re-export manager
export { getVRAMManager, VRAMManager } from "./manager.js";
// Re-export types
export type {
  ActiveTask,
  GPUMemoryStatus,
  MigrationStatus,
  ModelLoadStatus,
  ModelLocation,
  OllamaModel,
  OptimalLoadOptions,
  VRAMAllocationRequest,
  VRAMAllocationResult,
} from "./types.js";
export { TaskPriority, TaskType } from "./types.js";
