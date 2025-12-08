import type {
  CommandInteraction,
  ContextMenuCommandInteraction,
  PermissionResolvable,
} from "discord.js";
import type { GuardFunction } from "discordx";

/**
 * Permission Guard
 * Checks if user has required permissions
 */
export function PermissionGuard(
  ...permissions: PermissionResolvable[]
): GuardFunction<CommandInteraction | ContextMenuCommandInteraction> {
  return async (interaction, _client, next) => {
    // Check if in guild
    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        content: "❌ This command can only be used in a server!",
        ephemeral: true,
      });
      return;
    }

    // Get member permissions
    const memberPermissions =
      typeof interaction.member.permissions === "string" ? null : interaction.member.permissions;

    if (!memberPermissions) {
      await interaction.reply({
        content: "❌ Could not verify your permissions.",
        ephemeral: true,
      });
      return;
    }

    // Check each required permission
    const missingPermissions = permissions.filter((perm) => !memberPermissions.has(perm));

    if (missingPermissions.length > 0) {
      await interaction.reply({
        content: `❌ You are missing the following permissions: ${missingPermissions.join(", ")}`,
        ephemeral: true,
      });
      return;
    }

    await next();
  };
}
