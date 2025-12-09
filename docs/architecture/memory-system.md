# Memory Architecture

This document describes the 3-tier memory system used by the Discord bot, inspired by cutting-edge AI memory research from Mem0 and MemGPT/Letta.

## Overview

The memory system provides the AI with persistent, context-aware memory that:

- **Never forgets** important information about users
- **Self-edits** its own memories using LLM-powered tools
- **Extracts relationships** between entities (people, projects, preferences)
- **Decays naturally** following cognitive science principles

## Architecture Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│                     Memory Architecture                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  SHORT-TERM     │  │   LONG-TERM     │  │  GRAPH MEMORY   │  │
│  │  (Valkey/Redis) │  │  (ChromaDB)     │  │  (ChromaDB)     │  │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤  │
│  │ • Conversation  │  │ • User profiles │  │ • Entities      │  │
│  │   context       │  │ • Preferences   │  │ • Relations     │  │
│  │ • Session state │  │ • Facts         │  │ • Multi-hop     │  │
│  │ • Recent msgs   │  │ • Procedures    │  │   queries       │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           │                    │                    │            │
│           └────────────────────┼────────────────────┘            │
│                                │                                 │
│                    ┌───────────▼───────────┐                    │
│                    │   Memory Manager      │                    │
│                    │   + LLM Self-Edit     │                    │
│                    │   + Decay Algorithm   │                    │
│                    └───────────────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Memory Types

| Type           | Description                 | Example                                        |
| -------------- | --------------------------- | ---------------------------------------------- |
| `user_profile` | Facts about the user        | "John is a software engineer"                  |
| `preference`   | User preferences and likes  | "Prefers concise responses"                    |
| `fact`         | General knowledge from user | "TypeScript is their main language"            |
| `procedural`   | Interaction patterns        | "User prefers code examples over explanations" |
| `episodic`     | Past conversation summaries | "Last week discussed React hooks"              |

## Pattern 1: Graph Memory (Mem0)

