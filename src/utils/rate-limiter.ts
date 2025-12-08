/**
 * Rate Limiter and Channel Queue Management
 * Handles concurrent requests and prevents spam
 * Features:
 * - Soft limit warnings before hard blocks
 * - Visual feedback (remaining requests)
 * - Exponential backoff for repeat violations
 */

import config from "../config.js";
import { triggerPresenceUpdate } from "./presence.js";

interface CooldownEntry {
  lastRequest: number;
  cooldownMs: number;
  requestCount: number;
  windowStart: number;
  violations: number;
  lastViolation: number;
  lastAccess: number; // For LRU tracking
}

interface QueuedRequest {
  userId: string;
  messageId: string;
  timestamp: number;
  resolve: () => void;
}

interface ChannelState {
  activeRequests: number;
  queue: QueuedRequest[];
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
  isWarning: boolean;
  message: string | null;
  backoffMs: number;
}

// Configuration
const CONFIG = {
  // Cooldown settings
  channelCooldownMs: 5000, // 5 seconds between requests per user in channels (3 per 15s)
  dmCooldownMs: 2000, // 2 seconds in DMs (more lenient)

  // Concurrency settings
  maxConcurrentPerChannel: 2, // Max simultaneous AI requests per channel
  maxQueueSize: 5, // Max queued requests per channel
  queueTimeout: 180000, // Queue timeout (3 minutes)

  // Rate window settings
  windowMs: config.rateLimit.windowMs,
  maxRequests: config.rateLimit.requests,
  softLimitThreshold: config.rateLimit.softLimitThreshold,

  // Backoff settings
  backoffEnabled: config.rateLimit.backoff.enabled,
  backoffBaseMs: config.rateLimit.backoff.baseMs,
  backoffMaxMs: config.rateLimit.backoff.maxMs,
  backoffMultiplier: config.rateLimit.backoff.multiplier,

  // Violation decay (ms before violations are forgotten)
  violationDecayMs: 600000, // 10 minutes

  // LRU cache settings
  maxEntries: 10000, // Max number of tracked users
};

/**
 * Calculate backoff time based on violations
 */
function calculateBackoff(violations: number): number {
  if (!CONFIG.backoffEnabled || violations <= 0) return 0;
  return Math.min(
    CONFIG.backoffBaseMs * CONFIG.backoffMultiplier ** (violations - 1),
    CONFIG.backoffMaxMs
  );
}

/**
 * Create a new cooldown entry
 */
function createCooldownEntry(isDM: boolean, now: number): CooldownEntry {
  return {
    lastRequest: 0,
    cooldownMs: isDM ? CONFIG.dmCooldownMs : CONFIG.channelCooldownMs,
    requestCount: 0,
    windowStart: now,
    violations: 0,
    lastViolation: 0,
    lastAccess: now,
  };
}

/**
 * Rate Limiter - tracks per-user cooldowns with soft warnings and backoff
 * Uses LRU eviction to bound memory usage
 */
export class RateLimiter {
  private readonly cooldowns = new Map<string, CooldownEntry>();

  /**
   * Get the current number of tracked entries
   */
  get size(): number {
    return this.cooldowns.size;
  }

