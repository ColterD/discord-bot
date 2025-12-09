import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  CommandInteraction,
  ContextMenuCommandInteraction,
  ModalSubmitInteraction,
  Snowflake,
} from "discord.js";
import { Collection } from "discord.js";
import type { GuardFunction, SimpleCommandMessage } from "discordx";

interface RateLimitEntry {
  timestamps: number[];
  windowMs: number; // Store the window to use for cleanup
}

// Store rate limit data per user
const rateLimits = new Collection<Snowflake, RateLimitEntry>();

/**
 * Rate Limit Guard
 * Prevents users from spamming commands
 */
export function RateLimitGuard(
  maxRequests = 5,
  windowMs = 60000
): GuardFunction<
  | CommandInteraction
  | ContextMenuCommandInteraction
  | ButtonInteraction
  | AnySelectMenuInteraction
  | ModalSubmitInteraction
  | SimpleCommandMessage
> {
  return async (arg, _client, next) => {
    const argObj = Array.isArray(arg) ? arg[0] : arg;

    let userId: Snowflake;
    if ("user" in argObj) {
      userId = argObj.user.id;
    } else if ("message" in argObj) {
      userId = argObj.message.author.id;
    } else {
      await next();
      return;
    }

    const now = Date.now();
    const userLimit = rateLimits.get(userId) ?? { timestamps: [], windowMs };

    // Filter out old timestamps using the stored window
    const activeWindowMs = userLimit.windowMs ?? windowMs;
    userLimit.timestamps = userLimit.timestamps.filter(
      (timestamp) => now - timestamp < activeWindowMs
    );
    userLimit.windowMs = windowMs; // Update to current window in case it changed

    if (userLimit.timestamps.length >= maxRequests) {
      const oldestTimestamp = userLimit.timestamps[0];
      const timeLeft = oldestTimestamp
        ? Math.ceil((windowMs - (now - oldestTimestamp)) / 1000)
        : 60;

      if ("reply" in argObj && typeof argObj.reply === "function") {
        await argObj.reply({
          content: `⏳ Rate limited! Please wait ${timeLeft} seconds before trying again.`,
          ephemeral: true,
        });
      }
      return;
    }

    userLimit.timestamps.push(now);
    rateLimits.set(userId, userLimit);

    await next();
  };
}

/**
 * Clean up expired rate limit entries periodically
 */
let cleanupInterval: NodeJS.Timeout | null = null;

cleanupInterval = setInterval(() => {
  const now = Date.now();

  rateLimits.forEach((entry, userId) => {
    // Use stored windowMs for each entry (defaults to 60s if not set)
    const windowMs = entry.windowMs ?? 60000;
    entry.timestamps = entry.timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (entry.timestamps.length === 0) {
      rateLimits.delete(userId);
    }
  });
}, 60000); // Run every minute

/**
 * Clean up the rate limit guard interval
 * Should be called during application shutdown
 */
export function cleanupRateLimitGuard(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
