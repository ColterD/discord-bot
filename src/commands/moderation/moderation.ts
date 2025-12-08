import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  EmbedBuilder,
  type GuildMember,
  PermissionFlagsBits,
} from "discord.js";
import { Discord, Guard, Slash, SlashOption } from "discordx";
import config from "../../config.js";
import { PermissionGuard } from "../../guards/permission.guard.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("Moderation");

@Discord()
export class ModerationCommands {
  @Slash({
    name: "kick",
    description: "Kick a member from the server",
    defaultMemberPermissions: PermissionFlagsBits.KickMembers,
  })
  @Guard(PermissionGuard(PermissionFlagsBits.KickMembers))
  async kick(
    @SlashOption({
      name: "member",
      description: "The member to kick",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    target: GuildMember,
    @SlashOption({
      name: "reason",
      description: "Reason for the kick",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server!",
        ephemeral: true,
      });
      return;
    }

    const member = interaction.guild.members.cache.get(target.id);
    if (!member) {
      await interaction.reply({
        content: "Member not found!",
        ephemeral: true,
      });
      return;
    }

    if (!member.kickable) {
      await interaction.reply({
        content: "I cannot kick this member! They may have higher permissions.",
        ephemeral: true,
      });
      return;
    }

    const kickReason = reason ?? "No reason provided";

    try {
      await member.kick(kickReason);

      const embed = new EmbedBuilder()
        .setColor(config.colors.warning)
        .setTitle("👢 Member Kicked")
        .addFields(
          { name: "Member", value: target.user.tag, inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
          { name: "Reason", value: kickReason, inline: false }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      log.error(`Failed to kick ${target.user.tag}:`, error as Error);
      await interaction.reply({
        content: "Failed to kick the member.",
        ephemeral: true,
      });
    }
  }

  @Slash({
    name: "ban",
    description: "Ban a member from the server",
    defaultMemberPermissions: PermissionFlagsBits.BanMembers,
  })
  @Guard(PermissionGuard(PermissionFlagsBits.BanMembers))
  async ban(
    @SlashOption({
      name: "member",
      description: "The member to ban",
      type: ApplicationCommandOptionType.User,
      required: true,
    })
    target: GuildMember,
    @SlashOption({
      name: "reason",
      description: "Reason for the ban",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    reason: string | undefined,
    @SlashOption({
      name: "delete_days",
      description: "Days of messages to delete (0-7)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 0,
      maxValue: 7,
    })
    deleteDays: number | undefined,
    interaction: CommandInteraction
  ): Promise<void> {
    if (!interaction.guild) {
      await interaction.reply({
        content: "This command can only be used in a server!",
        ephemeral: true,
      });
      return;
    }

    const member = interaction.guild.members.cache.get(target.id);
    if (!member) {
      await interaction.reply({
        content: "Member not found!",
        ephemeral: true,
      });
      return;
    }

    if (!member.bannable) {
      await interaction.reply({
        content: "I cannot ban this member! They may have higher permissions.",
        ephemeral: true,
      });
      return;
    }

    const banReason = reason ?? "No reason provided";

    try {
      await member.ban({
        reason: banReason,
        deleteMessageSeconds: (deleteDays ?? 0) * 24 * 60 * 60,
      });

      const embed = new EmbedBuilder()
        .setColor(config.colors.error)
        .setTitle("🔨 Member Banned")
        .addFields(
          { name: "Member", value: target.user.tag, inline: true },
          { name: "Moderator", value: interaction.user.tag, inline: true },
          { name: "Reason", value: banReason, inline: false }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      log.error(`Failed to ban ${target.user.tag}:`, error as Error);
      await interaction.reply({
        content: "Failed to ban the member.",
        ephemeral: true,
      });
    }
  }

  @Slash({
    name: "clear",
    description: "Clear messages from the channel",
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
  })
  @Guard(PermissionGuard(PermissionFlagsBits.ManageMessages))
  async clear(
    @SlashOption({
      name: "amount",
      description: "Number of messages to delete (1-100)",
      type: ApplicationCommandOptionType.Integer,
      required: true,
      minValue: 1,
      maxValue: 100,
    })
    amount: number,
    interaction: CommandInteraction
  ): Promise<void> {
    if (!interaction.channel || !("bulkDelete" in interaction.channel)) {
      await interaction.reply({
        content: "This command can only be used in a text channel!",
        ephemeral: true,
      });
      return;
    }

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);

      await interaction.reply({
        content: `🧹 Deleted ${deleted.size} message(s).`,
        ephemeral: true,
      });
    } catch (error) {
      log.error(`Failed to bulk delete ${amount} messages:`, error as Error);
      await interaction.reply({
        content: "Failed to delete messages. Messages older than 14 days cannot be bulk deleted.",
        ephemeral: true,
      });
    }
  }
}
