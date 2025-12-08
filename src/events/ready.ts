import { Events } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On, Once } from "discordx";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Events");

// Flag to prevent duplicate REST listener registration on reconnect
let restListenersAttached = false;

/**
 * Discord events handler class
 */
@Discord()
export class ReadyEvent {
  @Once({ event: "clientReady" })
  async onClientReady([client]: ArgsOf<"clientReady">): Promise<void> {
    log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Initialize application commands
    // Cast client to discordx Client to access initApplicationCommands
    await (client as Client).initApplicationCommands();
    log.info("Application commands initialized");

    // Set up REST API event handlers for rate limit monitoring
    // Guard against duplicate listener registration on reconnect
    if (!restListenersAttached) {
      (client as Client).rest.on("rateLimited", (info) => {
        log.warn(
          `REST API rate limited: ${info.method} ${info.route} - Retry after ${info.timeToReset}ms (Global: ${info.global})`
        );
      });
      (client as Client).rest.on("invalidRequestWarning", (data) => {
        log.warn(
          `Invalid request warning: ${data.count} invalid requests, ${data.remainingTime}ms until reset`
        );
      });
      restListenersAttached = true;
      log.debug("REST event handlers initialized");
    }
  }

  @On({ event: Events.GuildCreate })
  onGuildCreate([guild]: ArgsOf<"guildCreate">): void {
    log.info(`Joined new guild: ${guild.name} (${guild.id})`);
  }

  @On({ event: Events.GuildDelete })
  onGuildDelete([guild]: ArgsOf<"guildDelete">): void {
    log.info(`Left guild: ${guild.name} (${guild.id})`);
  }

  // WebSocket error handling
  @On({ event: Events.ShardError })
  onShardError([error, shardId]: ArgsOf<"shardError">): void {
    log.error(`Shard ${shardId} WebSocket error`, error);
  }

  @On({ event: Events.ShardDisconnect })
  onShardDisconnect([closeEvent, shardId]: ArgsOf<"shardDisconnect">): void {
    log.warn(`Shard ${shardId} disconnected (code: ${closeEvent.code})`);
  }

  @On({ event: Events.ShardReconnecting })
  onShardReconnecting([shardId]: ArgsOf<"shardReconnecting">): void {
    log.info(`Shard ${shardId} reconnecting...`);
  }

  @On({ event: Events.ShardResume })
  onShardResume([shardId, replayedEvents]: ArgsOf<"shardResume">): void {
    log.info(`Shard ${shardId} resumed (replayed ${replayedEvents} events)`);
  }

  // Monitor shard ready events for health tracking
  @On({ event: Events.ShardReady })
  onShardReady([shardId]: ArgsOf<"shardReady">): void {
    log.info(`Shard ${shardId} is ready`);
  }

  @On({ event: Events.Warn })
  onWarn([message]: ArgsOf<"warn">): void {
    log.warn(`Discord.js warning: ${message}`);
  }

  @On({ event: Events.Error })
  onError([error]: ArgsOf<"error">): void {
    log.error("Discord.js error", error);
  }

  // Debug event - only useful when LOG_LEVEL=DEBUG
  // Provides verbose Discord.js internal activity
  @On({ event: Events.Debug })
  onDebug([message]: ArgsOf<"debug">): void {
    // Filter out noisy heartbeat messages unless specifically debugging
    if (message.includes("Heartbeat")) {
      return; // Skip heartbeat spam
    }
    log.debug(`Discord.js: ${message}`);
  }
}
