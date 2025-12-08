import * as chrono from "chrono-node";
import { ApplicationCommandOptionType, type CommandInteraction } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { getSchedulerService } from "../../services/scheduler.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("RemindCommand");

@Discord()
export class RemindCommand {
  @Slash({ description: "Set a reminder" })
  async remind(
    @SlashOption({
      description: "When to remind you (e.g., 'in 10 minutes', 'tomorrow at 5pm')",
      name: "when",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    when: string,
    @SlashOption({
      description: "What to remind you about",
      name: "what",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    what: string,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const parsedDate = chrono.parseDate(when);

      if (!parsedDate) {
        await interaction.editReply(
          `I couldn't understand when you want to be reminded. Please try a format like "in 10 minutes" or "tomorrow at 5pm".`
        );
        return;
      }

      // Ensure the date is in the future
      if (parsedDate.getTime() <= Date.now()) {
        await interaction.editReply(
          "The time you specified is in the past. Please specify a future time."
        );
        return;
      }

      const scheduler = getSchedulerService();
      const delay = parsedDate.getTime() - Date.now();

      await scheduler.scheduleReminder(interaction.user.id, interaction.channelId, what, delay);

      // Format the date for display
      const timeString = `<t:${Math.floor(parsedDate.getTime() / 1000)}:R>`;

      await interaction.editReply(`I've set a reminder for you ${timeString}: "${what}"`);

      log.info(`Reminder set for user ${interaction.user.id} at ${parsedDate.toISOString()}`);
    } catch (error) {
      log.error("Error setting reminder:", error as Error);
      await interaction.editReply(
        "An error occurred while setting your reminder. Please try again later."
      );
    }
  }
}
