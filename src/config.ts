/**
 * Bot Configuration
 * Centralized configuration management with Zod validation
 *
 * SECURITY NOTE: HTTP URLs in this file are defaults for Docker internal services
 * (Ollama, ChromaDB, SearXNG, ComfyUI) that communicate over a private Docker network.
 * In production, these services are not exposed to the internet - they're only
 * accessible within the Docker network. HTTPS would require TLS certificates for
 * internal services which adds unnecessary complexity. The security boundary is
 * the Docker network itself, not TLS between containers.
 */

import "dotenv/config";
import { z } from "zod";

// Helper for comma-separated lists
const csv = z
  .string()
  .default("")
  .transform((val) => val.split(",").filter(Boolean));

// Helper for internal service URLs
const internalServiceUrl = (name: string) =>
  z
    .string()
    .url({ message: `Invalid ${name} URL` })
    .refine((url) => {
      try {
        const parsed = new URL(url);
        return ["http:", "https:", "valkey:", "redis:"].includes(parsed.protocol);
      } catch {
        return false;
      }
    }, `Invalid ${name}: protocol must be http, https, valkey, or redis`);

// Define the environment schema
export const envSchema = z.object({
  // Bot Identity
  BOT_NAME: z.string().default("Discord Bot"),

  // Discord Credentials
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DEV_GUILD_ID: z.string().optional(),

  // Testing
  TEST_MODE: z.enum(["true", "false"]).default("false"),
  TEST_WEBHOOK_URL: z.string().optional(),
  TEST_CHANNEL_IDS: csv,
  TEST_VERBOSE_LOGGING: z.enum(["true", "false"]).default("false"),

  // Environment
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // LLM Configuration
  OLLAMA_HOST: internalServiceUrl("OLLAMA_HOST").default("http://ollama:11434"), // NOSONAR - Docker internal service
  LLM_MODEL: z
    .string()
    .default("hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1"),
  LLM_FALLBACK_MODEL: z.string().default("qwen2.5:7b"),
  LLM_MAX_TOKENS: z.coerce.number().int().min(1).default(4096),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  LLM_REQUEST_TIMEOUT: z.coerce.number().int().min(1000).default(300000), // 5 mins
  LLM_KEEP_ALIVE: z.string().default("300"), // String because it can be "-1"
  LLM_PRELOAD: z.enum(["true", "false"]).default("true"),
  LLM_SLEEP_AFTER_MS: z.coerce.number().int().min(1000).default(300000),
  LLM_USE_ORCHESTRATOR: z.enum(["true", "false"]).default("true"),

  // Heretic Specifics
  LLM_NUM_EXPERTS: z.coerce.number().int().min(1).default(5),
  LLM_REP_PEN: z.coerce.number().min(1).max(2).default(1.1),
  LLM_TEMP_CODING: z.coerce.number().min(0).max(2).default(0.6),
  LLM_TEMP_CREATIVE: z.coerce.number().min(0).max(2).default(1.0),
  LLM_CONTEXT_LENGTH: z.coerce.number().int().min(1024).default(65536),

  // LLM Performance
  LLM_NUM_BATCH: z.coerce.number().int().min(1).default(1024),
  LLM_NUM_THREAD: z.coerce.number().int().min(0).default(0),
  LLM_FLASH_ATTENTION: z.enum(["true", "false"]).default("true"),
  LLM_MMAP: z.enum(["true", "false"]).default("true"),
  LLM_MLOCK: z.enum(["true", "false"]).default("false"),

  // Cloudflare
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ROUTER_MODEL: z.string().default("@cf/ibm-granite/granite-4.0-h-micro"),
  CLOUDFLARE_EMBEDDING_MODEL: z.string().default("@cf/qwen/qwen3-embedding-0.6b"),
  CLOUDFLARE_WORKER_URL: z.string().optional(),
  CLOUDFLARE_WORKER_SECRET: z.string().optional(),

  // Summarization
  SUMMARIZATION_MODEL: z.string().default("qwen2.5:3b"),

  // Valkey
  VALKEY_URL: internalServiceUrl("VALKEY_URL").default("valkey://localhost:6379"),
  VALKEY_CONVERSATION_TTL_MS: z.coerce.number().int().min(60000).default(1800000),
  VALKEY_KEY_PREFIX: z.string().default("discord-bot:"),

  // ChromaDB
  CHROMA_URL: internalServiceUrl("CHROMA_URL").default("http://chromadb:8000"), // NOSONAR - Docker internal service
  CHROMA_COLLECTION: z.string().default("memories"),

  // Embedding
  EMBEDDING_MODEL: z.string().default("qwen3-embedding:0.6b"),

  // Memory System
  MEMORY_ENABLED: z.enum(["true", "false"]).default("true"),
  MEMORY_SUMMARIZE_AFTER_MESSAGES: z.coerce.number().int().min(1).default(15),
  MEMORY_SUMMARIZE_AFTER_IDLE_MS: z.coerce.number().int().min(60000).default(1800000),
  MEMORY_MAX_CONTEXT_TOKENS: z.coerce.number().int().min(1024).default(4096),
  MEMORY_CHARS_PER_TOKEN: z.coerce.number().min(1).max(10).default(4),
  MEMORY_PROFILE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.4),
  MEMORY_EPISODIC_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  MEMORY_TIME_DECAY_PER_DAY: z.coerce.number().min(0.5).max(1).default(0.98),
  MEMORY_STRENGTH_DECAY_DAYS: z.coerce.number().int().min(1).default(30),
  MEMORY_CONSOLIDATION_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.85),
  MEMORY_MIN_IMPORTANCE: z.coerce.number().min(0).max(1).default(0.3),

  // MCP
  MCP_CONFIG_PATH: z.string().default("./mcp-servers.json"),
  MCP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  MCP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),

  // Docker MCP Gateway
  DOCKER_MCP_ENABLED: z.enum(["true", "false"]).default("false"),
  DOCKER_MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  DOCKER_MCP_GATEWAY_URL: internalServiceUrl("DOCKER_MCP_GATEWAY_URL").default(
    "http://host.docker.internal:8811"
  ),
  DOCKER_MCP_GATEWAY_ENDPOINT: z.string().default("/mcp"),
  DOCKER_MCP_BEARER_TOKEN: z.string().optional(),
  DOCKER_MCP_AUTO_RECONNECT: z.enum(["true", "false"]).default("true"),
  DOCKER_MCP_MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().min(0).default(5),

  // Security
  BOT_OWNER_IDS: csv,
  BOT_ADMIN_IDS: csv,
  BOT_MODERATOR_IDS: csv,
  SECURITY_IMPERSONATION_ENABLED: z.enum(["true", "false"]).default("true"),
  SECURITY_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  SECURITY_REDACT_OUTPUT_PII: z.enum(["true", "false"]).default("true"),
  SECURITY_FILTER_OUTPUT_INJECTIONS: z.enum(["true", "false"]).default("true"),
  SECURITY_VALIDATE_PROMPTS: z.enum(["true", "false"]).default("true"),
  SECURITY_SYSTEM_PROMPT_PREAMBLE: z.enum(["true", "false"]).default("true"),

  // SearXNG
  SEARXNG_URL: internalServiceUrl("SEARXNG_URL").default("http://searxng:8080"), // NOSONAR - Docker internal service
  SEARXNG_TIMEOUT: z.coerce.number().int().min(1000).default(30000),

  // ComfyUI
  IMAGE_GENERATION_ENABLED: z.enum(["true", "false"]).default("true"),
  COMFYUI_URL: internalServiceUrl("COMFYUI_URL").default("http://comfyui:8188"), // NOSONAR - Docker internal service
  COMFYUI_MAX_QUEUE: z.coerce.number().int().min(1).default(5),
  COMFYUI_TIMEOUT: z.coerce.number().int().min(1000).default(120000),
  COMFYUI_SLEEP_AFTER_MS: z.coerce.number().int().min(1000).default(300000),
  COMFYUI_UNLOAD_ON_SLEEP: z.enum(["true", "false"]).default("true"),

  // GPU
  GPU_TOTAL_VRAM_MB: z.coerce.number().int().min(1024).default(24576),
  GPU_MIN_FREE_MB: z.coerce.number().int().min(256).default(2560),
  GPU_WARNING_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  GPU_CRITICAL_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
  GPU_LLM_VRAM_MB: z.coerce.number().int().min(1024).default(14000),
  GPU_IMAGE_VRAM_MB: z.coerce.number().int().min(1024).default(8000),
  GPU_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  GPU_AUTO_UNLOAD_FOR_IMAGES: z.enum(["true", "false"]).default("true"),

  // Rate Limit
  RATE_LIMIT_REQUESTS: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),

  // Health Monitor
  HEALTH_MONITOR_INTERVAL_MS: z.coerce.number().int().min(1000).default(30000),
  HEALTH_MONITOR_ALERT_THRESHOLD_MS: z.coerce.number().int().min(1000).default(300000),
});

