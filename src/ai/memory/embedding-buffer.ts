/**
 * Embedding Buffer
 *
 * Write-ahead buffer for batching embeddings before ChromaDB writes.
 * Uses Valkey for persistence and automatic batching based on count/time.
 *
 * Design based on ROADMAP.md:
 * - 10 items OR 30s trigger flush
 * - 1-hour TTL for orphaned entries
 * - Retry on failure with exponential backoff
 *
 * @module ai/memory/embedding-buffer
 */

import crypto from "node:crypto";
import Valkey from "iovalkey";
import { config } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import type { EmbeddingResponse } from "../providers/index.js";
import { getEmbeddingProvider } from "../providers/index.js";
import type { MemoryType } from "./chroma.js";

const logger = createLogger("EmbeddingBuffer");

/**
 * Buffer entry for pending embeddings
 */
export interface BufferEntry {
  /** Unique ID for the entry */
  id: string;
  /** Text content to embed */
  content: string;
  /** User ID for the memory */
  userId: string;
  /** Memory type */
  type: MemoryType;
  /** Source of the memory (e.g., "conversation", "extraction") */
  source: string;
  /** Importance score (0-1) */
  importance: number;
  /** Timestamp when entry was added */
  timestamp: number;
  /** Number of retry attempts */
  retryCount: number;
}

/**
 * Completed embedding ready for ChromaDB
 */
export interface CompletedEmbedding {
  entry: BufferEntry;
  embedding: number[];
}

/**
 * Buffer configuration
 */
export interface EmbeddingBufferConfig {
  /** Maximum entries before auto-flush */
  maxBatchSize?: number;
  /** Maximum time before auto-flush (ms) */
  maxBatchWaitMs?: number;
  /** TTL for orphaned entries (ms) */
  entryTtlMs?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Valkey key prefix */
  keyPrefix?: string;
}

/**
 * Callback for handling completed embeddings
 */
export type EmbeddingFlushCallback = (embeddings: CompletedEmbedding[]) => Promise<void>;

/**
 * Embedding Buffer Class
 *
 * Batches embedding requests for efficient processing.
 * Persists to Valkey for durability across restarts.
 */
export class EmbeddingBuffer {
  private readonly bufferConfig: Required<EmbeddingBufferConfig>;
  private readonly bufferKey: string;
  private readonly processingKey: string;

  private client: Valkey | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushCallback: EmbeddingFlushCallback | null = null;
  private isProcessing = false;
  private initPromise: Promise<void> | null = null;

  constructor(embeddingBufferConfig?: EmbeddingBufferConfig) {
    this.bufferConfig = {
      maxBatchSize: embeddingBufferConfig?.maxBatchSize ?? 10,
      maxBatchWaitMs: embeddingBufferConfig?.maxBatchWaitMs ?? 30000, // 30 seconds
      entryTtlMs: embeddingBufferConfig?.entryTtlMs ?? 3600000, // 1 hour
      maxRetries: embeddingBufferConfig?.maxRetries ?? 3,
      keyPrefix: embeddingBufferConfig?.keyPrefix ?? `${config.valkey.keyPrefix}embedding-buffer:`,
    };

    this.bufferKey = `${this.bufferConfig.keyPrefix}pending`;
    this.processingKey = `${this.bufferConfig.keyPrefix}processing`;
  }

  /**
   * Initialize the buffer and connect to Valkey
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      // Replace valkey:// with redis:// for iovalkey compatibility
      const connectionUrl = config.valkey.url.replace("valkey://", "redis://");

      this.client = new Valkey(connectionUrl, {
        retryStrategy: (times: number) => {
          if (times > 3) {
            logger.warn("Max retries reached, giving up");
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      this.client.on("error", (err: Error) => {
        logger.error(`Valkey client error: ${err.message}`);
      });

      await this.client.connect();
      logger.info("Embedding buffer connected to Valkey");

      // Recover any entries left in processing state (from crash)
      await this.recoverProcessingEntries();

      // Start flush timer
      this.startFlushTimer();
    } catch (error) {
      logger.error(
        `Failed to initialize embedding buffer: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw error;
    }
  }

  /**
   * Set the callback for flushing completed embeddings
   */
  onFlush(callback: EmbeddingFlushCallback): void {
    this.flushCallback = callback;
  }

