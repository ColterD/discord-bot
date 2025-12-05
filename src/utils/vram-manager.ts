/**
 * VRAM Manager
 *
 * Centralized GPU memory management for coordinating between:
 * - Ollama (LLM inference)
 * - ComfyUI (Image generation)
 *
 * Features:
 * - Real-time VRAM monitoring
 * - Intelligent model loading/unloading
 * - Priority-based resource allocation
 * - Prevents VRAM contention between services
 *
 * @security All HTTP requests use URLs from config (config.llm.apiUrl, config.comfyui.url)
 * which are validated at config load time via validateInternalServiceUrl().
 * These are trusted internal Docker service URLs, not user input.
 */

import axios from "axios";
import { createLogger } from "./logger.js";
import config from "../config.js";

const log = createLogger("VRAMManager");

/**
 * GPU memory status
 */
interface GPUMemoryStatus {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  usagePercent: number;
}

/**
 * Model load status from Ollama
 */
interface OllamaModel {
  name: string;
  size: number; // bytes (total model size)
  size_vram: number; // bytes used in VRAM
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
interface VRAMAllocationRequest {
  taskType: TaskType;
  priority: TaskPriority;
  estimatedVRAM: number; // MB
  userId?: string;
  requestId: string;
}

/**
 * VRAM allocation result
 */
interface VRAMAllocationResult {
  granted: boolean;
  reason?: string;
  waitTimeMs?: number;
  currentFreeVRAM?: number;
}

/**
 * Active task tracking
 */
interface ActiveTask {
  requestId: string;
  taskType: TaskType;
  priority: TaskPriority;
  startTime: number;
  userId?: string | undefined;
}

// VRAM thresholds (in MB)
const VRAM_CONFIG = {
  // Total VRAM on RTX 4090 (you can adjust for your GPU)
  totalVRAM: Number.parseInt(process.env.GPU_TOTAL_VRAM_MB ?? "24576", 10),

  // Minimum free VRAM to keep as buffer
  minFreeBuffer: Number.parseInt(process.env.GPU_MIN_FREE_MB ?? "512", 10),

  // VRAM thresholds
  warningThreshold: 0.75, // 75% usage warning
  criticalThreshold: 0.9, // 90% usage critical

  // Estimated VRAM usage per task type (MB)
  estimatedUsage: {
    [TaskType.LLM_CHAT]: 4096, // Allow spillover to RAM (was 14000)
    [TaskType.IMAGE_GENERATION]: 8000, // ComfyUI with FLUX ~8GB
    [TaskType.EMBEDDING]: 500, // Small embedding model
    [TaskType.SUMMARIZATION]: 2000, // 3B summarization model
  },

  // Task priorities (higher = more important)
  taskPriorities: {
    [TaskType.LLM_CHAT]: TaskPriority.HIGH,
    [TaskType.IMAGE_GENERATION]: TaskPriority.NORMAL,
    [TaskType.EMBEDDING]: TaskPriority.LOW,
    [TaskType.SUMMARIZATION]: TaskPriority.LOW,
  },

  // Polling interval for VRAM status (ms)
  pollInterval: 5000,

  // Timeout for VRAM operations (ms)
  operationTimeout: 30000,
};

/**
 * VRAM Manager Singleton
 */
class VRAMManager {
  private static instance: VRAMManager | null = null;

  private readonly activeTasks = new Map<string, ActiveTask>();
  private pendingRequests: VRAMAllocationRequest[] = [];
  private lastVRAMStatus: GPUMemoryStatus | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private disposed = false;

  // Callbacks for state changes
  private readonly onVRAMCritical: (() => void)[] = [];
  private readonly onVRAMNormal: (() => void)[] = [];

  private constructor() {
    this.startPolling();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): VRAMManager {
    VRAMManager.instance ??= new VRAMManager();
    return VRAMManager.instance;
  }

  /**
   * Dispose of the manager
   */
  dispose(): void {
    this.disposed = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    VRAMManager.instance = null;
  }

  /**
   * Start VRAM status polling
   */
  private startPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Initial status check
    void this.updateVRAMStatus();

