/**
 * Bot Configuration
 * Centralized configuration management
 */

/**
 * Validate and parse a positive integer from environment variable
 * @throws Error if value is invalid
 */
function validatePositiveInt(
  value: string | undefined,
  defaultValue: string,
  name: string,
  min = 1
): number {
  const parsed = Number.parseInt(value ?? defaultValue, 10);
  if (Number.isNaN(parsed) || parsed < min) {
    throw new Error(`Invalid ${name}: "${value ?? defaultValue}" must be a number >= ${min}`);
  }
  return parsed;
}

/**
 * Validate and parse a float from environment variable
 * @throws Error if value is invalid
 */
function validateFloat(
  value: string | undefined,
  defaultValue: string,
  name: string,
  min?: number,
  max?: number
): number {
  const parsed = Number.parseFloat(value ?? defaultValue);
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Invalid ${name}: "${value ?? defaultValue}" must be a number`);
  }
  if (min !== undefined && parsed < min) {
    throw new RangeError(`Invalid ${name}: must be >= ${min}`);
  }
  if (max !== undefined && parsed > max) {
    throw new RangeError(`Invalid ${name}: must be <= ${max}`);
  }
  return parsed;
}

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

  // Testing configuration
  testing: {
    // Master switch for test mode (enables test channels and verbose logging)
    enabled: process.env.TEST_MODE === "true",
    // Webhook URL for sending automated test messages
    webhookUrl: process.env.TEST_WEBHOOK_URL ?? "",
    // Channels where bot responds to ALL messages (for automated testing)
    // Set via TEST_CHANNEL_IDS env var (comma-separated) or defaults to empty
    alwaysRespondChannelIds: (process.env.TEST_CHANNEL_IDS ?? "").split(",").filter(Boolean),
    // Enable verbose logging for test channels
    verboseLogging: process.env.TEST_VERBOSE_LOGGING === "true" || process.env.TEST_MODE === "true",
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
    // Fallback model for when VRAM is constrained (smaller, can fit in limited RAM)
    fallbackModel: process.env.LLM_FALLBACK_MODEL ?? "qwen2.5:7b",
    maxTokens: validatePositiveInt(process.env.LLM_MAX_TOKENS, "4096", "LLM_MAX_TOKENS", 1),
    temperature: validateFloat(process.env.LLM_TEMPERATURE, "0.7", "LLM_TEMPERATURE", 0, 2),
    // Request timeout in ms (default 5 minutes)
    requestTimeout: validatePositiveInt(
      process.env.LLM_REQUEST_TIMEOUT,
      "300000",
      "LLM_REQUEST_TIMEOUT",
      1000
    ),
    // Keep model loaded in GPU memory (seconds, -1 = forever)
    // Using 300 (5 minutes) to balance response time and GPU memory
    keepAlive: (() => {
      const value = process.env.LLM_KEEP_ALIVE ?? "300";
      if (value === "-1") return -1;
      return validatePositiveInt(value, "300", "LLM_KEEP_ALIVE", 1);
    })(),
    // Preload model on startup for faster first response
    preloadOnStartup: process.env.LLM_PRELOAD !== "false",
    // Inactivity timeout before sleeping (ms) - default 5 minutes
    sleepAfterMs: validatePositiveInt(
      process.env.LLM_SLEEP_AFTER_MS,
      "300000",
      "LLM_SLEEP_AFTER_MS",
      1000
    ),
    // Use Orchestrator for enhanced tool-aware conversations
    useOrchestrator: process.env.LLM_USE_ORCHESTRATOR !== "false",
    // HERETIC-specific settings for optimal performance
    heretic: {
      // Recommended experts for MoE model (4-6)
      numExperts: validatePositiveInt(process.env.LLM_NUM_EXPERTS, "5", "LLM_NUM_EXPERTS", 1),
      // Repetition penalty (1.0-1.1 recommended)
      repPen: validateFloat(process.env.LLM_REP_PEN, "1.1", "LLM_REP_PEN", 1, 2),
      // Temperature for coding (0.6) vs creative (1.0-1.2)
      tempCoding: validateFloat(process.env.LLM_TEMP_CODING, "0.6", "LLM_TEMP_CODING", 0, 2),
      tempCreative: validateFloat(process.env.LLM_TEMP_CREATIVE, "1.0", "LLM_TEMP_CREATIVE", 0, 2),
      // Context length (32k max, 8k minimum recommended)
      contextLength: validatePositiveInt(
        process.env.LLM_CONTEXT_LENGTH,
        "4096",
        "LLM_CONTEXT_LENGTH",
        1024
      ),
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
    conversationTtlMs: validatePositiveInt(
      process.env.VALKEY_CONVERSATION_TTL_MS,
      "1800000",
      "VALKEY_CONVERSATION_TTL_MS",
      60000
    ),
    // Session prefix for namespacing
    keyPrefix: process.env.VALKEY_KEY_PREFIX ?? "discord-bot:",
  },

  // ChromaDB Configuration (Vector Store for Memory)
  chroma: {
    url: process.env.CHROMA_URL ?? "http://chromadb:8000",
    collectionName: process.env.CHROMA_COLLECTION ?? "memories",
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
    // Master switch for memory system
    enabled: process.env.MEMORY_ENABLED !== "false",
    // Summarization triggers
    summarizeAfterMessages: validatePositiveInt(
      process.env.MEMORY_SUMMARIZE_AFTER_MESSAGES,
      "15",
      "MEMORY_SUMMARIZE_AFTER_MESSAGES",
      1
    ),
    summarizeAfterIdleMs: validatePositiveInt(
      process.env.MEMORY_SUMMARIZE_AFTER_IDLE_MS,
      "1800000",
      "MEMORY_SUMMARIZE_AFTER_IDLE_MS",
      60000
    ), // 30 minutes
    // Context window allocation
    maxContextTokens: validatePositiveInt(
      process.env.MEMORY_MAX_CONTEXT_TOKENS,
      "4096",
      "MEMORY_MAX_CONTEXT_TOKENS",
      1024
    ),
    // Tier allocation percentages
    tierAllocation: {
      activeContext: 0.5, // 50% for current conversation
      userProfile: 0.3, // 30% for user preferences/facts
      episodic: 0.2, // 20% for relevant past sessions
    },
    // Relevance thresholds - memories below these scores are filtered out
    relevanceThresholds: {
      userProfile: validateFloat(
        process.env.MEMORY_PROFILE_THRESHOLD,
        "0.4",
        "MEMORY_PROFILE_THRESHOLD",
        0,
        1
      ), // User preferences/facts need moderate relevance
      episodic: validateFloat(
        process.env.MEMORY_EPISODIC_THRESHOLD,
        "0.55",
        "MEMORY_EPISODIC_THRESHOLD",
        0,
        1
      ), // Past conversations need higher relevance to avoid pollution
    },
    // Time decay - older memories are weighted less (multiplier per day old)
    timeDecayPerDay: validateFloat(
      process.env.MEMORY_TIME_DECAY_PER_DAY,
      "0.98",
      "MEMORY_TIME_DECAY_PER_DAY",
      0.5,
      1
    ), // 2% decay per day, so 30-day old memory = 0.98^30 ≈ 0.55 multiplier
    // Minimum importance score for memories to be stored (0-1)
    minImportanceForStorage: validateFloat(
      process.env.MEMORY_MIN_IMPORTANCE,
      "0.3",
      "MEMORY_MIN_IMPORTANCE",
      0,
      1
    ),
  },

  // MCP Configuration (Model Context Protocol)
  mcp: {
    // Config file location for stdio-based MCP servers
    configPath: process.env.MCP_CONFIG_PATH ?? "./mcp-servers.json",
    // Connection timeout
    connectionTimeoutMs: validatePositiveInt(
      process.env.MCP_CONNECTION_TIMEOUT_MS,
      "30000",
      "MCP_CONNECTION_TIMEOUT_MS",
      1000
    ),
    // Request timeout
    requestTimeoutMs: validatePositiveInt(
      process.env.MCP_REQUEST_TIMEOUT_MS,
      "60000",
      "MCP_REQUEST_TIMEOUT_MS",
      1000
    ),
    // Docker MCP Gateway (Docker Desktop MCP Toolkit)
    dockerGateway: {
      // Enable Docker MCP Gateway integration
      enabled: process.env.DOCKER_MCP_ENABLED === "true",
      // Transport type: "stdio" (recommended, spawns gateway process) or "http" (StreamableHTTP)
      // stdio: More stable, spawns `docker mcp gateway run` as child process
      // http: Connects to externally running gateway via StreamableHTTP transport
      transport: (process.env.DOCKER_MCP_TRANSPORT ?? "stdio") as "stdio" | "http",
      // Gateway URL (only used for HTTP transport)
      // Default: http://host.docker.internal:8811 for Docker Desktop
      url: process.env.DOCKER_MCP_GATEWAY_URL ?? "http://host.docker.internal:8811",
      // MCP endpoint path (only used for HTTP transport)
      endpoint: process.env.DOCKER_MCP_GATEWAY_ENDPOINT ?? "/mcp",
      // Bearer token for authentication (used for HTTP transport)
      bearerToken: process.env.DOCKER_MCP_BEARER_TOKEN ?? "",
      // Reconnect on failure
      autoReconnect: process.env.DOCKER_MCP_AUTO_RECONNECT !== "false",
      // Max reconnection attempts
      maxReconnectAttempts: validatePositiveInt(
        process.env.DOCKER_MCP_MAX_RECONNECT_ATTEMPTS,
        "5",
        "DOCKER_MCP_MAX_RECONNECT_ATTEMPTS",
        0
      ),
    },
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
      similarityThreshold: validateFloat(
        process.env.SECURITY_SIMILARITY_THRESHOLD,
        "0.7",
        "SECURITY_SIMILARITY_THRESHOLD",
        0,
        1
      ),
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

  // SearXNG Configuration (Web Search)
  searxng: {
    url: process.env.SEARXNG_URL ?? "http://searxng:8080",
    // Default number of results to return
    defaultResults: 10,
    // Timeout for search requests (ms)
    timeout: validatePositiveInt(process.env.SEARXNG_TIMEOUT, "30000", "SEARXNG_TIMEOUT", 1000),
  },

  // ComfyUI Configuration (Image Generation)
  comfyui: {
    url: process.env.COMFYUI_URL ?? "http://comfyui:8188",
    // Default workflow for Z-Image-Turbo
    defaultModel: "z-image-turbo",
    // Max queue size to prevent overloading
    maxQueueSize: validatePositiveInt(process.env.COMFYUI_MAX_QUEUE, "5", "COMFYUI_MAX_QUEUE", 1),
    // Timeout for image generation (ms) - default 2 minutes
    timeout: validatePositiveInt(process.env.COMFYUI_TIMEOUT, "120000", "COMFYUI_TIMEOUT", 1000),
    // Inactivity timeout before unloading models (ms) - default 5 minutes (matches LLM)
    sleepAfterMs: validatePositiveInt(
      process.env.COMFYUI_SLEEP_AFTER_MS,
      "300000",
      "COMFYUI_SLEEP_AFTER_MS",
      1000
    ),
    // Whether to unload models when sleeping (calls /free endpoint)
    unloadOnSleep: process.env.COMFYUI_UNLOAD_ON_SLEEP !== "false",
  },

  // GPU/VRAM Configuration
  gpu: {
    // Total VRAM available (MB) - RTX 4090 = 24576, RTX 4080 = 16384, etc.
    totalVRAM: validatePositiveInt(
      process.env.GPU_TOTAL_VRAM_MB,
      "24576",
      "GPU_TOTAL_VRAM_MB",
      1024
    ),
    // Minimum free VRAM buffer to maintain (MB)
    minFreeBuffer: validatePositiveInt(process.env.GPU_MIN_FREE_MB, "2048", "GPU_MIN_FREE_MB", 256),
    // VRAM usage thresholds
    warningThreshold: validateFloat(
      process.env.GPU_WARNING_THRESHOLD,
      "0.75",
      "GPU_WARNING_THRESHOLD",
      0,
      1
    ),
    criticalThreshold: validateFloat(
      process.env.GPU_CRITICAL_THRESHOLD,
      "0.90",
      "GPU_CRITICAL_THRESHOLD",
      0,
      1
    ),
    // Estimated VRAM usage per task (MB)
    estimatedLLMVRAM: validatePositiveInt(
      process.env.GPU_LLM_VRAM_MB,
      "14000",
      "GPU_LLM_VRAM_MB",
      1024
    ),
    estimatedImageVRAM: validatePositiveInt(
      process.env.GPU_IMAGE_VRAM_MB,
      "8000",
      "GPU_IMAGE_VRAM_MB",
      1024
    ),
    // VRAM monitoring interval (ms)
    pollInterval: validatePositiveInt(
      process.env.GPU_POLL_INTERVAL_MS,
      "5000",
      "GPU_POLL_INTERVAL_MS",
      1000
    ),
    // Auto-unload LLM for image generation if VRAM is tight
    autoUnloadForImages: process.env.GPU_AUTO_UNLOAD_FOR_IMAGES !== "false",
  },

  // Rate limiting
  rateLimit: {
    requests: validatePositiveInt(process.env.RATE_LIMIT_REQUESTS, "10", "RATE_LIMIT_REQUESTS", 1),
    windowMs: validatePositiveInt(
      process.env.RATE_LIMIT_WINDOW_MS,
      "60000",
      "RATE_LIMIT_WINDOW_MS",
      1000
    ),
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
