import type { GuardFunction, SimpleCommandMessage } from "discordx";
import type {
  ButtonInteraction,
  CommandInteraction,
  ContextMenuCommandInteraction,
  ModalSubmitInteraction,
  AnySelectMenuInteraction,
  Snowflake,
} from "discord.js";
import { Collection } from "discord.js";

interface RateLimitEntry {
  timestamps: number[];
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
    const userLimit = rateLimits.get(userId) ?? { timestamps: [] };

    // Filter out old timestamps
    userLimit.timestamps = userLimit.timestamps.filter((timestamp) => now - timestamp < windowMs);

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
setInterval(() => {
  const now = Date.now();
  const windowMs = 60000; // Default window

  rateLimits.forEach((entry, userId) => {
    entry.timestamps = entry.timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (entry.timestamps.length === 0) {
      rateLimits.delete(userId);
    }
  });
}, 60000); // Run every minute

export default RateLimitGuard;
