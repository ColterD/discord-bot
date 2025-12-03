/**
 * Mem0 Client Configuration
 * Provides memory storage and retrieval using Mem0 with Qdrant vector database
 * and Ollama for LLM and embeddings
 */

import { Memory } from "mem0ai/oss";
import config from "../../config.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Mem0");

let mem0Client: Memory | null = null;

/**
 * Get or create the Mem0 client
 * Uses Qdrant as vector store, Ollama for LLM and embeddings
 */
export const getMem0Client = (): Memory => {
  if (mem0Client) {
    return mem0Client;
  }

  log.info("Initializing Mem0 client...");

  // Extract host and port from Qdrant URL
  const qdrantUrl = new URL(config.qdrant.url);
  const qdrantHost = qdrantUrl.hostname;
  const qdrantPort = Number.parseInt(qdrantUrl.port || "6333", 10);

  // Note: mem0ai uses 'url' for Ollama embedder but has a bug in OllamaLLM
  // that looks for config.config.url instead of config.url.
  // We use modelProperties to pass additional options that get spread into the config.
  mem0Client = new Memory({
    version: "v1.1",

    // Qdrant vector store
    vectorStore: {
      provider: "qdrant",
      config: {
        collectionName: config.qdrant.collectionName,
        host: qdrantHost,
        port: qdrantPort,
        dimension: 1024, // Qwen3-Embedding-0.6B dimension
      },
    },

    // Ollama LLM for memory extraction
    llm: {
      provider: "ollama",
      config: {
        model: config.llm.model,
        // OllamaLLM looks for config.config.url, so we nest it in modelProperties
        modelProperties: {
          url: config.llm.apiUrl,
        },
      },
    },

    // Ollama embeddings
    embedder: {
      provider: "ollama",
      config: {
        model: config.embedding.model,
        // OllamaEmbedder uses config.url directly
        url: config.llm.apiUrl,
      },
    },

    // Disable history to reduce overhead (we don't need memory versioning)
    disableHistory: true,
  });

  log.info("Mem0 client initialized successfully");
  return mem0Client;
};

/**
 * Reset the Mem0 client (for testing or reconnection)
 */
export const resetMem0Client = (): void => {
  mem0Client = null;
  log.info("Mem0 client reset");
};
