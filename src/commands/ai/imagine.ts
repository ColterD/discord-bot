/**
 * Image Generation Command
 * Generate images using ComfyUI with Z-Image-Turbo
 */

import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  type CommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { Discord, Slash, SlashOption, SlashChoice } from "discordx";
import { getImageService } from "../../ai/image-service.js";
import { getRateLimiter, buildRateLimitFooter } from "../../utils/rate-limiter.js";
import { validatePrompt, sanitizeInput } from "../../utils/security.js";
import config from "../../config.js";

@Discord()
export class ImagineCommand {
  private get imageService() {
    return getImageService();
  }

  private get rateLimiter() {
    return getRateLimiter();
  }

  @Slash({
    name: "imagine",
    description: "Generate an image from a text prompt",
  })
  async imagine(
    @SlashOption({
      name: "prompt",
      description: "Describe the image you want to generate",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    prompt: string,
    @SlashChoice({ name: "Square (1024x1024)", value: "square" })
    @SlashChoice({ name: "Portrait (768x1152)", value: "portrait" })
    @SlashChoice({ name: "Landscape (1152x768)", value: "landscape" })
    @SlashChoice({ name: "Wide (1344x768)", value: "wide" })
    @SlashOption({
      name: "size",
      description: "Image size/aspect ratio",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    size: "square" | "portrait" | "landscape" | "wide" | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    const isDM = !interaction.guild;
    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    // Check rate limit
    const rateLimitResult = this.rateLimiter.checkRateLimit(userId, channelId, isDM);
    if (!rateLimitResult.allowed) {
      await interaction.reply({
        content: rateLimitResult.message ?? "Rate limited. Please wait.",
        ephemeral: true,
      });
      return;
    }

    // Validate prompt for security
    const validation = validatePrompt(prompt);
    if (validation.blocked) {
      await interaction.reply({
        content: `❌ ${validation.reason ?? "Invalid prompt"}`,
        ephemeral: true,
      });
      return;
    }

    // Sanitize prompt (remove PII)
    const sanitized = sanitizeInput(prompt);
    if (sanitized.modified) {
      // Log but don't tell user what was sanitized
      console.log(`[Imagine] Sanitized PII from user ${userId}: ${sanitized.piiFound.join(", ")}`);
    }

    await interaction.deferReply();

    // Record the request
    this.rateLimiter.recordRequest(userId, channelId, isDM);

    // Check if service is available
    const isAvailable = await this.imageService.healthCheck();
    if (!isAvailable) {
      const embed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle("❌ Image Generation Unavailable")
        .setDescription(
          "The image generation service is currently offline. Please try again later."
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Check queue status
    const canAccept = await this.imageService.canAcceptJob();
    if (!canAccept.allowed) {
      const embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle("⏳ Queue Full")
        .setDescription(
          canAccept.reason ?? "The image queue is full. Please wait a moment and try again."
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Get dimensions based on size choice
    const dimensions = this.getDimensions(size ?? "square");

    // Show generation in progress
    const progressEmbed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle("🎨 Generating Image...")
      .setDescription(
        `**Prompt:** ${sanitized.text.slice(0, 200)}${sanitized.text.length > 200 ? "..." : ""}`
      )
      .addFields(
        {
          name: "Size",
          value: `${dimensions.width}x${dimensions.height}`,
          inline: true,
        },
        { name: "Model", value: "Z-Image-Turbo", inline: true }
      )
      .setFooter({ text: "This may take 10-30 seconds..." })
      .setTimestamp();

    await interaction.editReply({ embeds: [progressEmbed] });

    try {
      // Generate the image
      const startTime = Date.now();
      const result = await this.imageService.generateImage(sanitized.text, userId, {
        width: dimensions.width,
        height: dimensions.height,
        steps: 4, // Z-Image-Turbo is optimized for few steps
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (!result.success || !result.imageBuffer) {
        const errorEmbed = new EmbedBuilder()
          .setColor(config.colors.error)
          .setTitle("❌ Generation Failed")
          .setDescription(result.error ?? "Failed to generate image. Please try again.")
          .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      // Create attachment
      const attachment = new AttachmentBuilder(result.imageBuffer, {
        name: `imagine-${Date.now()}.png`,
        description: sanitized.text.slice(0, 100),
      });

      // Build success embed
      const rateLimitFooter = buildRateLimitFooter(userId, channelId, isDM);
      const successEmbed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle("🎨 Image Generated")
        .setDescription(`**Prompt:** ${sanitized.text.slice(0, 500)}`)
        .setImage(`attachment://imagine-${Date.now()}.png`)
        .addFields(
          {
            name: "Size",
            value: `${dimensions.width}x${dimensions.height}`,
            inline: true,
          },
          { name: "Time", value: `${elapsed}s`, inline: true }
        )
        .setFooter({ text: `${rateLimitFooter} | Model: Z-Image-Turbo` })
        .setTimestamp();

      // Handle warning if prompt was modified
      if (rateLimitResult.isWarning && rateLimitResult.message) {
        successEmbed.addFields({
          name: "⚠️ Warning",
          value: rateLimitResult.message,
        });
      }

      await interaction.editReply({
        embeds: [successEmbed],
        files: [attachment],
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const errorEmbed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle("❌ Generation Error")
        .setDescription(`Failed to generate image: ${errorMessage}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  @Slash({
    name: "imagine-status",
    description: "Check the status of the image generation service",
  })
  async imagineStatus(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const isAvailable = await this.imageService.healthCheck();

    if (!isAvailable) {
      const embed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle("🔴 Image Service Offline")
        .setDescription("The ComfyUI image generation service is not responding.")
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const [queueStatus, vramStatus] = await Promise.all([
      this.imageService.getQueueStatus(),
      this.imageService.getVRAMStatus(),
    ]);

    const statusEmbed = new EmbedBuilder()
      .setColor(config.colors.success)
      .setTitle("🟢 Image Service Online")
      .addFields(
        {
          name: "Queue",
          value: `${queueStatus.running} running, ${queueStatus.pending} pending`,
          inline: true,
        },
        {
          name: "Max Queue",
          value: `${config.comfyui.maxQueueSize}`,
          inline: true,
        }
      );

    if (vramStatus) {
      const usedGB = (vramStatus.used / 1024 / 1024 / 1024).toFixed(1);
      const totalGB = (vramStatus.total / 1024 / 1024 / 1024).toFixed(1);
      const usedPercent = ((vramStatus.used / vramStatus.total) * 100).toFixed(0);

      statusEmbed.addFields({
        name: "VRAM",
        value: `${usedGB}/${totalGB} GB (${usedPercent}% used)`,
        inline: true,
      });
    }

    statusEmbed.setTimestamp();

    await interaction.editReply({ embeds: [statusEmbed] });
  }

  /**
   * Get dimensions from size preset
   */
  private getDimensions(size: string): { width: number; height: number } {
    switch (size) {
      case "portrait":
        return { width: 768, height: 1152 };
      case "landscape":
        return { width: 1152, height: 768 };
      case "wide":
        return { width: 1344, height: 768 };
      case "square":
      default:
        return { width: 1024, height: 1024 };
    }
  }
}
