import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import { Discord, SelectMenuComponent } from "discordx";
import config from "../config.js";

@Discord()
export class SelectMenuComponents {
  /**
   * Language selection for translation
   */
  @SelectMenuComponent({ id: "language_select" })
  async handleLanguageSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const selectedLanguage = interaction.values[0];

    await interaction.update({
      content: `🌐 Selected language: **${selectedLanguage}**`,
      components: [],
    });
  }

  /**
   * AI model selection
   */
  @SelectMenuComponent({ id: "model_select" })
  async handleModelSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const selectedModel = interaction.values[0];

    await interaction.update({
      content: `🤖 AI Model set to: **${selectedModel}**`,
      components: [],
    });
  }

  /**
   * Category selection for help
   */
  @SelectMenuComponent({ id: "help_category" })
  async handleHelpCategory(interaction: StringSelectMenuInteraction): Promise<void> {
    const category = interaction.values[0];
    if (!category) {
      await interaction.update({
        content: "❌ No category selected.",
        components: [],
      });
      return;
    }

    const categoryInfo: Record<string, { title: string; description: string }> = {
      utility: {
        title: "🔧 Utility Commands",
        description:
          "`/ping` - Check latency\n`/info` - Bot information\n`/avatar` - Get user avatar\n`/server` - Server information",
      },
      moderation: {
        title: "🛡️ Moderation Commands",
        description: "`/kick` - Kick a member\n`/ban` - Ban a member\n`/clear` - Clear messages",
      },
      ai: {
        title: "🤖 AI Commands",
        description:
          "`/ask` - Ask the AI a question\n`/summarize` - Summarize text\n`/translate` - Translate text",
      },
    };

    const selectedCategory = categoryInfo[category];
    const info = selectedCategory ?? {
      title: "Unknown Category",
      description: "No information available.",
    };

    const embed = new EmbedBuilder()
      .setTitle(info.title)
      .setDescription(info.description)
      .setColor(config.colors.primary);

    await interaction.update({
      embeds: [embed],
      components: [],
    });
  }
}

/**
 * Create a language selection menu
 */
export function createLanguageSelectMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("language_select")
      .setPlaceholder("Select a language...")
      .addOptions([
        { label: "English", value: "english", emoji: "🇬🇧" },
        { label: "Spanish", value: "spanish", emoji: "🇪🇸" },
        { label: "French", value: "french", emoji: "🇫🇷" },
        { label: "German", value: "german", emoji: "🇩🇪" },
        { label: "Japanese", value: "japanese", emoji: "🇯🇵" },
        { label: "Chinese", value: "chinese", emoji: "🇨🇳" },
        { label: "Korean", value: "korean", emoji: "🇰🇷" },
        { label: "Portuguese", value: "portuguese", emoji: "🇵🇹" },
        { label: "Russian", value: "russian", emoji: "🇷🇺" },
        { label: "Italian", value: "italian", emoji: "🇮🇹" },
      ])
  );
}

/**
 * Create a help category selection menu
 */
export function createHelpCategoryMenu(): ActionRowBuilder<StringSelectMenuBuilder> {
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_category")
      .setPlaceholder("Select a command category...")
      .addOptions([
        {
          label: "Utility",
          value: "utility",
          description: "General utility commands",
          emoji: "🔧",
        },
        {
          label: "Moderation",
          value: "moderation",
          description: "Server moderation commands",
          emoji: "🛡️",
        },
        {
          label: "AI",
          value: "ai",
          description: "AI-powered commands",
          emoji: "🤖",
        },
      ])
  );
}

export default SelectMenuComponents;