    this.pollInterval = setInterval(() => {
      if (!this.disposed) {
        void this.updateVRAMStatus();
      }
    }, VRAM_CONFIG.pollInterval);
  }

  /**
   * Update VRAM status from all sources
   */
  private async updateVRAMStatus(): Promise<void> {
    try {
      const [ollamaStatus, comfyuiStatus] = await Promise.all([
        this.getOllamaVRAMStatus(),
        this.getComfyUIVRAMStatus(),
      ]);

      // Combine status from both sources (use ComfyUI's nvidia-smi view if available)
      if (comfyuiStatus) {
        this.lastVRAMStatus = comfyuiStatus;
      } else if (ollamaStatus) {
        // Estimate from Ollama loaded models
        const usedMB = ollamaStatus.reduce(
          (sum, m) => sum + Math.round(m.size_vram / (1024 * 1024)),
          0
        );
        this.lastVRAMStatus = {
          totalMB: VRAM_CONFIG.totalVRAM,
          usedMB,
          freeMB: VRAM_CONFIG.totalVRAM - usedMB,
          usagePercent: usedMB / VRAM_CONFIG.totalVRAM,
        };
      }

      // Check thresholds and notify
      if (this.lastVRAMStatus) {
        const usage = this.lastVRAMStatus.usagePercent;
        if (usage >= VRAM_CONFIG.criticalThreshold) {
          log.warn(
            `VRAM critical: ${Math.round(usage * 100)}% used (${this.lastVRAMStatus.usedMB}MB / ${this.lastVRAMStatus.totalMB}MB)`
          );
          this.onVRAMCritical.forEach((cb) => cb());
        } else if (usage < VRAM_CONFIG.warningThreshold) {
          this.onVRAMNormal.forEach((cb) => cb());
        }
      }

      // Process pending requests if we have free VRAM
      await this.processPendingRequests();
    } catch (error) {
      log.debug(
        `Failed to update VRAM status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get VRAM status from Ollama
   */
  private async getOllamaVRAMStatus(): Promise<OllamaModel[] | null> {
    try {
      const response = await axios.get<{ models: OllamaModel[] }>(`${config.llm.apiUrl}/api/ps`, {
        timeout: 5000,
      });
      return response.data.models || [];
    } catch {
      return null;
    }
  }

  /**
   * Get VRAM status from ComfyUI
   */
  private async getComfyUIVRAMStatus(): Promise<GPUMemoryStatus | null> {
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

      const totalMB = Math.round(gpu.vram_total / (1024 * 1024));
      const freeMB = Math.round(gpu.vram_free / (1024 * 1024));
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

  /**
   * Get current VRAM status
   */
  getVRAMStatus(): GPUMemoryStatus | null {
    return this.lastVRAMStatus;
  }

  /**
   * Check if we have enough VRAM for a task
   */
  canAllocate(taskType: TaskType): boolean {
    if (!this.lastVRAMStatus) return true; // Optimistic if no status

    const requiredMB = VRAM_CONFIG.estimatedUsage[taskType];
    const availableMB = this.lastVRAMStatus.freeMB - VRAM_CONFIG.minFreeBuffer;

    return availableMB >= requiredMB;
  }

  /**
   * Request VRAM allocation for a task
   *
   * For LLM tasks, we're more permissive since Ollama can spill to RAM.
   * For image generation, we're stricter since ComfyUI needs contiguous VRAM.
   */
  async requestAllocation(request: VRAMAllocationRequest): Promise<VRAMAllocationResult> {
    const requiredMB = request.estimatedVRAM || VRAM_CONFIG.estimatedUsage[request.taskType];

    // For LLM tasks, be more permissive - Ollama handles RAM spillover
    if (request.taskType === TaskType.LLM_CHAT) {
      this.activeTasks.set(request.requestId, {
        requestId: request.requestId,
        taskType: request.taskType,
        priority: request.priority,
        startTime: Date.now(),
        userId: request.userId,
      });
      log.debug(`VRAM allocation granted for LLM (Ollama manages spillover)`);
      return { granted: true };
    }

    // Check current status
    if (!this.lastVRAMStatus) {
      await this.updateVRAMStatus();
    }

    if (!this.lastVRAMStatus) {
      // No status available, proceed optimistically
      this.activeTasks.set(request.requestId, {
        requestId: request.requestId,
        taskType: request.taskType,
        priority: request.priority,
        startTime: Date.now(),
        userId: request.userId,
      });

      return { granted: true };
    }

    const availableMB = this.lastVRAMStatus.freeMB - VRAM_CONFIG.minFreeBuffer;

    // Check if we have enough VRAM
    if (availableMB >= requiredMB) {
      this.activeTasks.set(request.requestId, {
        requestId: request.requestId,
        taskType: request.taskType,
        priority: request.priority,
        startTime: Date.now(),
        userId: request.userId,
      });

      log.debug(
        `VRAM allocated for ${request.taskType}: ${requiredMB}MB (${availableMB}MB available)`
      );

      return {
        granted: true,
        currentFreeVRAM: availableMB,
      };
    }

    // Not enough VRAM - check if we can free some
    const freedVRAM = await this.tryFreeVRAM(requiredMB, request.priority);

    if (freedVRAM >= requiredMB) {
      this.activeTasks.set(request.requestId, {
        requestId: request.requestId,
        taskType: request.taskType,
        priority: request.priority,
        startTime: Date.now(),
        userId: request.userId,
      });

      log.info(`VRAM freed and allocated for ${request.taskType}: ${requiredMB}MB`);

      return {
        granted: true,
        currentFreeVRAM: freedVRAM,
      };
    }

    // Still not enough, add to pending queue
    this.pendingRequests.push(request);

    log.info(
      `VRAM allocation pending for ${request.taskType}: need ${requiredMB}MB, have ${availableMB}MB`
    );

    return {
      granted: false,
      reason: `Insufficient VRAM: need ${requiredMB}MB, available ${availableMB}MB`,
      waitTimeMs: 30000, // Estimate
      currentFreeVRAM: availableMB,
    };
  }

  /**
   * Release VRAM allocation when task completes
   */
  releaseAllocation(requestId: string): void {
    const task = this.activeTasks.get(requestId);
    if (task) {
      const duration = Date.now() - task.startTime;
      log.debug(`VRAM released for ${task.taskType} (${requestId}) after ${duration}ms`);
      this.activeTasks.delete(requestId);
    }
  }

  /**
   * Try to free VRAM by unloading lower priority tasks
   */
  private async tryFreeVRAM(requiredMB: number, requestPriority: TaskPriority): Promise<number> {
    // Check if we should unload the LLM for image generation
    const ollamaModels = await this.getOllamaVRAMStatus();

    if (ollamaModels && ollamaModels.length > 0) {
      // Calculate potential VRAM to free
      let potentialFreeMB = 0;

      for (const model of ollamaModels) {
        // Only unload if the new task has higher or equal priority
        const modelPriority = VRAM_CONFIG.taskPriorities[TaskType.LLM_CHAT];
        if (requestPriority >= modelPriority) {
          potentialFreeMB += Math.round(model.size_vram / (1024 * 1024));
        }
      }

      const currentFree = this.lastVRAMStatus?.freeMB ?? 0;
      const totalAfterUnload = currentFree + potentialFreeMB;

      if (totalAfterUnload >= requiredMB + VRAM_CONFIG.minFreeBuffer) {
        // Unload Ollama models
        log.info(`Unloading Ollama model(s) to free ${potentialFreeMB}MB for new task`);

        try {
          for (const model of ollamaModels) {
            await axios.post(
              `${config.llm.apiUrl}/api/generate`,
              {
                model: model.name,
                keep_alive: 0, // Immediately unload
                stream: false,
              },
              { timeout: 30000 }
            );
          }

          // Update status after unload
          await this.updateVRAMStatus();

          return this.lastVRAMStatus?.freeMB ?? potentialFreeMB;
        } catch (error) {
          log.error("Failed to unload Ollama model:", error);
          return currentFree;
        }
      }
    }

    return this.lastVRAMStatus?.freeMB ?? 0;
  }

  /**
   * Process pending VRAM requests
   */
  private async processPendingRequests(): Promise<void> {
    if (this.pendingRequests.length === 0) return;

    // Sort by priority (highest first)
    this.pendingRequests.sort((a, b) => b.priority - a.priority);

    const toProcess = [...this.pendingRequests];
    this.pendingRequests = [];

    for (const request of toProcess) {
      // Check if we now have enough VRAM (don't go through full requestAllocation to avoid re-queuing)
      const requiredMB = request.estimatedVRAM || VRAM_CONFIG.estimatedUsage[request.taskType];
      const availableMB = (this.lastVRAMStatus?.freeMB ?? 0) - VRAM_CONFIG.minFreeBuffer;

      if (availableMB >= requiredMB) {
        // Grant the allocation
        this.activeTasks.set(request.requestId, {
          requestId: request.requestId,
          taskType: request.taskType,
          priority: request.priority,
          startTime: Date.now(),
          userId: request.userId,
        });
        log.debug(`Pending VRAM request granted for ${request.taskType}: ${requiredMB}MB`);
      } else {
        // Still not enough VRAM - drop the request (caller should retry if needed)
        // Don't re-queue to prevent infinite loops
        log.debug(
          `Pending VRAM request expired for ${request.taskType}: need ${requiredMB}MB, have ${availableMB}MB`
        );
      }
    }
  }

  /**
   * Request VRAM access for LLM (model wake/load)
   * Returns true if granted, false if denied
   *
   * NOTE: If a model is already loaded in Ollama, we allow the request
   * since Ollama handles memory spillover to RAM automatically.
   */
  async requestLLMAccess(): Promise<boolean> {
    // Check if a model is already loaded in Ollama
    const ollamaModels = await this.getOllamaVRAMStatus();
    if (ollamaModels && ollamaModels.length > 0) {
      // Model is already loaded - Ollama handles memory management
      log.debug("LLM model already loaded, granting access (Ollama manages memory spillover)");
      return true;
    }

    const requestId = `llm-${Date.now()}`;

    const result = await this.requestAllocation({
      taskType: TaskType.LLM_CHAT,
      priority: TaskPriority.NORMAL,
      estimatedVRAM: VRAM_CONFIG.estimatedUsage[TaskType.LLM_CHAT],
      requestId,
    });

    return result.granted;
  }

  /**
   * Notify that LLM has been loaded into VRAM
   */
  notifyLLMLoaded(): void {
    log.debug("LLM model loaded notification received");
    // Could track this state if needed for more sophisticated coordination
  }

  /**
   * Notify that LLM has been unloaded from VRAM
   */
  notifyLLMUnloaded(): void {
    log.debug("LLM model unloaded notification received");
    // Clear any LLM-related active tasks
    for (const [id, task] of this.activeTasks.entries()) {
      if (task.taskType === TaskType.LLM_CHAT) {
        this.activeTasks.delete(id);
      }
    }
  }

  /**
   * Notify that image generation is complete
   */
  notifyImageGenerationComplete(userId?: string): void {
    log.debug(`Image generation complete for user ${userId ?? "unknown"}`);
    // Clear image generation tasks for this user
    for (const [id, task] of this.activeTasks.entries()) {
      if (task.taskType === TaskType.IMAGE_GENERATION) {
        if (!userId || task.userId === userId) {
          this.activeTasks.delete(id);
        }
      }
    }
  }

  /**
   * Notify that image models have been unloaded from VRAM
   */
  notifyImageModelsUnloaded(): void {
    log.debug("Image models unloaded notification received");
    // Clear any image generation active tasks
    for (const [id, task] of this.activeTasks.entries()) {
      if (task.taskType === TaskType.IMAGE_GENERATION) {
        this.activeTasks.delete(id);
      }
    }
  }

  /**
   * Notify that image models have been loaded into VRAM
   */
  notifyImageModelsLoaded(): void {
    log.debug("Image models loaded notification received");
    // Could track this state if needed for more sophisticated coordination
  }

  /**
   * Request exclusive access for image generation
   * This will unload LLM if needed
   */
  async requestImageGenerationAccess(userId?: string): Promise<boolean> {
    const requestId = `img-${Date.now()}`;

    // Build request, only including userId if provided
    const request: VRAMAllocationRequest = {
      taskType: TaskType.IMAGE_GENERATION,
      priority: TaskPriority.HIGH, // Elevate priority for image gen
      estimatedVRAM: VRAM_CONFIG.estimatedUsage[TaskType.IMAGE_GENERATION],
      requestId,
    };
    if (userId) {
      request.userId = userId;
    }

    const result = await this.requestAllocation(request);

    return result.granted;
  }

  /**
   * Check if LLM is currently loaded
   */
  async isLLMLoaded(): Promise<boolean> {
    const models = await this.getOllamaVRAMStatus();
    return models !== null && models.length > 0;
  }

  /**
   * Get loaded Ollama models
   */
  async getLoadedModels(): Promise<string[]> {
    const models = await this.getOllamaVRAMStatus();
    return models?.map((m) => m.name) ?? [];
  }

  /**
   * Get model load location status
   * Returns whether the model is loaded in VRAM, RAM, or not loaded
   */
  async getModelLoadStatus(): Promise<{
    loaded: boolean;
    location: "vram" | "ram" | "partial" | "unloaded";
    vramUsedMB: number;
    modelSizeMB: number;
    modelName: string | null;
  }> {
    const models = await this.getOllamaVRAMStatus();

    if (!models || models.length === 0) {
      return {
        loaded: false,
        location: "unloaded",
        vramUsedMB: 0,
        modelSizeMB: 0,
        modelName: null,
      };
    }

    // Get the primary model (usually the first one)
    const model = models[0];
    if (!model) {
      return {
        loaded: false,
        location: "unloaded",
        vramUsedMB: 0,
        modelSizeMB: 0,
        modelName: null,
      };
    }

    const vramUsedMB = Math.round(model.size_vram / (1024 * 1024));
    const modelSizeMB = Math.round(model.size / (1024 * 1024));

    // Determine location based on VRAM usage
    // If VRAM usage is less than 10% of model size, it's mostly in RAM
    // If VRAM usage is more than 90% of model size, it's mostly in VRAM
    let location: "vram" | "ram" | "partial";
    const vramRatio = model.size_vram / model.size;

    if (vramRatio < 0.1) {
      location = "ram";
    } else if (vramRatio > 0.9) {
      location = "vram";
    } else {
      location = "partial"; // Split between VRAM and RAM
    }

    return {
      loaded: true,
      location,
      vramUsedMB,
      modelSizeMB,
      modelName: model.name,
    };
  }

  /**
   * Force unload all Ollama models
   */
  async unloadAllModels(): Promise<void> {
    const models = await this.getOllamaVRAMStatus();
    if (!models || models.length === 0) return;

    log.info("Force unloading all Ollama models");

    for (const model of models) {
      try {
        await axios.post(
          `${config.llm.apiUrl}/api/generate`,
          {
            model: model.name,
            keep_alive: 0,
            stream: false,
          },
          { timeout: 30000 }
        );
      } catch (error) {
        log.warn(`Failed to unload model ${model.name}:`, error);
      }
    }

    await this.updateVRAMStatus();
  }

  /**
   * Register callback for VRAM critical state
   */
  onCritical(callback: () => void): void {
    this.onVRAMCritical.push(callback);
  }

  /**
   * Register callback for VRAM normal state
   */
  onNormal(callback: () => void): void {
    this.onVRAMNormal.push(callback);
  }

  /**
   * Get estimated time until VRAM is available
   */
  getEstimatedWaitTime(): number {
    // Based on average task duration
    const activeTaskCount = this.activeTasks.size;
    if (activeTaskCount === 0) return 0;

    // Estimate ~45 seconds per active task
    return activeTaskCount * 45000;
  }

  /**
   * Get current active tasks
   */
  getActiveTasks(): ActiveTask[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * Check if image generation can run concurrently with LLM
   */
  canRunImageGenWithLLM(): boolean {
    if (!this.lastVRAMStatus) return false;

    const llmVRAM = VRAM_CONFIG.estimatedUsage[TaskType.LLM_CHAT];
    const imageVRAM = VRAM_CONFIG.estimatedUsage[TaskType.IMAGE_GENERATION];
    const required = llmVRAM + imageVRAM + VRAM_CONFIG.minFreeBuffer;

    return this.lastVRAMStatus.totalMB >= required;
  }

  /**
   * Calculate optimal num_gpu layers based on available VRAM
   * Returns the number of layers to load onto GPU, or -1 for all layers
   *
   * The model has ~60 layers. Each layer uses roughly model_size/60 VRAM.
   * We calculate how many layers can fit in available VRAM.
   */
  async calculateOptimalGPULayers(modelSizeMB = 14500): Promise<number> {
    // Refresh VRAM status
    await this.updateVRAMStatus();

    if (!this.lastVRAMStatus) {
      log.warn("No VRAM status available, defaulting to full GPU loading");
      return -1; // All layers on GPU
    }

    const availableVRAM = this.lastVRAMStatus.freeMB - VRAM_CONFIG.minFreeBuffer;
    const totalLayers = 60; // Typical transformer layer count for 30B model

    // If we have enough for the full model, use all GPU layers
    if (availableVRAM >= modelSizeMB) {
      log.info(`Full VRAM available (${availableVRAM}MB), loading all layers to GPU`);
      return -1; // -1 means all layers
    }

    // Calculate how many layers can fit
    const vramPerLayer = modelSizeMB / totalLayers;
    const optimalLayers = Math.floor(availableVRAM / vramPerLayer);

    // Clamp to reasonable range (at least some layers for KV cache, max all)
    const layers = Math.max(0, Math.min(optimalLayers, totalLayers));

    log.info(
      `Limited VRAM (${availableVRAM}MB available), loading ${layers}/${totalLayers} layers to GPU`
    );

    return layers;
  }

  /**
   * Get Ollama load options based on current VRAM availability
   * This returns options to pass to Ollama's /api/generate or /api/chat
   */
  async getOptimalLoadOptions(): Promise<{
    num_gpu: number;
    main_gpu: number;
  }> {
    const numGpu = await this.calculateOptimalGPULayers();

    return {
      num_gpu: numGpu,
      main_gpu: 0, // Use first GPU
    };
  }

  /**
   * Check if model should be loaded with reduced VRAM
   * Returns true if VRAM is constrained and we need to offload to RAM
   */
  async isVRAMConstrained(): Promise<boolean> {
    await this.updateVRAMStatus();

    if (!this.lastVRAMStatus) return false;

    const availableVRAM = this.lastVRAMStatus.freeMB - VRAM_CONFIG.minFreeBuffer;
    const modelVRAM = VRAM_CONFIG.estimatedUsage[TaskType.LLM_CHAT];

    return availableVRAM < modelVRAM;
  }

  /**
   * Wait for VRAM to become available (with timeout)
   * Useful when ComfyUI is using VRAM and we want to wait for it
   */
  async waitForVRAM(requiredMB: number, timeoutMs = 60000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      await this.updateVRAMStatus();

      if (this.lastVRAMStatus) {
        const available = this.lastVRAMStatus.freeMB - VRAM_CONFIG.minFreeBuffer;
        if (available >= requiredMB) {
          log.info(`VRAM available: ${available}MB (needed ${requiredMB}MB)`);
          return true;
        }
        log.debug(`Waiting for VRAM: ${available}MB available, need ${requiredMB}MB`);
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    log.warn(`Timeout waiting for ${requiredMB}MB VRAM after ${timeoutMs}ms`);
    return false;
  }
}

// Export singleton getter
export function getVRAMManager(): VRAMManager {
  return VRAMManager.getInstance();
}

// Export config for external use
export { VRAM_CONFIG };
