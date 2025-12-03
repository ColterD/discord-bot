import { dirname, importx } from "@discordx/importer";
import { REST, Routes } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const devGuildId = process.env.DEV_GUILD_ID;
const isProduction = process.env.NODE_ENV === "production";

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment");
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

  const rest = new REST().setToken(token as string);

  try {
    if (isProduction) {
      // Global deployment - all servers, up to 1 hour propagation
      console.log("🌍 Deploying commands globally (production mode)...");
      console.log("⚠️  Note: Global commands take up to 1 hour to propagate.");

      await rest.put(Routes.applicationCommands(clientId as string), {
        body: [], // Commands will be registered via client.initApplicationCommands()
      });

      console.log("✅ Global commands deployment initiated.");
    } else {
      // Guild deployment - instant updates for development
      if (!devGuildId) {
        console.error("DEV_GUILD_ID is required for development mode");
        process.exit(1);
      }

      console.log(`🏠 Deploying commands to dev guild: ${devGuildId}`);
      console.log("⚡ Guild commands update instantly.");

      await rest.put(
        Routes.applicationGuildCommands(clientId as string, devGuildId),
        { body: [] }
      );

      console.log("✅ Guild commands deployment initiated.");
    }

    console.log("\n📋 Deployment Strategy Summary:");
    console.log(
      `   Mode: ${isProduction ? "PRODUCTION (Global)" : "DEVELOPMENT (Guild)"}`
    );
    console.log(`   Propagation: ${isProduction ? "Up to 1 hour" : "Instant"}`);
  } catch (error) {
    console.error("Failed to deploy commands:", error);
    process.exit(1);
  }
}

deployCommands();
