/**
 * Maintenance Service
 * Handles periodic housekeeping tasks for the Discord bot
 *
 * Runs every 12 hours to clean up stale data and maintain system health
 */

import { getConversationService } from "../ai/conversation.js";
import { cleanupMessageDeduplication } from "../events/message.js";
import { cacheManager } from "../utils/cache.js";
import { createLogger } from "../utils/logger.js";
import { getRateLimiter } from "../utils/rate-limiter.js";

const log = createLogger("Maintenance");

// 12 hours in milliseconds
const MAINTENANCE_INTERVAL = 12 * 60 * 60 * 1000;

// Track the interval for cleanup
let maintenanceIntervalId: NodeJS.Timeout | null = null;

// Track when the last maintenance ran
let lastMaintenanceRun: Date | null = null;

interface MaintenanceResult {
  conversationsCleared: number;
  rateLimiterCleared: boolean;
  deduplicationCleared: boolean;
  cacheCleared: boolean;
  duration: number;
}

/**
 * Run all maintenance tasks
 * This is the core function that performs cleanup operations
 */
async function runMaintenance(): Promise<MaintenanceResult> {
  const startTime = Date.now();
  log.info("🧹 Starting scheduled maintenance...");

  const result: MaintenanceResult = {
    conversationsCleared: 0,
    rateLimiterCleared: false,
    deduplicationCleared: false,
    cacheCleared: false,
    duration: 0,
  };

  try {
    // 1. Clean up expired conversations
    const conversationService = getConversationService();
    result.conversationsCleared = conversationService.cleanupExpiredConversations();
    log.debug(`Cleared ${result.conversationsCleared} expired conversations`);

    // 2. Clean up rate limiter entries
    const rateLimiter = getRateLimiter();
    rateLimiter.cleanup();
    result.rateLimiterCleared = true;
    log.debug("Rate limiter cleaned up");

    // 3. Clean up message deduplication cache
    cleanupMessageDeduplication();
    result.deduplicationCleared = true;
    log.debug("Message deduplication cache cleaned up");

    // 4. Trigger cache manager cleanup (if using in-memory fallback)
    try {
      if (cacheManager.isUsingFallback()) {
        // The in-memory cache has its own cleanup interval, but we can
        // force a check by accessing the client
        cacheManager.getClient();
        result.cacheCleared = true;
        log.debug("In-memory cache maintenance acknowledged");
      } else {
        // Valkey handles its own expiration
        result.cacheCleared = true;
        log.debug("Valkey cache (self-managing)");
      }
    } catch {
      // Cache manager might not be initialized, that's fine
      log.debug("Cache manager cleanup skipped (not initialized)");
    }

    // 5. Run garbage collection hint (Node.js will decide if needed)
    if (globalThis.gc) {
      globalThis.gc();
      log.debug("Garbage collection hint sent");
    }

    result.duration = Date.now() - startTime;
    lastMaintenanceRun = new Date();

    log.info(
      `✅ Maintenance complete in ${result.duration}ms - ` +
        `Conversations: ${result.conversationsCleared}, ` +
        `RateLimiter: ${result.rateLimiterCleared}, ` +
        `Dedup: ${result.deduplicationCleared}`
    );
  } catch (error) {
    result.duration = Date.now() - startTime;
    log.error("Maintenance failed", error instanceof Error ? error : undefined);
  }

  return result;
}

/**
 * Start the maintenance scheduler
 * Runs maintenance every 12 hours
 */
export function startMaintenanceScheduler(): void {
  if (maintenanceIntervalId) {
    log.warn("Maintenance scheduler already running");
    return;
  }

  log.info(
    `🔧 Starting maintenance scheduler (interval: ${MAINTENANCE_INTERVAL / 1000 / 60 / 60}h)`
  );

  // Run initial maintenance after a short delay (let bot fully initialize)
  setTimeout(() => {
    runMaintenance().catch((error) => {
      log.error("Initial maintenance failed", error instanceof Error ? error : undefined);
    });
  }, 30000); // 30 seconds after startup

  // Schedule periodic maintenance
  maintenanceIntervalId = setInterval(() => {
    runMaintenance().catch((error) => {
      log.error("Scheduled maintenance failed", error instanceof Error ? error : undefined);
    });
  }, MAINTENANCE_INTERVAL);

  log.info("Maintenance scheduler started");
}

/**
 * Stop the maintenance scheduler
 */
export function stopMaintenanceScheduler(): void {
  if (maintenanceIntervalId) {
    clearInterval(maintenanceIntervalId);
    maintenanceIntervalId = null;
    log.info("Maintenance scheduler stopped");
  }
}

/**
 * Get the last maintenance run time
 */
export function getLastMaintenanceRun(): Date | null {
  return lastMaintenanceRun;
}

/**
 * Manually trigger maintenance (useful for admin commands)
 */
export async function triggerMaintenance(): Promise<MaintenanceResult> {
  log.info("Manual maintenance triggered");
  return runMaintenance();
}
