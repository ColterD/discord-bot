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
 * Initialize the distance matrix for Levenshtein calculation
 */
function initializeMatrix(m: number, n: number): number[][] {
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  return dp;
}

/**
 * Get value from matrix safely with default fallback
 */
function getMatrixValue(dp: number[][], row: number, col: number): number {
  return dp[row]?.[col] ?? 0;
}

/**
 * Maximum input length for Levenshtein distance calculation
 * Longer strings would create O(n*m) memory usage, risking DoS
 */
const MAX_LEVENSHTEIN_INPUT_LENGTH = 1000;

/**
 * Calculate Levenshtein distance between two strings
 * Protected against DoS via input length limit
 */
function levenshteinDistance(str1: string, str2: string): number {
  // DoS protection: Limit input length to prevent memory exhaustion
  // O(n*m) memory for very long strings could crash the process
  if (str1.length > MAX_LEVENSHTEIN_INPUT_LENGTH || str2.length > MAX_LEVENSHTEIN_INPUT_LENGTH) {
    // Fall back to simple length-based comparison for very long strings
    return str1 === str2 ? 0 : Math.max(str1.length, str2.length);
  }

  const m = str1.length;
  const n = str2.length;
  const dp = initializeMatrix(m, n);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const deletion = getMatrixValue(dp, i - 1, j) + 1;
      const insertion = getMatrixValue(dp, i, j - 1) + 1;
      const substitution = getMatrixValue(dp, i - 1, j - 1) + cost;

      const row = dp[i];
      if (row) {
        row[j] = Math.min(deletion, insertion, substitution);
      }
    }
  }

  return getMatrixValue(dp, m, n);
}

/**
 * Calculate string similarity (0.0 - 1.0)
 */
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

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
    const match = pattern.exec(content);
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
 * Helper: Check a name against protected names and add threats
 */
function checkNameAgainstProtected(
  name: string,
  nameType: "Display name" | "Username",
  threshold: number
): ThreatDetail[] {
  const threats: ThreatDetail[] = [];
  for (const protectedName of PROTECTED_NAMES) {
    const similarity = stringSimilarity(name, protectedName);
    if (similarity >= threshold) {
      threats.push({
        type: "name_similarity",
        description: `${nameType} similar to protected name "${protectedName}"`,
        matched: name,
        severity: similarity >= 0.9 ? "critical" : "high",
      });
    }
  }
  return threats;
}

/**
 * Helper: Detect unicode homoglyph attacks
 */
function detectHomoglyphAttack(displayName: string, threshold: number): ThreatDetail | null {
  const normalizedDisplay = normalizeHomoglyphs(displayName);
  if (normalizedDisplay === displayName.toLowerCase()) {
    return null;
  }
  for (const protectedName of PROTECTED_NAMES) {
    if (stringSimilarity(normalizedDisplay, protectedName) >= threshold) {
      return {
        type: "name_similarity",
        description: "Unicode homoglyph attack detected",
        matched: displayName,
        severity: "critical",
      };
    }
  }
  return null;
}

/**
 * Layer 2: Name similarity detection
 */
function detectNameSimilarity(displayName: string, username: string): ThreatDetail[] {
  const threshold = config.security.impersonation.similarityThreshold;

  const threats = [
    ...checkNameAgainstProtected(displayName, "Display name", threshold),
    ...checkNameAgainstProtected(username, "Username", threshold),
  ];

  const homoglyphThreat = detectHomoglyphAttack(displayName, threshold);
  if (homoglyphThreat) {
    threats.push(homoglyphThreat);
  }

  return threats;
}

/**
 * Normalize unicode homoglyphs to ASCII equivalents
 * Uses NFKC normalization first, then applies additional mappings
 */
function normalizeHomoglyphs(str: string): string {
  // NFKC normalization handles many confusables automatically
  // (fullwidth chars, circled letters, mathematical variants, etc.)
  let result = str.normalize("NFKC").toLowerCase();

  // Additional homoglyph mappings for characters NFKC doesn't handle
  const homoglyphMap: Record<string, string> = {
    // Common Cyrillic lookalikes (NFKC doesn't normalize these)
    а: "a", // Cyrillic small a (U+0430)
    е: "e", // Cyrillic small e (U+0435)
    і: "i", // Cyrillic small i (U+0456)
    о: "o", // Cyrillic small o (U+043E)
    р: "p", // Cyrillic small r (U+0440)
    с: "c", // Cyrillic small s (U+0441)
    х: "x", // Cyrillic small kha (U+0445)
    у: "y", // Cyrillic small u (U+0443)
    // Greek lookalikes
    ω: "w", // Greek small omega
    ν: "v", // Greek small nu
    // Zero-width characters (remove entirely)
    "\u200B": "", // Zero-width space
    "\u200C": "", // Zero-width non-joiner
    "\u200D": "", // Zero-width joiner
    "\uFEFF": "", // BOM
  };

  for (const [homoglyph, replacement] of Object.entries(homoglyphMap)) {
    result = result.replaceAll(homoglyph, replacement);
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
  sanitized = sanitized.replaceAll(/[\u200B-\u200D\uFEFF]/g, "");

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

  // Layer 1: Pattern detection
  const patternThreats = detectPatterns(content);

  // Layer 2: Name similarity
  const nameThreats = detectNameSimilarity(displayName, username);

  // Combine all threats
  const threats: ThreatDetail[] = [...patternThreats, ...nameThreats];

  // Calculate overall confidence
  let confidence = 0;
  if (threats.length > 0) {
    const severityWeights = {
      low: 0.2,
      medium: 0.4,
      high: 0.7,
      critical: 1,
    };

    const maxWeight = Math.max(...threats.map((t) => severityWeights[t.severity]));
    const avgWeight =
      threats.reduce((sum, t) => sum + severityWeights[t.severity], 0) / threats.length;

    // Confidence increases with more threats and higher severity
    confidence = Math.min(0.5 * maxWeight + 0.5 * avgWeight, 1);
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
export function isImpersonatingRole(displayName: string, username: string): boolean {
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
