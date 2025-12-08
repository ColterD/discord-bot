import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  type Attachment,
  type CommandInteraction,
  EmbedBuilder,
  type MessageContextMenuCommandInteraction,
  type UserContextMenuCommandInteraction,
} from "discord.js";
import { ContextMenu, Discord, Slash, SlashChoice, SlashOption } from "discordx";
import { getMemoryManager } from "../../ai/memory/index.js";
import { getAIService } from "../../ai/service.js";
import config from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { buildRateLimitFooter, getRateLimiter } from "../../utils/rate-limiter.js";
import { sanitizeInput, securityCheck, validatePrompt } from "../../utils/security.js";

const log = createLogger("AICommands");

// Supported file types for RAG
const SUPPORTED_TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/html",
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".log",
  ".yml",
  ".yaml",
]);

@Discord()
export class AICommands {
  private get aiService() {
    return getAIService();
  }

  private get memoryManager() {
    return getMemoryManager();
  }

  private get rateLimiter() {
    return getRateLimiter();
  }

  /**
   * Helper: Check rate limit and respond if blocked
   */
  private async checkRateLimitAndRespond(
    interaction: CommandInteraction,
    userId: string,
    channelId: string,
    isDM: boolean
  ): Promise<
    | { allowed: false }
    | { allowed: true; result: { allowed: true; isWarning?: boolean; message?: string | null } }
  > {
    const rateLimitResult = this.rateLimiter.checkRateLimit(userId, channelId, isDM);
    if (!rateLimitResult.allowed) {
      await interaction.reply({
        content: rateLimitResult.message ?? "Rate limited. Please wait.",
        ephemeral: true,
      });
      return { allowed: false };
    }
    return {
      allowed: true,
      result: {
        allowed: true,
        isWarning: rateLimitResult.isWarning,
        message: rateLimitResult.message,
      },
    };
  }

  /**
   * Helper: Validate and sanitize prompt, respond if blocked
   */
  private async validatePromptAndRespond(
    interaction: CommandInteraction,
    question: string
  ): Promise<{ valid: boolean; sanitizedText?: string }> {
    const validation = validatePrompt(question);
    if (validation.blocked) {
      await interaction.reply({
        content: `❌ ${validation.reason ?? "Invalid question"}`,
        ephemeral: true,
      });
      return { valid: false };
    }
    const sanitized = sanitizeInput(question);
    return { valid: true, sanitizedText: sanitized.text };
  }

  /**
   * Get temperature value based on mode
   */
  private getTemperatureForMode(mode: "creative" | "balanced" | "precise" | undefined): number {
    if (mode === "creative") return 0.9;
    if (mode === "precise") return 0.3;
    return 0.7;
  }

  /**
   * Helper: Get context from file attachment
   */
  private async getAttachmentContext(file: Attachment | undefined): Promise<string> {
    if (!file) return "";
    const fileContext = await this.processFileAttachment(file);
    if (fileContext.success) {
      return `\n\n## Attached Document Context:\n${fileContext.text}`;
    }
    if (fileContext.error) {
      log.warn(`File processing failed: ${fileContext.error}`);
    }
    return "";
  }

  /**
   * Helper: Build response embed
   */
  private buildResponseEmbed(
    response: string,
    rateLimitResult: { allowed: true; isWarning?: boolean; message?: string | null },
    mode: string | undefined,
    file: Attachment | undefined,
    contextText: string,
    userId: string,
    channelId: string,
    isDM: boolean
  ): EmbedBuilder {
    const rateLimitFooter = buildRateLimitFooter(userId, channelId, isDM);

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle("🤖 AI Response")
      .setDescription(response.slice(0, 4000))
      .setFooter({
        text: `${rateLimitFooter} | Mode: ${mode ?? "balanced"}`,
      })
      .setTimestamp();

    if (rateLimitResult.isWarning && rateLimitResult.message) {
      embed.addFields({
        name: "⚠️ Notice",
        value: rateLimitResult.message,
      });
    }

    if (file && contextText) {
      embed.addFields({
        name: "📎 Attached Context",
        value: `Processed \`${file.name}\` (${(file.size / 1024).toFixed(1)} KB)`,
        inline: true,
      });
    }

    return embed;
  }

