import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { ButtonComponent, Discord } from "discordx";
import config from "../config.js";

@Discord()
export class ButtonComponents {
  /**
   * Confirmation button handler
   */
  @ButtonComponent({ id: "confirm" })
  async handleConfirm(interaction: ButtonInteraction): Promise<void> {
    await interaction.update({
      content: "✅ Action confirmed!",
      components: [],
    });
  }

  /**
   * Cancel button handler
   */
  @ButtonComponent({ id: "cancel" })
  async handleCancel(interaction: ButtonInteraction): Promise<void> {
    await interaction.update({
      content: "❌ Action cancelled.",
      components: [],
    });
  }

  /**
   * Pagination - Previous page
   */
  @ButtonComponent({ id: /^page_prev_\d+$/ })
  async handlePrevPage(interaction: ButtonInteraction): Promise<void> {
    const currentPage = Number.parseInt(interaction.customId.split("_")[2] ?? "0", 10);
    const newPage = Math.max(0, currentPage - 1);

    await interaction.update({
      content: `📖 Page ${newPage + 1}`,
      components: this.createPaginationRow(newPage),
    });
  }

  /**
   * Pagination - Next page
   */
  @ButtonComponent({ id: /^page_next_\d+$/ })
  async handleNextPage(interaction: ButtonInteraction): Promise<void> {
    const currentPage = Number.parseInt(interaction.customId.split("_")[2] ?? "0", 10);
    const newPage = currentPage + 1;

    await interaction.update({
      content: `📖 Page ${newPage + 1}`,
      components: this.createPaginationRow(newPage),
    });
  }

  /**
   * Help menu button
   */
  @ButtonComponent({ id: "show_help" })
  async handleShowHelp(interaction: ButtonInteraction): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("📚 Help Menu")
      .setDescription("Here are the available commands:")
      .addFields(
        { name: "/ping", value: "Check bot latency", inline: true },
        { name: "/info", value: "Display bot information", inline: true },
        { name: "/avatar", value: "Get user avatar", inline: true },
        { name: "/ask", value: "Ask the AI a question", inline: true },
        { name: "/summarize", value: "Summarize text with AI", inline: true },
        { name: "/translate", value: "Translate text with AI", inline: true }
      )
      .setColor(config.colors.primary)
      .setFooter({ text: "Use /help for more details" });

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * Utility method to create pagination buttons
   */
  private createPaginationRow(currentPage: number): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`page_prev_${currentPage}`)
        .setLabel("◀ Previous")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`page_next_${currentPage}`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Primary)
    );

    return [row];
  }
}

/**
 * Utility function to create confirmation buttons
 */
export function createConfirmationButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("confirm").setLabel("Confirm").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
  );
}

/**
 * Utility function to create pagination buttons
 */
export function createPaginationButtons(
  currentPage: number,
  hasMore = true
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`page_prev_${currentPage}`)
      .setLabel("◀ Previous")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(`page_next_${currentPage}`)
      .setLabel("Next ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasMore)
  );
}

export default ButtonComponents;
