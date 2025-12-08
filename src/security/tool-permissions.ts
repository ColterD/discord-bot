/**
 * Tool Permissions
 * 4-tier permission system for tool access control
 *
 * SECURITY: Owner-only tools are completely hidden from non-owners
 * They don't appear in tool listings, error messages, or anywhere else
 */

import { config } from "../config.js";
import { getUserPermissionLevel, PermissionLevel } from "../guards/owner.guard.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ToolPermissions");

/**
 * Tool name validation pattern
 * Prevents injection attacks by ensuring tool names only contain safe characters
 * Allows: lowercase letters, digits, underscores, hyphens (must start with letter)
 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/i;

/**
 * Empty reason for hidden tools - indicates tool doesn't "exist" for this user
 * Using a constant makes the security intent explicit
 */
const HIDDEN_TOOL_REASON = "";

/**
 * Pre-computed permission Sets for O(1) lookup instead of O(n) array.includes()
 * Lazily initialized on first use to avoid startup overhead
 */
let permissionSets: {
  alwaysBlocked: Set<string>;
  ownerOnly: Set<string>;
  adminOnly: Set<string>;
  moderatorOnly: Set<string>;
} | null = null;

function getPermissionSets() {
  if (!permissionSets) {
    const { tools } = config.security;
    permissionSets = {
      alwaysBlocked: new Set(tools.alwaysBlocked),
      ownerOnly: new Set(tools.ownerOnly),
      adminOnly: new Set(tools.adminOnly),
      moderatorOnly: new Set(tools.moderatorOnly),
    };
  }
  return permissionSets;
}

/**
 * Validate that a tool name is safe
 */
function isValidToolName(toolName: string): boolean {
  return toolName.length > 0 && toolName.length <= 64 && TOOL_NAME_PATTERN.test(toolName);
}

/**
 * Tool permission tiers
 */
export enum ToolPermission {
  Public = 0, // Anyone can use
  ModeratorOnly = 1, // Moderators and above
  AdminOnly = 2, // Admins and above
  OwnerOnly = 3, // Owners only
  AlwaysBlocked = 4, // Never allowed (requires explicit override)
}

/**
 * Tool definition with permission
 */
export interface ToolWithPermission {
  name: string;
  permission: ToolPermission;
  description?: string;
}

/**
 * Check result with reason
 */
export interface ToolAccessResult {
  allowed: boolean;
  reason: string;
  visible: boolean; // Whether tool should be visible in listings
}

/**
 * Get the permission level required for a tool
 */
export function getToolPermission(toolName: string): ToolPermission {
  // Validate tool name to prevent injection attacks
  if (!isValidToolName(toolName)) {
    log.warn(`Invalid tool name rejected: ${toolName.slice(0, 64)}`);
    return ToolPermission.AlwaysBlocked;
  }

  const sets = getPermissionSets();

  // Check always blocked first (O(1) Set lookup)
  if (sets.alwaysBlocked.has(toolName)) {
    return ToolPermission.AlwaysBlocked;
  }

  // Check owner-only
  if (sets.ownerOnly.has(toolName)) {
    return ToolPermission.OwnerOnly;
  }

  // Check admin-only
  if (sets.adminOnly.has(toolName)) {
    return ToolPermission.AdminOnly;
  }

  // Check moderator-only
  if (sets.moderatorOnly.has(toolName)) {
    return ToolPermission.ModeratorOnly;
  }

  // Default: public
  return ToolPermission.Public;
}

/**
 * Check if a user can access a tool
 */
export function checkToolAccess(userId: string, toolName: string): ToolAccessResult {
  const userLevel = getUserPermissionLevel(userId);
  const toolPermission = getToolPermission(toolName);

  // Always blocked - nobody can use
  if (toolPermission === ToolPermission.AlwaysBlocked) {
    return {
      allowed: false,
      reason: "This tool is disabled for security reasons",
      visible: userLevel === PermissionLevel.Owner, // Only owners can see it's blocked
    };
  }

  // Owner-only tools
  if (toolPermission === ToolPermission.OwnerOnly) {
    if (userLevel === PermissionLevel.Owner) {
      return {
        allowed: true,
        reason: "Owner access granted",
        visible: true,
      };
    }
    // CRITICAL: Non-owners don't see owner-only tools at all
    return {
      allowed: false,
      reason: HIDDEN_TOOL_REASON,
      visible: false,
    };
  }

  // Admin-only tools
  if (toolPermission === ToolPermission.AdminOnly) {
    if (userLevel >= PermissionLevel.Admin) {
      return {
        allowed: true,
        reason: "Admin access granted",
        visible: true,
      };
    }
    return {
      allowed: false,
      reason: "This tool requires administrator privileges",
      visible: true,
    };
  }

  // Moderator-only tools
  if (toolPermission === ToolPermission.ModeratorOnly) {
    if (userLevel >= PermissionLevel.Moderator) {
      return {
        allowed: true,
        reason: "Moderator access granted",
        visible: true,
      };
    }
    return {
      allowed: false,
      reason: "This tool requires moderator privileges",
      visible: true,
    };
  }

  // Public tools - everyone can use
  return {
    allowed: true,
    reason: "Public access",
    visible: true,
  };
}

/**
 * Filter a list of tools to only those visible to a user
 * Owner-only tools are completely removed for non-owners
 */
export function filterToolsForUser<T extends { name: string }>(tools: T[], userId: string): T[] {
  return tools.filter((tool) => {
    const access = checkToolAccess(userId, tool.name);
    return access.visible;
  });
}

/**
 * Get all tools a user can execute (not just see)
 */
export function getExecutableToolsForUser<T extends { name: string }>(
  tools: T[],
  userId: string
): T[] {
  return tools.filter((tool) => {
    const access = checkToolAccess(userId, tool.name);
    return access.allowed;
  });
}

/**
 * Check if a tool exists in the allowed tools for a user
 * Returns false for hidden tools (prevents enumeration)
 */
export function isToolVisibleToUser(toolName: string, userId: string): boolean {
  return checkToolAccess(userId, toolName).visible;
}

/**
 * Get a generic "tool not found" message
 * Used instead of revealing restricted tool exists
 */
export function getToolNotFoundMessage(): string {
  return "I don't have a tool with that name available.";
}
