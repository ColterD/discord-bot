/**
 * VRAM Manager Configuration
 *
 * Centralized configuration for GPU memory management,
 * thresholds, and task priorities.
 *
 * @module utils/vram/config
 */

import config from "../../config.js";
import {
  VRAM_EMBEDDING_ESTIMATE_MB,
  VRAM_POLL_INTERVAL_MS,
  VRAM_SUMMARIZATION_ESTIMATE_MB,
  VRAM_UNLOAD_TIMEOUT_MS,
} from "../../constants.js";
import { TaskPriority, TaskType } from "./types.js";

/**
 * VRAM configuration with centralized defaults and thresholds
 *
 * Uses values from config.ts (which reads from .env) with
 * fallbacks to constants.ts for timing values.
 */
export const VRAM_CONFIG = {
  // Total VRAM available (from config or env)
  totalVRAM: config.gpu.totalVRAM,

  // Minimum free VRAM to keep as buffer (2GB default for headroom)
  minFreeBuffer: config.gpu.minFreeBuffer,

  // VRAM thresholds
  warningThreshold: config.gpu.warningThreshold,
  criticalThreshold: config.gpu.criticalThreshold,

  // Estimated VRAM usage per task type (MB)
  estimatedUsage: {
    [TaskType.LLM_CHAT]: config.gpu.estimatedLLMVRAM,
    [TaskType.IMAGE_GENERATION]: config.gpu.estimatedImageVRAM,
    [TaskType.EMBEDDING]: VRAM_EMBEDDING_ESTIMATE_MB,
    [TaskType.SUMMARIZATION]: VRAM_SUMMARIZATION_ESTIMATE_MB,
  } as const,

  // Task priorities (higher = more important)
  taskPriorities: {
    [TaskType.LLM_CHAT]: TaskPriority.HIGH,
    [TaskType.IMAGE_GENERATION]: TaskPriority.NORMAL,
    [TaskType.EMBEDDING]: TaskPriority.LOW,
    [TaskType.SUMMARIZATION]: TaskPriority.LOW,
  } as const,

  // Polling interval for VRAM status (ms)
  pollInterval: VRAM_POLL_INTERVAL_MS,

  // Timeout for VRAM operations (ms)
  operationTimeout: VRAM_UNLOAD_TIMEOUT_MS,
} as const;
