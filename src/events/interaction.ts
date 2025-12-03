import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";
import { Events } from "discord.js";
import { client } from "../index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Interaction");

@Discord()
export class InteractionEvent {
  @On({ event: Events.InteractionCreate })
  async onInteraction([
    interaction,
  ]: ArgsOf<"interactionCreate">): Promise<void> {
    try {
      await client.executeInteraction(interaction);
    } catch (error) {
      log.error(
        `Error executing interaction: ${interaction.id}`,
        error instanceof Error ? error : undefined
      );

      // Attempt to notify the user of the error
      try {
        if (interaction.isRepliable()) {
          const errorContent =
            "❌ An error occurred while processing your request. Please try again later.";

          // Check if we've already replied or deferred
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
              content: errorContent,
              ephemeral: true,
            });
          } else {
            await interaction.reply({
              content: errorContent,
              ephemeral: true,
            });
          }
        }
      } catch (replyError) {
        // If we can't even send the error message, just log it
        log.warn(
          "Failed to send error message to user",
          replyError instanceof Error ? replyError : undefined
        );
      }
    }
  }
}
