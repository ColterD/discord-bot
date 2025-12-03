/**
 * Impersonation Detector
 * Hybrid 3-layer detection for prompt injection and impersonation attacks
 *
 * Layers:
 * 1. Pattern Detection - Known attack patterns
 * 2. Name Similarity - Levenshtein distance for username spoofing
 * 3. Semantic Analysis - LLM-based detection (optional, CPU model)
 */

import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ImpersonationDetector");

/**
 * Detection result with details
 */
export interface DetectionResult {
  detected: boolean;
  confidence: number; // 0.0 - 1.0
  threats: ThreatDetail[];
  sanitizedContent?: string | undefined;
}

/**
 * Individual threat detail
 */
export interface ThreatDetail {
  type: "pattern" | "name_similarity" | "semantic";
  description: string;
  matched: string;
  severity: "low" | "medium" | "high" | "critical";
}

/**
 * Known usernames to protect from impersonation
 */
const PROTECTED_NAMES = [
  "owner",
  "admin",
  "administrator",
  "moderator",
  "system",
  "bot",
  "discord",
  "staff",
];

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Create distance matrix
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0) as number[]);

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1, // Deletion
        dp[i]![j - 1]! + 1, // Insertion
        dp[i - 1]![j - 1]! + cost // Substitution
      );
    }
  }

  return dp[m]![n]!;
}

/**
 * Calculate string similarity (0.0 - 1.0)
 */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);

  return 1 - distance / maxLength;
}

/**
 * Layer 1: Pattern-based detection
 */
function detectPatterns(content: string): ThreatDetail[] {
  const threats: ThreatDetail[] = [];
  const patterns = config.security.impersonation.suspiciousPatterns;

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      threats.push({
        type: "pattern",
        description: "Suspicious pattern detected",
        matched: match[0],
        severity: getSeverityFromPattern(pattern),
      });
    }
  }

  return threats;
}

/**
 * Determine severity based on pattern type
 */
function getSeverityFromPattern(pattern: RegExp): ThreatDetail["severity"] {
  const patternStr = pattern.source.toLowerCase();

  // Critical: Direct impersonation attempts
  if (
    patternStr.includes("owner") ||
    patternStr.includes("admin") ||
    patternStr.includes("system")
  ) {
    return "critical";
  }

  // High: Prompt injection attempts
  if (
    patternStr.includes("ignore") ||
    patternStr.includes("override") ||
    patternStr.includes("instructions")
  ) {
    return "high";
  }

  // Medium: Privilege escalation attempts
  if (patternStr.includes("grant") || patternStr.includes("access")) {
    return "medium";
  }

  return "low";
}

/**
 * Layer 2: Name similarity detection
 */
function detectNameSimilarity(
  displayName: string,
  username: string
): ThreatDetail[] {
  const threats: ThreatDetail[] = [];
  const threshold = config.security.impersonation.similarityThreshold;

  // Check against protected names
  for (const protectedName of PROTECTED_NAMES) {
    const displaySimilarity = stringSimilarity(displayName, protectedName);
    const usernameSimilarity = stringSimilarity(username, protectedName);

    if (displaySimilarity >= threshold) {
      threats.push({
        type: "name_similarity",
        description: `Display name similar to protected name "${protectedName}"`,
        matched: displayName,
        severity: displaySimilarity >= 0.9 ? "critical" : "high",
      });
    }

    if (usernameSimilarity >= threshold) {
      threats.push({
        type: "name_similarity",
        description: `Username similar to protected name "${protectedName}"`,
        matched: username,
        severity: usernameSimilarity >= 0.9 ? "critical" : "high",
      });
    }
  }

  // Check for unicode homoglyphs (lookalike characters)
  const normalizedDisplay = normalizeHomoglyphs(displayName);
  if (normalizedDisplay !== displayName.toLowerCase()) {
    for (const protectedName of PROTECTED_NAMES) {
      if (stringSimilarity(normalizedDisplay, protectedName) >= threshold) {
        threats.push({
          type: "name_similarity",
          description: "Unicode homoglyph attack detected",
          matched: displayName,
          severity: "critical",
        });
        break;
      }
    }
  }

  return threats;
}

