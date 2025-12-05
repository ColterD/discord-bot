/**
 * ChromaDB Memory Client
 * Vector-based semantic memory using ChromaDB with Ollama embeddings
 *
 * Replaces mem0ai with a native TypeScript solution that works properly with Ollama
 */

import { OllamaEmbeddingFunction } from "@chroma-core/ollama";
import { ChromaClient, type Collection, type IncludeEnum, type Where } from "chromadb";
import { config } from "../../config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ChromaMemory");

/**
 * Memory document structure stored in ChromaDB
 */
export interface MemoryDocument {
  id: string;
  content: string;
  metadata: {
    userId: string;
    timestamp: number;
    type: "user_profile" | "episodic" | "fact" | "preference";
    source: string;
    importance: number;
  };
}

/**
 * Search result from ChromaDB
 */
export interface MemorySearchResult {
  id: string;
  content: string;
  metadata: MemoryDocument["metadata"];
  distance: number;
  relevanceScore: number;
}

/**
 * ChromaDB Memory Client - singleton pattern
 */
class ChromaMemoryClient {
  private client: ChromaClient | null = null;
  private collection: Collection | null = null;
  private embedder: OllamaEmbeddingFunction | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;

  /**
   * Initialize the ChromaDB client and collection
   */
  async initialize(): Promise<void> {
    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.initialized) {
      return;
    }

    this.initPromise = this.doInitialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    try {
      log.info(`Connecting to ChromaDB at ${config.chroma.url}`);

      // Create the Ollama embedding function
      this.embedder = new OllamaEmbeddingFunction({
        url: config.llm.apiUrl,
        model: config.embedding.model,
      });

      // Parse the ChromaDB URL to extract host and port
      const chromaUrl = new URL(config.chroma.url);

      // Create the ChromaDB client with the new API
      this.client = new ChromaClient({
        ssl: chromaUrl.protocol === "https:",
        host: chromaUrl.hostname,
        port: Number.parseInt(chromaUrl.port) || (chromaUrl.protocol === "https:" ? 443 : 8000),
      });

      // Get or create the memories collection
      this.collection = await this.client.getOrCreateCollection({
        name: config.chroma.collectionName,
        embeddingFunction: this.embedder,
        metadata: {
          description: "Discord bot user memories and episodic knowledge",
          "hnsw:space": "cosine", // Use cosine similarity
        },
      });

      const count = await this.collection.count();
      log.info(`ChromaDB initialized with ${count} existing memories`);
      this.initialized = true;
    } catch (error) {
      log.error(
        "Failed to initialize ChromaDB: " +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      throw error;
    }
  }

  /**
   * Ensure the client is initialized before operations
   */
  private async ensureInitialized(): Promise<Collection> {
    if (!this.initialized || !this.collection) {
      await this.initialize();
    }
    if (!this.collection) {
      throw new Error("ChromaDB collection not initialized");
    }
    return this.collection;
  }

  /**
   * Build a Where filter for querying by user and optional types
   * SECURITY: Validates userId format to prevent injection
   */
  private buildWhereFilter(userId: string, types?: MemoryDocument["metadata"]["type"][]): Where {
    // Validate userId format (Discord snowflake: 17-19 digits)
    // This prevents potential injection through malformed IDs
    if (!/^\d{17,19}$/.test(userId)) {
      log.warn(`Invalid userId format in buildWhereFilter: ${userId}`);
      // Return a filter that matches nothing for invalid IDs
      return { userId: { $eq: "__INVALID__" } };
    }

    if (!types || types.length === 0) {
      return { userId: { $eq: userId } };
    }

    const firstType = types[0];
    if (types.length === 1 && firstType) {
      return {
        $and: [{ userId: { $eq: userId } }, { type: { $eq: firstType } }],
      };
    }

    return {
      $and: [{ userId: { $eq: userId } }, { type: { $in: types } }],
    };
  }

  /**
   * Transform query result item into MemorySearchResult
   */
  private transformResultItem(
    id: string,
    content: string,
    metadata: Record<string, unknown>,
    distance: number | null | undefined = 0
  ): MemorySearchResult {
    const distanceValue = distance ?? 0;
    const relevanceScore = 1 - distanceValue / 2;

    return {
      id,
      content,
      metadata: {
        userId: metadata.userId as string,
        timestamp: metadata.timestamp as number,
        type: metadata.type as MemoryDocument["metadata"]["type"],
        source: (metadata.source as string) ?? "conversation",
        importance: (metadata.importance as number) ?? 1,
      },
      distance: distanceValue,
      relevanceScore,
    };
  }

