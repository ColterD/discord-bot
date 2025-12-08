import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";
import { getConversationService } from "../../ai/conversation.js";
import config from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { getRateLimiter } from "../../utils/rate-limiter.js";
import { splitMessage } from "../../utils/text.js";

const log = createLogger("ContinueCommand");

@Discord()
export class ContinueCommand {
  private get conversationService() {
    return getConversationService();
  }

  private get rateLimiter() {
    return getRateLimiter();
  }

  /**
   * Generate the AI response for the continue request
   */
  private async generateResponse(
    userId: string,
    channelId: string,
    guildId: string | null,
    user: CommandInteraction["user"]
  ): Promise<{
    response: string;
    generatedImage?: { buffer: Buffer; filename: string } | undefined;
    blocked?: boolean | undefined;
  }> {
    const continuePrompt = "Please continue your previous response from where you left off.";

    if (config.llm.useOrchestrator) {
      const member = guildId
        ? await user.client.guilds.cache
            .get(guildId)
            ?.members.fetch(userId)
            .catch(() => null)
        : null;

      const result = await this.conversationService.chatWithOrchestrator(
        continuePrompt,
        user,
        member ?? null,
        channelId,
        guildId ?? undefined
      );

      return {
        response: result.response,
        generatedImage: result.generatedImage,
        blocked: result.blocked,
      };
    }

    // Fallback to simple chat
    const contextId = guildId ? `channel-${channelId}-user-${userId}` : `dm-${userId}`;

    const response = await this.conversationService.chat(
      contextId,
      continuePrompt,
      user.displayName || user.username,
      userId
    );

    return { response };
  }

  @Slash({ description: "Ask the AI to continue its last response" })
  async continue(interaction: CommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;
    const isDM = !interaction.guild;

    // 1. Rate Limit Check
    const rateLimitResult = this.rateLimiter.checkRateLimit(userId, channelId, isDM);
    if (!rateLimitResult.allowed) {
      await interaction.reply({
        content: rateLimitResult.message ?? "Rate limited. Please wait.",
        ephemeral: true,
      });
      return;
    }

    // 2. Defer Reply (AI takes time)
    await interaction.deferReply();

    try {
      // 3. Generate Response
      const result = await this.generateResponse(
        userId,
        channelId,
        interaction.guildId,
        interaction.user
      );

      if (result.blocked) {
        await interaction.editReply("🛡️ I couldn't process that request.");
        return;
      }

      const { response, generatedImage } = result;

      // 4. Send Response
      if (!response && !generatedImage) {
        await interaction.editReply("I don't have anything to continue! 🤷‍♂️");
        return;
      }

      const chunks = splitMessage(response);
      const files = generatedImage
        ? [{ attachment: generatedImage.buffer, name: generatedImage.filename }]
        : [];

      // Send first chunk with reply
      if (chunks.length > 0) {
        const firstChunk = chunks[0];
        if (firstChunk) {
          await interaction.editReply({
            content: firstChunk,
            files: files,
          });
        }
      } else if (files.length > 0) {
        // Image only
        await interaction.editReply({
          files: files,
        });
      }

      // Send remaining chunks as follow-ups
      for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk) {
          await interaction.followUp({
            content: chunk,
          });
        }
      }
    } catch (error) {
      log.error("Error in continue command:", error);
      await interaction.editReply("😅 Oops, something went wrong. Please try again!");
    }
  }
}