  /**
   * Add an entry to the buffer
   */
  async add(entry: Omit<BufferEntry, "id" | "timestamp" | "retryCount">): Promise<string> {
    await this.ensureInitialized();

    const fullEntry: BufferEntry = {
      ...entry,
      id: `emb_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      retryCount: 0,
    };

    await this.client?.hset(this.bufferKey, fullEntry.id, JSON.stringify(fullEntry));
    await this.client?.expire(this.bufferKey, Math.ceil(this.bufferConfig.entryTtlMs / 1000));

    logger.debug(`Added entry to embedding buffer: ${fullEntry.id}`);

    // Check if we should auto-flush
    const count = await this.getBufferCount();
    if (count >= this.bufferConfig.maxBatchSize) {
      void this.flush();
    }

    return fullEntry.id;
  }

  /**
   * Get current buffer count
   */
  async getBufferCount(): Promise<number> {
    await this.ensureInitialized();
    return (await this.client?.hlen(this.bufferKey)) ?? 0;
  }

  /**
   * Get all pending entries
   */
  async getPendingEntries(): Promise<BufferEntry[]> {
    await this.ensureInitialized();

    const entries = await this.client?.hgetall(this.bufferKey);
    if (!entries) return [];
    return Object.values(entries).map((json) => JSON.parse(String(json)) as BufferEntry);
  }

  /**
   * Flush buffer: generate embeddings and call callback
   */
  async flush(): Promise<CompletedEmbedding[]> {
    if (this.isProcessing) {
      logger.debug("Flush already in progress, skipping");
      return [];
    }

    this.isProcessing = true;

    try {
      await this.ensureInitialized();

      // Move entries to processing set atomically
      const entries = await this.getPendingEntries();
      if (entries.length === 0) {
        return [];
      }

      logger.info(`Flushing embedding buffer: ${entries.length} entries`);

      // Move to processing atomically using Redis transaction
      // This prevents race conditions where entries could be lost between hset and hdel
      if (this.client) {
        const pipeline = this.client.pipeline();
        for (const entry of entries) {
          pipeline.hset(this.processingKey, entry.id, JSON.stringify(entry));
          pipeline.hdel(this.bufferKey, entry.id);
        }
        await pipeline.exec();
      }

      // Generate embeddings
      const completed = await this.generateEmbeddings(entries);

      // Call callback if set
      if (this.flushCallback && completed.length > 0) {
        try {
          await this.flushCallback(completed);
          // Remove from processing on success
          for (const comp of completed) {
            await this.client?.hdel(this.processingKey, comp.entry.id);
          }
          logger.info(`Successfully flushed ${completed.length} embeddings`);
        } catch (error) {
          // On failure, entries will be retried from processing set
          logger.error(
            `Flush callback failed: ${error instanceof Error ? error.message : "Unknown error"}`
          );
          await this.handleFlushFailure(completed);
        }
      }

      return completed;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Generate embeddings for entries
   */
  private async generateEmbeddings(entries: BufferEntry[]): Promise<CompletedEmbedding[]> {
    const completed: CompletedEmbedding[] = [];

    try {
      const provider = await getEmbeddingProvider();

      // Batch embedding request
      const texts = entries.map((e) => e.content);
      if (!provider.embed) {
        throw new Error("Embedding provider does not support embed method");
      }
      const response: EmbeddingResponse = await provider.embed(texts);

      // Match embeddings to entries
      for (const [index, entry] of entries.entries()) {
        const embedding = response.embeddings[index];
        if (embedding) {
          completed.push({ entry, embedding });
        } else {
          logger.warn(`No embedding generated for entry: ${entry.id}`);
        }
      }
    } catch (error) {
      logger.error(
        `Failed to generate embeddings: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      // Return empty - entries stay in processing for retry
    }

    return completed;
  }

