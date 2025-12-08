/**
 * Response Cleaner
 *
 * Utilities for cleaning and sanitizing LLM responses.
 * Handles:
 * - Tool call artifact removal
 * - LaTeX to Unicode conversion
 * - Harmony token sanitization
 */

/**
 * Convert digits/letters to superscript Unicode characters
 */
export function toSuperscript(text: string): string {
  const superscripts: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "+": "⁺",
    "-": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
    n: "ⁿ",
    i: "ⁱ",
    x: "ˣ",
  };
  return text
    .split("")
    .map((c) => superscripts[c] ?? c)
    .join("");
}

/**
 * Convert digits to subscript Unicode characters
 */
export function toSubscript(text: string): string {
  const subscripts: Record<string, string> = {
    "0": "₀",
    "1": "₁",
    "2": "₂",
    "3": "₃",
    "4": "₄",
    "5": "₅",
    "6": "₆",
    "7": "₇",
    "8": "₈",
    "9": "₉",
    "+": "₊",
    "-": "₋",
    "=": "₌",
    "(": "₍",
    ")": "₎",
    a: "ₐ",
    e: "ₑ",
    o: "ₒ",
    x: "ₓ",
    i: "ᵢ",
    n: "ₙ",
  };
  return text
    .split("")
    .map((c) => subscripts[c] ?? c)
    .join("");
}

/**
 * Clean final response (remove tool call artifacts and LaTeX math)
 * Discord doesn't render LaTeX, so we convert to Unicode symbols
 */
export function cleanResponse(response: string): string {
  const cleaned = response
    // Remove tool artifacts
    .replaceAll(/```json[\s\S]*?```/gi, "")
    .replaceAll(/\{"tool"[\s\S]*?\}/g, "")

    // Clean LaTeX math formatting for Discord
    .replaceAll("$$", "") // Remove $$ block delimiters
    .replaceAll("$", "") // Remove $ inline delimiters
    .replaceAll(String.raw`\times`, "×") // Multiply
    .replaceAll(String.raw`\cdot`, "·") // Dot multiply
    .replaceAll(String.raw`\div`, "÷") // Divide
    .replaceAll(String.raw`\pm`, "±") // Plus/minus
    .replaceAll(String.raw`\neq`, "≠") // Not equal
    .replaceAll(String.raw`\leq`, "≤") // Less than or equal
    .replaceAll(String.raw`\geq`, "≥") // Greater than or equal
    .replaceAll(String.raw`\approx`, "≈") // Approximately
    .replaceAll(String.raw`\infty`, "∞") // Infinity
    .replaceAll(String.raw`\pi`, "π") // Pi
    .replaceAll(String.raw`\alpha`, "α")
    .replaceAll(String.raw`\beta`, "β")
    .replaceAll(String.raw`\gamma`, "γ")
    .replaceAll(String.raw`\delta`, "δ")
    .replaceAll(String.raw`\theta`, "θ")
    .replaceAll(String.raw`\lambda`, "λ")
    .replaceAll(String.raw`\mu`, "μ")
    .replaceAll(String.raw`\sigma`, "σ")
    .replaceAll(String.raw`\sum`, "∑") // Summation
    .replaceAll(String.raw`\prod`, "∏") // Product
    .replaceAll(String.raw`\int`, "∫") // Integral
    .replaceAll(/\\sqrt\{([^}]+)\}/g, "√($1)") // Square root
    .replaceAll(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1/$2)") // Fractions
    .replaceAll(/\^(\d)/g, (_, d) => toSuperscript(d)) // Single digit exponent
    .replaceAll(/\^{([^}]+)}/g, (_, exp) => toSuperscript(exp)) // Braced exponent
    .replaceAll(/\^\(([^)]+)\)/g, (_, exp) => toSuperscript(exp)) // Parenthesized exponent
    .replaceAll(/_(\d)/g, (_, d) => toSubscript(d)) // Single digit subscript
    .replaceAll(/_{([^}]+)}/g, (_, sub) => toSubscript(sub)) // Braced subscript
    .replaceAll(String.raw`\\`, "") // Remove escaped backslashes
    .replaceAll(String.raw`\,`, " ") // LaTeX thin space
    .replaceAll(String.raw`\;`, " ") // LaTeX medium space
    .replaceAll(String.raw`\quad`, "  ") // LaTeX quad space
    .replaceAll(/\\text\{([^}]+)\}/g, "$1") // Remove \text{} wrapper
    .replaceAll(String.raw`\left`, "") // Remove \left
    .replaceAll(String.raw`\right`, "") // Remove \right
    .trim();

  return cleaned;
}

/**
 * Sanitize harmony tokens from gpt-oss model output
 * These tokens (e.g., <|call|>, <|message|>, <|channel|>) can appear
 * in the model's output and cause parsing issues.
 */
export function sanitizeHarmonyTokens(content: string): string {
  // Remove harmony tokens: <|word|> patterns
  // Also remove trailing garbage after JSON objects
  return content.replaceAll(/<\|[a-z_]+\|>/gi, "").trim();
}
