/**
 * Security module exports
 *
 * Provides security utilities for:
 * - Tool permission management (4-tier access control)
 * - Prompt injection and impersonation detection
 */

export {
  ToolPermission,
  checkToolAccess,
  filterToolsForUser,
  getExecutableToolsForUser,
  getToolPermission,
  isToolVisibleToUser,
  logToolAccess,
  getToolNotFoundMessage,
  type ToolWithPermission,
  type ToolAccessResult,
} from "./tool-permissions.js";

export {
  detectImpersonation,
  quickInjectionCheck,
  isImpersonatingRole,
  type ThreatDetail,
  type DetectionResult,
} from "./impersonation-detector.js";
