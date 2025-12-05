/**
 * Memory Monitoring Utility
 * Tracks heap usage and provides alerts for memory pressure
 * Per Node.js best practices for production monitoring
 */

import { createLogger } from "./logger.js";

const log = createLogger("Memory");

interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  heapUsagePercent: number;
  rssMB: number;
  externalMB: number;
}

interface MemoryThresholds {
  /** Warning threshold as percentage (0-100) */
  warningPercent: number;
  /** Critical threshold as percentage (0-100) */
  criticalPercent: number;
  /** Maximum heap size in MB before forced GC hint */
  maxHeapMB: number;
}

// Default thresholds
const DEFAULT_THRESHOLDS: MemoryThresholds = {
  warningPercent: 70,
  criticalPercent: 85,
  maxHeapMB: 768,
};

let thresholds = { ...DEFAULT_THRESHOLDS };
let monitorInterval: NodeJS.Timeout | null = null;
let lastWarningTime = 0;
const WARNING_COOLDOWN = 60000; // Don't spam warnings more than once per minute

/**
 * Get current memory statistics
 */
export function getMemoryStats(): MemoryStats {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const heapTotalMB = usage.heapTotal / 1024 / 1024;

  return {
    heapUsedMB: Math.round(heapUsedMB * 100) / 100,
    heapTotalMB: Math.round(heapTotalMB * 100) / 100,
    heapUsagePercent: Math.round((heapUsedMB / heapTotalMB) * 100),
    rssMB: Math.round((usage.rss / 1024 / 1024) * 100) / 100,
    externalMB: Math.round((usage.external / 1024 / 1024) * 100) / 100,
  };
}

/**
 * Format memory stats for logging
 */
export function formatMemoryStats(stats: MemoryStats): string {
  return `Heap: ${stats.heapUsedMB}MB / ${stats.heapTotalMB}MB (${stats.heapUsagePercent}%) | RSS: ${stats.rssMB}MB | External: ${stats.externalMB}MB`;
}

/**
 * Check memory health and log warnings if thresholds exceeded
 * Returns 'healthy' | 'warning' | 'critical'
 *
 * Note: We check against maxHeapMB (absolute limit) not heapUsagePercent
 * because Node.js dynamically grows the heap up to max-old-space-size.
 * heapTotal is the current allocated heap, not the maximum available.
 */
export function checkMemoryHealth(): "healthy" | "warning" | "critical" {
  const stats = getMemoryStats();
  const now = Date.now();

  // Calculate percentage against max heap, not current allocation
  const percentOfMax = (stats.heapUsedMB / thresholds.maxHeapMB) * 100;

  // Check against thresholds (using absolute heap size against max)
  if (percentOfMax >= thresholds.criticalPercent) {
    if (now - lastWarningTime > WARNING_COOLDOWN) {
      log.error(
        `CRITICAL memory pressure: ${formatMemoryStats(stats)} (${Math.round(percentOfMax)}% of ${thresholds.maxHeapMB}MB max)`
      );
      lastWarningTime = now;
    }
    return "critical";
  }

  if (percentOfMax >= thresholds.warningPercent) {
    if (now - lastWarningTime > WARNING_COOLDOWN) {
      log.warn(
        `High memory usage: ${formatMemoryStats(stats)} (${Math.round(percentOfMax)}% of ${thresholds.maxHeapMB}MB max)`
      );
      lastWarningTime = now;
    }
    return "warning";
  }

  return "healthy";
}

/**
 * Start periodic memory monitoring
 * @param intervalMs - Check interval in milliseconds (default: 60 seconds)
 */
export function startMemoryMonitor(intervalMs = 60000): void {
  if (monitorInterval) {
    log.debug("Memory monitor already running");
    return;
  }

  log.info(
    `Starting memory monitor (interval: ${intervalMs}ms, warning: ${thresholds.warningPercent}%, critical: ${thresholds.criticalPercent}%)`
  );

  // Initial check
  const initialStats = getMemoryStats();
  log.debug(`Initial memory: ${formatMemoryStats(initialStats)}`);

  monitorInterval = setInterval(() => {
    checkMemoryHealth();
  }, intervalMs);

  // Ensure cleanup on process exit
  monitorInterval.unref();
}

/**
 * Stop memory monitoring
 */
export function stopMemoryMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    log.debug("Memory monitor stopped");
  }
}

/**
 * Update memory thresholds
 */
export function setMemoryThresholds(newThresholds: Partial<MemoryThresholds>): void {
  thresholds = { ...thresholds, ...newThresholds };
  log.debug(
    `Memory thresholds updated: warning=${thresholds.warningPercent}%, critical=${thresholds.criticalPercent}%, maxHeap=${thresholds.maxHeapMB}MB`
  );
}

/**
 * Log current memory stats at debug level
 * Useful for periodic health logging
 */
export function logMemoryStats(): void {
  const stats = getMemoryStats();
  log.debug(formatMemoryStats(stats));
}
