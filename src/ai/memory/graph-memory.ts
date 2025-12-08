/**
 * Graph Memory System (Mem0 Pattern)
 *
 * Implements knowledge graph capabilities for entity extraction and relationship storage.
 * Based on Mem0's Graph Memory architecture:
 * - Extract entities (people, places, organizations) from conversations
 * - Store relationships between entities
 * - Enable multi-hop relationship queries
 *
 * Uses ChromaDB with special entity/relation document types for storage.
 *
 * @see https://docs.mem0.ai/features/graph-memory
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "../../utils/logger.js";
import { getChromaClient, type MemorySearchResult, type MemoryType } from "./chroma.js";

const log = createLogger("GraphMemory");

/**
 * Entity types that can be extracted from conversations
 * Following Mem0's entity taxonomy
 */
export type EntityType =
  | "person"
  | "organization"
  | "location"
  | "project"
  | "concept"
  | "product"
  | "event"
  | "skill"
  | "preference";

/**
 * Entity structure stored in ChromaDB
 */
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  userId: string;
  description?: string;
  aliases?: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Relationship between two entities
 */
export interface Relation {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: EntityType;
  targetId: string;
  targetName: string;
  targetType: EntityType;
  relationship: string;
  userId: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * LLM entity extraction result
 */
export interface ExtractedEntity {
  name: string;
  type: EntityType;
  description?: string;
}

/**
 * LLM relationship extraction result
 */
export interface ExtractedRelation {
  source: string;
  target: string;
  relationship: string;
  confidence?: number;
}

/**
 * Graph extraction result from LLM
 */
export interface GraphExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

/**
 * System prompt for LLM entity/relation extraction
 * Based on Mem0's graph extraction approach
 */
const GRAPH_EXTRACTION_PROMPT = `You are an entity and relationship extractor. Analyze the conversation and extract:

1. ENTITIES: Important named items mentioned (people, places, organizations, projects, skills, preferences)
2. RELATIONS: Connections between entities (e.g., "works_at", "lives_in", "knows", "prefers")

Rules:
- Only extract entities explicitly mentioned with proper names or clear identifiers
- For preferences, the user IS one end of the relation (use "user" as source)
- Relationships should be directional verbs (source -> target)
- Use lowercase_snake_case for relationships
- Confidence is 0.0-1.0 based on clarity of the statement

Output JSON format:
{
  "entities": [
    {"name": "Entity Name", "type": "person|organization|location|project|concept|product|event|skill|preference", "description": "Brief description"}
  ],
  "relations": [
    {"source": "Source Name", "target": "Target Name", "relationship": "relationship_type", "confidence": 0.9}
  ]
}

If no entities or relations found, return: {"entities": [], "relations": []}`;

/**
 * Graph Memory Manager
 * Handles entity extraction, storage, and relationship queries
 */
export class GraphMemoryManager {
  private static instance: GraphMemoryManager;

  private constructor() {
    // Graph entities and relations are stored as special document types in ChromaDB
    // using the main collection, not separate collections
  }

  public static getInstance(): GraphMemoryManager {
    if (!GraphMemoryManager.instance) {
      GraphMemoryManager.instance = new GraphMemoryManager();
    }
    return GraphMemoryManager.instance;
  }

  /**
   * Extract entities and relations from conversation text using LLM
   * This is called by the memory manager when processing conversations
   *
   * @param text - Conversation text to analyze
   * @param userId - User ID for context
   * @returns Extracted entities and relations
   */
  async extractFromText(text: string, userId: string): Promise<GraphExtractionResult> {
    // This will be integrated with the Ollama service
    // For now, return structure that will be populated by orchestrator
    log.debug(`Graph extraction requested for user ${userId} (text length: ${text.length})`);

    return {
      entities: [],
      relations: [],
    };
  }

