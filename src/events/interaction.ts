import { Events } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Interaction");

// Lazy-load the client to avoid circular dependency issues
// This function is called at runtime when the event fires, not at import time
async function getClient(): Promise<Client> {
  const { client } = await import("../index.js");
  return client;
}

@Discord()
export class InteractionEvent {
  @On({ event: Events.InteractionCreate })
  async onInteraction([interaction]: ArgsOf<"interactionCreate">): Promise<void> {
    try {
      const client = await getClient();
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