  /**
   * Evict least recently used entries when over limit
   */
  private evictLRU(): void {
    if (this.cooldowns.size <= CONFIG.maxEntries) return;

    // Sort by lastAccess and remove oldest entries
    const entries = [...this.cooldowns.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    const toRemove = entries.slice(0, this.cooldowns.size - CONFIG.maxEntries);
    for (const [key] of toRemove) {
      this.cooldowns.delete(key);
    }
  }

  /**
   * Check if a user is on cooldown
   * Returns remaining cooldown in ms, or 0 if not on cooldown
   */
  checkCooldown(userId: string, channelId: string, isDM: boolean): number {
    const key = isDM ? `dm-${userId}` : `channel-${channelId}-${userId}`;
    const entry = this.cooldowns.get(key);

    if (!entry) return 0;

    // Update LRU access time
    entry.lastAccess = Date.now();

    const elapsed = Date.now() - entry.lastRequest;
    const remaining = entry.cooldownMs - elapsed;

    return Math.max(remaining, 0);
  }

  /**
   * Get or create an entry for the given key
   */
  private getOrCreateEntry(key: string, isDM: boolean, now: number): CooldownEntry {
    const existing = this.cooldowns.get(key);
    if (existing) {
      existing.lastAccess = now;
      return existing;
    }

    const entry = createCooldownEntry(isDM, now);
    this.cooldowns.set(key, entry);
    this.evictLRU();
    return entry;
  }

  /**
   * Check if in backoff period and return result if so
   */
  private checkBackoffPeriod(entry: CooldownEntry, now: number): RateLimitResult | null {
    const backoffMs = calculateBackoff(entry.violations);
    if (backoffMs <= 0) return null;

    const timeSinceViolation = now - entry.lastViolation;
    if (timeSinceViolation >= backoffMs) return null;

    const remaining = backoffMs - timeSinceViolation;
    return {
      allowed: false,
      remaining: 0,
      resetIn: remaining,
      isWarning: false,
      message: `⏳ You're going too fast! Please wait ${formatCooldown(remaining)} before trying again.`,
      backoffMs,
    };
  }

  /**
   * Advanced rate limit check with soft warnings and backoff
   * Returns detailed result including warnings and feedback
   */
  checkRateLimit(userId: string, channelId: string, isDM: boolean): RateLimitResult {
    const key = isDM ? `dm-${userId}` : `channel-${channelId}-${userId}`;
    const now = Date.now();

    // Get or create entry
    const entry = this.getOrCreateEntry(key, isDM, now);

    // Reset window if expired
    if (now - entry.windowStart > CONFIG.windowMs) {
      entry.windowStart = now;
      entry.requestCount = 0;
    }

    // Decay violations over time
    if (now - entry.lastViolation > CONFIG.violationDecayMs) {
      entry.violations = Math.max(0, entry.violations - 1);
    }

    // Check if still in backoff period
    const backoffResult = this.checkBackoffPeriod(entry, now);
    if (backoffResult) return backoffResult;

    // Check request count against limits
    const requestsUsed = entry.requestCount;
    const remaining = CONFIG.maxRequests - requestsUsed;
    const softLimit = Math.floor(CONFIG.maxRequests * CONFIG.softLimitThreshold);
    const resetIn = CONFIG.windowMs - (now - entry.windowStart);

    // Hard limit reached
    if (requestsUsed >= CONFIG.maxRequests) {
      entry.violations++;
      entry.lastViolation = now;

      const violationText = entry.violations > 1 ? "s" : "";
      return {
        allowed: false,
        remaining: 0,
        resetIn,
        isWarning: false,
        message: `🛑 Rate limit reached! Please wait ${formatCooldown(resetIn)}. (${entry.violations} violation${violationText})`,
        backoffMs: calculateBackoff(entry.violations),
      };
    }

    // Soft warning threshold reached (not in DMs)
    if (requestsUsed >= softLimit && !isDM) {
      const requestText = remaining - 1 === 1 ? "" : "s";
      return {
        allowed: true,
        remaining: remaining - 1,
        resetIn,
        isWarning: true,
        message: `⚠️ You're going a bit fast... ${remaining - 1} request${requestText} remaining.`,
        backoffMs: 0,
      };
    }

    // All good
    return {
      allowed: true,
      remaining: remaining - 1,
      resetIn,
      isWarning: false,
      message: null,
      backoffMs: 0,
    };
  }

  /**
   * Record a request and start cooldown
   */
  recordRequest(userId: string, channelId: string, isDM: boolean): void {
    const key = isDM ? `dm-${userId}` : `channel-${channelId}-${userId}`;
    const cooldownMs = isDM ? CONFIG.dmCooldownMs : CONFIG.channelCooldownMs;
    const now = Date.now();

    let entry = this.cooldowns.get(key);
    if (entry) {
      // Reset window if expired
      if (now - entry.windowStart > CONFIG.windowMs) {
        entry.windowStart = now;
        entry.requestCount = 0;
      }

      entry.lastRequest = now;
      entry.cooldownMs = cooldownMs;
      entry.requestCount++;
      entry.lastAccess = now;
    } else {
      entry = {
        lastRequest: now,
        cooldownMs,
        requestCount: 1,
        windowStart: now,
        violations: 0,
        lastViolation: 0,
        lastAccess: now,
      };
      this.cooldowns.set(key, entry);
      this.evictLRU(); // Check if eviction needed
    }
  }

  /**
   * Get rate limit stats for display
   */
  getStats(
    userId: string,
    channelId: string,
    isDM: boolean
  ): {
    remaining: number;
    total: number;
    resetIn: number;
    violations: number;
  } {
    const key = isDM ? `dm-${userId}` : `channel-${channelId}-${userId}`;
    const entry = this.cooldowns.get(key);
    const now = Date.now();

    if (!entry) {
      return {
        remaining: CONFIG.maxRequests,
        total: CONFIG.maxRequests,
        resetIn: CONFIG.windowMs,
        violations: 0,
      };
    }

    // Check if window expired
    if (now - entry.windowStart > CONFIG.windowMs) {
      return {
        remaining: CONFIG.maxRequests,
        total: CONFIG.maxRequests,
        resetIn: CONFIG.windowMs,
        violations: entry.violations,
      };
    }

    return {
      remaining: Math.max(0, CONFIG.maxRequests - entry.requestCount),
      total: CONFIG.maxRequests,
      resetIn: CONFIG.windowMs - (now - entry.windowStart),
      violations: entry.violations,
    };
  }

  /**
   * Clean up old cooldown entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cooldowns) {
      // Clean up entries that are both past cooldown and window
      if (
        now - entry.lastRequest > entry.cooldownMs * 2 &&
        now - entry.windowStart > CONFIG.windowMs * 2
      ) {
        this.cooldowns.delete(key);
      }
    }
  }
}

/**
 * Channel Queue - manages concurrent requests per channel
 */
export class ChannelQueue {
  private readonly channels = new Map<string, ChannelState>();

  /**
   * Get or create channel state
   */
  private getChannelState(channelId: string): ChannelState {
    let state = this.channels.get(channelId);
    if (!state) {
      state = { activeRequests: 0, queue: [] };
      this.channels.set(channelId, state);
    }
    return state;
  }

  /**
   * Check if we can process a request immediately
   */
  canProcessImmediately(channelId: string): boolean {
    const state = this.getChannelState(channelId);
    return state.activeRequests < CONFIG.maxConcurrentPerChannel;
  }

  /**
   * Get queue position (0 = can process now, >0 = position in queue)
   */
  getQueuePosition(channelId: string): number {
    const state = this.getChannelState(channelId);
    if (state.activeRequests < CONFIG.maxConcurrentPerChannel) {
      return 0;
    }
    return state.queue.length + 1;
  }

  /**
   * Check if queue is full
   */
  isQueueFull(channelId: string): boolean {
    const state = this.getChannelState(channelId);
    return state.queue.length >= CONFIG.maxQueueSize;
  }

  /**
   * Acquire a slot to process a request
   * Returns immediately if slot available, or waits in queue
   */
  async acquireSlot(channelId: string, userId: string, messageId: string): Promise<boolean> {
    const state = this.getChannelState(channelId);

    // Can process immediately
    if (state.activeRequests < CONFIG.maxConcurrentPerChannel) {
      state.activeRequests++;
      triggerPresenceUpdate(); // Update presence when activity changes
      return true;
    }

    // Queue is full
    if (state.queue.length >= CONFIG.maxQueueSize) {
      return false;
    }

    // Add to queue and wait
    triggerPresenceUpdate(); // Update presence when queue changes
    return new Promise<boolean>((resolve) => {
      const request: QueuedRequest = {
        userId,
        messageId,
        timestamp: Date.now(),
        resolve: () => {
          state.activeRequests++;
          triggerPresenceUpdate(); // Update when moving from queue to active
          resolve(true);
        },
      };

      state.queue.push(request);

      // Timeout handler
      setTimeout(() => {
        const index = state.queue.indexOf(request);
        if (index !== -1) {
          state.queue.splice(index, 1);
          triggerPresenceUpdate(); // Update when request times out
          resolve(false);
        }
      }, CONFIG.queueTimeout);
    });
  }

  /**
   * Release a slot after processing
   */
  releaseSlot(channelId: string): void {
    const state = this.getChannelState(channelId);
    state.activeRequests = Math.max(0, state.activeRequests - 1);

    // Process next in queue
    if (state.queue.length > 0 && state.activeRequests < CONFIG.maxConcurrentPerChannel) {
      const next = state.queue.shift();
      if (next) {
        next.resolve();
        return; // resolve() will trigger presence update
      }
    }

    // Trigger presence update when slot is released and no queue processing
    triggerPresenceUpdate();
  }

  /**
   * Get current stats for a channel
   */
  getStats(channelId: string): { active: number; queued: number } {
    const state = this.getChannelState(channelId);
    return {
      active: state.activeRequests,
      queued: state.queue.length,
    };
  }

  /**
   * Get total stats across all channels
   */
  getTotalStats(): { active: number; queued: number } {
    let active = 0;
    let queued = 0;
    for (const state of this.channels.values()) {
      active += state.activeRequests;
      queued += state.queue.length;
    }
    return { active, queued };
  }
}

// Singleton instances
let rateLimiter: RateLimiter | null = null;
let channelQueue: ChannelQueue | null = null;

export function getRateLimiter(): RateLimiter {
  rateLimiter ??= new RateLimiter();
  return rateLimiter;
}

export function getChannelQueue(): ChannelQueue {
  channelQueue ??= new ChannelQueue();
  return channelQueue;
}

/**
 * Format cooldown time for display
 */
export function formatCooldown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/**
 * Build rate limit footer text for embeds
 */
export function buildRateLimitFooter(userId: string, channelId: string, isDM: boolean): string {
  const limiter = getRateLimiter();
  const stats = limiter.getStats(userId, channelId, isDM);
  return `📊 ${stats.remaining}/${stats.total} requests remaining`;
}

export { CONFIG as RATE_LIMIT_CONFIG };
export type { RateLimitResult };
