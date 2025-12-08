/**
 * ChromaDB Memory Client
 * Vector-based semantic memory using ChromaDB with Ollama embeddings
 *
 * Native TypeScript solution for long-term memory storage using vector search
 */

import { randomUUID } from "node:crypto";
import { OllamaEmbeddingFunction } from "@chroma-core/ollama";
import { ChromaClient, type Collection, type IncludeEnum, type Where } from "chromadb";
import { config } from "../../config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("ChromaMemory");

/**
 * Memory types following ENGRAM 3-type architecture + extensions
 * - user_profile: Facts about the user (name, job, location)
 * - episodic: Past conversation summaries and events
 * - fact: General knowledge/facts shared by user
 * - preference: User preferences (likes, dislikes, communication style)
 * - procedural: User interaction patterns (how they want to be responded to)
 */
export type MemoryType = "user_profile" | "episodic" | "fact" | "preference" | "procedural";

/**
 * Memory document structure stored in ChromaDB
 * Enhanced with access tracking for Ebbinghaus forgetting curve (MemoryBank pattern)
 */
export interface MemoryDocument {
  id: string;
  content: string;
  metadata: {
    userId: string;
    timestamp: number;
    type: MemoryType;
    source: string;
    importance: number;
    // Access tracking fields (MemoryBank/Mem0 pattern)
    accessCount: number; // How many times this memory was retrieved
    lastAccessed: number; // Timestamp of last access
    strength: number; // Memory strength (decays over time, increases with access)
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
        port: Number.parseInt(chromaUrl.port, 10) || (chromaUrl.protocol === "https:" ? 443 : 8000),
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
   * Provides defaults for access tracking fields for backwards compatibility
   */
  private transformResultItem(
    id: string,
    content: string,
    metadata: Record<string, unknown>,
    distance: number | null | undefined = 0
  ): MemorySearchResult {
    const distanceValue = distance ?? 0;
    // Clamp to prevent negative scores when distance > 2
    const relevanceScore = Math.max(0, 1 - distanceValue / 2);
    const now = Date.now();

    return {
      id,
      content,
      metadata: {
        userId: metadata.userId as string,
        timestamp: metadata.timestamp as number,
        type: metadata.type as MemoryDocument["metadata"]["type"],
        source: (metadata.source as string) ?? "conversation",
        importance: (metadata.importance as number) ?? 1,
        // Access tracking fields with backwards-compatible defaults
        accessCount: (metadata.accessCount as number) ?? 0,
        lastAccessed: (metadata.lastAccessed as number) ?? (metadata.timestamp as number) ?? now,
        strength: (metadata.strength as number) ?? 1,
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
    const decay = decayRate ** ageDays;

    // Clamp to minimum of 0.1 so very old memories aren't completely ignored
    return Math.max(0.1, Math.min(1, decay));
  }

  /**
   * Calculate memory strength decay based on Ebbinghaus forgetting curve (MemoryBank pattern)
   * Memory strength decays over time unless accessed/reinforced
   *
   * @param lastAccessed - Timestamp when memory was last accessed
   * @param currentStrength - Current stored strength value
   * @returns Decayed strength value
   */
  private calculateStrengthDecay(lastAccessed: number, currentStrength: number): number {
    const now = Date.now();
    const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

    // Ebbinghaus-inspired decay: strength * e^(-t/τ)
    // τ (tau) is the time constant - higher means slower decay
    // τ = 30 days means memory retains ~37% strength after 30 days without access
    const tau = config.memory.strengthDecayDays ?? 30;
    const decayedStrength = currentStrength * Math.exp(-daysSinceAccess / tau);

    // Minimum strength of 0.1 so memories aren't completely forgotten
    return Math.max(0.1, decayedStrength);
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
   * Advanced re-ranking with access frequency, recency, and strength (Milvus/Pinecone pattern)
   * Combines multiple signals for optimal memory retrieval:
   * - Semantic similarity (base relevance from vector search)
   * - Time decay (older memories weighted less)
   * - Memory strength (Ebbinghaus forgetting curve)
   * - Access frequency (frequently accessed memories are more important)
   * - Importance score (explicit importance rating)
   *
   * @param memory - Memory search result to re-rank
   * @returns Enhanced relevance score
   */
  calculateEnhancedRelevance(memory: MemorySearchResult): number {
    const { metadata, relevanceScore: baseRelevance } = memory;

    // 1. Time decay factor (0.1 - 1.0)
    const timeDecay = this.calculateTimeDecay(metadata.timestamp);

    // 2. Strength decay based on last access (Ebbinghaus curve)
    const decayedStrength = this.calculateStrengthDecay(metadata.lastAccessed, metadata.strength);

    // 3. Access frequency bonus (log scale to prevent runaway scores)
    // accessCount of 0 = 1.0, 10 = 1.3, 100 = 1.7
    const accessBonus = 1 + Math.log10(Math.max(1, metadata.accessCount + 1)) * 0.3;

    // 4. Importance factor (0.3 - 1.5)
    const importanceFactor = Math.max(0.3, Math.min(1.5, metadata.importance));

    // 5. Type-based boost (user preferences and facts are more stable)
    let typeBoost = 1;
    if (metadata.type === "preference" || metadata.type === "user_profile") {
      typeBoost = 1.1;
    } else if (metadata.type === "procedural") {
      typeBoost = 1.05;
    }

    // Combine factors: base * timeDecay * strength * accessBonus * importance * typeBoost
    const enhanced =
      baseRelevance * timeDecay * decayedStrength * accessBonus * importanceFactor * typeBoost;

    // Normalize to 0-1 range (cap at 1.5 then normalize)
    return Math.min(1, enhanced / 1.5);
  }

  /**
   * Record memory access - updates access count and last accessed timestamp
   * Should be called when a memory is retrieved and used
   *
   * @param id - Memory ID that was accessed
   */
  async recordMemoryAccess(id: string): Promise<void> {
    const collection = await this.ensureInitialized();

    try {
      const existing = await collection.get({
        ids: [id],
        include: ["documents", "metadatas"] as IncludeEnum[],
      });

      const existingMeta = existing.metadatas?.[0];
      const existingContent = existing.documents?.[0];

      if (!existingMeta || !existingContent) {
        log.warn(`Memory ${id} not found for access recording`);
        return;
      }

      // Update access tracking fields
      const accessCount = ((existingMeta.accessCount as number) ?? 0) + 1;
      const now = Date.now();

      // Accessing a memory reinforces its strength (memory consolidation)
      const currentStrength = (existingMeta.strength as number) ?? 1;
      const reinforcedStrength = Math.min(2, currentStrength + 0.05); // Small boost per access

      // ChromaDB doesn't support direct updates, so we delete and re-add
      await collection.delete({ ids: [id] });

      // Create new ID with preserved original parts but new timestamp
      const userId = existingMeta.userId as string;
      const newId = `${userId}-${Date.now()}-${randomUUID().slice(0, 8)}`;

      await collection.add({
        ids: [newId],
        documents: [existingContent],
        metadatas: [
          {
            ...existingMeta,
            accessCount,
            lastAccessed: now,
            strength: reinforcedStrength,
          },
        ],
      });

      log.debug(`Recorded access for memory ${id} -> ${newId} (count: ${accessCount})`);
    } catch (error) {
      // Non-critical operation, log but don't throw
      log.warn(
        `Failed to record memory access for ${id}: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
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

      // Create new ID with updated timestamp using cryptographically secure random
      const userId = existingMeta.userId as string;
      const newId = `${userId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const timestamp = Date.now();

      // Merge metadata - preserve original, apply updates
      // When updating (consolidating), increment access count and boost strength
      const existingAccessCount = (existingMeta.accessCount as number) ?? 0;
      const existingStrength = (existingMeta.strength as number) ?? 1;

      const mergedMeta = {
        userId,
        timestamp,
        type: (metadata.type ?? existingMeta.type) as MemoryDocument["metadata"]["type"],
        source: (metadata.source ?? existingMeta.source ?? "conversation") as string,
        importance: (metadata.importance ?? existingMeta.importance ?? 1) as number,
        // Update access tracking - consolidation counts as an access, boosts strength
        accessCount: metadata.accessCount ?? existingAccessCount + 1,
        lastAccessed: metadata.lastAccessed ?? timestamp,
        // Strength increases when memory is consolidated/updated (memory reinforcement)
        strength: Math.min(2, metadata.strength ?? existingStrength + 0.1),
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

    // Use cryptographically secure random for ID generation
    const id = `${userId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
            // Initialize access tracking fields (MemoryBank pattern)
            accessCount: 0,
            lastAccessed: timestamp,
            strength: 1, // New memories start at full strength
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
   * Get relevance threshold based on memory type
   */
  private getRelevanceThreshold(
    type: MemoryDocument["metadata"]["type"],
    minRelevance?: number
  ): number {
    if (minRelevance !== undefined) {
      return minRelevance;
    }

    // Procedural memories need lower threshold - they're important for interaction
    if (type === "procedural") {
      return config.memory.relevanceThresholds.userProfile * 0.9;
    }

    // User profile and preferences need moderate relevance
    if (type === "user_profile" || type === "preference") {
      return config.memory.relevanceThresholds.userProfile;
    }

    // Episodic memories need higher threshold to avoid pollution
    return config.memory.relevanceThresholds.episodic;
  }

  /**
   * Search memories by semantic similarity with relevance filtering and time decay
   *
   * @param userId - Discord user ID
   * @param query - Search query
   * @param limit - Max results to return
   * @param types - Optional memory type filter
   * @param minRelevance - Minimum effective relevance score (0-1), defaults from config
   * @param useEnhancedRanking - Use advanced re-ranking (default: true)
   * @returns Filtered and sorted memories
   */
  async searchMemories(
    userId: string,
    query: string,
    limit = 10,
    types?: MemoryDocument["metadata"]["type"][],
    minRelevance?: number,
    useEnhancedRanking = true
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

        if (!id || !content || !metadata) {
          continue;
        }

        const result = this.transformResultItem(id, content, metadata, distance);

        // Use enhanced ranking (Milvus/Pinecone pattern) or legacy ranking
        const effectiveRelevance = useEnhancedRanking
          ? this.calculateEnhancedRelevance(result)
          : this.calculateEffectiveRelevance(
              result.relevanceScore,
              result.metadata.timestamp,
              result.metadata.importance
            );

        // Apply relevance threshold based on memory type
        const threshold = this.getRelevanceThreshold(result.metadata.type, minRelevance);

        if (effectiveRelevance >= threshold) {
          // Store effective relevance for sorting
          result.relevanceScore = effectiveRelevance;
          memories.push(result);
        }
      }

      // Sort by effective relevance (highest first)
      memories.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Limit to requested count
      const filtered = memories.slice(0, limit);

      // Record access for memories that will be returned (async, non-blocking)
      // Only record access for top results to avoid excessive updates
      const topMemoryIds = filtered.map((m) => m.id);
      void Promise.all(topMemoryIds.map((id) => this.recordMemoryAccess(id))).catch((err) => {
        log.warn(`Failed to record memory access: ${err}`);
      });

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
   * Get a specific memory by ID
   *
   * @param memoryId - Memory ID to retrieve
   * @returns Memory or null if not found
   */
  async getMemoryById(memoryId: string): Promise<MemorySearchResult | null> {
    const collection = await this.ensureInitialized();

    try {
      const results = await collection.get({
        ids: [memoryId],
        include: ["documents", "metadatas"] as IncludeEnum[],
      });

      const content = results.documents?.[0];
      const metadata = results.metadatas?.[0];

      if (!content || !metadata) {
        return null;
      }

      return this.transformResultItem(memoryId, content, metadata, 0);
    } catch (error) {
      log.error(
        `Failed to get memory ${memoryId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return null;
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
   * Consolidate similar memories for a user (Mem0 pattern)
   * Finds groups of semantically similar memories and merges them into stronger,
   * unified memories. This reduces memory pollution and strengthens important memories.
   *
   * @param userId - Discord user ID
   * @param type - Optional memory type to consolidate (all types if not specified)
   * @param similarityThreshold - Minimum similarity to consider memories related (default from config)
   * @returns Number of memories consolidated
   */
  async consolidateMemories(
    userId: string,
    type?: MemoryDocument["metadata"]["type"],
    similarityThreshold?: number
  ): Promise<{ consolidated: number; removed: number }> {
    const threshold = similarityThreshold ?? config.memory.consolidationThreshold;
    const types = type ? [type] : undefined;
    const memories = await this.getAllMemories(userId, types);

    if (memories.length < 2) {
      return { consolidated: 0, removed: 0 };
    }

    log.info(`Starting memory consolidation for user ${userId} (${memories.length} memories)`);

    const processedIds = new Set<string>();
    let consolidated = 0;
    let removed = 0;

    for (const memory of memories) {
      // Skip if already processed
      if (processedIds.has(memory.id)) {
        continue;
      }

      // Find similar memories
      const similar = await this.findSimilarMemories(
        userId,
        memory.content,
        memory.metadata.type,
        threshold
      );

      // Filter out the current memory and already processed ones
      const relatedMemories = similar.filter((m) => m.id !== memory.id && !processedIds.has(m.id));

      if (relatedMemories.length === 0) {
        processedIds.add(memory.id);
        continue;
      }

      // Merge similar memories
      // Keep the memory with highest combined score (strength * importance * accessCount)
      const allRelated = [memory, ...relatedMemories];
      const scored = allRelated.map((m) => ({
        memory: m,
        score:
          m.metadata.strength *
          m.metadata.importance *
          Math.log10(Math.max(1, m.metadata.accessCount + 1)),
      }));
      scored.sort((a, b) => b.score - a.score);

      const primary = scored[0];
      if (!primary) continue;

      const toMerge = scored.slice(1);

      // Combine access counts and boost strength
      const combinedAccessCount = allRelated.reduce((sum, m) => sum + m.metadata.accessCount, 0);
      const maxStrength = Math.max(...allRelated.map((m) => m.metadata.strength));
      const boostedStrength = Math.min(2, maxStrength + 0.1 * toMerge.length);

      // Update the primary memory with combined stats
      await this.updateMemory(primary.memory.id, primary.memory.content, {
        accessCount: combinedAccessCount,
        strength: boostedStrength,
        importance: Math.max(...allRelated.map((m) => m.metadata.importance)),
      });

      // Delete the merged memories
      for (const { memory: m } of toMerge) {
        await this.deleteMemory(m.id);
        processedIds.add(m.id);
        removed++;
      }

      processedIds.add(primary.memory.id);
      consolidated++;
    }

    log.info(
      `Memory consolidation complete: ${consolidated} groups consolidated, ${removed} duplicates removed`
    );
    return { consolidated, removed };
  }

  /**
   * Find multiple similar memories (helper for consolidation)
   */
  private async findSimilarMemories(
    userId: string,
    content: string,
    type: MemoryDocument["metadata"]["type"],
    similarityThreshold: number
  ): Promise<MemorySearchResult[]> {
    const collection = await this.ensureInitialized();

    try {
      const whereFilter = this.buildWhereFilter(userId, [type]);

      const results = await collection.query({
        queryTexts: [content],
        nResults: 10,
        where: whereFilter,
        include: ["documents", "metadatas", "distances"] as IncludeEnum[],
      });

      const similar: MemorySearchResult[] = [];
      const ids = results.ids[0] ?? [];

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const existingContent = results.documents?.[0]?.[i];
        const metadata = results.metadatas?.[0]?.[i];
        const distance = results.distances?.[0]?.[i];

        if (id && existingContent && metadata && distance !== undefined) {
          const result = this.transformResultItem(id, existingContent, metadata, distance);
          if (result.relevanceScore >= similarityThreshold) {
            similar.push(result);
          }
        }
      }

      return similar;
    } catch (error) {
      log.error(
        `Failed to find similar memories for user ${userId}: ` +
          (error instanceof Error ? error.message : String(error)),
        error
      );
      return [];
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
