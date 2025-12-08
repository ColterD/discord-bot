import {
  ApplicationCommandOptionType,
  ChannelType,
  type CommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { getConversationService } from "../../ai/conversation.js";
import config from "../../config.js";

@Discord()
export class UtilityCommands {
  @Slash({
    name: "ping",
    description: "Check bot latency and response time",
  })
  async ping(interaction: CommandInteraction): Promise<void> {
    const { resource: sent } = await interaction.reply({
      content: "🏓 Pinging...",
      withResponse: true,
    });

    const roundtrip =
      (sent?.message?.createdTimestamp ?? Date.now()) - interaction.createdTimestamp;
    const wsLatency = interaction.client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle("🏓 Pong!")
      .addFields(
        { name: "Roundtrip", value: `${roundtrip}ms`, inline: true },
        { name: "WebSocket", value: `${wsLatency}ms`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
  }

  @Slash({
    name: "info",
    description: "Get information about the bot",
  })
  async info(interaction: CommandInteraction): Promise<void> {
    const { client } = interaction;

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`📊 ${client.user?.username ?? "Bot"} Info`)
      .setThumbnail(client.user?.displayAvatarURL() ?? "")
      .addFields(
        { name: "Guilds", value: `${client.guilds.cache.size}`, inline: true },
        { name: "Users", value: `${client.users.cache.size}`, inline: true },
        {
          name: "Uptime",
          value: formatUptime(client.uptime ?? 0),
          inline: true,
        },
        {
          name: "Node.js",
          value: process.version,
          inline: true,
        },
        {
          name: "Memory",
          value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  @Slash({
    name: "avatar",
    description: "Get a user's avatar",
  })
  async avatar(
    @SlashOption({
      name: "user",
      description: "The user to get the avatar of",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    targetUser: CommandInteraction["user"] | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    const user = targetUser ?? interaction.user;

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${user.username}'s Avatar`)
      .setImage(user.displayAvatarURL({ size: 4096 }))
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  @Slash({
    name: "server",
    description: "Get information about the server",
  })
  async server(interaction: CommandInteraction): Promise<void> {
    const { guild } = interaction;

    if (!guild) {
      await interaction.reply({
        content: "This command can only be used in a server!",
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`📊 ${guild.name}`)
      .setThumbnail(guild.iconURL() ?? "")
      .addFields(
        { name: "Owner", value: `<@${guild.ownerId}>`, inline: true },
        { name: "Members", value: `${guild.memberCount}`, inline: true },
        {
          name: "Created",
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
        {
          name: "Channels",
          value: `${guild.channels.cache.size}`,
          inline: true,
        },
        { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
        {
          name: "Boost Level",
          value: `${guild.premiumTier}`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  @Slash({
    name: "ai-status",
    description: "Check the status of the AI service",
  })
  async aiStatus(interaction: CommandInteraction): Promise<void> {
    const conversationService = getConversationService();
    const available = await conversationService.checkAvailability();
    const status = conversationService.getAvailabilityStatus();

    const embed = new EmbedBuilder()
      .setColor(available ? config.colors.success : config.colors.error)
      .setTitle("🤖 AI Status")
      .addFields(
        {
          name: "Status",
          value: available ? "✅ Online" : "❌ Offline",
          inline: true,
        },
        {
          name: "Model",
          value: config.llm.model.split("/").pop() || config.llm.model,
          inline: true,
        },
        {
          name: "Last Check",
          value: status.lastCheck ? `<t:${Math.floor(status.lastCheck / 1000)}:R>` : "Never",
          inline: true,
        }
      )
      .setDescription(
        available
          ? "The AI is ready! You can chat with me by mentioning me, replying to my messages, or sending me a DM."
          : "The AI service is currently unavailable. Slash commands still work!"
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  @Slash({
    name: "clear-context",
    description: "Clear the conversation context/memory with the AI",
  })
  async clearContext(interaction: CommandInteraction): Promise<void> {
    const conversationService = getConversationService();

    // Generate context ID same as in message handler - PER USER even in channels
    const contextId =
      interaction.channel?.type === ChannelType.DM
        ? `dm-${interaction.user.id}`
        : `channel-${interaction.channelId}-user-${interaction.user.id}`;

    conversationService.clearContext(contextId);

    await interaction.reply({
      content: "🧹 Conversation context cleared! I've forgotten our previous conversation.",
      ephemeral: true,
    });
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
