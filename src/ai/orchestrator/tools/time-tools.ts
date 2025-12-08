/**
 * Time Tools
 *
 * Time-related tool implementations.
 */

import type { ToolResult } from "../types.js";

/**
 * US timezone configurations in priority order: CST, PST, MST, EST
 */
export const US_TIMEZONES = [
  { id: "America/Chicago", label: "Central (CST/CDT)" },
  { id: "America/Los_Angeles", label: "Pacific (PST/PDT)" },
  { id: "America/Denver", label: "Mountain (MST/MDT)" },
  { id: "America/New_York", label: "Eastern (EST/EDT)" },
] as const;

/**
 * Get current time tool
 * If no timezone specified, returns time in all major US timezones (CST first)
 */
export function executeGetTime(timezone?: string): ToolResult {
  try {
    const now = new Date();

    // If a specific timezone is requested, return just that
    if (timezone) {
      const formatted = now.toLocaleString("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
      return { success: true, result: `Current time in ${timezone}: ${formatted}` };
    }

    // No timezone specified: return all US timezones with CST first
    const timeStrings = US_TIMEZONES.map(({ id, label }) => {
      const formatted = now.toLocaleString("en-US", {
        timeZone: id,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      return `${label}: ${formatted}`;
    });

    return {
      success: true,
      result: `Current time in US timezones:\n${timeStrings.join("\n")}`,
    };
  } catch {
    return { success: false, error: "Invalid timezone" };
  }
}