/**
 * Normalize unicode homoglyphs to ASCII equivalents
 */
function normalizeHomoglyphs(str: string): string {
  const homoglyphMap: Record<string, string> = {
    // Common Latin-lookalike characters
    а: "a", // Cyrillic
    е: "e", // Cyrillic
    і: "i", // Cyrillic
    о: "o", // Cyrillic
    р: "p", // Cyrillic
    с: "c", // Cyrillic
    х: "x", // Cyrillic
    у: "y", // Cyrillic
    ω: "w", // Greek
    ν: "v", // Greek
    // Mathematical/special characters
    "𝐚": "a",
    "𝐛": "b",
    "𝐨": "o",
    // Zero-width characters (just remove)
    "\u200B": "", // Zero-width space
    "\u200C": "", // Zero-width non-joiner
    "\u200D": "", // Zero-width joiner
    "\uFEFF": "", // BOM
  };

  let result = str.toLowerCase();
  for (const [homoglyph, replacement] of Object.entries(homoglyphMap)) {
    result = result.split(homoglyph).join(replacement);
  }

  return result;
}

/**
 * Sanitize content by removing/neutralizing threats
 */
function sanitizeContent(content: string): string {
  let sanitized = content;

  // Escape/mark potential injection attempts
  const patterns = config.security.impersonation.suspiciousPatterns;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, (match) => `[BLOCKED: ${match}]`);
  }

  // Remove zero-width characters
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, "");

  return sanitized;
}

/**
 * Main detection function
 */
export function detectImpersonation(
  content: string,
  displayName: string,
  username: string
): DetectionResult {
  if (!config.security.impersonation.enabled) {
    return {
      detected: false,
      confidence: 0,
      threats: [],
    };
  }

  const threats: ThreatDetail[] = [];

  // Layer 1: Pattern detection
  threats.push(...detectPatterns(content));

  // Layer 2: Name similarity
  threats.push(...detectNameSimilarity(displayName, username));

  // Calculate overall confidence
  let confidence = 0;
  if (threats.length > 0) {
    const severityWeights = {
      low: 0.2,
      medium: 0.4,
      high: 0.7,
      critical: 1.0,
    };

    const maxWeight = Math.max(
      ...threats.map((t) => severityWeights[t.severity])
    );
    const avgWeight =
      threats.reduce((sum, t) => sum + severityWeights[t.severity], 0) /
      threats.length;

    // Confidence increases with more threats and higher severity
    confidence = Math.min(0.5 * maxWeight + 0.5 * avgWeight, 1.0);
  }

  const detected = threats.length > 0 && confidence >= 0.3;

  if (detected) {
    log.warn(
      `Impersonation attempt detected for ${username}: ` +
        threats.map((t) => t.description).join(", ")
    );
  }

  return {
    detected,
    confidence,
    threats,
    sanitizedContent: detected ? sanitizeContent(content) : undefined,
  };
}

/**
 * Quick check for obvious injection attempts
 * Fast path for common cases
 */
export function quickInjectionCheck(content: string): boolean {
  // Fast regex checks for common patterns
  const quickPatterns = [
    /\[system\]/i,
    /\[admin\]/i,
    /ignore\s+(all\s+)?previous/i,
    /you\s+are\s+(now\s+)?the\s+owner/i,
  ];

  return quickPatterns.some((p) => p.test(content));
}

/**
 * Check if a user appears to be impersonating a protected role
 */
export function isImpersonatingRole(
  displayName: string,
  username: string
): boolean {
  const threshold = config.security.impersonation.similarityThreshold;

  for (const protectedName of PROTECTED_NAMES) {
    if (
      stringSimilarity(displayName, protectedName) >= threshold ||
      stringSimilarity(username, protectedName) >= threshold
    ) {
      return true;
    }
  }

  return false;
}
