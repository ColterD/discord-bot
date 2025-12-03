import "reflect-metadata";
import { dirname, importx } from "@discordx/importer";
import { IntentsBitField, Options, Partials } from "discord.js";
import { Client } from "discordx";
import dotenv from "dotenv";
import { startPresenceUpdater } from "./utils/presence.js";
import { getConversationService } from "./ai/conversation.js";
import { getRateLimiter } from "./utils/rate-limiter.js";
import { getAIService } from "./ai/service.js";
import { mcpManager } from "./mcp/index.js";
import { createLogger } from "./utils/logger.js";
import { waitForServices } from "./utils/health.js";
import { abortAllPendingRequests } from "./utils/fetch.js";
import { startMemoryMonitor, stopMemoryMonitor } from "./utils/memory.js";
import { NotBot } from "./guards/index.js";
import { ReadyEvent } from "./events/ready.js";
import config from "./config.js";

// Create logger for main module
const log = createLogger("Main");

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    log.error(`Missing required environment variable: ${envVar}`);
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
  silent: process.env.NODE_ENV === "production",

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
  const extension = process.env.NODE_ENV === "production" ? "js" : "{ts,js}";
  log.info(`Loading modules with extension: ${extension}`);
  await importx(
    `${dirname(import.meta.url)}/{commands,events,components,guards}/**/*.${extension}`
  );
  log.info("Modules loaded successfully");

  // Login to Discord
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error("DISCORD_TOKEN is not defined");
  }

  log.info("Logging in to Discord...");

  // Register ready handler using clientReady (ready is deprecated in discord.js v15)
  client.once("clientReady" as const, async (c) => {
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info(`🤖 Bot is ready!`);
    log.info(`   Logged in as: ${c.user.tag}`);
    log.info(`   Serving ${c.guilds.cache.size} guild(s)`);
    log.info(`   Mode: ${process.env.NODE_ENV ?? "development"}`);
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Initialize application commands
    await client.initApplicationCommands();
    log.info("Application commands initialized");

    // Set up REST API event handlers
    ReadyEvent.setupRestEventHandlers();
  });

  await client.login(token);
  log.info("Discord login successful");

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
  const CLEANUP_INTERVAL = 5 * 60 * 1000;
  cleanupIntervalId = setInterval(() => {
    const conversationService = getConversationService();
    const rateLimiter = getRateLimiter();

    const conversationsCleared = conversationService.cleanupExpiredConversations();
    rateLimiter.cleanup();

    if (conversationsCleared > 0) {
      log.debug(`Cleared ${conversationsCleared} expired conversations`);
    }
  }, CLEANUP_INTERVAL);
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

    // Abort any pending HTTP requests
    abortAllPendingRequests();

    // Disconnect MCP servers
    await mcpManager.shutdown();
    log.debug("MCP servers disconnected");

    // Destroy Discord client connection
    client.destroy();
    log.info("Discord client disconnected");

    // Clean up caches
    const conversationService = getConversationService();
    const rateLimiter = getRateLimiter();
    conversationService.cleanupExpiredConversations();
    rateLimiter.cleanup();
    log.info("Caches cleaned up");

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

bootstrap().catch((error) => {
  log.error("Failed to start bot", error instanceof Error ? error : undefined);
  process.exit(1);
});
