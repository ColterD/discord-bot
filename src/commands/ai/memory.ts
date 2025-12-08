/**
 * Memory Management Slash Commands
 *
 * Provides user-facing commands for viewing, searching, and deleting their stored memories.
 * Implements `/memory view`, `/memory search`, and `/memory forget` subcommands.
 *
 * @see ROADMAP.md - User Memory Commands
 */

import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  type CommandInteraction,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { Discord, Guard, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  getChromaClient,
  type MemorySearchResult,
  type MemoryType,
} from "../../ai/memory/index.js";
import config from "../../config.js";
import { NotBot } from "../../guards/index.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("MemoryCommands");

/** Memory type display names */
const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user_profile: "📋 Profile",
  episodic: "💭 Episode",
  fact: "📚 Fact",
  preference: "❤️ Preference",
  procedural: "⚙️ Procedure",
};

/** Memory type descriptions for help */
const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, string> = {
  user_profile: "Personal info like name, job, location",
  episodic: "Conversation summaries and past events",
  fact: "General knowledge and facts you've shared",
  preference: "Your likes, dislikes, and preferences",
  procedural: "How you prefer to be interacted with",
};

/** Maximum memories per embed page */
const MEMORIES_PER_PAGE = 5;

/** Interaction timeout in milliseconds */
const INTERACTION_TIMEOUT_MS = 120_000;