  /**
   * Calculate time decay factor for a memory
   * Older memories have lower weight to prevent old irrelevant memories from polluting context
   *
   * @param timestamp - Memory timestamp in ms
   * @returns Decay factor between 0 and 1
   */
  private calculateTimeDecay(timestamp: number): number {
    const now = Date.now();
    const ageMs = now - timestamp;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    // Apply exponential decay: decayFactor = decayRate ^ ageDays
    const decayRate = config.memory.timeDecayPerDay;
    const decay = Math.pow(decayRate, ageDays);

    // Clamp to minimum of 0.1 so very old memories aren't completely ignored
    return Math.max(0.1, Math.min(1, decay));
  }

  /**
   * Calculate effective relevance score including time decay
   *
   * @param baseRelevance - Raw relevance score from vector similarity (0-1)
   * @param timestamp - Memory timestamp in ms
   * @param importance - Memory importance factor (0-1)
   * @returns Adjusted relevance score
   */
  calculateEffectiveRelevance(baseRelevance: number, timestamp: number, importance = 1): number {
    const timeDecay = this.calculateTimeDecay(timestamp);
    // Effective = base * timeDecay * importance
    // Importance ranges from 0.3 to 1.5 to allow boosting/dampening
    const importanceFactor = Math.max(0.3, Math.min(1.5, importance));
    return baseRelevance * timeDecay * importanceFactor;
  }

