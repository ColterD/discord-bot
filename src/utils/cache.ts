/**
 * Cache Utility
 * Valkey client with graceful fallback to in-memory Map
 */

import Valkey from "iovalkey";
import { config } from "../config.js";
import { createLogger } from "./logger.js";

const log = createLogger("Cache");

/**
 * Maximum allowed pattern length to prevent ReDoS attacks
 * Patterns longer than this are rejected
 */
const MAX_PATTERN_LENGTH = 256;

/**
 * Match a key against a glob pattern using simple string matching
 * Supports * (match any characters) and ? (match single character)
 * This avoids dynamic RegExp construction which can be vulnerable to ReDoS
 */
function globMatch(pattern: string, key: string): boolean {
  // Reject excessively long patterns to prevent DoS
  if (pattern.length > MAX_PATTERN_LENGTH || key.length > MAX_PATTERN_LENGTH * 4) {
    return false;
  }

  let pi = 0; // pattern index
  let ki = 0; // key index
  let starIdx = -1; // last star position in pattern
  let matchIdx = -1; // position in key when star was found

  while (ki < key.length) {
    if (pi < pattern.length && (pattern[pi] === "?" || pattern[pi] === key[ki])) {
      // Match single character or exact match
      pi++;
      ki++;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      // Star found, record position for backtracking
      starIdx = pi;
      matchIdx = ki;
      pi++;
    } else if (starIdx >= 0) {
      // Mismatch, but we have a star to backtrack to
      pi = starIdx + 1;
      matchIdx++;
      ki = matchIdx;
    } else {
      // No match and no star to backtrack
      return false;
    }
  }

  // Check remaining pattern characters (must all be stars)
  while (pi < pattern.length && pattern[pi] === "*") {
    pi++;
  }

  return pi === pattern.length;
}

/**
 * Cache interface for abstraction
 */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  ttl(key: string): Promise<number>;
  expire(key: string, ttlMs: number): Promise<void>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

/**
 * In-memory fallback cache for when Valkey is unavailable
 */
export class InMemoryCache implements CacheClient {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup expired keys every 60 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs,
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async keys(pattern: string): Promise<string[]> {
    // Use safe glob matching that avoids dynamic RegExp (ReDoS-safe)
    const matches: string[] = [];
    const now = Date.now();

    for (const [key, entry] of this.store) {
      if (entry.expiresAt !== null && entry.expiresAt < now) {
        this.store.delete(key);
        continue;
      }
      if (globMatch(pattern, key)) {
        matches.push(key);
      }
    }
    return matches;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2; // Key doesn't exist
    if (entry.expiresAt === null) return -1; // No expiry
    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : -2;
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlMs;
    }
  }

  isConnected(): boolean {
    return true; // In-memory is always "connected"
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

/**
 * Valkey cache client wrapper
 */
export class ValkeyCache implements CacheClient {
  private readonly client: Valkey;
  private connected = false;
  private readonly keyPrefix: string;
  private errorLogged = false;

  constructor(url: string, keyPrefix: string) {
    this.keyPrefix = keyPrefix;
    this.client = new Valkey(url, {
      retryStrategy: (times: number) => {
        if (times > 3) {
          if (!this.errorLogged) {
            log.warn("Max retries reached, giving up");
            this.errorLogged = true;
          }
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.client.on("connect", () => {
      this.connected = true;
      this.errorLogged = false; // Reset error flag on successful connection
      log.info("Connected to Valkey");
    });

    this.client.on("error", (err: Error) => {
      this.connected = false;
      // Only log the first error to avoid spam
      if (!this.errorLogged) {
        log.warn(`Connection error: ${err.message}`);
        this.errorLogged = true;
      }
    });

    this.client.on("close", () => {
      this.connected = false;
      log.debug("Connection closed");
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to connect: ${message}`, error);
      throw error;
    }
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(this.prefixKey(key));
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    if (ttlMs === undefined) {
      await this.client.set(prefixedKey, value);
    } else {
      await this.client.set(prefixedKey, value, "PX", ttlMs);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.prefixKey(key));
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(this.prefixKey(key));
    return result === 1;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefixedPattern = this.prefixKey(pattern);
    const keys = await this.client.keys(prefixedPattern);
    // Remove prefix from returned keys
    return keys.map((k: string) => k.slice(this.keyPrefix.length));
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(this.prefixKey(key));
  }

  async expire(key: string, ttlMs: number): Promise<void> {
    await this.client.pexpire(this.prefixKey(key), ttlMs);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    this.connected = false;
  }
}

/**
 * Cache singleton with automatic fallback
 */
class CacheManager {
  private static instance: CacheManager | null = null;
  private cache: CacheClient;
  private readonly fallbackCache: InMemoryCache;
  private usingFallback = false;

  private constructor() {
    this.fallbackCache = new InMemoryCache();
    this.cache = this.fallbackCache;
  }

  static getInstance(): CacheManager {
    CacheManager.instance ??= new CacheManager();
    return CacheManager.instance;
  }

  async initialize(): Promise<void> {
    try {
      const valkeyCache = new ValkeyCache(config.valkey.url, config.valkey.keyPrefix);
      await valkeyCache.connect();
      this.cache = valkeyCache;
      this.usingFallback = false;
      log.info("Using Valkey for caching");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Valkey unavailable, using in-memory fallback: ${message}`);
      this.cache = this.fallbackCache;
      this.usingFallback = true;
    }
  }

  getClient(): CacheClient {
    return this.cache;
  }

  isUsingFallback(): boolean {
    return this.usingFallback;
  }

  async shutdown(): Promise<void> {
    await this.cache.disconnect();
    if (!this.usingFallback) {
      await this.fallbackCache.disconnect();
    }
  }
}

// Export singleton
export const cacheManager = CacheManager.getInstance();
export const getCache = (): CacheClient => cacheManager.getClient();