  /**
   * Store an entity in the graph
   *
   * @param userId - User ID (for isolation)
   * @param entity - Entity to store
   * @returns Entity ID
   */
  async addEntity(userId: string, entity: ExtractedEntity): Promise<string> {
    const chroma = getChromaClient();
    const now = Date.now();
    const id = `entity-${userId}-${now}-${randomUUID().slice(0, 8)}`;

    // Check for existing entity with same name (merge if found)
    const existing = await this.findEntityByName(userId, entity.name);
    if (existing) {
      log.debug(`Entity "${entity.name}" already exists for user ${userId}, updating...`);
      // Extract description from existing content if available
      const existingDescription = this.extractDescriptionFromContent(existing.content);
      const description = entity.description ?? existingDescription;
      const updates: Partial<Entity> = { updatedAt: now };
      if (description) {
        updates.description = description;
      }
      return this.updateEntity(existing.id, updates);
    }

    // Store entity as a special memory document
    // ChromaDB stores as vector for semantic search
    const content = this.entityToDocument(entity);

    await chroma.addMemory(userId, content, "user_profile" as MemoryType, "graph_entity", 0.9);

    log.info(`Added entity: ${entity.name} (${entity.type}) for user ${userId}`);
    return id;
  }

  /**
   * Extract description from stored entity content
   */
  private extractDescriptionFromContent(content: string): string | undefined {
    // Entity format: "ENTITY: name (type) - description"
    // NOSONAR - safe: linear regex, no nested quantifiers
    const match = /ENTITY:\s*[^(]+\([^)]+\)\s*-\s*(.+)/.exec(content);
    return match?.[1]?.trim();
  }

  /**
   * Store a relation between two entities
   *
   * @param userId - User ID (for isolation)
   * @param relation - Relation to store
   * @returns Relation ID
   */
  async addRelation(userId: string, relation: ExtractedRelation): Promise<string> {
    const chroma = getChromaClient();
    const now = Date.now();
    const id = `rel-${userId}-${now}-${randomUUID().slice(0, 8)}`;

    // Check for existing relation
    const existing = await this.findRelation(
      userId,
      relation.source,
      relation.target,
      relation.relationship
    );
    if (existing) {
      log.debug(
        `Relation already exists: ${relation.source} -[${relation.relationship}]-> ${relation.target}`
      );
      return existing.id;
    }

    // Store relation as a memory document
    const content = this.relationToDocument(relation);

    await chroma.addMemory(userId, content, "fact" as MemoryType, "graph_relation", 0.85);

    log.info(`Added relation: ${relation.source} -[${relation.relationship}]-> ${relation.target}`);
    return id;
  }

  /**
   * Process graph extraction result and store in ChromaDB
   *
   * @param userId - User ID
   * @param result - Extraction result from LLM
   */
  async processExtractionResult(userId: string, result: GraphExtractionResult): Promise<void> {
    if (!result.entities.length && !result.relations.length) {
      log.debug("No entities or relations to process");
      return;
    }

    // Store entities first
    for (const entity of result.entities) {
      try {
        await this.addEntity(userId, entity);
      } catch (error) {
        log.warn(`Failed to store entity ${entity.name}: ${error}`);
      }
    }

    // Store relations
    for (const relation of result.relations) {
      try {
        await this.addRelation(userId, relation);
      } catch (error) {
        log.warn(`Failed to store relation: ${error}`);
      }
    }

    log.info(
      `Processed graph extraction: ${result.entities.length} entities, ${result.relations.length} relations`
    );
  }

  /**
   * Find an entity by name (fuzzy match via semantic search)
   *
   * @param userId - User ID
   * @param name - Entity name to search for
   * @returns Entity or null
   */
  async findEntityByName(userId: string, name: string): Promise<MemorySearchResult | null> {
    const chroma = getChromaClient();
    const query = `entity: ${name}`;

    const results = await chroma.searchMemories(userId, query, 5, undefined, 0.8);

    // Filter for entity documents
    const entityResults = results.filter((r) => r.content.startsWith("ENTITY:"));

    if (entityResults.length > 0) {
      const best = entityResults[0];
      if (best?.content.toLowerCase().includes(name.toLowerCase())) {
        return best;
      }
    }

    return null;
  }

  /**
   * Find relations involving an entity
   *
   * @param userId - User ID
   * @param entityName - Entity name to find relations for
   * @returns Related memories
   */
  async findRelationsForEntity(userId: string, entityName: string): Promise<MemorySearchResult[]> {
    const chroma = getChromaClient();
    const query = `relationship involving ${entityName}`;

    const results = await chroma.searchMemories(userId, query, 20, undefined, 0.6);

    // Filter for relation documents
    return results.filter((r) => r.content.startsWith("RELATION:"));
  }

