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
 * - Autonomous VRAM/RAM migration
 * - Request deduplication and self-scheduling polling
 *
 * @module utils/vram/manager
 */

import config from "../../config.js";
import {
  VRAM_DEFAULT_MODEL_SIZE_MB,
  VRAM_ESTIMATED_TASK_DURATION_MS,
  VRAM_FULL_GPU_RATIO_THRESHOLD,
  VRAM_RAM_RATIO_THRESHOLD,
  VRAM_TRANSFORMER_LAYERS,
  VRAM_WAIT_CHECK_INTERVAL_MS,
  VRAM_WAIT_DEFAULT_TIMEOUT_MS,
} from "../../constants.js";
import { delay } from "../async.js";
import { acquireLock } from "../distributed-lock.js";
import { createLogger } from "../logger.js";
import { getComfyUIVRAMStatus } from "./comfyui-client.js";
import { VRAM_CONFIG } from "./config.js";
import { bytesToMB } from "./helpers.js";
import { MigrationManager } from "./migration.js";
import { getOllamaVRAMStatus, unloadModel } from "./ollama-client.js";
import {
  type ActiveTask,
  type GPUMemoryStatus,
  type MigrationStatus,
  type ModelLoadStatus,
  type OptimalLoadOptions,
  TaskPriority,
  TaskType,
  type VRAMAllocationRequest,
  type VRAMAllocationResult,
} from "./types.js";

const log = createLogger("VRAMManager");

/**
 * VRAM Manager Singleton
 *
 * Enhanced with autonomous VRAM/RAM migration:
 * - Monitors for external VRAM consumers (games, other apps)
 * - Automatically migrates models to RAM when VRAM is needed
 * - Migrates back to VRAM when space becomes available
 * - Intelligent throttling to prevent thrashing
 * - Request deduplication to prevent concurrent API calls
 * - Self-scheduling polling for accurate intervals
 */
class VRAMManager {
  private static instance: VRAMManager | null = null;

  private readonly activeTasks = new Map<string, ActiveTask>();
  private pendingRequests: VRAMAllocationRequest[] = [];
  private lastVRAMStatus: GPUMemoryStatus | null = null;
  private pollTimeout: NodeJS.Timeout | null = null;
  private disposed = false;

  // Request deduplication - prevents concurrent status updates
  private updatePromise: Promise<void> | null = null;

  // Distributed lock handles for active allocations
  private readonly allocationLocks = new Map<
    string,
    { release: () => Promise<boolean>; extend: (ttlMs?: number) => Promise<boolean> }
  >();

  // Callbacks for state changes (with unsubscribe support)
  private readonly onVRAMCritical: (() => void)[] = [];
  private readonly onVRAMNormal: (() => void)[] = [];

  // Migration manager
  private readonly migration = new MigrationManager();

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
   * Dispose of the manager and cancel any pending operations
   */
  dispose(): void {
    this.disposed = true;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    // Release all held locks
    for (const [, lockHandle] of this.allocationLocks) {
      void lockHandle.release().catch(() => {
        // Ignore errors during shutdown
      });
    }
    this.allocationLocks.clear();

    this.activeTasks.clear();
    this.pendingRequests = [];
    this.onVRAMCritical.length = 0;
    this.onVRAMNormal.length = 0;
    VRAMManager.instance = null;
    log.info("VRAM Manager disposed");
  }

