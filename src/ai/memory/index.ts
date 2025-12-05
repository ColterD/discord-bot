export {
  getChromaClient,
  resetChromaClient,
  type MemoryDocument,
  type MemorySearchResult,
} from "./chroma.js";
export { MemoryManager, BOT_USER_ID, type MemoryResult } from "./memory-manager.js";
export {
  conversationStore,
  type ConversationMessage,
  type ConversationMetadata,
  type Conversation,
} from "./conversation-store.js";
export { SessionSummarizer } from "./session-summarizer.js";

import { MemoryManager } from "./memory-manager.js";

export const getMemoryManager = () => MemoryManager.getInstance();