  /**
   * Find a specific relation
   */
  private async findRelation(
    userId: string,
    source: string,
    target: string,
    relationship: string
  ): Promise<MemorySearchResult | null> {
    const chroma = getChromaClient();
    const query = `${source} ${relationship} ${target}`;

    const results = await chroma.searchMemories(userId, query, 5, undefined, 0.85);

    const relationResults = results.filter((r) => r.content.startsWith("RELATION:"));

    for (const result of relationResults) {
      if (
        result.content.toLowerCase().includes(source.toLowerCase()) &&
        result.content.toLowerCase().includes(target.toLowerCase()) &&
        result.content.toLowerCase().includes(relationship.toLowerCase())
      ) {
        return result;
      }
    }

    return null;
  }

  /**
   * Update an entity by deleting and re-adding with merged content
   * ChromaDB doesn't support direct updates
   */
  private async updateEntity(id: string, updates: Partial<Entity>): Promise<string> {
    const chroma = getChromaClient();

    try {
      // Get existing entity
      const existing = await chroma.getMemoryById(id);
      if (!existing) {
        log.warn(`Entity ${id} not found for update`);
        return id;
      }

      // Parse existing content to extract entity data
      const lines = existing.content.split("\n");
      const nameMatch = /ENTITY:\s*(.+)/.exec(lines[0] ?? "");
      const typeMatch = /Type:\s*(.+)/.exec(lines[1] ?? "");
      const descMatch = /Description:\s*(.+)/.exec(lines[2] ?? "");

      const entityName = nameMatch?.[1]?.trim() ?? "Unknown";
      const entityType = (typeMatch?.[1]?.trim() ?? "concept") as EntityType;
      const entityDesc = updates.description ?? descMatch?.[1]?.trim();

      // Delete old entity
      await chroma.deleteMemory(id);

      // Create updated entity
      const updatedEntity: ExtractedEntity = {
        name: entityName,
        type: entityType,
      };
      // Only add description if present
      if (entityDesc) {
        updatedEntity.description = entityDesc;
      }

      // Re-add with updated content
      const newId = await this.addEntity(existing.metadata.userId, updatedEntity);
      log.debug(`Entity updated: ${id} -> ${newId}`);
      return newId;
    } catch (error) {
      log.error(`Failed to update entity ${id}: ${error}`);
      return id;
    }
  }

  /**
   * Query the knowledge graph with a natural language question
   * Supports multi-hop queries like "Who is X's manager's spouse?"
   *
   * @param userId - User ID
   * @param question - Natural language question
   * @returns Relevant entities and relations
   */
  async queryGraph(
    userId: string,
    question: string
  ): Promise<{
    entities: MemorySearchResult[];
    relations: MemorySearchResult[];
    answer?: string;
  }> {
    const chroma = getChromaClient();

    // Search for both entities and relations relevant to the question
    const allResults = await chroma.searchMemories(userId, question, 20, undefined, 0.5);

    const entities = allResults.filter((r) => r.content.startsWith("ENTITY:"));
    const relations = allResults.filter((r) => r.content.startsWith("RELATION:"));

    log.debug(`Graph query found ${entities.length} entities, ${relations.length} relations`);

    return { entities, relations };
  }

  /**
   * Get all entities for a user
   *
   * @param userId - User ID
   * @returns All user entities
   */
  async getAllEntities(userId: string): Promise<MemorySearchResult[]> {
    const chroma = getChromaClient();
    const allMemories = await chroma.getAllMemories(userId);

    return allMemories.filter((m) => m.content.startsWith("ENTITY:"));
  }

  /**
   * Get all relations for a user
   *
   * @param userId - User ID
   * @returns All user relations
   */
  async getAllRelations(userId: string): Promise<MemorySearchResult[]> {
    const chroma = getChromaClient();
    const allMemories = await chroma.getAllMemories(userId);

    return allMemories.filter((m) => m.content.startsWith("RELATION:"));
  }

  /**
   * Format entity as storable document
   */
  private entityToDocument(entity: ExtractedEntity): string {
    const parts = [`ENTITY: ${entity.name}`, `Type: ${entity.type}`];
    if (entity.description) {
      parts.push(`Description: ${entity.description}`);
    }
    return parts.join("\n");
  }

  /**
   * Format relation as storable document
   */
  private relationToDocument(relation: ExtractedRelation): string {
    return (
      `RELATION: ${relation.source} -[${relation.relationship}]-> ${relation.target}` +
      (relation.confidence ? ` (confidence: ${relation.confidence.toFixed(2)})` : "")
    );
  }

