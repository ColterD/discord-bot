/**
 * Tool Parser
 *
 * Parses tool calls from LLM response content using custom JSON format.
 */

import { createLogger } from "../../utils/logger.js";
import type { ToolCall } from "./types.js";

const log = createLogger("ToolParser");

/**
 * Extract and clean JSON string from matched pattern
 */
function cleanJsonString(match: RegExpExecArray | string): string {
  let jsonStr = typeof match === "string" ? match : (match[1] ?? match[0]);

  // Extra cleanup: remove any trailing garbage after the JSON object
  // This handles cases like: {"tool":"x","arguments":{}}<|garbage|>
  const lastBrace = jsonStr.lastIndexOf("}");
  if (lastBrace !== -1) {
    jsonStr = jsonStr.slice(0, lastBrace + 1);
  }

  // Remove potential markdown block markers if regex missed them
  jsonStr = jsonStr
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/```$/, "");

  // Sanitize common trailing commas in JSON (simple regex approach)
  // Replaces ",}" with "}" and ",]" with "]"
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");

  return jsonStr.trim();
}

// Maximum content length to run regex patterns against (protects against ReDoS)
const MAX_CONTENT_LENGTH_FOR_REGEX = 50000;

/**
 * Parse tool call from LLM response content using custom JSON format
 */
export function parseToolCallFromContent(content: string): ToolCall | null {
  // SECURITY: Length guard protects against ReDoS on adversarial input
  // LLM responses are bounded by token limits, but this provides defense-in-depth
  if (content.length > MAX_CONTENT_LENGTH_FOR_REGEX) {
    log.warn(
      `[TOOL-PARSE] Content too long for regex parsing (${content.length} > ${MAX_CONTENT_LENGTH_FOR_REGEX})`
    );
    return null;
  }

  const patterns = [
    /```json\s*\n?([\s\S]*?)\n?```/i, // NOSONAR - safe: lazy quantifier with clear terminator
    /```\s*\n?([\s\S]*?)\n?```/, // NOSONAR - safe: lazy quantifier with clear terminator
    // NOSONAR - Complex pattern for nested JSON; protected by length guard above
    /\{(?:[^{}]|\{(?:[^{}]|{[^{}]*})*\})*?"tool"\s*:\s*".+?"(?:[^{}]|\{(?:[^{}]|{[^{}]*})*\})*?\}/s,
  ];

  log.debug(
    `[TOOL-PARSE] Attempting to parse content (${content.length} chars): ${content.slice(0, 200)}`
  );

  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match) {
      try {
        const jsonStr = cleanJsonString(match);
        log.debug(`[TOOL-PARSE] Pattern matched, extracted: ${jsonStr.slice(0, 200)}`);

        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

        if (typeof parsed.tool === "string") {
          return {
            name: parsed.tool,
            arguments: (parsed.arguments as Record<string, unknown>) ?? {},
          };
        }
      } catch (error) {
        // Log parsing errors for debugging but continue to next pattern
        log.debug(
          `[TOOL-PARSE] Failed to parse tool call JSON: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  log.debug(`[TOOL-PARSE] No tool call found in content`);
  return null;
}