  /**
   * Start VRAM status polling using self-scheduling setTimeout
   * This ensures accurate intervals even when async operations take time
   */
  private startPolling(): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }

    // Initial status check
    void this.updateVRAMStatus();

    // Start self-scheduling polling
    this.scheduleNextPoll();
  }

  /**
   * Schedule the next poll using setTimeout for accurate timing
   * This ensures polling interval doesn't drift due to async work time
   */
  private scheduleNextPoll(): void {
    if (this.disposed) return;

    this.pollTimeout = setTimeout(() => {
      if (!this.disposed) {
        void this.updateVRAMStatus().finally(() => {
          this.scheduleNextPoll();
        });
      }
    }, VRAM_CONFIG.pollInterval);
  }

  /**
   * Update VRAM status from all sources
   * Uses promise-based mutex to allow callers to wait for the update to complete
   */
  async updateVRAMStatus(): Promise<void> {
    // If update is already in progress, wait for it to complete
    if (this.updatePromise) {
      log.debug("VRAM status update already in progress, waiting...");
      await this.updatePromise;
      return;
    }

    // Start new update and store the promise
    this.updatePromise = this.doUpdateVRAMStatus();
    try {
      await this.updatePromise;
    } finally {
      this.updatePromise = null;
    }
  }

  /**
   * Determine status from raw readings
   */
  private determineCurrentStatus(
    ollamaStatus: { size_vram: number; size: number; name: string }[] | null,
    comfyuiStatus: GPUMemoryStatus | null
  ): void {
    if (comfyuiStatus) {
      this.lastVRAMStatus = comfyuiStatus;
    } else if (ollamaStatus === null) {
      // Fallback when neither source is available - assume full VRAM available
      this.lastVRAMStatus = {
        totalMB: VRAM_CONFIG.totalVRAM,
        usedMB: 0,
        freeMB: VRAM_CONFIG.totalVRAM,
        usagePercent: 0,
      };
      log.debug("Using default VRAM status (full GPU available) - no monitoring source responded");
    } else {
      // Estimate from Ollama loaded models
      const usedMB = ollamaStatus.reduce((sum, m) => sum + bytesToMB(m.size_vram), 0);
      this.lastVRAMStatus = {
        totalMB: VRAM_CONFIG.totalVRAM,
        usedMB,
        freeMB: VRAM_CONFIG.totalVRAM - usedMB,
        usagePercent: usedMB / VRAM_CONFIG.totalVRAM,
      };
    }
  }

  /**
   * Check thresholds and triggers callbacks
   */
  private checkThresholds(): void {
    if (!this.lastVRAMStatus) return;

    const usage = this.lastVRAMStatus.usagePercent;
    if (usage >= VRAM_CONFIG.criticalThreshold) {
      log.warn(
        `VRAM critical: ${Math.round(usage * 100)}% used (${this.lastVRAMStatus.usedMB}MB / ${this.lastVRAMStatus.totalMB}MB)`
      );
      for (const cb of this.onVRAMCritical) {
        cb();
      }
    } else if (usage < VRAM_CONFIG.warningThreshold) {
      for (const cb of this.onVRAMNormal) {
        cb();
      }
    }

    // Update migration baseline
    this.migration.updateBaseline(this.lastVRAMStatus.usedMB);
  }

  /**
   * Internal implementation of VRAM status update
   */
  private async doUpdateVRAMStatus(): Promise<void> {
    try {
      // Only check ComfyUI if image generation is enabled
      const [ollamaStatus, comfyuiStatus] = await Promise.all([
        getOllamaVRAMStatus(),
        config.comfyui.enabled ? getComfyUIVRAMStatus() : Promise.resolve(null),
      ]);

      // Determine and set this.lastVRAMStatus
      this.determineCurrentStatus(ollamaStatus, comfyuiStatus);

      // Check thresholds
      this.checkThresholds();

      // Process pending requests if we have free VRAM
      await this.processPendingRequests();

      // Check for autonomous migration opportunities
      await this.migration.checkAutonomousMigration(
        ollamaStatus,
        this.lastVRAMStatus,
        () => this.getModelLoadStatus(),
        () => this.updateVRAMStatus()
      );
    } catch (error) {
      log.debug(
        `Failed to update VRAM status: ${error instanceof Error ? error.message : String(error)}`
      );
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
   * Uses distributed locking to prevent race conditions in multi-instance deployments.
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

    // For image generation, use distributed lock to prevent race conditions
    const lockHandle = await acquireLock(`vram:allocation:${request.taskType}`, {
      ttlMs: 60000, // 60 second lock TTL
      acquireTimeoutMs: 30000, // Wait up to 30 seconds to acquire
    });

    if (!lockHandle) {
      log.warn(`Failed to acquire VRAM allocation lock for ${request.taskType}`);
      return {
        granted: false,
        reason: "Could not acquire VRAM allocation lock (high contention)",
        waitTimeMs: 30000,
      };
    }

    // Store lock handle for release when allocation is freed
    this.allocationLocks.set(request.requestId, lockHandle);

    try {
      return await this.performAllocation(request, requiredMB);
    } catch (error) {
      // On error, release the lock immediately
      this.allocationLocks.delete(request.requestId);
      await lockHandle.release();
      throw error;
    }
  }

  /**
   * Internal allocation logic (called within lock)
   */
  private async performAllocation(
    request: VRAMAllocationRequest,
    requiredMB: number
  ): Promise<VRAMAllocationResult> {
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

    // Still not enough - release lock since we're not allocating
    const lockHandle = this.allocationLocks.get(request.requestId);
    if (lockHandle) {
      this.allocationLocks.delete(request.requestId);
      await lockHandle.release();
    }

    // Add to pending queue
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

      // Release distributed lock if held
      const lockHandle = this.allocationLocks.get(requestId);
      if (lockHandle) {
        this.allocationLocks.delete(requestId);
        void lockHandle.release().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          log.debug(`Failed to release VRAM allocation lock: ${message}`);
        });
      }
    }
  }

  /**
   * Calculate potential VRAM that can be freed
   */
  private calculatePotentialFreedVRAM(
    ollamaModels: { size_vram: number }[],
    requestPriority: TaskPriority
  ): number {
    let potentialFreeMB = 0;

    for (const model of ollamaModels) {
      // Only unload if the new task has higher or equal priority
      const modelPriority = VRAM_CONFIG.taskPriorities[TaskType.LLM_CHAT];
      if (requestPriority >= modelPriority) {
        potentialFreeMB += bytesToMB(model.size_vram);
      }
    }

    return potentialFreeMB;
  }

  /**
   * Try to free VRAM by unloading lower priority tasks
   */
  private async tryFreeVRAM(requiredMB: number, requestPriority: TaskPriority): Promise<number> {
    // Check if we should unload the LLM for image generation
    const ollamaModels = await getOllamaVRAMStatus();

    if (!ollamaModels || ollamaModels.length === 0) {
      return this.lastVRAMStatus?.freeMB ?? 0;
    }

    const potentialFreeMB = this.calculatePotentialFreedVRAM(ollamaModels, requestPriority);

    const currentFree = this.lastVRAMStatus?.freeMB ?? 0;
    const totalAfterUnload = currentFree + potentialFreeMB;

    if (totalAfterUnload < requiredMB + VRAM_CONFIG.minFreeBuffer) {
      return currentFree;
    }

    // Unload Ollama models
    log.info(`Unloading Ollama model(s) to free ${potentialFreeMB}MB for new task`);

    try {
      for (const model of ollamaModels) {
        await unloadModel(model.name);
      }

      // Update status after unload
      await this.updateVRAMStatus();

      return this.lastVRAMStatus?.freeMB ?? potentialFreeMB;
    } catch (error) {
      log.error("Failed to unload Ollama model:", error);
      return currentFree;
    }
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
    const ollamaModels = await getOllamaVRAMStatus();
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
    const models = await getOllamaVRAMStatus();
    return models !== null && models.length > 0;
  }

  /**
   * Get loaded Ollama models
   */
  async getLoadedModels(): Promise<string[]> {
    const models = await getOllamaVRAMStatus();
    return models?.map((m) => m.name) ?? [];
  }

  /**
   * Get model load location status
   * Returns whether the model is loaded in VRAM, RAM, or not loaded
   */
  async getModelLoadStatus(): Promise<ModelLoadStatus> {
    const models = await getOllamaVRAMStatus();

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

    const vramUsedMB = bytesToMB(model.size_vram);
    const modelSizeMB = bytesToMB(model.size);

    // Determine location based on VRAM usage
    // If VRAM usage is less than 10% of model size, it's mostly in RAM
    // If VRAM usage is more than 90% of model size, it's mostly in VRAM
    let location: "vram" | "ram" | "partial";
    const vramRatio = model.size_vram / model.size;

    if (vramRatio < VRAM_RAM_RATIO_THRESHOLD) {
      location = "ram";
    } else if (vramRatio > VRAM_FULL_GPU_RATIO_THRESHOLD) {
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
    const models = await getOllamaVRAMStatus();
    if (!models || models.length === 0) return;

    log.info("Force unloading all Ollama models");

    for (const model of models) {
      try {
        await unloadModel(model.name);
      } catch (error) {
        log.warn(`Failed to unload model ${model.name}:`, error);
      }
    }

    await this.updateVRAMStatus();
  }

  /**
   * Register callback for VRAM critical state
   * @returns Unsubscribe function to remove the callback
   */
  onCritical(callback: () => void): () => void {
    this.onVRAMCritical.push(callback);
    return () => {
      const index = this.onVRAMCritical.indexOf(callback);
      if (index !== -1) {
        this.onVRAMCritical.splice(index, 1);
      }
    };
  }

  /**
   * Register callback for VRAM normal state
   * @returns Unsubscribe function to remove the callback
   */
  onNormal(callback: () => void): () => void {
    this.onVRAMNormal.push(callback);
    return () => {
      const index = this.onVRAMNormal.indexOf(callback);
      if (index !== -1) {
        this.onVRAMNormal.splice(index, 1);
      }
    };
  }

  /**
   * Get estimated time until VRAM is available
   */
  getEstimatedWaitTime(): number {
    // Based on average task duration
    const activeTaskCount = this.activeTasks.size;
    if (activeTaskCount === 0) return 0;

    // Estimate ~45 seconds per active task
    return activeTaskCount * VRAM_ESTIMATED_TASK_DURATION_MS;
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
  async calculateOptimalGPULayers(modelSizeMB = VRAM_DEFAULT_MODEL_SIZE_MB): Promise<number> {
    // Refresh VRAM status
    await this.updateVRAMStatus();

    if (!this.lastVRAMStatus) {
      log.warn("No VRAM status available, defaulting to full GPU loading");
      return -1; // All layers on GPU
    }

    const availableVRAM = this.lastVRAMStatus.freeMB - VRAM_CONFIG.minFreeBuffer;
    const totalLayers = VRAM_TRANSFORMER_LAYERS;

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
  async getOptimalLoadOptions(): Promise<OptimalLoadOptions> {
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
  async waitForVRAM(
    requiredMB: number,
    timeoutMs = VRAM_WAIT_DEFAULT_TIMEOUT_MS
  ): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = VRAM_WAIT_CHECK_INTERVAL_MS;

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

      await delay(checkInterval);
    }

    log.warn(`Timeout waiting for ${requiredMB}MB VRAM after ${timeoutMs}ms`);
    return false;
  }

  /**
   * Get current migration status for debugging/monitoring
   */
  getMigrationStatus(): MigrationStatus {
    return this.migration.getStatus();
  }
}

// Export singleton getter
export function getVRAMManager(): VRAMManager {
  return VRAMManager.getInstance();
}

// Export the class for testing
export { VRAMManager };
