export { getMem0Client, resetMem0Client } from "./mem0.js";
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