  @Slash({
    name: "ask",
    description: "Ask the AI a question",
  })
  async ask(
    @SlashOption({
      name: "question",
      description: "Your question for the AI",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    question: string,
    @SlashChoice({ name: "Creative", value: "creative" })
    @SlashChoice({ name: "Balanced", value: "balanced" })
    @SlashChoice({ name: "Precise", value: "precise" })
    @SlashOption({
      name: "mode",
      description: "Response style",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    mode: "creative" | "balanced" | "precise" | undefined,
    @SlashOption({
      name: "file",
      description: "Attach a text file to provide context",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    file: Attachment | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    const isDM = !interaction.guild;
    const channelId = interaction.channelId;
    const userId = interaction.user.id;

    // Check rate limit
    const rateLimitCheck = await this.checkRateLimitAndRespond(
      interaction,
      userId,
      channelId,
      isDM
    );
    if (!rateLimitCheck.allowed) return;
    const rateLimitResult = rateLimitCheck.result;

    // Validate and sanitize prompt
    const promptCheck = await this.validatePromptAndRespond(interaction, question);
    if (!promptCheck.valid || !promptCheck.sanitizedText) return;
    const sanitizedText = promptCheck.sanitizedText;

    await interaction.deferReply();

    // Record the request
    this.rateLimiter.recordRequest(userId, channelId, isDM);

    const temperature = this.getTemperatureForMode(mode);

    try {
      // Get memory context for personalization
      const memoryContext = await this.memoryManager.buildFullContext(userId, sanitizedText);

      const systemPrompt = `You are a helpful Discord bot assistant. Be concise and friendly.

${memoryContext}`;

      // Handle file attachment for RAG context
      const contextText = await this.getAttachmentContext(file);

      // Combine question with file context
      const fullQuestion = contextText
        ? `${sanitizedText}\n\n[User attached a file with the following content:]\n${contextText}`
        : sanitizedText;

      const response = await this.aiService.chat(fullQuestion, {
        temperature,
        systemPrompt,
      });

      // Store memory from conversation (async, don't wait)
      this.memoryManager.addMemory(userId, `User asked: ${sanitizedText}`).catch((err) => {
        log.debug(`Failed to add memory: ${err instanceof Error ? err.message : String(err)}`);
      });

      const embed = this.buildResponseEmbed(
        response,
        rateLimitResult,
        mode,
        file,
        contextText,
        userId,
        channelId,
        isDM
      );

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Failed to get AI response: ${errorMessage}`,
      });
    }
  }

  @Slash({
    name: "remember",
    description: "Tell the AI something to remember about you",
  })
  async remember(
    @SlashOption({
      name: "fact",
      description: "Something you want the AI to remember about you",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    fact: string,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    // Validate and sanitize
    const security = securityCheck(fact);
    if (security.shouldBlock) {
      await interaction.editReply({
        content: `❌ ${security.validation.reason ?? "Invalid input"}`,
      });
      return;
    }

    try {
      const success = await this.memoryManager.addMemory(interaction.user.id, security.safeText);

      if (success) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle("✅ Memory Saved")
          .setDescription(`I'll remember: "${security.safeText.slice(0, 200)}"`)
          .setFooter({
            text: "This information will be used in future conversations.",
          })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({
          content: "❌ Failed to save memory. The memory system may be unavailable.",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Failed to save memory: ${errorMessage}`,
      });
    }
  }

  @Slash({
    name: "forget",
    description: "Clear all memories the AI has about you",
  })
  async forget(interaction: CommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      const count = await this.memoryManager.deleteAllMemories(interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle("🗑️ Memories Cleared")
        .setDescription(
          count > 0
            ? `Cleared ${count} memories associated with your account.`
            : "You had no stored memories."
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply({
        content: `❌ Failed to clear memories: ${errorMessage}`,
      });
    }
  }

  /**
   * Process a file attachment for RAG context
   */
  private async processFileAttachment(
    file: Attachment
  ): Promise<{ success: boolean; text?: string; error?: string }> {
    // Check file type
    const isSupported =
      (file.contentType && SUPPORTED_TEXT_TYPES.has(file.contentType)) ||
      SUPPORTED_EXTENSIONS.has(this.getExtension(file.name));

    if (!isSupported) {
      return {
        success: false,
        error: `Unsupported file type. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`,
      };
    }

    // Check file size (max 100KB to prevent abuse)
    const maxSize = 100 * 1024;
    if (file.size > maxSize) {
      return {
        success: false,
        error: `File too large. Max size: ${maxSize / 1024}KB`,
      };
    }

    try {
      // Validate the URL is from Discord CDN
      // SECURITY: Discord attachment URLs should only come from Discord's CDN
      const parsedUrl = new URL(file.url);
      const allowedHosts = [
        "cdn.discordapp.com",
        "media.discordapp.net",
        "attachments.discordapp.com",
      ];
      if (!allowedHosts.includes(parsedUrl.hostname.toLowerCase())) {
        return { success: false, error: "Invalid attachment URL" };
      }
      if (!["https:"].includes(parsedUrl.protocol)) {
        return { success: false, error: "Invalid attachment URL protocol" };
      }

      // Fetch file content
      const response = await fetch(file.url, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: "Failed to download file" };
      }

      const text = await response.text();

      // Validate content
      const security = securityCheck(text);
      if (security.shouldBlock) {
        return {
          success: false,
          error: "File content blocked by security check",
        };
      }

      // Truncate if too long (max 8000 chars for context)
      const maxChars = 8000;
      const truncatedText =
        security.safeText.length > maxChars
          ? `${security.safeText.slice(0, maxChars)}\n... [Content truncated]`
          : security.safeText;

      return { success: true, text: truncatedText };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get file extension from filename
   */
  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf(".");
    return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : "";
  }

  @Slash({
    name: "summarize",
    description: "Summarize the last N messages in the channel",
  })
  async summarize(
    @SlashOption({
      name: "count",
      description: "Number of messages to summarize (5-50)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 5,
      maxValue: 50,
    })
    count: number | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    const messageCount = count ?? 20;

    if (!interaction.channel || !("messages" in interaction.channel)) {
      await interaction.editReply("Cannot access messages in this channel.");
      return;
    }

    try {
      const messages = await interaction.channel.messages.fetch({
        limit: messageCount,
      });

      const messageContent = messages
        .filter((m) => !m.author.bot && m.content.length > 0)
        .map((m) => `${m.author.username}: ${m.content}`)
        .reverse()
        .join("\n");

      if (!messageContent) {
        await interaction.editReply("No messages to summarize.");
        return;
      }

      const summary = await this.aiService.chat(
        `Please summarize the following conversation concisely:\n\n${messageContent}`,
        {
          temperature: 0.5,
          systemPrompt: "You are a summarization assistant. Create clear, concise summaries.",
        }
      );

      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle("📝 Conversation Summary")
        .setDescription(summary.slice(0, 4000))
        .setFooter({ text: `Summarized ${messages.size} messages` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply(`❌ Failed to summarize: ${errorMessage}`);
    }
  }

  @Slash({
    name: "translate",
    description: "Translate text to another language",
  })
  async translate(
    @SlashOption({
      name: "text",
      description: "Text to translate",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    text: string,
    @SlashChoice({ name: "Spanish", value: "Spanish" })
    @SlashChoice({ name: "French", value: "French" })
    @SlashChoice({ name: "German", value: "German" })
    @SlashChoice({ name: "Japanese", value: "Japanese" })
    @SlashChoice({ name: "Chinese", value: "Chinese" })
    @SlashChoice({ name: "Korean", value: "Korean" })
    @SlashChoice({ name: "Portuguese", value: "Portuguese" })
    @SlashChoice({ name: "Italian", value: "Italian" })
    @SlashOption({
      name: "language",
      description: "Target language",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    language: string,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply();

    try {
      const translation = await this.aiService.chat(
        `Translate the following text to ${language}. Only respond with the translation, nothing else:\n\n${text}`,
        {
          temperature: 0.3,
          systemPrompt: "You are a translation assistant. Translate accurately.",
        }
      );

      const embed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle(`🌐 Translation (${language})`)
        .addFields(
          { name: "Original", value: text.slice(0, 1000), inline: false },
          {
            name: "Translation",
            value: translation.slice(0, 1000),
            inline: false,
          }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply(`❌ Failed to translate: ${errorMessage}`);
    }
  }

  // Context menu for quick AI analysis of messages
  @ContextMenu({
    name: "Analyze Message",
    type: ApplicationCommandType.Message,
  })
  async analyzeMessage(interaction: MessageContextMenuCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const message = interaction.targetMessage;

    try {
      const analysis = await this.aiService.chat(
        `Analyze this message and provide insights about its tone, intent, and key points:\n\n"${message.content}"`,
        {
          temperature: 0.5,
          systemPrompt: "You are a message analysis assistant. Be objective and insightful.",
        }
      );

      const embed = new EmbedBuilder()
        .setColor(config.colors.info)
        .setTitle("🔍 Message Analysis")
        .setDescription(analysis.slice(0, 4000))
        .setFooter({ text: `Analyzed message from ${message.author.username}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply(`❌ Failed to analyze: ${errorMessage}`);
    }
  }

  // Context menu for user info with AI enhancement
  @ContextMenu({
    name: "AI User Greeting",
    type: ApplicationCommandType.User,
  })
  async userGreeting(interaction: UserContextMenuCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const targetUser = interaction.targetUser;

    try {
      const greeting = await this.aiService.chat(
        `Create a fun, friendly greeting for a Discord user named "${targetUser.username}". Make it creative and welcoming!`,
        {
          temperature: 0.9,
          systemPrompt: "You are a friendly Discord bot. Be creative and fun!",
        }
      );

      const embed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle(`👋 Greeting for ${targetUser.username}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(greeting.slice(0, 4000))
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply(`❌ Failed to generate greeting: ${errorMessage}`);
    }
  }
}
