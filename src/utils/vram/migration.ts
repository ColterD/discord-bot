/**
 * Autonomous Migration System
 *
 * Handles automatic VRAM/RAM migration based on system pressure:
 * - Monitors for external VRAM consumers (games, other apps)
 * - Automatically migrates models to RAM when VRAM is needed
 * - Migrates back to VRAM when space becomes available
 * - Intelligent throttling to prevent thrashing
 *
 * @module utils/vram/migration
 */

import {
  VRAM_AVAILABLE_CHECKS_THRESHOLD,
  VRAM_EXTERNAL_CONSUMER_THRESHOLD_MB,
  VRAM_MIGRATION_COOLDOWN_MS,
  VRAM_PRESSURE_CHECKS_THRESHOLD,
  VRAM_RECLAIM_THRESHOLD,
  VRAM_UNLOAD_SETTLE_MS,
} from "../../constants.js";
import { delay } from "../async.js";
import { createLogger } from "../logger.js";
import { VRAM_CONFIG } from "./config.js";
import { reloadModel, unloadModel } from "./ollama-client.js";
import type {
  GPUMemoryStatus,
  MigrationStatus,
  ModelLoadStatus,
  ModelLocation,
  OllamaModel,
} from "./types.js";

const log = createLogger("VRAMMigration");

/**
 * Migration state tracker
 */
export class MigrationManager {
  private migrationInProgress = false;
  private lastMigrationTime = 0;
  private vramBaseline: number | null = null;
  private consecutivePressureChecks = 0;
  private consecutiveAvailableChecks = 0;
  private currentModelLocation: ModelLocation = "unloaded";

  /**
   * Check for autonomous migration opportunities
   * Called during each VRAM status update to detect:
   * 1. External apps consuming VRAM - trigger migration to RAM
   * 2. VRAM becoming available - trigger migration back to GPU
   */
  async checkAutonomousMigration(
    ollamaModels: OllamaModel[] | null,
    vramStatus: GPUMemoryStatus | null,
    getModelStatus: () => Promise<ModelLoadStatus>,
    updateVRAMStatus: () => Promise<void>
  ): Promise<void> {
    if (this.migrationInProgress) return;

    // Check cooldown
    const now = Date.now();
    if (now - this.lastMigrationTime < VRAM_MIGRATION_COOLDOWN_MS) {
      return;
    }

    if (!vramStatus || !ollamaModels) return;

    // Update current model location
    const modelStatus = await getModelStatus();
    this.currentModelLocation = modelStatus.location;

    // Case 1: Model is in VRAM but external pressure detected
    if (modelStatus.location === "vram" && this.detectExternalPressure(vramStatus)) {
      this.consecutivePressureChecks++;
      this.consecutiveAvailableChecks = 0;

      if (this.consecutivePressureChecks >= VRAM_PRESSURE_CHECKS_THRESHOLD) {
        log.info("Detected sustained external VRAM pressure, migrating model to RAM...");
        await this.migrateToRAM(ollamaModels, updateVRAMStatus);
        this.consecutivePressureChecks = 0;
      }
      return;
    }

    // Case 2: Model is in RAM but VRAM is now available
    if (
      (modelStatus.location === "ram" || modelStatus.location === "partial") &&
      this.detectVRAMAvailable(vramStatus, modelStatus.modelSizeMB)
    ) {
      this.consecutiveAvailableChecks++;
      this.consecutivePressureChecks = 0;

      if (this.consecutiveAvailableChecks >= VRAM_AVAILABLE_CHECKS_THRESHOLD) {
        log.info("Detected available VRAM, migrating model back to GPU...");
        await this.migrateToVRAM(ollamaModels, updateVRAMStatus);
        this.consecutiveAvailableChecks = 0;
      }
      return;
    }

    // Reset counters if conditions not met
    this.consecutivePressureChecks = 0;
    this.consecutiveAvailableChecks = 0;
  }

