/**
 * Calculation Tools
 *
 * Math calculation tool implementations.
 */

import { evaluate } from "mathjs";
import type { ToolResult } from "../types.js";

/**
 * Calculate expression tool
 */
export function executeCalculate(expression: string): ToolResult {
  try {
    const result = evaluate(expression);
    return { success: true, result: `${expression} = ${String(result)}` };
  } catch (error) {
    return {
      success: false,
      error: `Calculation error: ${error instanceof Error ? error.message : "Invalid expression"}`,
    };
  }
}
