import "reflect-metadata";
// CRITICAL: Import dotenv/config FIRST to load env vars before any other imports
import "dotenv/config";

import { dirname, importx } from "@discordx/importer";
import { IntentsBitField, Options, Partials } from "discord.js";
import { Client } from "discordx";
import { getConversationService } from "./ai/conversation.js";
import { getAIService } from "./ai/service.js";
// ReadyEvent is loaded dynamically via importx - do NOT import here to avoid circular dependency
import config from "./config.js";
import { CLEANUP_INTERVAL_MS } from "./constants.js";
import { cleanupMessageDeduplication } from "./events/message.js";
import { NotBot } from "./guards/index.js";
import { cleanupRateLimitGuard } from "./guards/rate-limit.guard.js";
import { mcpManager } from "./mcp/index.js";
import { getNotificationService, startHealthMonitor, stopHealthMonitor } from "./services/index.js";
import { startMaintenanceScheduler, stopMaintenanceScheduler } from "./services/maintenance.js";
import { getSchedulerService } from "./services/scheduler.js";
import { abortAllPendingRequests } from "./utils/fetch.js";
import { waitForServices } from "./utils/health.js";
import { createLogger } from "./utils/logger.js";
import { startMemoryMonitor, stopMemoryMonitor } from "./utils/memory.js";
import { startPresenceUpdater, stopPresenceUpdater } from "./utils/presence.js";
import { getRateLimiter } from "./utils/rate-limiter.js";
import { getVRAMManager } from "./utils/vram/index.js";

// Create logger for main module
const log = createLogger("Main");

// Validate required configuration
if (!config.discord.token || !config.discord.clientId) {
  log.error("Missing required configuration: DISCORD_TOKEN or DISCORD_CLIENT_ID");
  process.exit(1);
}

// Validate owner/admin/moderator IDs are valid Discord snowflakes
function validateDiscordId(id: string, _type: string): boolean {
  return /^\d{17,19}$/.test(id);
}

for (const id of config.security.ownerIds) {
  if (!validateDiscordId(id, "owner")) {
    log.error(`Invalid owner ID format: ${id} (must be 17-19 digit Discord snowflake)`);
    process.exit(1);
  }
}

for (const id of config.security.adminIds) {
  if (!validateDiscordId(id, "admin")) {
    log.error(`Invalid admin ID format: ${id} (must be 17-19 digit Discord snowflake)`);
    process.exit(1);
  }
}

for (const id of config.security.moderatorIds) {
  if (!validateDiscordId(id, "moderator")) {
    log.error(`Invalid moderator ID format: ${id} (must be 17-19 digit Discord snowflake)`);
    process.exit(1);
  }
}

// Store interval references for cleanup
let cleanupIntervalId: NodeJS.Timeout | null = null;

// Global error handlers to prevent silent crashes
process.on("unhandledRejection", (reason, promise) => {
  log.error(
    `Unhandled Rejection at: ${promise}, reason: ${reason}`,
    reason instanceof Error ? reason : undefined
  );
});

process.on("uncaughtException", (error) => {
  log.error("Uncaught Exception:", error);
  // Give time for logs to flush before exiting
  setTimeout(() => process.exit(1), 1000);
});

export const client = new Client({
  // Bot ID for multi-bot support
  botId: "primary",

  // Discord intents - request only what you need
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessageReactions,
    IntentsBitField.Flags.DirectMessages,
    IntentsBitField.Flags.MessageContent,
  ],

  // Partials for handling uncached data (reactions, DMs)
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],

  // Cache optimization - limit memory usage
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    // Limit message cache per channel
    MessageManager: 100,
    // Disable reaction caching (we use partials)
    ReactionManager: 0,
    // Limit member cache per guild
    GuildMemberManager: {
      maxSize: 200,
      keepOverLimit: (member) => member.id === member.client.user?.id,
    },
  }),

  // Sweeper configuration - periodically clean old data
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: {
      interval: 3600, // Every hour
      lifetime: 1800, // Remove messages older than 30 minutes
    },
  },

  // Disable logging in production
  silent: config.env.isProduction,

  // Simple command configuration (prefix-based commands)
  simpleCommand: {
    prefix: "!",
  },

  // Global guards applied to all commands/events
  guards: [NotBot],
});