  /**
   * Build context string from graph data for inclusion in prompts
   *
   * @param userId - User ID
   * @param query - Current query for relevance filtering
   * @param maxTokens - Maximum tokens for context
   * @returns Formatted knowledge graph context
   */
  async buildGraphContext(userId: string, query: string, maxTokens = 500): Promise<string> {
    const { entities, relations } = await this.queryGraph(userId, query);

    if (entities.length === 0 && relations.length === 0) {
      return "";
    }

    const lines: string[] = ["## Knowledge Graph"];

    // Add entities
    if (entities.length > 0) {
      lines.push("### Known Entities");
      for (const entity of entities.slice(0, 10)) {
        lines.push(`- ${entity.content.replace("ENTITY: ", "")}`);
      }
    }

    // Add relations
    if (relations.length > 0) {
      lines.push("### Relationships");
      for (const relation of relations.slice(0, 10)) {
        lines.push(`- ${relation.content.replace("RELATION: ", "")}`);
      }
    }

    const context = lines.join("\n");

    // Rough token estimation (4 chars per token)
    if (context.length / 4 > maxTokens) {
      // Truncate if too long
      const maxChars = maxTokens * 4;
      return `${context.slice(0, maxChars)}\n...`;
    }

    return context;
  }
}

/**
 * Get the singleton GraphMemoryManager instance
 */
export function getGraphMemoryManager(): GraphMemoryManager {
  return GraphMemoryManager.getInstance();
}

/**
 * Get the graph extraction system prompt for the LLM
 */
export function getGraphExtractionPrompt(): string {
  return GRAPH_EXTRACTION_PROMPT;
}

/**
 * Extract JSON string from response (may be wrapped in markdown code blocks)
 */
function extractJsonFromResponse(response: string): string | null {
  // NOSONAR - safe: lazy quantifier with clear terminator (```)
  const regex = /```(?:json)?\s*([\s\S]*?)```/;
  const match = regex.exec(response);
  if (match?.[1]) {
    return match[1].trim();
  }
  // Assume raw JSON if no code block
  return response.trim();
}

/**
 * Validate that parsed object has correct structure
 */
function isValidGraphObject(
  parsed: unknown
): parsed is { entities: unknown[]; relations: unknown[] } {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj.entities) && Array.isArray(obj.relations);
}

/**
 * Parse entity array from raw data
 */
function parseEntities(rawEntities: unknown[]): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  for (const e of rawEntities) {
    if (typeof e !== "object" || e === null) continue;

    const entity = e as Record<string, unknown>;
    if (typeof entity.name !== "string" || typeof entity.type !== "string") continue;

    const extracted: ExtractedEntity = {
      name: entity.name,
      type: entity.type as EntityType,
    };

    // Only add description if it's a non-empty string
    if (typeof entity.description === "string" && entity.description.trim()) {
      extracted.description = entity.description;
    }

    entities.push(extracted);
  }

  return entities;
}

/**
 * Parse relation array from raw data
 */
function parseRelations(rawRelations: unknown[]): ExtractedRelation[] {
  const relations: ExtractedRelation[] = [];

  for (const r of rawRelations) {
    if (typeof r !== "object" || r === null) continue;

    const relation = r as Record<string, unknown>;
    if (
      typeof relation.source !== "string" ||
      typeof relation.target !== "string" ||
      typeof relation.relationship !== "string"
    )
      continue;

    const extracted: ExtractedRelation = {
      source: relation.source,
      target: relation.target,
      relationship: relation.relationship,
    };

    // Only add confidence if it's a valid number
    if (typeof relation.confidence === "number") {
      extracted.confidence = relation.confidence;
    }

    relations.push(extracted);
  }

  return relations;
}

/**
 * Parse LLM response for graph extraction
 *
 * @param response - LLM response text
 * @returns Parsed extraction result or null if parsing fails
 */
export function parseGraphExtractionResponse(response: string): GraphExtractionResult | null {
  try {
    const jsonStr = extractJsonFromResponse(response);
    if (!jsonStr) {
      return null;
    }

    const parsed = JSON.parse(jsonStr) as unknown;

    if (!isValidGraphObject(parsed)) {
      return null;
    }

    const entities = parseEntities(parsed.entities);
    const relations = parseRelations(parsed.relations);

    return { entities, relations };
  } catch (error) {
    log.warn(`Failed to parse graph extraction response: ${error}`);
    return null;
  }
}
