export {
  getChromaClient,
  type MemoryDocument,
  type MemorySearchResult,
  type MemoryType,
  resetChromaClient,
} from "./chroma.js";
export {
  type Conversation,
  type ConversationMessage,
  type ConversationMetadata,
  conversationStore,
} from "./conversation-store.js";
// Graph Memory (Mem0 pattern)
export {
  type Entity,
  type EntityType,
  type ExtractedEntity,
  type ExtractedRelation,
  type GraphExtractionResult,
  GraphMemoryManager,
  getGraphExtractionPrompt,
  getGraphMemoryManager,
  parseGraphExtractionResponse,
  type Relation,
} from "./graph-memory.js";
export { BOT_USER_ID, MemoryManager, type MemoryResult } from "./memory-manager.js";
// Memory Tools for LLM Self-Editing (MemGPT pattern)
export {
  executeMemoryTool,
  getMemoryToolsManager,
  MEMORY_SELF_EDIT_TOOLS,
  type MemoryBlockType,
  type MemoryToolResult,
} from "./memory-tools.js";
export { SessionSummarizer, sessionSummarizer } from "./session-summarizer.js";

import { MemoryManager } from "./memory-manager.js";

export const getMemoryManager = () => MemoryManager.getInstance();
