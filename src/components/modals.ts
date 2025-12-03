import {
  ModalSubmitInteraction,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
  EmbedBuilder,
} from "discord.js";
import { Discord, ModalComponent } from "discordx";
import { AIService } from "../ai/service.js";
import config from "../config.js";

@Discord()
export class ModalComponents {
  private aiService = new AIService();

  /**
   * Feedback modal handler
   */
  @ModalComponent({ id: "feedback_modal" })
  async handleFeedbackModal(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    const feedback = interaction.fields.getTextInputValue("feedback_input");
    const category =
      interaction.fields.getTextInputValue("feedback_category") || "General";

    const embed = new EmbedBuilder()
      .setTitle("📝 Feedback Received")
      .setDescription("Thank you for your feedback!")
      .addFields(
        { name: "Category", value: category, inline: true },
        { name: "Feedback", value: feedback }
      )
      .setColor(config.colors.success)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }

  /**
   * AI prompt modal handler
   */
  @ModalComponent({ id: "ai_prompt_modal" })
  async handleAIPromptModal(
    interaction: ModalSubmitInteraction
  ): Promise<void> {
    const prompt = interaction.fields.getTextInputValue("prompt_input");
    const systemPrompt =
      interaction.fields.getTextInputValue("system_prompt") ||
      "You are a helpful assistant.";

    await interaction.deferReply();

    try {
      const response = await this.aiService.chat(prompt, { systemPrompt });

      const embed = new EmbedBuilder()
        .setTitle("🤖 AI Response")
        .setDescription(
          response.length > 4000
            ? response.substring(0, 4000) + "..."
            : response
        )
        .setColor(config.colors.primary)
        .setFooter({ text: `Model: ${this.aiService.getModel()}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Error: ${errorMessage}`,
      });
    }
  }

  /**
   * Report modal handler
   */
  @ModalComponent({ id: "report_modal" })
  async handleReportModal(interaction: ModalSubmitInteraction): Promise<void> {
    const reportType = interaction.fields.getTextInputValue("report_type");
    const description =
      interaction.fields.getTextInputValue("report_description");
    const evidence =
      interaction.fields.getTextInputValue("report_evidence") ||
      "None provided";

    const embed = new EmbedBuilder()
      .setTitle("🚨 Report Submitted")
      .setDescription("Your report has been submitted to the moderators.")
      .addFields(
        { name: "Type", value: reportType, inline: true },
        { name: "Description", value: description },
        { name: "Evidence", value: evidence }
      )
      .setColor(config.colors.warning)
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  }
}

/**
 * Create a feedback modal
 */
export function createFeedbackModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("feedback_modal")
    .setTitle("📝 Submit Feedback");

  const categoryInput = new TextInputBuilder()
    .setCustomId("feedback_category")
    .setLabel("Category")
    .setPlaceholder("Bug, Feature Request, General, etc.")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(50);

  const feedbackInput = new TextInputBuilder()
    .setCustomId("feedback_input")
    .setLabel("Your Feedback")
    .setPlaceholder("Tell us what you think...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(categoryInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(feedbackInput)
  );

  return modal;
}

/**
 * Create an AI prompt modal
 */
export function createAIPromptModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("ai_prompt_modal")
    .setTitle("🤖 AI Prompt");

  const systemPromptInput = new TextInputBuilder()
    .setCustomId("system_prompt")
    .setLabel("System Prompt (Optional)")
    .setPlaceholder("You are a helpful assistant...")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500);

  const promptInput = new TextInputBuilder()
    .setCustomId("prompt_input")
    .setLabel("Your Prompt")
    .setPlaceholder("Ask anything...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(systemPromptInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(promptInput)
  );

  return modal;
}

/**
 * Create a report modal
 */
export function createReportModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId("report_modal")
    .setTitle("🚨 Submit Report");

  const typeInput = new TextInputBuilder()
    .setCustomId("report_type")
    .setLabel("Report Type")
    .setPlaceholder("Spam, Harassment, Inappropriate Content, etc.")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);

  const descriptionInput = new TextInputBuilder()
    .setCustomId("report_description")
    .setLabel("Description")
    .setPlaceholder("Describe the issue in detail...")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1500);

  const evidenceInput = new TextInputBuilder()
    .setCustomId("report_evidence")
    .setLabel("Evidence (Optional)")
    .setPlaceholder("Message links, screenshots, etc.")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(evidenceInput)
  );

  return modal;
}

export default ModalComponents;
