/**
 * Security module exports
 *
 * Provides security utilities for:
 * - Tool permission management (4-tier access control)
 * - Prompt injection and impersonation detection
 */

export {
  type DetectionResult,
  detectImpersonation,
  isImpersonatingRole,
  quickInjectionCheck,
  type ThreatDetail,
} from "./impersonation-detector.js";
export {
  checkToolAccess,
  filterToolsForUser,
  getExecutableToolsForUser,
  getToolNotFoundMessage,
  getToolPermission,
  isToolVisibleToUser,
  type ToolAccessResult,
  ToolPermission,
  type ToolWithPermission,
} from "./tool-permissions.js";
