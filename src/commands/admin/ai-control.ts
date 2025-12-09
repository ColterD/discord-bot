import { type CommandInteraction, EmbedBuilder } from "discord.js";
import { Discord, Guard, Slash } from "discordx";
import { getAIControlService } from "../../ai/control.js";
import { OwnerGuard } from "../../guards/owner.guard.js";
import { getLastMaintenanceRun, triggerMaintenance } from "../../services/maintenance.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("AdminCommands");

@Discord()
export class AdminCommands {
  /**
   * Start the AI service
   */
  @Slash({
    name: "startai",
    description: "🔒 Enable AI and load the model (Owner only)",
  })
  @Guard(OwnerGuard())
  async startAI(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const controlService = getAIControlService();
      const result = await controlService.enable();

      const embed = new EmbedBuilder()
        .setTitle(result.success ? "🟢 AI Started" : "❌ Start Failed")
        .setDescription(result.message)
        .setColor(result.success ? 0x00ff00 : 0xff0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error("Failed to start AI", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Failed to start AI: ${errorMessage}`,
      });
    }
  }

  /**
   * Stop the AI service
   */
  @Slash({
    name: "stopai",
    description: "🔒 Disable AI and unload model from GPU (Owner only)",
  })
  @Guard(OwnerGuard())
  async stopAI(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const controlService = getAIControlService();
      const result = await controlService.disable();

      const embed = new EmbedBuilder()
        .setTitle(result.success ? "🔴 AI Stopped" : "❌ Stop Failed")
        .setDescription(result.message)
        .setColor(result.success ? 0xffaa00 : 0xff0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error("Failed to stop AI", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Failed to stop AI: ${errorMessage}`,
      });
    }
  }

  /**
   * Get AI status
   */
  @Slash({
    name: "aistatus",
    description: "🔒 Check AI service status (Owner only)",
  })
  @Guard(OwnerGuard())
  async aiStatus(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const controlService = getAIControlService();
      const status = await controlService.getStatus();

      // Determine status emoji and text based on state
      let statusEmoji: string;
      let statusText: string;
      let embedColor: number;

      if (status.running) {
        if (status.modelLoaded) {
          statusEmoji = "🟢";
          statusText = "Online & Model Loaded";
          embedColor = 0x00ff00;
        } else {
          statusEmoji = "🟡";
          statusText = "Online (Model Not Loaded)";
          embedColor = 0xffaa00;
        }
      } else {
        statusEmoji = "🔴";
        statusText = "Offline";
        embedColor = 0xff0000;
      }

      const embed = new EmbedBuilder()
        .setTitle(`${statusEmoji} AI Status`)
        .setColor(embedColor)
        .addFields(
          { name: "Status", value: statusText, inline: true },
          { name: "Model", value: status.model || "Unknown", inline: true },
          {
            name: "Manually Disabled",
            value: controlService.isManuallyDisabled() ? "Yes" : "No",
            inline: true,
          }
        )
        .setTimestamp();

      if (status.error) {
        embed.addFields({ name: "Error", value: status.error });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error("Failed to get AI status", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Failed to get AI status: ${errorMessage}`,
      });
    }
  }

  /**
   * Trigger system maintenance
   */
  @Slash({
    name: "maintenance",
    description: "🔒 Run system maintenance tasks (Owner only)",
  })
  @Guard(OwnerGuard())
  async maintenance(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const lastRun = getLastMaintenanceRun();
      const result = await triggerMaintenance();

      const embed = new EmbedBuilder()
        .setTitle("🧹 Maintenance Complete")
        .setColor(0x00aaff)
        .addFields(
          { name: "Duration", value: `${result.duration}ms`, inline: true },
          { name: "Conversations Cleared", value: `${result.conversationsCleared}`, inline: true },
          { name: "Rate Limiter", value: result.rateLimiterCleared ? "✅" : "❌", inline: true },
          { name: "Deduplication", value: result.deduplicationCleared ? "✅" : "❌", inline: true },
          { name: "Cache", value: result.cacheCleared ? "✅" : "❌", inline: true },
          {
            name: "Previous Run",
            value: lastRun ? `<t:${Math.floor(lastRun.getTime() / 1000)}:R>` : "Never",
            inline: true,
          }
        )
        .setFooter({ text: "Automatic maintenance runs every 12 hours" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error("Failed to run maintenance", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Failed to run maintenance: ${errorMessage}`,
      });
    }
  }
}
