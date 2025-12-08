/**
 * VRAM Manager Types
 *
 * Type definitions for GPU memory management, task tracking,
 * and allocation requests.
 *
 * @module utils/vram/types
 */

/**
 * Model location state for VRAM/RAM migration
 */
export type ModelLocation = "vram" | "ram" | "partial" | "unloaded";

/**
 * GPU memory status
 */
export interface GPUMemoryStatus {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  usagePercent: number;
}

/**
 * Model load status from Ollama
 */
export interface OllamaModel {
  name: string;
  /** Total model size in bytes */
  size: number;
  /** Bytes used in VRAM */
  size_vram: number;
  expires_at: string;
}

/**
 * Task priority levels
 */
export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

/**
 * Task types that need VRAM
 */
export enum TaskType {
  LLM_CHAT = "llm_chat",
  IMAGE_GENERATION = "image_generation",
  EMBEDDING = "embedding",
  SUMMARIZATION = "summarization",
}

/**
 * VRAM allocation request
 */
export interface VRAMAllocationRequest {
  taskType: TaskType;
  priority: TaskPriority;
  /** Estimated VRAM in MB */
  estimatedVRAM: number;
  userId?: string;
  requestId: string;
}

/**
 * VRAM allocation result
 */
export interface VRAMAllocationResult {
  granted: boolean;
  reason?: string;
  waitTimeMs?: number;
  currentFreeVRAM?: number;
}

/**
 * Active task tracking
 */
export interface ActiveTask {
  requestId: string;
  taskType: TaskType;
  priority: TaskPriority;
  startTime: number;
  userId?: string | undefined;
}

/**
 * Migration status for monitoring
 */
export interface MigrationStatus {
  inProgress: boolean;
  location: ModelLocation;
  lastMigration: number;
  pressureCount: number;
  availableCount: number;
}

/**
 * Model load status result
 */
export interface ModelLoadStatus {
  loaded: boolean;
  location: ModelLocation;
  vramUsedMB: number;
  modelSizeMB: number;
  modelName: string | null;
}

/**
 * Optimal load options for Ollama
 */
export interface OptimalLoadOptions {
  num_gpu: number;
  main_gpu: number;
}
