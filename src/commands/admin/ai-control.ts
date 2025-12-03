import { Discord, Slash, Guard } from "discordx";
import { type CommandInteraction, EmbedBuilder } from "discord.js";
import { OwnerGuard } from "../../guards/owner.guard.js";
import { getAIControlService } from "../../ai/control.js";

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

    const controlService = getAIControlService();
    const result = await controlService.enable();

    const embed = new EmbedBuilder()
      .setTitle(result.success ? "🟢 AI Started" : "❌ Start Failed")
      .setDescription(result.message)
      .setColor(result.success ? 0x00ff00 : 0xff0000)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
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

    const controlService = getAIControlService();
    const result = await controlService.disable();

    const embed = new EmbedBuilder()
      .setTitle(result.success ? "🔴 AI Stopped" : "❌ Stop Failed")
      .setDescription(result.message)
      .setColor(result.success ? 0xffaa00 : 0xff0000)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
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

    const controlService = getAIControlService();
    const status = await controlService.getStatus();

    const statusEmoji = status.running ? (status.modelLoaded ? "🟢" : "🟡") : "🔴";
    const statusText = status.running
      ? status.modelLoaded
        ? "Online & Model Loaded"
        : "Online (Model Not Loaded)"
      : "Offline";

    const embed = new EmbedBuilder()
      .setTitle(`${statusEmoji} AI Status`)
      .setColor(status.running ? (status.modelLoaded ? 0x00ff00 : 0xffaa00) : 0xff0000)
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
  }
}