**Source**: [Mem0 Graph Memory](https://docs.mem0.ai/features/graph-memory)

### Entity Extraction

The system uses LLM to extract entities from conversations:

```typescript
interface Entity {
  id: string;
  name: string; // "John"
  type: EntityType; // "person" | "organization" | "project" | ...
  userId: string; // Owner of this entity
  description?: string;
  aliases?: string[]; // ["Johnny", "J"]
  createdAt: number;
  updatedAt: number;
}
```

### Relationship Storage

Entities are connected via typed relationships:

```typescript
interface Relation {
  sourceId: string; // Entity ID
  targetId: string; // Entity ID
  relationship: string; // "works_at" | "knows" | "prefers" | ...
  confidence: number; // 0.0 - 1.0
}
```

### Multi-hop Queries

Graph memory enables relationship traversal:

```
User: "What do I know about John's company?"

Graph traversal:
  User → knows → John → works_at → Acme Corp
                                       ↓
                          Returns: Facts about Acme Corp
```

## Pattern 2: LLM Self-Editing Memory (MemGPT)

**Source**: [MemGPT/Letta Memory](https://docs.letta.com/concepts/memory)

### Memory Tools

The AI can directly modify its own memory using these tools:

#### `memory_append`

Add new information to memory.

```json
{
  "tool": "memory_append",
  "content": "User prefers Python over JavaScript",
  "category": "preference",
  "importance": 0.9
}
```

#### `memory_replace`

Update/correct existing memory.

```json
{
  "tool": "memory_replace",
  "search_query": "User's programming language",
  "new_content": "User now prefers TypeScript over Python",
  "reason": "User stated they switched languages"
}
```

#### `memory_search`

Query past memories.

```json
{
  "tool": "memory_search",
  "query": "user's programming preferences",
  "limit": 5
}
```

#### `memory_delete`

Remove outdated information.

```json
{
  "tool": "memory_delete",
  "search_query": "outdated project reference",
  "reason": "User confirmed project is complete"
}
```

### Why Self-Editing?

Traditional memory systems passively store information. MemGPT-style self-editing enables:

1. **Correction**: AI can fix mistakes in its own memories
2. **Consolidation**: Merge related memories into cleaner entries
3. **Prioritization**: AI decides what's important to remember
4. **Active Learning**: AI explicitly notes when it learns something new

## Pattern 3: Memory Decay (Ebbinghaus)

**Source**: Cognitive science + [MemoryBank paper](https://arxiv.org/abs/2305.10250)

### Forgetting Curve

Memories decay naturally following the Ebbinghaus forgetting curve:

```
                  Strength
                     │
              1.0 ───┼─╮
                     │  ╲
              0.5 ───┼───╲──────
                     │    ╲
              0.37 ──┼─────╲────  ← After τ days (default: 30)
                     │      ╲
              0.0 ───┴───────────→ Time (days)
                     0   30  60
```

**Formula**: `R = strength × e^(-t/τ)`

Where:

- `R` = Retention (effective strength)
- `t` = Days since last access
- `τ` = Decay constant (default: 30 days)

### Access Count Boost

Frequently accessed memories decay slower:

```typescript
effectiveStrength = baseStrength × (1 + log(accessCount + 1) / 10)
```

| Access Count | Strength Multiplier |
| ------------ | ------------------- |
| 0            | 1.00x               |
| 1            | 1.07x               |
| 5            | 1.18x               |
| 10           | 1.24x               |
| 50           | 1.39x               |

## File Structure

```
src/ai/memory/
├── index.ts              # Exports all memory modules
├── chroma.ts             # ChromaDB client, vector search
├── memory-manager.ts     # Orchestrates memory operations
├── memory-tools.ts       # MemGPT self-editing tools
├── graph-memory.ts       # Mem0 entity/relation extraction
├── conversation-store.ts # Short-term conversation history
└── session-summarizer.ts # Converts conversations to episodic memory
```

## Configuration

```env
# Memory System
MEMORY_ENABLED=true
CHROMA_URL=http://localhost:8000

# Embeddings (for vector search)
EMBEDDING_MODEL=qwen3-embedding:0.6b

# Decay Settings
MEMORY_DECAY_TAU=30        # Days for 63% decay
MEMORY_MIN_STRENGTH=0.1    # Below this, memories are pruned
```

## API Usage

### Store a Memory

```typescript
import { getChromaClient } from "./ai/memory/index.js";

const chroma = getChromaClient();
await chroma.storeMemory(
  userId, // Discord user ID
  "User loves TypeScript",
  "preference", // Memory type
  "conversation", // Source
  0.9 // Importance
);
```

### Search Memories

```typescript
const results = await chroma.searchMemories(
  userId,
  "programming preferences",
  5, // Limit
  "preference", // Filter by type
  0.7 // Min similarity
);
```

### Use Memory Tools (LLM Self-Edit)

```typescript
import { executeMemoryTool } from "./ai/memory/index.js";

const result = await executeMemoryTool(userId, "memory_append", {
  content: "User's birthday is March 15",
  category: "fact",
  importance: 0.8,
});
```

### Extract Graph Entities

```typescript
import { getGraphMemoryManager } from "./ai/memory/index.js";

const graph = getGraphMemoryManager();
const { entities, relations } = await graph.extractFromText(conversationText, userId);
```

## Testing

Run memory system tests:

```bash
# Memory-specific tests (21 tests)
npx tsx tests/integration/memory.test.ts

# All integration tests
npm run test:integration
```

## Vector Database Comparison

Current implementation uses **ChromaDB**. Research comparison:

| Feature           | ChromaDB  | LanceDB        | Qdrant    |
| ----------------- | --------- | -------------- | --------- |
| **Embedded**      | No Server | Embedded       | No Server |
| **TypeScript**    | Good      | **Native**     | Good      |
| **Performance**   | Good      | Excellent      | **Best**  |
| **Docker**        | Required  | **Not needed** | Required  |
| **Hybrid Search** | Basic     | SQL+Vector     | Advanced  |

**Recommendation**: Consider migrating to **LanceDB** for embedded, serverless operation with native TypeScript support.

## Future Improvements

1. **LanceDB Migration**: Embedded vector store, no Docker dependency
2. **Memory Importance Learning**: Train model on what users find valuable
3. **Cross-user Patterns**: Learn from aggregate patterns (privacy-preserving)
4. **Memory Visualization**: Dashboard showing memory graph
5. **Selective Forgetting**: User-controlled "forget me" functionality

## References

- [Mem0 Documentation](https://docs.mem0.ai/)
- [MemGPT/Letta Paper](https://arxiv.org/abs/2310.08560)
- [MemoryBank Paper](https://arxiv.org/abs/2305.10250)
- [Ebbinghaus Forgetting Curve](https://en.wikipedia.org/wiki/Forgetting_curve)
