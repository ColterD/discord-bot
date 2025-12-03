import type { GuardFunction, ArgsOf, SimpleCommandMessage } from "discordx";
import {
  Message,
  type ButtonInteraction,
  type CommandInteraction,
  type ContextMenuCommandInteraction,
  type ModalSubmitInteraction,
  type SelectMenuInteraction,
} from "discord.js";

/**
 * NotBot Guard
 * Prevents bot users from triggering commands/events
 */
export const NotBot: GuardFunction<
  | ArgsOf<"messageCreate">
  | CommandInteraction
  | ContextMenuCommandInteraction
  | ButtonInteraction
  | SelectMenuInteraction
  | ModalSubmitInteraction
  | SimpleCommandMessage
> = async (arg, _client, next) => {
  const argObj = Array.isArray(arg) ? arg[0] : arg;

  let user;
  if (argObj instanceof Message) {
    user = argObj.author;
  } else if ("user" in argObj) {
    user = argObj.user;
  } else if ("message" in argObj && argObj.message instanceof Message) {
    user = argObj.message.author;
  }

  if (user && !user.bot) {
    await next();
  }
};

export default NotBot;
