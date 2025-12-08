/**
 * Distributed Lock Utility
 *
 * Provides SETNX-based distributed locking using Valkey.
 * Used for coordinating VRAM allocations across potentially multiple bot instances.
 *
 * Features:
 * - Automatic TTL expiration for stale locks
 * - Lock extension for long-running operations
 * - Graceful fallback to in-memory locking when Valkey unavailable
 * - Safe release with ownership verification
 *
 * @module utils/distributed-lock
 */

import { randomUUID } from "node:crypto";
import Valkey from "iovalkey";
import { config } from "../config.js";
import { ONE_SECOND_MS } from "../constants.js";
import { createLogger } from "./logger.js";

const log = createLogger("DistributedLock");

// =============================================================================
// Constants
// =============================================================================

/** Default lock TTL in milliseconds */
export const LOCK_DEFAULT_TTL_MS = 30 * ONE_SECOND_MS;

/** Default acquire timeout in milliseconds */
export const LOCK_DEFAULT_ACQUIRE_TIMEOUT_MS = 10 * ONE_SECOND_MS;

/** Default retry interval when waiting for lock */
export const LOCK_RETRY_INTERVAL_MS = 100;

/** Lock key prefix */
const LOCK_KEY_PREFIX = "lock:";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for acquiring a distributed lock
 */
export interface LockOptions {
  /** Time-to-live for the lock in milliseconds (default: 30s) */
  ttlMs?: number;
  /** Maximum time to wait for lock acquisition (default: 10s) */
  acquireTimeoutMs?: number;
  /** Retry interval when waiting for lock (default: 100ms) */
  retryIntervalMs?: number;
}

/**
 * Result of a lock acquisition attempt
 */
export interface LockResult {
  /** Whether the lock was acquired */
  acquired: boolean;
  /** Unique lock identifier for release */
  lockId?: string;
  /** Error message if acquisition failed */
  error?: string;
}

/**
 * Lock handle for managing an acquired lock
 */
export interface LockHandle {
  /** Unique lock identifier */
  lockId: string;
  /** Lock resource name */
  resource: string;
  /** Release the lock */
  release: () => Promise<boolean>;
  /** Extend the lock TTL */
  extend: (ttlMs?: number) => Promise<boolean>;
  /** Check if this lock is still held */
  isHeld: () => Promise<boolean>;
}

// =============================================================================
// In-Memory Lock (Fallback)
// =============================================================================

/**
 * In-memory lock store for fallback when Valkey is unavailable
 */
class InMemoryLockStore {
  private readonly locks = new Map<string, { lockId: string; expiresAt: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup expired locks every 5 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * ONE_SECOND_MS);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, lock] of this.locks) {
      if (lock.expiresAt < now) {
        this.locks.delete(key);
      }
    }
  }

  async tryAcquire(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(key);
    const now = Date.now();

    // Check if lock exists and is not expired
    if (existing && existing.expiresAt > now) {
      return false;
    }

    // Acquire the lock
    this.locks.set(key, { lockId, expiresAt: now + ttlMs });
    return true;
  }

  async release(key: string, lockId: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (!existing || existing.lockId !== lockId) {
      return false;
    }
    this.locks.delete(key);
    return true;
  }

  async extend(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    const existing = this.locks.get(key);
    if (!existing || existing.lockId !== lockId) {
      return false;
    }
    existing.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async isHeld(key: string, lockId: string): Promise<boolean> {
    const existing = this.locks.get(key);
    return existing?.lockId === lockId && existing.expiresAt > Date.now();
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.locks.clear();
  }
}

// =============================================================================
// Distributed Lock Manager
// =============================================================================

/**
 * Distributed Lock Manager
 *
 * Provides distributed locking using Valkey SETNX.
 * Falls back to in-memory locking when Valkey is unavailable.
 */
class DistributedLockManager {
  private static instance: DistributedLockManager | null = null;
  private client: Valkey | null = null;
  private readonly fallbackStore = new InMemoryLockStore();
  private connected = false;
  private readonly keyPrefix: string;
  private errorLogged = false;

  private constructor() {
    this.keyPrefix = config.valkey.keyPrefix + LOCK_KEY_PREFIX;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): DistributedLockManager {
    DistributedLockManager.instance ??= new DistributedLockManager();
    return DistributedLockManager.instance;
  }

