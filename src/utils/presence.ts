/**
 * Bot Presence Manager
 * Updates Discord rich presence with queue and AI status
 * Now with event-driven updates for faster response
 * Supports model sleep state indication and VRAM/RAM status
 */

import { ActivityType, type PresenceStatusData } from "discord.js";
import type { Client } from "discordx";
import { getConversationService } from "../ai/conversation.js";
import { getImageServiceIfLoaded, onImageSleepStateChange } from "../ai/image-service.js";
import { onSleepStateChange } from "../ai/service.js";
import { MAX_ACTIVITY_NAME_LENGTH } from "../constants.js";
import { createLogger } from "./logger.js";
import { getChannelQueue } from "./rate-limiter.js";
import { getVRAMManager } from "./vram/index.js";

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
const DEBOUNCE_MS = 100; // 100ms for sleep/wake events (was 500ms, but we need faster updates)
const DEBOUNCE_QUEUE_MS = 500; // 500ms for queue-related updates

// Store interval ID for cleanup
let presenceUpdateInterval: NodeJS.Timeout | null = null;

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

  // Register for LLM sleep state change notifications
  onSleepStateChange((_isAsleep) => {
    // Trigger immediate presence update when LLM sleep state changes
    triggerPresenceUpdate(true); // true = use short debounce for sleep events
  });

  // Register for image model sleep state change notifications
  onImageSleepStateChange((_isAsleep) => {
    // Trigger immediate presence update when image model sleep state changes
    triggerPresenceUpdate(true); // true = use short debounce for sleep events
  });

  // Update presence every 15 seconds as a backup
  const UPDATE_INTERVAL = 15_000;

  // Initial update
  setTimeout(() => updatePresence(), 5000);

  // Regular updates (fallback in case event-driven updates miss something)
  presenceUpdateInterval = setInterval(() => updatePresence(), UPDATE_INTERVAL);
}

/**
 * Stop the presence updater and clean up intervals
 */
export function stopPresenceUpdater(): void {
  if (presenceUpdateInterval) {
    clearInterval(presenceUpdateInterval);
    presenceUpdateInterval = null;
  }
  if (pendingUpdate) {
    clearTimeout(pendingUpdate);
    pendingUpdate = null;
  }
  clientInstance = null;
}

interface PresenceState {
  status: PresenceStatusData;
  activityName: string;
}

/**
 * Model load location type
 */
type ModelLocation = "vram" | "ram" | "partial" | "unloaded";

/**
 * Get emoji for model location
 */
function getLocationEmoji(location: ModelLocation): string {
  switch (location) {
    case "vram":
      return "🚀"; // Fast - in GPU
    case "ram":
      return "🐢"; // Slow - in RAM
    case "partial":
      return "⚡"; // Mixed
    case "unloaded":
      return "💤"; // Not loaded
  }
}

/**
 * Get short label for model location
 */
function getLocationLabel(location: ModelLocation): string {
  switch (location) {
    case "vram":
      return "GPU";
    case "ram":
      return "RAM";
    case "partial":
      return "GPU+RAM";
    case "unloaded":
      return "Unloaded";
  }
}

/**
 * Truncate activity name to respect Discord's 128 character limit
 */
function truncateActivityName(name: string): string {
  if (name.length <= MAX_ACTIVITY_NAME_LENGTH) {
    return name;
  }
  // Truncate and add ellipsis
  return `${name.slice(0, MAX_ACTIVITY_NAME_LENGTH - 1)}…`;
}

/**
 * Helper: Determine presence state based on current conditions
 * All activity names are optimized for Discord's 128 char limit
 */
function determinePresenceState(
  isOnline: boolean,
  isSleeping: boolean,
  active: number,
  queued: number,
  modelLocation: ModelLocation
): PresenceState {
  if (!isOnline) {
    return { status: "idle", activityName: "🔧 AI Offline | /help" };
  }

  if (isSleeping && active === 0 && queued === 0) {
    return { status: "idle", activityName: "😴 Sleeping | @mention to wake" };
  }

  const locationEmoji = getLocationEmoji(modelLocation);
  const locationLabel = getLocationLabel(modelLocation);

  if (active > 0 || queued > 0) {
    let activityName = `💭 ${active} active`;
    if (queued > 0) {
      activityName += ` • ${queued} queued`;
    }
    activityName += ` • ${locationEmoji} ${locationLabel}`;
    return { status: "dnd", activityName: truncateActivityName(activityName) };
  }

  // Idle, ready for requests - show model location with compact format
  let activityName: string;
  if (stats.totalRequests > 0) {
    activityName = `✨ Ready • ${locationEmoji} ${locationLabel} • ~${formatResponseTime(stats.averageResponseTime)}`;
  } else {
    activityName = `✨ Ready • ${locationEmoji} ${locationLabel} | @mention me!`;
  }
  return { status: "online", activityName: truncateActivityName(activityName) };
}

/**
 * Core presence update logic - extracted for reuse
 */
async function updatePresence(): Promise<void> {
  if (!clientInstance?.user) return;

  try {
    // Use lazy loading - only get image service if already initialized
    // This prevents forcing image service initialization just for presence updates
    const imageService = getImageServiceIfLoaded();
    const vramManager = getVRAMManager();
    // If image service not initialized, treat as sleeping (not loaded)
    const imageSleeping = imageService?.isSleeping() ?? true;

    const isOnline = await checkCachedAvailability();
    const { active, queued } = getQueueStats();

    // Get model load location (VRAM/RAM/partial/unloaded) from actual VRAM status
    // This is the source of truth - don't rely on aiService.isSleeping() which can be stale
    const modelStatus = await vramManager.getModelLoadStatus();
    const modelLocation: ModelLocation = modelStatus.location;

    // Determine if sleeping based on actual model location, not AI service state
    // This prevents race condition where AI service marks sleeping before VRAM is actually freed
    const isSleeping = modelLocation === "unloaded" && imageSleeping;

    const { status, activityName } = determinePresenceState(
      isOnline,
      isSleeping,
      active,
      queued,
      modelLocation
    );

    // Only update presence if something actually changed
    if (status === lastStatus && activityName === lastActivityName) {
      return; // No change, skip the API call
    }

    // Update tracking
    lastStatus = status;
    lastActivityName = activityName;

    log.info(
      `Presence updated: ${activityName} (LLM: ${modelStatus.location}, Image: ${imageSleeping ? "sleeping" : "awake"}, ${modelStatus.vramUsedMB}MB VRAM)`
    );

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
 * Trigger a presence update with debouncing
 * @param immediate - If true, uses shorter debounce for sleep/wake events (100ms)
 *                    If false, uses longer debounce for queue updates (500ms)
 */
export function triggerPresenceUpdate(immediate = false): void {
  // Skip if client not ready yet
  if (!clientInstance) return;

  // Debounce rapid updates
  if (pendingUpdate) {
    clearTimeout(pendingUpdate);
  }

  const debounceMs = immediate ? DEBOUNCE_MS : DEBOUNCE_QUEUE_MS;
  pendingUpdate = setTimeout(() => {
    pendingUpdate = null;
    updatePresence();
  }, debounceMs);
}