  /**
   * Detect if external applications are consuming VRAM
   * Uses baseline comparison to detect sudden VRAM usage spikes
   */
  private detectExternalPressure(vramStatus: GPUMemoryStatus): boolean {
    // If no baseline set, establish it now
    if (this.vramBaseline === null) {
      this.vramBaseline = vramStatus.usedMB;
      return false;
    }

    // Check if current usage is significantly higher than baseline
    const usageIncrease = vramStatus.usedMB - this.vramBaseline;

    // Also check absolute thresholds
    const isNearCritical = vramStatus.usagePercent >= VRAM_CONFIG.criticalThreshold;
    const hasSignificantIncrease = usageIncrease > VRAM_EXTERNAL_CONSUMER_THRESHOLD_MB;

    if (isNearCritical && hasSignificantIncrease) {
      log.debug(
        `External pressure detected: ${usageIncrease}MB increase from baseline, ${Math.round(vramStatus.usagePercent * 100)}% used`
      );
      return true;
    }

    return false;
  }

  /**
   * Detect if there's enough VRAM to migrate model back to GPU
   */
  private detectVRAMAvailable(vramStatus: GPUMemoryStatus, modelSizeMB: number): boolean {
    const available = vramStatus.freeMB - VRAM_CONFIG.minFreeBuffer;
    const lowUsage = vramStatus.usagePercent < VRAM_RECLAIM_THRESHOLD;

    // Need enough space for the model AND usage should be below threshold
    const hasSpace = available >= modelSizeMB;

    if (hasSpace && lowUsage) {
      log.debug(
        `VRAM available for migration: ${available}MB free (need ${modelSizeMB}MB), ${Math.round(vramStatus.usagePercent * 100)}% used`
      );
      return true;
    }

    return false;
  }

  /**
   * Migrate model to RAM by reloading with num_gpu: 0
   */
  private async migrateToRAM(
    models: OllamaModel[],
    updateVRAMStatus: () => Promise<void>
  ): Promise<void> {
    if (this.migrationInProgress || models.length === 0) return;

    const model = models[0];
    if (!model) return;

    this.migrationInProgress = true;
    this.lastMigrationTime = Date.now();

    try {
      log.info(`Migrating ${model.name} to RAM to free VRAM...`);

      // First unload the model
      await unloadModel(model.name);

      // Wait for unload to settle
      await delay(VRAM_UNLOAD_SETTLE_MS);

      // Reload with minimal GPU layers (num_gpu: 0 = all in RAM)
      await reloadModel(model.name, 0);

      log.info(`Successfully migrated ${model.name} to RAM`);

      // Update baseline to current VRAM usage (without our model)
      await updateVRAMStatus();
    } catch (error) {
      log.error(
        `Failed to migrate model to RAM: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.migrationInProgress = false;
    }
  }

  /**
   * Migrate model back to VRAM by reloading with full GPU layers
   */
  private async migrateToVRAM(
    models: OllamaModel[],
    updateVRAMStatus: () => Promise<void>
  ): Promise<void> {
    if (this.migrationInProgress || models.length === 0) return;

    const model = models[0];
    if (!model) return;

    this.migrationInProgress = true;
    this.lastMigrationTime = Date.now();

    try {
      log.info(`Migrating ${model.name} back to VRAM for faster inference...`);

      // First unload the model
      await unloadModel(model.name);

      // Wait for unload to settle
      await delay(VRAM_UNLOAD_SETTLE_MS);

      // Reload with full GPU layers
      await reloadModel(model.name, -1);

      log.info(`Successfully migrated ${model.name} to VRAM`);

      // Update baseline to current VRAM usage (with our model)
      await updateVRAMStatus();
    } catch (error) {
      log.error(
        `Failed to migrate model to VRAM: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.migrationInProgress = false;
    }
  }

  /**
   * Update the VRAM baseline
   */
  updateBaseline(usedMB: number): void {
    this.vramBaseline = usedMB;
  }

  /**
   * Update current model location
   */
  setModelLocation(location: ModelLocation): void {
    this.currentModelLocation = location;
  }

  /**
   * Get current migration status for debugging/monitoring
   */
  getStatus(): MigrationStatus {
    return {
      inProgress: this.migrationInProgress,
      location: this.currentModelLocation,
      lastMigration: this.lastMigrationTime,
      pressureCount: this.consecutivePressureChecks,
      availableCount: this.consecutiveAvailableChecks,
    };
  }
}