async function bootstrap(): Promise<void> {
  // Check service health before starting
  const servicesHealthy = await waitForServices();
  if (!servicesHealthy) {
    log.error("Required services are not healthy. Exiting.");
    process.exit(1);
  }

  // Import all commands, events, and components
  // Use .js extension only - TypeScript compiles to .js, and .d.ts should be excluded
  const extension = config.env.isProduction ? "js" : "{ts,js}";
  log.info(`Loading modules with extension: ${extension}`);
  await importx(
    `${dirname(import.meta.url)}/{commands,events,components,guards}/**/*.${extension}`
  );
  log.info("Modules loaded successfully");

  // Login to Discord
  const token = config.discord.token;
  if (!token) {
    throw new Error("DISCORD_TOKEN is not defined in config");
  }

  log.info("Logging in to Discord...");

  await client.login(token);
  log.info("Discord login successful");

  // Initialize Scheduler Service
  const schedulerService = getSchedulerService();
  schedulerService.setClient(client);
  log.info("Scheduler service initialized");

  // Initialize MCP servers for tool integration
  if (config.llm.useOrchestrator) {
    mcpManager.initialize().catch((error) => {
      log.warn(
        "MCP initialization failed - tools may be limited",
        error instanceof Error ? error : undefined
      );
    });
  }

  // Preload the LLM model into GPU memory for faster first response
  if (config.llm.preloadOnStartup) {
    const aiService = getAIService();
    // Don't await - let it load in background while bot starts up
    aiService.preloadModel().catch((error) => {
      log.warn("Model preload failed", error instanceof Error ? error : undefined);
    });
  }

  // Start presence updater after login
  startPresenceUpdater(client);

  // Start memory monitoring (every 60 seconds)
  startMemoryMonitor(60000);

  // Start periodic cleanup for conversations and rate limiter (every 5 minutes)
  cleanupIntervalId = setInterval(() => {
    const conversationService = getConversationService();
    const rateLimiter = getRateLimiter();

    const conversationsCleared = conversationService.cleanupExpiredConversations();
    rateLimiter.cleanup();

    if (conversationsCleared > 0) {
      log.debug(`Cleared ${conversationsCleared} expired conversations`);
    }
  }, CLEANUP_INTERVAL_MS);

  // Start maintenance scheduler (runs every 12 hours for deep cleanup)
  startMaintenanceScheduler();

  // Initialize notification service with Discord client
  const notificationService = getNotificationService();
  notificationService.setClient(client);
  log.info("Notification service initialized");

  // Start health monitor for self-healing infrastructure
  startHealthMonitor();
  log.info("Health monitor started");
}

/**
 * Graceful shutdown handler
 * Cleans up resources before exiting
 */
async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal}, shutting down gracefully...`);

  try {
    // Clear cleanup interval
    if (cleanupIntervalId) {
      clearInterval(cleanupIntervalId);
      cleanupIntervalId = null;
      log.debug("Cleanup interval cleared");
    }

    // Stop memory monitoring
    stopMemoryMonitor();

    // Stop health monitor
    stopHealthMonitor();
    log.debug("Health monitor stopped");

    // Stop maintenance scheduler
    stopMaintenanceScheduler();

    // Stop presence updater
    stopPresenceUpdater();
    log.debug("Presence updater stopped");

    // Abort any pending HTTP requests
    abortAllPendingRequests();

    // Disconnect MCP servers
    await mcpManager.shutdown();
    log.debug("MCP servers disconnected");

    // Dispose AI service resources
    const aiService = getAIService();
    aiService.dispose();
    log.debug("AI service disposed");

    // Dispose VRAM manager
    const vramManager = getVRAMManager();
    vramManager.dispose();
    log.debug("VRAM manager disposed");

    // Destroy Discord client connection
    client.destroy();
    log.info("Discord client disconnected");

    // Clean up caches
    const conversationService = getConversationService();
    const rateLimiter = getRateLimiter();
    conversationService.cleanupExpiredConversations();
    rateLimiter.cleanup();
    log.info("Caches cleaned up");

    // Clean up cache manager (Valkey/in-memory)
    const { cacheManager } = await import("./utils/cache.js");
    await cacheManager.shutdown();
    log.debug("Cache manager shut down");

    // Clean up distributed lock manager
    const { lockManager } = await import("./utils/distributed-lock.js");
    await lockManager.shutdown();
    log.debug("Distributed lock manager shut down");

    // Clean up rate limit guard interval
    cleanupRateLimitGuard();
    log.debug("Rate limit guard cleaned up");

    // Clean up message deduplication
    cleanupMessageDeduplication();
    log.debug("Message deduplication cleaned up");

    // Shutdown Scheduler Service
    await getSchedulerService().close();
    log.debug("Scheduler service shut down");

    log.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    log.error("Error during shutdown", error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

try {
  await bootstrap();
} catch (error) {
  log.error("Failed to start bot", error instanceof Error ? error : undefined);
  process.exit(1);
}