// Parse the environment
// safeParse is used so we can format errors nicely if needed, but for now we throw if invalid
const _env = envSchema.parse(process.env);

// Export the config object structure matching the original interface
export const config = {
  bot: {
    name: _env.BOT_NAME,
    prefix: "!",
  },
  discord: {
    token: _env.DISCORD_TOKEN,
    clientId: _env.DISCORD_CLIENT_ID,
    devGuildId: _env.DEV_GUILD_ID ?? "",
  },
  testing: {
    enabled: _env.TEST_MODE === "true",
    webhookUrl: _env.TEST_WEBHOOK_URL ?? "",
    alwaysRespondChannelIds: _env.TEST_CHANNEL_IDS,
    verboseLogging: _env.TEST_VERBOSE_LOGGING === "true" || _env.TEST_MODE === "true",
  },
  env: {
    isProduction: _env.NODE_ENV === "production",
    isDevelopment: _env.NODE_ENV === "development",
  },
  llm: {
    apiUrl: _env.OLLAMA_HOST,
    model: _env.LLM_MODEL,
    fallbackModel: _env.LLM_FALLBACK_MODEL,
    maxTokens: _env.LLM_MAX_TOKENS,
    temperature: _env.LLM_TEMPERATURE,
    requestTimeout: _env.LLM_REQUEST_TIMEOUT,
    keepAlive: (() => {
      const val = _env.LLM_KEEP_ALIVE;
      if (val === "-1") return -1;
      const parsed = Number.parseInt(val, 10);
      return Number.isNaN(parsed) || parsed < 1 ? 300 : parsed;
    })(),
    preloadOnStartup: _env.LLM_PRELOAD === "true",
    sleepAfterMs: _env.LLM_SLEEP_AFTER_MS,
    useOrchestrator: _env.LLM_USE_ORCHESTRATOR === "true",
    heretic: {
      numExperts: _env.LLM_NUM_EXPERTS,
      repPen: _env.LLM_REP_PEN,
      tempCoding: _env.LLM_TEMP_CODING,
      tempCreative: _env.LLM_TEMP_CREATIVE,
      contextLength: _env.LLM_CONTEXT_LENGTH,
    },
    performance: {
      numBatch: _env.LLM_NUM_BATCH,
      numThread: _env.LLM_NUM_THREAD,
      flashAttention: _env.LLM_FLASH_ATTENTION === "true",
      mmap: _env.LLM_MMAP === "true",
      mlock: _env.LLM_MLOCK === "true",
    },
  },
  cloudflare: {
    accountId: _env.CLOUDFLARE_ACCOUNT_ID ?? "",
    apiToken: _env.CLOUDFLARE_API_TOKEN ?? "",
    get isConfigured(): boolean {
      return Boolean(this.accountId && this.apiToken);
    },
    routerModel: _env.CLOUDFLARE_ROUTER_MODEL,
    embeddingModel: _env.CLOUDFLARE_EMBEDDING_MODEL,
    worker: {
      url: _env.CLOUDFLARE_WORKER_URL ?? "",
      secret: _env.CLOUDFLARE_WORKER_SECRET ?? "",
      get isConfigured(): boolean {
        return Boolean(this.url);
      },
    },
  },
  summarization: {
    model: _env.SUMMARIZATION_MODEL,
    options: {
      num_gpu: 0,
    },
    maxTokens: 1024,
    temperature: 0.3,
  },
  valkey: {
    url: _env.VALKEY_URL,
    conversationTtlMs: _env.VALKEY_CONVERSATION_TTL_MS,
    keyPrefix: _env.VALKEY_KEY_PREFIX,
  },
  chroma: {
    url: _env.CHROMA_URL,
    collectionName: _env.CHROMA_COLLECTION,
  },
  embedding: {
    model: _env.EMBEDDING_MODEL,
    options: {
      num_gpu: 0,
    },
  },
  memory: {
    enabled: _env.MEMORY_ENABLED === "true",
    summarizeAfterMessages: _env.MEMORY_SUMMARIZE_AFTER_MESSAGES,
    summarizeAfterIdleMs: _env.MEMORY_SUMMARIZE_AFTER_IDLE_MS,
    maxContextTokens: _env.MEMORY_MAX_CONTEXT_TOKENS,
    charsPerToken: _env.MEMORY_CHARS_PER_TOKEN,
    tierAllocation: {
      activeContext: 0.5,
      userProfile: 0.3,
      episodic: 0.2,
    },
    relevanceThresholds: {
      userProfile: _env.MEMORY_PROFILE_THRESHOLD,
      episodic: _env.MEMORY_EPISODIC_THRESHOLD,
    },
    timeDecayPerDay: _env.MEMORY_TIME_DECAY_PER_DAY,
    strengthDecayDays: _env.MEMORY_STRENGTH_DECAY_DAYS,
    consolidationThreshold: _env.MEMORY_CONSOLIDATION_THRESHOLD,
    minImportanceForStorage: _env.MEMORY_MIN_IMPORTANCE,
  },
  mcp: {
    configPath: _env.MCP_CONFIG_PATH,
    connectionTimeoutMs: _env.MCP_CONNECTION_TIMEOUT_MS,
    requestTimeoutMs: _env.MCP_REQUEST_TIMEOUT_MS,
    dockerGateway: {
      enabled: _env.DOCKER_MCP_ENABLED === "true",
      transport: _env.DOCKER_MCP_TRANSPORT,
      url: _env.DOCKER_MCP_GATEWAY_URL,
      endpoint: _env.DOCKER_MCP_GATEWAY_ENDPOINT,
      bearerToken: _env.DOCKER_MCP_BEARER_TOKEN ?? "",
      autoReconnect: _env.DOCKER_MCP_AUTO_RECONNECT === "true",
      maxReconnectAttempts: _env.DOCKER_MCP_MAX_RECONNECT_ATTEMPTS,
    },
  },
  security: {
    ownerIds: _env.BOT_OWNER_IDS,
    adminIds: _env.BOT_ADMIN_IDS,
    moderatorIds: _env.BOT_MODERATOR_IDS,
    impersonation: {
      enabled: _env.SECURITY_IMPERSONATION_ENABLED === "true",
      similarityThreshold: _env.SECURITY_SIMILARITY_THRESHOLD,
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
    tools: {
      alwaysBlocked: ["filesystem_delete", "filesystem_write"],
      ownerOnly: ["filesystem_read", "filesystem_list", "execute_command", "mcp_server_restart"],
      adminOnly: ["user_ban", "user_kick", "channel_purge"],
      moderatorOnly: ["user_timeout", "message_delete"],
    },
    output: {
      redactPII: _env.SECURITY_REDACT_OUTPUT_PII === "true",
      filterInjectionPatterns: _env.SECURITY_FILTER_OUTPUT_INJECTIONS === "true",
    },
    input: {
      validatePrompts: _env.SECURITY_VALIDATE_PROMPTS === "true",
    },
    systemPrompt: {
      includeSecurityPreamble: _env.SECURITY_SYSTEM_PROMPT_PREAMBLE === "true",
    },
  },
  searxng: {
    url: _env.SEARXNG_URL,
    defaultResults: 10,
    timeout: _env.SEARXNG_TIMEOUT,
  },
  comfyui: {
    enabled: _env.IMAGE_GENERATION_ENABLED === "true",
    url: _env.COMFYUI_URL,
    defaultModel: "z-image-turbo",
    maxQueueSize: _env.COMFYUI_MAX_QUEUE,
    timeout: _env.COMFYUI_TIMEOUT,
    sleepAfterMs: _env.COMFYUI_SLEEP_AFTER_MS,
    unloadOnSleep: _env.COMFYUI_UNLOAD_ON_SLEEP === "true",
  },
  gpu: {
    totalVRAM: _env.GPU_TOTAL_VRAM_MB,
    minFreeBuffer: _env.GPU_MIN_FREE_MB,
    warningThreshold: _env.GPU_WARNING_THRESHOLD,
    criticalThreshold: _env.GPU_CRITICAL_THRESHOLD,
    estimatedLLMVRAM: _env.GPU_LLM_VRAM_MB,
    estimatedImageVRAM: _env.GPU_IMAGE_VRAM_MB,
    pollInterval: _env.GPU_POLL_INTERVAL_MS,
    autoUnloadForImages: _env.GPU_AUTO_UNLOAD_FOR_IMAGES === "true",
  },
  rateLimit: {
    requests: _env.RATE_LIMIT_REQUESTS,
    windowMs: _env.RATE_LIMIT_WINDOW_MS,
    softLimitThreshold: 0.8,
    backoff: {
      enabled: true,
      baseMs: 5000,
      maxMs: 300000,
      multiplier: 2,
    },
  },
  healthMonitor: {
    checkIntervalMs: _env.HEALTH_MONITOR_INTERVAL_MS,
    alertThresholdMs: _env.HEALTH_MONITOR_ALERT_THRESHOLD_MS,
  },
  colors: {
    primary: 0x5865f2,
    success: 0x57f287,
    warning: 0xfee75c,
    error: 0xed4245,
    info: 0x5865f2,
  },
} as const;

export default config;