@Discord()
@SlashGroup({ name: "memory", description: "View, search, and manage your stored memories" })
@SlashGroup("memory")
@Guard(NotBot)
export class MemoryCommands {
  /**
   * View all stored memories with optional type filtering
   */
  @Slash({
    name: "view",
    description: "View your stored memories",
  })
  async view(
    @SlashChoice({ name: "All Types", value: "all" })
    @SlashChoice({ name: "Profile Info", value: "user_profile" })
    @SlashChoice({ name: "Episodes", value: "episodic" })
    @SlashChoice({ name: "Facts", value: "fact" })
    @SlashChoice({ name: "Preferences", value: "preference" })
    @SlashChoice({ name: "Procedures", value: "procedural" })
    @SlashOption({
      name: "type",
      description: "Filter by memory type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    type: MemoryType | "all" | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!config.memory.enabled) {
      await interaction.editReply({
        content: "❌ Memory system is currently disabled.",
      });
      return;
    }

    try {
      const chroma = getChromaClient();
      const userId = interaction.user.id;

      // Get memories with optional type filter
      const typeFilter = type && type !== "all" ? [type] : undefined;
      const memories = await chroma.getAllMemories(userId, typeFilter);

      if (memories.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.info)
          .setTitle("🧠 Your Memories")
          .setDescription(
            type && type !== "all"
              ? `You have no stored ${MEMORY_TYPE_LABELS[type]} memories.`
              : "You have no stored memories yet.\n\nThe AI will learn and remember things about you as you chat!"
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Create paginated view
      await this.sendPaginatedMemories(interaction, memories, type ?? "all", 0);
    } catch (error) {
      log.error(`Failed to fetch memories: ${error}`);
      await interaction.editReply({
        content: `❌ Failed to retrieve memories: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  /**
   * Search memories by keyword/phrase
   */
  @Slash({
    name: "search",
    description: "Search your stored memories",
  })
  async search(
    @SlashOption({
      name: "query",
      description: "What to search for in your memories",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    query: string,
    @SlashOption({
      name: "limit",
      description: "Maximum results to return (1-20)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: 20,
    })
    limit: number | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!config.memory.enabled) {
      await interaction.editReply({
        content: "❌ Memory system is currently disabled.",
      });
      return;
    }

    // Validate query length
    if (query.length < 2) {
      await interaction.editReply({
        content: "❌ Search query must be at least 2 characters.",
      });
      return;
    }

    if (query.length > 200) {
      await interaction.editReply({
        content: "❌ Search query must be 200 characters or less.",
      });
      return;
    }

    try {
      const chroma = getChromaClient();
      const userId = interaction.user.id;
      const resultLimit = limit ?? 10;

      const results = await chroma.searchMemories(userId, query, resultLimit);

      if (results.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(config.colors.warning)
          .setTitle("🔍 Memory Search")
          .setDescription(`No memories found matching: **${query}**`)
          .setFooter({ text: "Try a different search term or browse with /memory view" })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Build results embed
      const embed = new EmbedBuilder()
        .setColor(config.colors.success)
        .setTitle("🔍 Memory Search Results")
        .setDescription(`Found **${results.length}** memories matching: **${query}**`)
        .setTimestamp();

      for (const memory of results.slice(0, 10)) {
        const typeLabel = MEMORY_TYPE_LABELS[memory.metadata.type] ?? "📝";
        const date = new Date(memory.metadata.timestamp).toLocaleDateString();
        const relevance = Math.round(memory.relevanceScore * 100);
        const content = this.truncateContent(memory.content, 200);

        embed.addFields({
          name: `${typeLabel} (${relevance}% match) — ${date}`,
          value: content,
          inline: false,
        });
      }

      if (results.length > 10) {
        embed.setFooter({
          text: `Showing top 10 of ${results.length} results`,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      log.error(`Failed to search memories: ${error}`);
      await interaction.editReply({
        content: `❌ Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }

  /**
   * Forget specific memories or all memories
   */
  @Slash({
    name: "forget",
    description: "Delete specific memories or all your stored memories",
  })
  async forget(
    @SlashChoice({ name: "Select specific memories to delete", value: "select" })
    @SlashChoice({ name: "Delete ALL my memories", value: "all" })
    @SlashOption({
      name: "mode",
      description: "How to delete memories",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    mode: "select" | "all",
    @SlashChoice({ name: "All Types", value: "all" })
    @SlashChoice({ name: "Profile Info", value: "user_profile" })
    @SlashChoice({ name: "Episodes", value: "episodic" })
    @SlashChoice({ name: "Facts", value: "fact" })
    @SlashChoice({ name: "Preferences", value: "preference" })
    @SlashChoice({ name: "Procedures", value: "procedural" })
    @SlashOption({
      name: "type",
      description: "Filter by memory type (only for 'select' mode)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    type: MemoryType | "all" | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    if (!config.memory.enabled) {
      await interaction.editReply({
        content: "❌ Memory system is currently disabled.",
      });
      return;
    }

    const userId = interaction.user.id;

    if (mode === "all") {
      // Confirm deletion of all memories
      await this.confirmDeleteAll(interaction, userId);
    } else {
      // Show selection UI
      await this.showMemorySelectionUI(interaction, userId, type ?? "all");
    }
  }

  /**
   * Send paginated memory view with navigation buttons
   */
  private async sendPaginatedMemories(
    interaction: CommandInteraction,
    memories: MemorySearchResult[],
    typeFilter: MemoryType | "all",
    page: number
  ): Promise<void> {
    const totalPages = Math.ceil(memories.length / MEMORIES_PER_PAGE);
    const startIdx = page * MEMORIES_PER_PAGE;
    const pageMemories = memories.slice(startIdx, startIdx + MEMORIES_PER_PAGE);

    // Build embed
    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle("🧠 Your Memories")
      .setDescription(
        typeFilter === "all"
          ? `You have **${memories.length}** stored memories`
          : `Showing **${MEMORY_TYPE_LABELS[typeFilter]}** memories (${memories.length} total)`
      )
      .setFooter({ text: `Page ${page + 1} of ${totalPages}` })
      .setTimestamp();

    for (const memory of pageMemories) {
      const typeLabel = MEMORY_TYPE_LABELS[memory.metadata.type] ?? "📝";
      const date = new Date(memory.metadata.timestamp).toLocaleDateString();
      const importance = Math.round(memory.metadata.importance * 100);
      const content = this.truncateContent(memory.content, 300);

      embed.addFields({
        name: `${typeLabel} — ${date} (${importance}% importance)`,
        value: content,
        inline: false,
      });
    }

    // Build navigation buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`memory_prev_${page}_${typeFilter}`)
        .setLabel("◀ Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`memory_next_${page}_${typeFilter}`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId("memory_stats")
        .setLabel("📊 Stats")
        .setStyle(ButtonStyle.Primary)
    );

    const message = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // Handle button interactions
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: INTERACTION_TIMEOUT_MS,
    });

    collector.on("collect", async (btnInteraction) => {
      if (btnInteraction.user.id !== interaction.user.id) {
        await btnInteraction.reply({
          content: "This menu is not for you.",
          ephemeral: true,
        });
        return;
      }

      await btnInteraction.deferUpdate();

      if (btnInteraction.customId === "memory_stats") {
        await this.showMemoryStats(interaction, memories);
        collector.stop();
        return;
      }

      const [, direction, , filter] = btnInteraction.customId.split("_");
      const newPage = direction === "prev" ? page - 1 : page + 1;
      await this.sendPaginatedMemories(
        interaction,
        memories,
        filter as MemoryType | "all",
        newPage
      );
      collector.stop();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        // Disable buttons after timeout
        const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("disabled_1")
            .setLabel("◀ Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId("disabled_2")
            .setLabel("Next ▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId("disabled_3")
            .setLabel("📊 Stats")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        );

        await interaction.editReply({ components: [disabledRow] }).catch(() => {
          // Message may have been deleted
        });
      }
    });
  }

  /**
   * Show memory statistics
   */
  private async showMemoryStats(
    interaction: CommandInteraction,
    memories: MemorySearchResult[]
  ): Promise<void> {
    // Count by type
    const typeCounts: Record<string, number> = {};
    let totalImportance = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;

    for (const memory of memories) {
      const type = memory.metadata.type;
      typeCounts[type] = (typeCounts[type] ?? 0) + 1;
      totalImportance += memory.metadata.importance;
      if (memory.metadata.timestamp < oldestTimestamp) {
        oldestTimestamp = memory.metadata.timestamp;
      }
      if (memory.metadata.timestamp > newestTimestamp) {
        newestTimestamp = memory.metadata.timestamp;
      }
    }

    const avgImportance = memories.length > 0 ? totalImportance / memories.length : 0;

    const embed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle("📊 Memory Statistics")
      .setDescription(`You have **${memories.length}** total stored memories`)
      .addFields(
        {
          name: "By Type",
          value:
            Object.entries(typeCounts)
              .map(([type, count]) => {
                const label = MEMORY_TYPE_LABELS[type as MemoryType] ?? type;
                return `${label}: **${count}**`;
              })
              .join("\n") || "No memories",
          inline: true,
        },
        {
          name: "Details",
          value: [
            `Average Importance: **${Math.round(avgImportance * 100)}%**`,
            `Oldest: **${new Date(oldestTimestamp).toLocaleDateString()}**`,
            `Newest: **${new Date(newestTimestamp).toLocaleDateString()}**`,
          ].join("\n"),
          inline: true,
        }
      )
      .addFields({
        name: "Memory Types Explained",
        value: Object.entries(MEMORY_TYPE_DESCRIPTIONS)
          .map(([type, desc]) => `${MEMORY_TYPE_LABELS[type as MemoryType]}: ${desc}`)
          .join("\n"),
        inline: false,
      })
      .setTimestamp();

    // Add back button
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("memory_back")
        .setLabel("◀ Back to Memories")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    // Handle back button
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: INTERACTION_TIMEOUT_MS,
    });

    collector.on("collect", async (btnInteraction) => {
      if (btnInteraction.user.id !== interaction.user.id) {
        await btnInteraction.reply({
          content: "This menu is not for you.",
          ephemeral: true,
        });
        return;
      }

      await btnInteraction.deferUpdate();
      await this.sendPaginatedMemories(interaction, memories, "all", 0);
      collector.stop();
    });
  }

  /**
   * Show confirmation dialog for deleting all memories
   */
  private async confirmDeleteAll(interaction: CommandInteraction, userId: string): Promise<void> {
    const chroma = getChromaClient();
    const memories = await chroma.getAllMemories(userId);

    if (memories.length === 0) {
      await interaction.editReply({
        content: "You have no memories to delete.",
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.error)
      .setTitle("⚠️ Confirm Delete All Memories")
      .setDescription(
        `You are about to delete **${memories.length}** memories.\n\n` +
          "**This action cannot be undone!**\n\n" +
          "The AI will forget everything it knows about you."
      )
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("memory_confirm_delete_all")
        .setLabel("🗑️ Yes, Delete Everything")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("memory_cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    // Handle confirmation
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30_000, // Shorter timeout for destructive action
    });

    collector.on("collect", async (btnInteraction) => {
      if (btnInteraction.user.id !== interaction.user.id) {
        await btnInteraction.reply({
          content: "This confirmation is not for you.",
          ephemeral: true,
        });
        return;
      }

      await btnInteraction.deferUpdate();

      if (btnInteraction.customId === "memory_confirm_delete_all") {
        try {
          const count = await chroma.deleteAllMemories(userId);
          log.info(`User ${userId} deleted all ${count} memories`);

          const successEmbed = new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle("🗑️ Memories Deleted")
            .setDescription(`Successfully deleted **${count}** memories.`)
            .setTimestamp();

          await interaction.editReply({ embeds: [successEmbed], components: [] });
        } catch (error) {
          log.error(`Failed to delete all memories: ${error}`);
          await interaction.editReply({
            content: `❌ Failed to delete memories: ${error instanceof Error ? error.message : "Unknown error"}`,
            components: [],
          });
        }
      } else {
        await interaction.editReply({
          content: "Deletion cancelled.",
          embeds: [],
          components: [],
        });
      }

      collector.stop();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction
          .editReply({
            content: "Confirmation timed out. No memories were deleted.",
            embeds: [],
            components: [],
          })
          .catch(() => {
            // Message may have been deleted
          });
      }
    });
  }

  /**
   * Show memory selection UI for selective deletion
   */
  private async showMemorySelectionUI(
    interaction: CommandInteraction,
    userId: string,
    typeFilter: MemoryType | "all"
  ): Promise<void> {
    const chroma = getChromaClient();
    const types = typeFilter === "all" ? undefined : [typeFilter];
    const memories = await chroma.getAllMemories(userId, types);

    if (memories.length === 0) {
      await interaction.editReply({
        content:
          typeFilter === "all"
            ? "You have no memories to delete."
            : `You have no ${MEMORY_TYPE_LABELS[typeFilter]} memories to delete.`,
      });
      return;
    }

    // Build select menu with up to 25 memories
    const options = memories.slice(0, 25).map((memory) => {
      const typeLabel = MEMORY_TYPE_LABELS[memory.metadata.type] ?? "📝";
      const content = this.truncateContent(memory.content, 80);
      const date = new Date(memory.metadata.timestamp).toLocaleDateString();

      return {
        label: `${typeLabel} ${content}`.slice(0, 100),
        description: `Added ${date}`,
        value: memory.id,
      };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("memory_select_delete")
      .setPlaceholder("Select memories to delete...")
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 10))
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("memory_cancel_select")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
      .setColor(config.colors.warning)
      .setTitle("🗑️ Select Memories to Delete")
      .setDescription(
        `Select up to 10 memories to delete.\n` +
          `Showing ${options.length} of ${memories.length} memories.`
      )
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed],
      components: [row, cancelRow],
    });

    // Handle selection
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      time: INTERACTION_TIMEOUT_MS,
    });