  /**
   * Initialize the lock manager with Valkey connection
   */
  async initialize(): Promise<void> {
    try {
      this.client = new Valkey(config.valkey.url, {
        retryStrategy: (times: number) => {
          if (times > 3) {
            if (!this.errorLogged) {
              log.warn("Distributed lock: Max retries reached, using in-memory fallback");
              this.errorLogged = true;
            }
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });

      this.client.on("connect", () => {
        this.connected = true;
        this.errorLogged = false; // Reset on successful connection
        log.debug("Connected to Valkey for distributed locking");
      });

      this.client.on("error", (err: Error) => {
        this.connected = false;
        // Only log first error to avoid spam
        if (!this.errorLogged) {
          log.warn(`Valkey lock connection error: ${err.message}`);
          this.errorLogged = true;
        }
      });

      this.client.on("close", () => {
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;
      log.info("Distributed lock manager initialized with Valkey");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!this.errorLogged) {
        log.warn(`Valkey unavailable for locking, using in-memory fallback: ${message}`);
        this.errorLogged = true;
      }
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Check if using Valkey or fallback
   */
  isDistributed(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Try to acquire a lock with timeout
   */
  async acquire(resource: string, options?: LockOptions): Promise<LockHandle | null> {
    const ttlMs = options?.ttlMs ?? LOCK_DEFAULT_TTL_MS;
    const acquireTimeoutMs = options?.acquireTimeoutMs ?? LOCK_DEFAULT_ACQUIRE_TIMEOUT_MS;
    const retryIntervalMs = options?.retryIntervalMs ?? LOCK_RETRY_INTERVAL_MS;

    const lockId = randomUUID();
    const key = this.prefixKey(resource);
    const startTime = Date.now();

    while (Date.now() - startTime < acquireTimeoutMs) {
      const acquired = await this.tryAcquire(key, lockId, ttlMs);

      if (acquired) {
        log.debug(`Lock acquired: ${resource} (id: ${lockId.slice(0, 8)}...)`);
        return this.createHandle(resource, lockId, ttlMs);
      }

      // Wait before retrying
      await this.sleep(retryIntervalMs);
    }

    log.debug(`Lock acquisition timed out: ${resource}`);
    return null;
  }

  /**
   * Try to acquire lock immediately without waiting
   */
  async tryAcquire(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    if (this.connected && this.client) {
      return this.tryAcquireValkey(key, lockId, ttlMs);
    }
    return this.fallbackStore.tryAcquire(key, lockId, ttlMs);
  }

  /**
   * Try to acquire lock using Valkey SETNX
   */
  private async tryAcquireValkey(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    try {
      // SET key value PX ttl NX - atomic set-if-not-exists with expiration
      // Using multi-argument form that iovalkey supports
      const result = await this.client?.set(key, lockId, "PX", ttlMs, "NX");
      return result === "OK";
    } catch (error) {
      log.warn("Valkey lock acquire failed, using fallback:", error);
      return this.fallbackStore.tryAcquire(key, lockId, ttlMs);
    }
  }

  /**
   * Release a lock (only if we own it)
   */
  async release(resource: string, lockId: string): Promise<boolean> {
    const key = this.prefixKey(resource);

    if (this.connected && this.client) {
      return this.releaseValkey(key, lockId);
    }
    return this.fallbackStore.release(key, lockId);
  }

  /**
   * Release lock using Valkey with ownership check
   */
  private async releaseValkey(key: string, lockId: string): Promise<boolean> {
    try {
      // Lua script for atomic check-and-delete
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const result = await this.client?.eval(luaScript, 1, key, lockId);
      const released = result === 1;
      if (released) {
        log.debug(`Lock released: ${key.replace(this.keyPrefix, "")}`);
      }
      return released;
    } catch (error) {
      log.warn("Valkey lock release failed:", error);
      return this.fallbackStore.release(key, lockId);
    }
  }

  /**
   * Extend a lock's TTL (only if we own it)
   */
  async extend(resource: string, lockId: string, ttlMs?: number): Promise<boolean> {
    const key = this.prefixKey(resource);
    const newTtlMs = ttlMs ?? LOCK_DEFAULT_TTL_MS;

    if (this.connected && this.client) {
      return this.extendValkey(key, lockId, newTtlMs);
    }
    return this.fallbackStore.extend(key, lockId, newTtlMs);
  }

  /**
   * Extend lock using Valkey with ownership check
   */
  private async extendValkey(key: string, lockId: string, ttlMs: number): Promise<boolean> {
    try {
      // Lua script for atomic check-and-extend
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      const result = await this.client?.eval(luaScript, 1, key, lockId, ttlMs);
      return result === 1;
    } catch (error) {
      log.warn("Valkey lock extend failed:", error);
      return this.fallbackStore.extend(key, lockId, ttlMs);
    }
  }

  /**
   * Check if a lock is still held by us
   */
  async isHeld(resource: string, lockId: string): Promise<boolean> {
    const key = this.prefixKey(resource);

    if (this.connected && this.client) {
      try {
        const value = await this.client.get(key);
        return value === lockId;
      } catch {
        return this.fallbackStore.isHeld(key, lockId);
      }
    }
    return this.fallbackStore.isHeld(key, lockId);
  }

  /**
   * Create a lock handle for convenient lock management
   */
  private createHandle(resource: string, lockId: string, ttlMs: number): LockHandle {
    return {
      lockId,
      resource,
      release: () => this.release(resource, lockId),
      extend: (newTtlMs?: number) => this.extend(resource, lockId, newTtlMs ?? ttlMs),
      isHeld: () => this.isHeld(resource, lockId),
    };
  }

  /**
   * Execute a function while holding a lock
   */
  async withLock<T>(
    resource: string,
    fn: () => Promise<T>,
    options?: LockOptions
  ): Promise<{ success: true; result: T } | { success: false; error: string }> {
    const lock = await this.acquire(resource, options);

    if (!lock) {
      return { success: false, error: "Failed to acquire lock" };
    }

    try {
      const result = await fn();
      return { success: true, result };
    } finally {
      await lock.release();
    }
  }

  /**
   * Prefix a key with the lock prefix
   */
  private prefixKey(resource: string): string {
    return `${this.keyPrefix}${resource}`;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Shutdown the lock manager
   */
  async shutdown(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
    this.fallbackStore.destroy();
    this.connected = false;
    log.info("Distributed lock manager shut down");
  }
}

// =============================================================================
// Exports
// =============================================================================

/** Singleton lock manager instance */
export const lockManager = DistributedLockManager.getInstance();

/** Convenience function to acquire a lock */
export const acquireLock = (resource: string, options?: LockOptions): Promise<LockHandle | null> =>
  lockManager.acquire(resource, options);

/** Convenience function to execute with lock */
export const withLock = <T>(
  resource: string,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<{ success: true; result: T } | { success: false; error: string }> =>
  lockManager.withLock(resource, fn, options);
