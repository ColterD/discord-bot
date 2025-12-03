/**
 * Bot Configuration
 * Centralized configuration management
 */

export const config = {
  // Bot settings
  bot: {
    name: "Discord Bot",
    prefix: "!",
  },

  // Discord settings
  discord: {
    token: process.env.DISCORD_TOKEN ?? "",
    clientId: process.env.DISCORD_CLIENT_ID ?? "",
    devGuildId: process.env.DEV_GUILD_ID ?? "",
  },

  // Environment
  env: {
    isProduction: process.env.NODE_ENV === "production",
    isDevelopment: process.env.NODE_ENV === "development",
  },

  // LLM Configuration (Ollama in Docker container)
  llm: {
    apiUrl: process.env.OLLAMA_HOST ?? "http://ollama:11434",
    model:
      process.env.LLM_MODEL ??
      "hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1",
    maxTokens: Number.parseInt(process.env.LLM_MAX_TOKENS ?? "4096", 10),
    temperature: Number.parseFloat(process.env.LLM_TEMPERATURE ?? "0.7"),
    // Keep model loaded in GPU memory (seconds, -1 = forever)
    // Using 300 (5 minutes) to balance response time and GPU memory
    keepAlive: Number.parseInt(process.env.LLM_KEEP_ALIVE ?? "300", 10),
    // Preload model on startup for faster first response
    preloadOnStartup: process.env.LLM_PRELOAD !== "false",
    // Inactivity timeout before sleeping (ms) - default 5 minutes
    sleepAfterMs: Number.parseInt(process.env.LLM_SLEEP_AFTER_MS ?? "300000", 10),
    // Use Orchestrator for enhanced tool-aware conversations
    useOrchestrator: process.env.LLM_USE_ORCHESTRATOR !== "false",
    // HERETIC-specific settings for optimal performance
    heretic: {
      // Recommended experts for MoE model (4-6)
      numExperts: Number.parseInt(process.env.LLM_NUM_EXPERTS ?? "5", 10),
      // Repetition penalty (1.0-1.1 recommended)
      repPen: Number.parseFloat(process.env.LLM_REP_PEN ?? "1.1"),
      // Temperature for coding (0.6) vs creative (1.0-1.2)
      tempCoding: Number.parseFloat(process.env.LLM_TEMP_CODING ?? "0.6"),
      tempCreative: Number.parseFloat(process.env.LLM_TEMP_CREATIVE ?? "1.0"),
      // Context length (32k max, 8k minimum recommended)
      contextLength: Number.parseInt(process.env.LLM_CONTEXT_LENGTH ?? "8192", 10),
    },
  },

  // Summarization model (runs on CPU to preserve GPU VRAM)
  summarization: {
    model: process.env.SUMMARIZATION_MODEL ?? "qwen2.5:3b",
    // Force CPU-only for summarization
    options: {
      num_gpu: 0,
    },
    maxTokens: 1024,
    temperature: 0.3, // Lower temp for consistent summaries
  },

  // Valkey Configuration (Conversation Caching)
  valkey: {
    url: process.env.VALKEY_URL ?? "valkey://valkey:6379",
    // Conversation TTL (30 minutes of inactivity)
    conversationTtlMs: Number.parseInt(process.env.VALKEY_CONVERSATION_TTL_MS ?? "1800000", 10),
    // Session prefix for namespacing
    keyPrefix: process.env.VALKEY_KEY_PREFIX ?? "discord-bot:",
  },

  // Qdrant Configuration (Vector Store for Memory)
  qdrant: {
    url: process.env.QDRANT_URL ?? "http://qdrant:6333",
    collectionName: process.env.QDRANT_COLLECTION ?? "memories",
  },

  // Embedding Model Configuration
  embedding: {
    model: process.env.EMBEDDING_MODEL ?? "qwen3-embedding:0.6b",
    // Use CPU for embeddings to preserve GPU VRAM for main LLM
    options: {
      num_gpu: 0,
    },
  },

  // Memory Configuration (Mem0 + Three-tier architecture)
  memory: {
    // Summarization triggers
    summarizeAfterMessages: Number.parseInt(
      process.env.MEMORY_SUMMARIZE_AFTER_MESSAGES ?? "15",
      10
    ),
    summarizeAfterIdleMs: Number.parseInt(
      process.env.MEMORY_SUMMARIZE_AFTER_IDLE_MS ?? "1800000",
      10
    ), // 30 minutes
    // Context window allocation
    maxContextTokens: Number.parseInt(process.env.MEMORY_MAX_CONTEXT_TOKENS ?? "4096", 10),
    // Tier allocation percentages
    tierAllocation: {
      activeContext: 0.5, // 50% for current conversation
      userProfile: 0.3, // 30% for user preferences/facts
      episodic: 0.2, // 20% for relevant past sessions
    },
  },

  // MCP Configuration (Model Context Protocol)
  mcp: {
    // Config file location
    configPath: process.env.MCP_CONFIG_PATH ?? "./mcp-servers.json",
    // Connection timeout
    connectionTimeoutMs: Number.parseInt(process.env.MCP_CONNECTION_TIMEOUT_MS ?? "30000", 10),
    // Request timeout
    requestTimeoutMs: Number.parseInt(process.env.MCP_REQUEST_TIMEOUT_MS ?? "60000", 10),
  },

  // Security Configuration
  security: {
    // Owner user IDs (comma-separated in env)
    ownerIds: (process.env.BOT_OWNER_IDS ?? "").split(",").filter(Boolean),
    adminIds: (process.env.BOT_ADMIN_IDS ?? "").split(",").filter(Boolean),
    moderatorIds: (process.env.BOT_MODERATOR_IDS ?? "").split(",").filter(Boolean),

    // Impersonation detection
    impersonation: {
      enabled: process.env.SECURITY_IMPERSONATION_ENABLED !== "false",
      // Similarity threshold for name matching (0.0-1.0)
      similarityThreshold: Number.parseFloat(process.env.SECURITY_SIMILARITY_THRESHOLD ?? "0.7"),
      // Patterns that indicate impersonation attempts
      suspiciousPatterns: [
        /pretend\s+(to\s+)?be/i,
        /you\s+are\s+(now\s+)?(?:the\s+)?owner/i,
        /ignore\s+(all\s+)?previous/i,
        /new\s+instructions?:/i,
        /\[system\]/i,
        /\[admin\]/i,
        /\[owner\]/i,
        /override\s+permissions?/i,
        /grant\s+(me\s+)?access/i,
      ],
    },

    // Tool access control
    tools: {
      // Always blocked tools (even for owners must use explicit override)
      alwaysBlocked: ["filesystem_delete", "filesystem_write"],
      // Owner-only tools (completely hidden from non-owners)
      ownerOnly: ["filesystem_read", "filesystem_list", "execute_command", "mcp_server_restart"],
      // Admin+ tools
      adminOnly: ["user_ban", "user_kick", "channel_purge"],
      // Moderator+ tools
      moderatorOnly: ["user_timeout", "message_delete"],
    },
  },

  // ComfyUI Configuration (Image Generation)
  comfyui: {
    url: process.env.COMFYUI_URL ?? "http://comfyui:8188",
    // Default workflow for Z-Image-Turbo
    defaultModel: "z-image-turbo",
    // Max queue size to prevent overloading
    maxQueueSize: Number.parseInt(process.env.COMFYUI_MAX_QUEUE ?? "5", 10),
    // Timeout for image generation (ms) - default 2 minutes
    timeout: Number.parseInt(process.env.COMFYUI_TIMEOUT ?? "120000", 10),
  },

  // Rate limiting
  rateLimit: {
    requests: Number.parseInt(process.env.RATE_LIMIT_REQUESTS ?? "10", 10),
    windowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10),
    // Soft limit warnings before hard block
    softLimitThreshold: 0.8, // Warn at 80% of limit
    // Exponential backoff settings
    backoff: {
      enabled: true,
      baseMs: 5000, // Base wait time
      maxMs: 300000, // Max wait time (5 minutes)
      multiplier: 2, // Exponential multiplier
    },
  },

  // Colors for embeds
  colors: {
    primary: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    error: 0xed4245,
    info: 0x5865f2,
  },
} as const;

export default config;
