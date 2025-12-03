/**
 * Shared AI Utilities
 *
 * Common utility functions used across agent and orchestrator
 */

import { evaluate } from "mathjs";
import axios from "axios";
import { stripHtmlTags } from "../../utils/security.js";
import { ALLOWED_FETCH_HOSTNAMES } from "./constants.js";
import type { ToolCall, ToolResult } from "./types.js";

/**
 * Parse tool call from LLM response
 * Supports JSON blocks in various formats
 */
export function parseToolCall(response: string): ToolCall | null {
  const patterns = [
    /```json\s*\n?([\s\S]*?)\n?```/i,
    /```\s*\n?([\s\S]*?)\n?```/,
    /\{[\s\S]*?"tool"[\s\S]*?\}/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(response);
    if (match) {
      try {
        const jsonStr = match[1] ?? match[0];
        const parsed = JSON.parse(jsonStr.trim()) as Record<string, unknown>;

        if (typeof parsed.tool === "string") {
          return {
            name: parsed.tool,
            arguments: (parsed.arguments as Record<string, unknown>) ?? {},
          };
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Format an error into a message string
 */
export function formatError(error: unknown, defaultMessage = "Unknown error"): string {
  return error instanceof Error ? error.message : defaultMessage;
}

/**
 * Get current time in a timezone
 */
export function toolGetTime(timezone?: string): ToolResult {
  try {
    const tz = timezone?.trim() ?? "UTC";
    // Validate timezone format to prevent injection
    if (!/^[\w/+-]+$/.test(tz) || tz.length > 50) {
      return { success: false, error: "Invalid timezone format." };
    }

    const now = new Date();
    const formatted = now.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });

    return { success: true, result: `Current time in ${tz}: ${formatted}` };
  } catch {
    return { success: false, error: "Invalid timezone" };
  }
}

/**
 * Calculate a mathematical expression safely using mathjs
 *
 * SECURITY: mathjs evaluate() is safe for mathematical expressions.
 * Unlike JavaScript eval(), mathjs has no access to JavaScript globals,
 * filesystem, network, or other dangerous APIs. It only evaluates
 * mathematical expressions in a sandboxed environment.
 *
 * Additional protections:
 * - Input sanitization removes all non-math characters
 * - Only alphanumeric, operators, parentheses, and whitespace allowed
 *
 * @see https://mathjs.org/docs/expressions/security.html
 */
export function toolCalculate(expression: string): ToolResult {
  if (!expression?.trim()) {
    return { success: false, error: "No expression provided" };
  }

  // Sanitize expression - allow only math characters (alphanumeric, operators, parens, whitespace)
  // This prevents any attempt to inject non-mathematical content
  const sanitized = expression.replaceAll(/[^0-9+\-*/().^%\s,a-z]/gi, "");

  if (sanitized.length === 0) {
    return { success: false, error: "Invalid expression format" };
  }

  try {
    // mathjs evaluate() is sandboxed and cannot execute arbitrary JavaScript
    const result = evaluate(sanitized);
    return { success: true, result: `${expression} = ${result as string}` };
  } catch (error) {
    return { success: false, error: formatError(error, "Calculation failed") };
  }
}

/**
 * Search the web using DuckDuckGo API
 *
 * SECURITY: This performs a GET request to a fixed, trusted API endpoint.
 * - Destination is hardcoded to api.duckduckgo.com (not user-controlled)
 * - Only the search query parameter comes from user input
 * - Query is length-limited to prevent abuse
 * - Uses safe JSON format with HTML stripping disabled
 */
export async function toolWebSearch(query: string, maxResults = 5): Promise<ToolResult> {
  if (!query?.trim()) {
    return { success: false, error: "No search query provided" };
  }

  try {
    const response = await axios.get("https://api.duckduckgo.com/", {
      params: {
        q: query.slice(0, 200), // Limit query length
        format: "json",
        no_html: 1,
        skip_disambig: 1,
      },
      timeout: 10000,
    });

    const data = response.data as Record<string, unknown>;
    const results: string[] = [];

    // Abstract (main answer)
    if (data.Abstract) {
      results.push(`📖 **Answer**: ${data.Abstract as string}`);
    }

    // Related topics
    const topics = data.RelatedTopics as { Text?: string; FirstURL?: string }[] | undefined;
    if (topics?.length) {
      results.push("\n**Related:**");
      const limited = topics.slice(0, maxResults);
      for (const topic of limited) {
        if (topic.Text) {
          results.push(`• ${topic.Text}`);
        }
      }
    }

    if (results.length === 0) {
      return { success: true, result: `No results found for "${query}"` };
    }

    return { success: true, result: results.join("\n") };
  } catch (error) {
    return { success: false, error: formatError(error, "Search failed") };
  }
}

/**
 * Validate and check if a URL is allowed for fetching
 */
export function isUrlAllowed(url: string): { allowed: boolean; hostname?: string; error?: string } {
  try {
    const parsed = new URL(url);

    // Must be HTTPS
    if (parsed.protocol !== "https:") {
      return { allowed: false, error: "Only HTTPS URLs are allowed" };
    }

    // Check against allowlist
    if (!ALLOWED_FETCH_HOSTNAMES.has(parsed.hostname)) {
      return {
        allowed: false,
        error: `Domain not in allowlist. Allowed: ${[...ALLOWED_FETCH_HOSTNAMES].join(", ")}`,
      };
    }

    return { allowed: true, hostname: parsed.hostname };
  } catch {
    return { allowed: false, error: "Invalid URL format" };
  }
}

/**
 * Fetch content from an allowed URL
 *
 * SECURITY: Server-Side Request Forgery (SSRF) protection implemented:
 * - URL validation requires HTTPS protocol only
 * - Strict domain allowlist (ALLOWED_FETCH_HOSTNAMES) prevents internal network access
 * - Content length limited to 500KB to prevent denial of service
 * - Request timeout prevents hanging connections
 * - Only external, trusted documentation sites are allowed
 * - All HTML is stripped before returning content
 */
export async function toolFetchUrl(url: string): Promise<ToolResult> {
  if (!url?.trim()) {
    return { success: false, error: "No URL provided" };
  }

  const validation = isUrlAllowed(url);
  if (!validation.allowed) {
    return { success: false, error: validation.error };
  }

  try {
    const response = await axios.get<string>(url, {
      timeout: 15000,
      maxContentLength: 500_000, // 500KB limit
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0)",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });

    const content = stripHtmlTags(response.data).slice(0, 10000);

    return {
      success: true,
      result: `Content from ${url}:\n\n${content}`,
    };
  } catch (error) {
    return { success: false, error: formatError(error, "Failed to fetch URL") };
  }
}
