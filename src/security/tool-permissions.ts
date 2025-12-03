/**
 * Tool Permissions
 * 4-tier permission system for tool access control
 *
 * SECURITY: Owner-only tools are completely hidden from non-owners
 * They don't appear in tool listings, error messages, or anywhere else
 */

import { config } from "../config.js";
import {
  PermissionLevel,
  getUserPermissionLevel,
} from "../guards/owner.guard.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ToolPermissions");

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
  const { tools } = config.security;

  // Check always blocked first
  if ((tools.alwaysBlocked as readonly string[]).includes(toolName)) {
    return ToolPermission.AlwaysBlocked;
  }

  // Check owner-only
  if ((tools.ownerOnly as readonly string[]).includes(toolName)) {
    return ToolPermission.OwnerOnly;
  }

  // Check admin-only
  if ((tools.adminOnly as readonly string[]).includes(toolName)) {
    return ToolPermission.AdminOnly;
  }

  // Check moderator-only
  if ((tools.moderatorOnly as readonly string[]).includes(toolName)) {
    return ToolPermission.ModeratorOnly;
  }

  // Default: public
  return ToolPermission.Public;
}

/**
 * Check if a user can access a tool
 */
export function checkToolAccess(
  userId: string,
  toolName: string
): ToolAccessResult {
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
      reason: "", // Empty reason - tool doesn't "exist" for this user
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
export function filterToolsForUser<T extends { name: string }>(
  tools: T[],
  userId: string
): T[] {
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
 * Log a tool access attempt
 */
export function logToolAccess(
  userId: string,
  toolName: string,
  result: ToolAccessResult
): void {
  if (result.allowed) {
    log.debug(`User ${userId} accessed tool ${toolName}: ${result.reason}`);
  } else {
    log.info(
      `User ${userId} denied access to tool ${toolName}: ${
        result.reason || "hidden tool"
      }`
    );
  }
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