  /**
   * Find a semantically similar existing memory
   * Used to prevent duplicates and enable memory updates
   *
   * @param userId - Discord user ID
   * @param content - Content to match
   * @param type - Memory type to match
   * @param similarityThreshold - Minimum similarity (0-1) to consider a match, default 0.85
   * @returns Matching memory or null if none found
   */
  async findSimilarMemory(
    userId: string,
    content: string,
    type: MemoryDocument["metadata"]["type"],
    similarityThreshold = 0.85
  ): Promise<MemorySearchResult | null> {
    const collection = await this.ensureInitialized();

    try {
      const whereFilter = this.buildWhereFilter(userId, [type]);

      const results = await collection.query({
        queryTexts: [content],
        nResults: 5,
        where: whereFilter,
        include: ["documents", "metadatas", "distances"] as IncludeEnum[],
      });

      const ids = results.ids[0] ?? [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const existingContent = results.documents?.[0]?.[i];
        const metadata = results.metadatas?.[0]?.[i];
        const distance = results.distances?.[0]?.[i];

        if (id && existingContent && metadata && distance !== undefined) {
          const result = this.transformResultItem(id, existingContent, metadata, distance);

          // Check if similarity is above threshold
          if (result.relevanceScore >= similarityThreshold) {
            log.debug(
              `Found similar memory ${id} (${(result.relevanceScore * 100).toFixed(1)}% similar)`
            );
            return result;
          }
        }
      }

      return null;
    } catch (error) {
      log.error(
        `Failed to find similar memory for user ${userId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return null;
    }
  }

  /**
   * Update an existing memory with new content
   * ChromaDB doesn't support direct updates, so we delete and re-add
   *
   * @param id - Memory ID to update
   * @param newContent - New content
   * @param metadata - Updated metadata (preserves userId, updates timestamp)
   * @returns New memory ID
   */
  async updateMemory(
    id: string,
    newContent: string,
    metadata: Partial<MemoryDocument["metadata"]>
  ): Promise<string> {
    const collection = await this.ensureInitialized();

    try {
      // Get the existing memory to preserve metadata
      const existing = await collection.get({
        ids: [id],
        include: ["metadatas"] as IncludeEnum[],
      });

      const existingMeta = existing.metadatas?.[0];
      if (!existingMeta) {
        throw new Error(`Memory ${id} not found for update`);
      }

      // Delete the old memory
      await collection.delete({ ids: [id] });

      // Create new ID with updated timestamp
      const userId = existingMeta.userId as string;
      const newId = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timestamp = Date.now();

      // Merge metadata - preserve original, apply updates
      const mergedMeta = {
        userId,
        timestamp,
        type: (metadata.type ?? existingMeta.type) as MemoryDocument["metadata"]["type"],
        source: (metadata.source ?? existingMeta.source ?? "conversation") as string,
        importance: (metadata.importance ?? existingMeta.importance ?? 1) as number,
      };

      await collection.add({
        ids: [newId],
        documents: [newContent],
        metadatas: [mergedMeta],
      });

      log.debug(`Updated memory ${id} -> ${newId}: ${newContent.slice(0, 50)}...`);
      return newId;
    } catch (error) {
      log.error(
        `Failed to update memory ${id}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      throw error;
    }
  }

  /**
   * Add or update a memory - finds similar existing memory and updates it, or adds new
   * This is the preferred method for storing memories to prevent duplicates
   *
   * @param userId - Discord user ID
   * @param content - Memory content
   * @param type - Memory type
   * @param source - Source of the memory
   * @param importance - Importance score
   * @param similarityThreshold - Threshold for considering a memory "similar" (default 0.85)
   * @returns Object with memory ID and whether it was an update or new addition
   */
  async addOrUpdateMemory(
    userId: string,
    content: string,
    type: MemoryDocument["metadata"]["type"] = "episodic",
    source?: string,
    importance?: number,
    similarityThreshold = 0.85
  ): Promise<{ id: string; updated: boolean; previousContent?: string }> {
    // First, try to find a similar existing memory
    const similar = await this.findSimilarMemory(userId, content, type, similarityThreshold);

    if (similar) {
      // Found similar memory - update it instead of adding duplicate
      log.info(
        `Updating existing memory ${similar.id} (${(similar.relevanceScore * 100).toFixed(1)}% similar) instead of creating duplicate`
      );

      const newId = await this.updateMemory(similar.id, content, {
        type,
        source: source ?? similar.metadata.source,
        importance: importance ?? similar.metadata.importance,
      });

      return {
        id: newId,
        updated: true,
        previousContent: similar.content,
      };
    }

    // No similar memory found - add new one
    const id = await this.addMemory(userId, content, type, source, importance);
    return { id, updated: false };
  }

  /**
   * Add a memory to the store (creates new memory, does not check for duplicates)
   * Consider using addOrUpdateMemory() instead to prevent duplicates
   */
  async addMemory(
    userId: string,
    content: string,
    type: MemoryDocument["metadata"]["type"] = "episodic",
    source?: string,
    importance?: number
  ): Promise<string> {
    const collection = await this.ensureInitialized();

    const id = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = Date.now();

    try {
      await collection.add({
        ids: [id],
        documents: [content],
        metadatas: [
          {
            userId,
            timestamp,
            type,
            source: source ?? "conversation",
            importance: importance ?? 1,
          },
        ],
      });

      log.debug(`Added memory ${id} for user ${userId}: ${content.slice(0, 50)}...`);
      return id;
    } catch (error) {
      log.error(
        `Failed to add memory for user ${userId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      throw error;
    }
  }

  /**
   * Search memories by semantic similarity with relevance filtering and time decay
   *
   * @param userId - Discord user ID
   * @param query - Search query
   * @param limit - Max results to return
   * @param types - Optional memory type filter
   * @param minRelevance - Minimum effective relevance score (0-1), defaults from config
   * @returns Filtered and sorted memories
   */
  async searchMemories(
    userId: string,
    query: string,
    limit = 10,
    types?: MemoryDocument["metadata"]["type"][],
    minRelevance?: number
  ): Promise<MemorySearchResult[]> {
    const collection = await this.ensureInitialized();

    try {
      const whereFilter = this.buildWhereFilter(userId, types);

      // Fetch more results than needed to account for filtering
      const fetchLimit = Math.min(limit * 3, 50);

      const results = await collection.query({
        queryTexts: [query],
        nResults: fetchLimit,
        where: whereFilter,
        include: ["documents", "metadatas", "distances"] as IncludeEnum[],
      });

      const memories: MemorySearchResult[] = [];

      const ids = results.ids[0] ?? [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const content = results.documents?.[0]?.[i];
        const metadata = results.metadatas?.[0]?.[i];
        const distance = results.distances?.[0]?.[i];

        if (id && content && metadata) {
          const result = this.transformResultItem(id, content, metadata, distance);

          // Calculate effective relevance with time decay and importance
          const effectiveRelevance = this.calculateEffectiveRelevance(
            result.relevanceScore,
            result.metadata.timestamp,
            result.metadata.importance
          );

          // Apply relevance threshold based on memory type
          const threshold =
            minRelevance ??
            (result.metadata.type === "user_profile" || result.metadata.type === "preference"
              ? config.memory.relevanceThresholds.userProfile
              : config.memory.relevanceThresholds.episodic);

          if (effectiveRelevance >= threshold) {
            // Store effective relevance for sorting
            result.relevanceScore = effectiveRelevance;
            memories.push(result);
          }
        }
      }

      // Sort by effective relevance (highest first)
      memories.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Limit to requested count
      const filtered = memories.slice(0, limit);

      log.debug(
        `Found ${ids.length} raw matches, ${memories.length} passed threshold, returning ${filtered.length}`
      );
      return filtered;
    } catch (error) {
      log.error(
        `Failed to search memories for user ${userId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return [];
    }
  }

  /**
   * Get all memories for a user
   */
  async getAllMemories(
    userId: string,
    types?: MemoryDocument["metadata"]["type"][]
  ): Promise<MemorySearchResult[]> {
    const collection = await this.ensureInitialized();

    try {
      const whereFilter = this.buildWhereFilter(userId, types);

      const results = await collection.get({
        where: whereFilter,
        include: ["documents", "metadatas"] as IncludeEnum[],
      });

      const memories: MemorySearchResult[] = [];

      for (let i = 0; i < results.ids.length; i++) {
        const id = results.ids[i];
        const content = results.documents?.[i];
        const metadata = results.metadatas?.[i];

        if (id && content && metadata) {
          memories.push(this.transformResultItem(id, content, metadata, 0));
        }
      }

      log.debug(`Retrieved ${memories.length} total memories for user ${userId}`);
      return memories;
    } catch (error) {
      log.error(
        `Failed to get all memories for user ${userId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return [];
    }
  }

  /**
   * Delete a specific memory
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    const collection = await this.ensureInitialized();

    try {
      await collection.delete({
        ids: [memoryId],
      });
      log.debug(`Deleted memory ${memoryId}`);
      return true;
    } catch (error) {
      log.error(
        `Failed to delete memory ${memoryId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return false;
    }
  }

  /**
   * Delete all memories for a user
   */
  async deleteAllMemories(userId: string): Promise<number> {
    const collection = await this.ensureInitialized();

    try {
      // First get all memory IDs for this user
      const results = await collection.get({
        where: { userId: { $eq: userId } },
      });

      if (results.ids.length === 0) {
        log.debug(`No memories to delete for user ${userId}`);
        return 0;
      }

      // Delete all of them
      await collection.delete({
        ids: results.ids,
      });

      log.info(`Deleted ${results.ids.length} memories for user ${userId}`);
      return results.ids.length;
    } catch (error) {
      log.error(
        `Failed to delete all memories for user ${userId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return 0;
    }
  }

  /**
   * Get the total count of memories
   */
  async getCount(): Promise<number> {
    const collection = await this.ensureInitialized();
    return collection.count();
  }

  /**
   * Get count of memories for a specific user
   */
  async getUserMemoryCount(userId: string): Promise<number> {
    const collection = await this.ensureInitialized();

    try {
      const results = await collection.get({
        where: { userId: { $eq: userId } },
      });
      return results.ids.length;
    } catch (error) {
      log.error(
        `Failed to get memory count for user ${userId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return 0;
    }
  }

  /**
   * Reset the client (for testing or reconnection)
   */
  reset(): void {
    this.client = null;
    this.collection = null;
    this.embedder = null;
    this.initialized = false;
    this.initPromise = null;
    log.info("ChromaDB client reset");
  }

  /**
   * Check if the client is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.client) {
        return false;
      }
      // Simple heartbeat check
      await this.client.heartbeat();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let chromaClient: ChromaMemoryClient | null = null;

/**
 * Get the ChromaDB memory client instance
 */
export function getChromaClient(): ChromaMemoryClient {
  chromaClient ??= new ChromaMemoryClient();
  return chromaClient;
}

/**
 * Reset the ChromaDB client (for testing or reconnection)
 */
export function resetChromaClient(): void {
  if (chromaClient) {
    chromaClient.reset();
    chromaClient = null;
  }
}

export { ChromaMemoryClient };
