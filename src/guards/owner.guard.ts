/**
 * Owner Guard
 * Restricts commands to bot owner(s) only
 * Expandable permission system for future role-based access
 */

import type { GuardFunction } from "discordx";
import type {
  CommandInteraction,
  ContextMenuCommandInteraction,
  MessageComponentInteraction,
} from "discord.js";

// Permission levels (expandable)
export enum PermissionLevel {
  User = 0,
  Moderator = 1,
  Admin = 2,
  Owner = 3,
}

// Configuration - load from env or config file
interface PermissionConfig {
  ownerIds: Set<string>;
  adminIds: Set<string>;
  moderatorIds: Set<string>;
}

// Parse comma-separated IDs from environment
function parseIdList(envVar: string | undefined): Set<string> {
  if (!envVar) return new Set();
  return new Set(
    envVar
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
}

// Load configuration
function loadConfig(): PermissionConfig {
  return {
    ownerIds: parseIdList(process.env.BOT_OWNER_IDS),
    adminIds: parseIdList(process.env.BOT_ADMIN_IDS),
    moderatorIds: parseIdList(process.env.BOT_MODERATOR_IDS),
  };
}

let config: PermissionConfig | null = null;

function getConfig(): PermissionConfig {
  config ??= loadConfig();
  return config;
}

/**
 * Get a user's permission level
 */
export function getUserPermissionLevel(userId: string): PermissionLevel {
  const cfg = getConfig();

  if (cfg.ownerIds.has(userId)) return PermissionLevel.Owner;
  if (cfg.adminIds.has(userId)) return PermissionLevel.Admin;
  if (cfg.moderatorIds.has(userId)) return PermissionLevel.Moderator;
  return PermissionLevel.User;
}

/**
 * Check if a user has at least the required permission level
 */
export function hasPermissionLevel(userId: string, requiredLevel: PermissionLevel): boolean {
  return getUserPermissionLevel(userId) >= requiredLevel;
}

/**
 * Reload configuration (useful if env changes)
 */
export function reloadPermissionConfig(): void {
  config = loadConfig();
}

type SupportedInteraction =
  | CommandInteraction
  | ContextMenuCommandInteraction
  | MessageComponentInteraction;

/**
 * Owner Guard - Only allows bot owners
 */
export function OwnerGuard(): GuardFunction<SupportedInteraction> {
  return async (interaction, _client, next) => {
    if (!hasPermissionLevel(interaction.user.id, PermissionLevel.Owner)) {
      await interaction.reply({
        content: "🔒 This command is restricted to bot owners only.",
        ephemeral: true,
      });
      return;
    }
    await next();
  };
}

/**
 * Admin Guard - Allows admins and owners
 */
export function AdminGuard(): GuardFunction<SupportedInteraction> {
  return async (interaction, _client, next) => {
    if (!hasPermissionLevel(interaction.user.id, PermissionLevel.Admin)) {
      await interaction.reply({
        content: "🔒 This command is restricted to bot administrators only.",
        ephemeral: true,
      });
      return;
    }
    await next();
  };
}

/**
 * Moderator Guard - Allows moderators, admins, and owners
 */
export function ModeratorGuard(): GuardFunction<SupportedInteraction> {
  return async (interaction, _client, next) => {
    if (!hasPermissionLevel(interaction.user.id, PermissionLevel.Moderator)) {
      await interaction.reply({
        content: "🔒 This command is restricted to bot moderators only.",
        ephemeral: true,
      });
      return;
    }
    await next();
  };
}

/**
 * Require Permission Level Guard - Generic guard for any level
 */
export function RequirePermissionLevel(
  level: PermissionLevel
): GuardFunction<SupportedInteraction> {
  return async (interaction, _client, next) => {
    if (!hasPermissionLevel(interaction.user.id, level)) {
      const levelNames = ["users", "moderators", "administrators", "owners"];
      await interaction.reply({
        content: `🔒 This command requires ${levelNames[level]} access or higher.`,
        ephemeral: true,
      });
      return;
    }
    await next();
  };
}

export default OwnerGuard;