    collector.on("collect", async (componentInteraction) => {
      if (componentInteraction.user.id !== interaction.user.id) {
        await componentInteraction.reply({
          content: "This menu is not for you.",
          ephemeral: true,
        });
        return;
      }

      await componentInteraction.deferUpdate();

      if (componentInteraction.customId === "memory_cancel_select") {
        await interaction.editReply({
          content: "Deletion cancelled.",
          embeds: [],
          components: [],
        });
        collector.stop();
        return;
      }

      if (componentInteraction.isStringSelectMenu()) {
        const selectedIds = componentInteraction.values;
        let deletedCount = 0;

        for (const memoryId of selectedIds) {
          const success = await chroma.deleteMemory(memoryId);
          if (success) deletedCount++;
        }

        log.info(`User ${userId} deleted ${deletedCount} selected memories`);

        const successEmbed = new EmbedBuilder()
          .setColor(config.colors.success)
          .setTitle("🗑️ Memories Deleted")
          .setDescription(`Successfully deleted **${deletedCount}** memories.`)
          .setTimestamp();

        await interaction.editReply({
          embeds: [successEmbed],
          components: [],
        });

        collector.stop();
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction
          .editReply({
            content: "Selection timed out. No memories were deleted.",
            embeds: [],
            components: [],
          })
          .catch(() => {
            // Message may have been deleted
          });
      }
    });
  }

  /**
   * Truncate content with ellipsis
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) return content;
    return `${content.slice(0, maxLength - 3)}...`;
  }
}
