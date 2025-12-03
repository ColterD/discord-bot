/**
 * Bot Presence Manager
 * Updates Discord rich presence with queue and AI status
 * Now with event-driven updates for faster response
 * Supports model sleep state indication
 */

import { ActivityType, type PresenceStatusData } from "discord.js";
import type { Client } from "discordx";
import { getChannelQueue } from "./rate-limiter.js";
import { getConversationService } from "../ai/conversation.js";
import { getAIService, onSleepStateChange } from "../ai/service.js";
import { createLogger } from "./logger.js";

const log = createLogger("Presence");

interface PresenceStats {
  totalRequests: number;
  averageResponseTime: number;
  lastResponseTime: number;
}

// Track response stats
const stats: PresenceStats = {
  totalRequests: 0,
  averageResponseTime: 0,
  lastResponseTime: 0,
};

// Cache AI availability to prevent flip-flopping
let cachedAvailability: boolean | null = null;
let lastAvailabilityCheck = 0;
const AVAILABILITY_CACHE_MS = 60_000; // Cache for 60 seconds (longer to prevent flip-flopping)
let checkInProgress = false;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3; // Only go offline after 3 consecutive failures

// Track last presence state to prevent unnecessary updates
let lastStatus: PresenceStatusData | null = null;
let lastActivityName: string | null = null;

// Store client reference for event-driven updates
let clientInstance: Client | null = null;

// Debounce event-driven updates to prevent spam
let pendingUpdate: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500; // Wait 500ms before updating to batch rapid changes

/**
 * Record a response time for stats
 */
export function recordResponseTime(ms: number): void {
  stats.lastResponseTime = ms;
  stats.totalRequests++;

  // Rolling average
  if (stats.totalRequests === 1) {
    stats.averageResponseTime = ms;
  } else {
    stats.averageResponseTime = stats.averageResponseTime * 0.9 + ms * 0.1; // Exponential moving average
  }
}

/**
 * Get current stats
 */
export function getStats(): PresenceStats {
  return { ...stats };
}

/**
 * Format response time for display
 */
function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Get queue stats
 */
function getQueueStats(): { active: number; queued: number } {
  const queue = getChannelQueue();
  return queue.getTotalStats();
}

/**
 * Check AI availability with caching to prevent flip-flopping
 * Uses consecutive failure counting to prevent brief hiccups from changing status
 */
async function checkCachedAvailability(): Promise<boolean> {
  const now = Date.now();

  // Return cached value if still valid and not expired
  if (cachedAvailability !== null && now - lastAvailabilityCheck < AVAILABILITY_CACHE_MS) {
    return cachedAvailability;
  }

  // Prevent concurrent checks
  if (checkInProgress) {
    return cachedAvailability ?? false;
  }

  checkInProgress = true;
  try {
    const conversationService = getConversationService();
    const isAvailable = await conversationService.checkAvailability();

    if (isAvailable) {
      // Reset failure counter on success
      consecutiveFailures = 0;
      cachedAvailability = true;
    } else {
      // Increment failure counter
      consecutiveFailures++;

      // Only mark as offline after multiple consecutive failures
      // or if we don't have a cached value yet
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || cachedAvailability === null) {
        cachedAvailability = false;
      }
      // If we were previously online, stay online until enough failures
    }

    lastAvailabilityCheck = now;
    return cachedAvailability;
  } catch {
    // On error, count as failure
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      cachedAvailability = false;
    }
    return cachedAvailability ?? false;
  } finally {
    checkInProgress = false;
  }
}

/**
 * Start the presence update loop
 */
export function startPresenceUpdater(client: Client): void {
  // Store client reference for event-driven updates
  clientInstance = client;

  // Register for sleep state change notifications
  onSleepStateChange((_isAsleep) => {
    // Trigger immediate presence update when sleep state changes
    triggerPresenceUpdate();
  });

  // Update presence every 15 seconds as a backup
  const UPDATE_INTERVAL = 15_000;

  // Initial update
  setTimeout(() => updatePresence(), 5000);

  // Regular updates (fallback in case event-driven updates miss something)
  setInterval(() => updatePresence(), UPDATE_INTERVAL);
}

interface PresenceState {
  status: PresenceStatusData;
  activityName: string;
}

/**
 * Helper: Determine presence state based on current conditions
 */
function determinePresenceState(
  isOnline: boolean,
  isSleeping: boolean,
  active: number,
  queued: number
): PresenceState {
  if (!isOnline) {
    return { status: "idle", activityName: "🔧 AI Offline | /help" };
  }

  if (isSleeping && active === 0 && queued === 0) {
    return { status: "idle", activityName: "😴 Sleeping | @mention to wake" };
  }

  if (active > 0 || queued > 0) {
    let activityName = `💭 ${active} active`;
    if (queued > 0) {
      activityName += ` • ${queued} queued`;
    }
    if (stats.lastResponseTime > 0) {
      activityName += ` • ~${formatResponseTime(stats.averageResponseTime)}`;
    }
    return { status: "dnd", activityName };
  }

  // Idle, ready for requests
  const activityName =
    stats.totalRequests > 0
      ? `✨ Ready • ${stats.totalRequests} chats • ~${formatResponseTime(stats.averageResponseTime)}`
      : "✨ Ready | @mention me!";
  return { status: "online", activityName };
}

/**
 * Core presence update logic - extracted for reuse
 */
async function updatePresence(): Promise<void> {
  if (!clientInstance?.user) return;

  try {
    const aiService = getAIService();
    const isSleeping = aiService.isSleeping();
    const isOnline = await checkCachedAvailability();
    const { active, queued } = getQueueStats();

    const { status, activityName } = determinePresenceState(isOnline, isSleeping, active, queued);

    // Only update presence if something actually changed
    if (status === lastStatus && activityName === lastActivityName) {
      return; // No change, skip the API call
    }

    // Update tracking
    lastStatus = status;
    lastActivityName = activityName;

    clientInstance.user.setPresence({
      status,
      activities: [
        {
          name: activityName,
          type: ActivityType.Custom,
        },
      ],
    });
  } catch (error) {
    log.error("Failed to update presence:", error);
  }
}

/**
 * Trigger an immediate presence update (debounced)
 * Call this when queue state changes for faster response
 */
export function triggerPresenceUpdate(): void {
  // Skip if client not ready yet
  if (!clientInstance) return;

  // Debounce rapid updates
  if (pendingUpdate) {
    clearTimeout(pendingUpdate);
  }

  pendingUpdate = setTimeout(() => {
    pendingUpdate = null;
    updatePresence();
  }, DEBOUNCE_MS);
}
