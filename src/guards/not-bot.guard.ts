import {
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type CommandInteraction,
  type ContextMenuCommandInteraction,
  Message,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ArgsOf, GuardFunction, SimpleCommandMessage } from "discordx";
import { config } from "../config.js";

/**
 * NotBot Guard
 * Prevents bot users from triggering commands/events
 * Exception: Allows webhook messages in designated test channels for automated testing
 */
export const NotBot: GuardFunction<
  | ArgsOf<"messageCreate">
  | CommandInteraction
  | ContextMenuCommandInteraction
  | ButtonInteraction
  | AnySelectMenuInteraction
  | ModalSubmitInteraction
  | SimpleCommandMessage
> = async (arg, _client, next) => {
  const argObj = Array.isArray(arg) ? arg[0] : arg;

  let user: { bot?: boolean | null } | undefined;
  let isWebhookInTestChannel = false;

  if (argObj instanceof Message) {
    user = argObj.author;
    // Check if this is a webhook message in a test channel (only when test mode is enabled)
    if (
      argObj.webhookId &&
      config.testing.enabled &&
      config.testing.alwaysRespondChannelIds.includes(argObj.channelId)
    ) {
      isWebhookInTestChannel = true;
    }
  } else if ("user" in argObj) {
    user = argObj.user;
  } else if ("message" in argObj && argObj.message instanceof Message) {
    user = argObj.message.author;
  }

  // Allow non-bot users or webhooks in test channels (when test mode is enabled)
  if ((user && !user.bot) || isWebhookInTestChannel) {
    await next();
  }
};
