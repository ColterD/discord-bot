import { dirname, importx } from "@discordx/importer";
import { REST, Routes } from "discord.js";
import config from "./config.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("Deploy");

const { token, clientId, devGuildId } = config.discord;
const { isProduction } = config.env;

if (!token || !clientId) {
  log.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in configuration");
  process.exit(1);
}

/**
 * Hybrid Command Deployment Strategy:
 *
 * DEVELOPMENT MODE (NODE_ENV !== 'production'):
 * - Commands are deployed to a specific guild (DEV_GUILD_ID)
 * - Updates are instant (no propagation delay)
 * - Perfect for testing and development
 *
 * PRODUCTION MODE (NODE_ENV === 'production'):
 * - Commands are deployed globally to all guilds
 * - Takes up to 1 hour for changes to propagate
 * - Use for stable, production-ready commands
 *
 * To use:
 * - Development: Set NODE_ENV=development and DEV_GUILD_ID in .env
 * - Production: Set NODE_ENV=production in .env
 */

async function deployCommands(): Promise<void> {
  // Dynamic import to get command metadata
  await importx(`${dirname(import.meta.url)}/commands/**/*.{ts,js}`);

  const rest = new REST().setToken(token);

  try {
    if (isProduction) {
      // Global deployment - all servers, up to 1 hour propagation
      log.info("🌍 Deploying commands globally (production mode)...");
      log.warn("⚠️  Note: Global commands take up to 1 hour to propagate.");

      await rest.put(Routes.applicationCommands(clientId), {
        body: [], // Commands will be registered via client.initApplicationCommands()
      });

      log.info("✅ Global commands deployment initiated.");
    } else {
      // Guild deployment - instant updates for development
      if (!devGuildId) {
        log.error("DEV_GUILD_ID is required for development mode");
        process.exit(1);
      }

      log.info(`🏠 Deploying commands to dev guild: ${devGuildId}`);
      log.info("⚡ Guild commands update instantly.");

      await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body: [] });

      log.info("✅ Guild commands deployment initiated.");
    }

    log.info("\n📋 Deployment Strategy Summary:");
    log.info(`   Mode: ${isProduction ? "PRODUCTION (Global)" : "DEVELOPMENT (Guild)"}`);
    log.info(`   Propagation: ${isProduction ? "Up to 1 hour" : "Instant"}`);
  } catch (error) {
    log.error("Failed to deploy commands:", error);
    process.exitCode = 1;
    return;
  }
}

await deployCommands();

// Allow pending I/O to complete before exit
setTimeout(() => {
  process.exit(0);
}, 100);
