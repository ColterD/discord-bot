import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { Events } from "discord.js";
import { client } from "../index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Events");

/**
 * Discord events handler class
 * Note: The ready event is handled in index.ts for reliability
 */
@Discord()
export class ReadyEvent {
  /**
   * Set up REST API event handlers for rate limit monitoring
   * Called from index.ts after ready event
   */
  static setupRestEventHandlers(): void {
    // Monitor rate limit events from Discord API
    client.rest.on("rateLimited", (info) => {
      log.warn(
        `REST API rate limited: ${info.method} ${info.route} - Retry after ${info.timeToReset}ms (Global: ${info.global})`
      );
    });

    // Monitor invalid request warnings (potential issues)
    client.rest.on("invalidRequestWarning", (data) => {
      log.warn(
        `Invalid request warning: ${data.count} invalid requests, ${data.remainingTime}ms until reset`
      );
    });

    log.debug("REST event handlers initialized");
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