  /**
   * Handle flush failure - prepare for retry
   */
  private async handleFlushFailure(completed: CompletedEmbedding[]): Promise<void> {
    for (const comp of completed) {
      const entry = comp.entry;
      entry.retryCount++;

      if (entry.retryCount >= this.bufferConfig.maxRetries) {
        logger.error(`Entry ${entry.id} exceeded max retries, dropping`);
        await this.client?.hdel(this.processingKey, entry.id);
      } else {
        // Move back to pending with updated retry count
        await this.client?.hset(this.bufferKey, entry.id, JSON.stringify(entry));
        await this.client?.hdel(this.processingKey, entry.id);
      }
    }
  }

  /**
   * Recover entries left in processing state (from crash)
   */
  private async recoverProcessingEntries(): Promise<void> {
    const processing = await this.client?.hgetall(this.processingKey);
    if (!processing) return;
    const entries = Object.values(processing);

    if (entries.length > 0) {
      logger.info(`Recovering ${entries.length} entries from processing state`);

      for (const json of entries) {
        const entry = JSON.parse(String(json)) as BufferEntry;
        entry.retryCount++;

        if (entry.retryCount >= this.bufferConfig.maxRetries) {
          logger.warn(`Recovered entry ${entry.id} exceeded max retries, dropping`);
        } else {
          await this.client?.hset(this.bufferKey, entry.id, JSON.stringify(entry));
        }
        await this.client?.hdel(this.processingKey, entry.id);
      }
    }
  }

  /**
   * Start the auto-flush timer
   */
  private startFlushTimer(): void {
    this.stopFlushTimer();

    this.flushTimer = setInterval(() => {
      void this.checkAutoFlush();
    }, this.bufferConfig.maxBatchWaitMs);
  }

  /**
   * Stop the auto-flush timer
   */
  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Check if auto-flush should occur
   */
  private async checkAutoFlush(): Promise<void> {
    try {
      const count = await this.getBufferCount();
      if (count > 0) {
        logger.debug(`Auto-flush triggered: ${count} entries pending`);
        await this.flush();
      }
    } catch (error) {
      logger.error(
        `Auto-flush check failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Ensure buffer is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.client) {
      await this.initialize();
    }
  }

  /**
   * Shutdown the buffer gracefully
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down embedding buffer");

    this.stopFlushTimer();

    // Flush any remaining entries
    try {
      await this.flush();
    } catch (error) {
      logger.error(
        `Failed to flush on shutdown: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    // Disconnect from Valkey
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }

    this.initPromise = null;
    logger.info("Embedding buffer shutdown complete");
  }

  /**
   * Get buffer stats for monitoring
   */
  async getStats(): Promise<{
    pending: number;
    processing: number;
    isProcessing: boolean;
  }> {
    await this.ensureInitialized();

    return {
      pending: (await this.client?.hlen(this.bufferKey)) ?? 0,
      processing: (await this.client?.hlen(this.processingKey)) ?? 0,
      isProcessing: this.isProcessing,
    };
  }
}

// Singleton instance
let bufferInstance: EmbeddingBuffer | null = null;

/**
 * Get the singleton embedding buffer instance
 */
export function getEmbeddingBuffer(embeddingConfig?: EmbeddingBufferConfig): EmbeddingBuffer {
  bufferInstance ??= new EmbeddingBuffer(embeddingConfig);
  return bufferInstance;
}

/**
 * Initialize and get the embedding buffer
 */
export async function initializeEmbeddingBuffer(
  embeddingConfig?: EmbeddingBufferConfig
): Promise<EmbeddingBuffer> {
  const buffer = getEmbeddingBuffer(embeddingConfig);
  await buffer.initialize();
  return buffer;
}
