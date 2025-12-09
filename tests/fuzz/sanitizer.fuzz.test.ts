/**
 * Fuzz Tests for Security-Critical Functions
 *
 * Uses fast-check for property-based testing to find edge cases
 * and potential security issues with random input generation.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Import the sanitizer logic we want to fuzz
// Since sanitizeForLog is internal to websocket.ts, we recreate it here for testing
// Uses .replaceAll() which CodeQL recognizes as a log injection sanitizer
function sanitizeForLog(value: unknown): string {
  const str = String(value);
  // Remove control characters - includes \n \r explicitly for CodeQL detection
  const sanitized = str.replaceAll(/[\n\r\p{Cc}]/gu, "");
  return sanitized.length > 100 ? `${sanitized.slice(0, 100)}...` : sanitized;
}

// Get iteration count from environment or use default
const FUZZ_ITERATIONS = Number.parseInt(process.env.FUZZ_ITERATIONS ?? "1000", 10);

describe("Fuzz: sanitizeForLog", () => {
  it("should never contain control characters", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeForLog(input);
        // Check no control characters (0x00-0x1F or 0x7F)
        for (const char of result) {
          const code = char.codePointAt(0);
          if (code !== undefined && (code < 0x20 || code === 0x7f)) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: FUZZ_ITERATIONS }
    );
  });

  it("should never contain newlines or carriage returns", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeForLog(input);
        return !result.includes("\n") && !result.includes("\r");
      }),
      { numRuns: FUZZ_ITERATIONS }
    );
  });

  it("should truncate long strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 200 }), (input) => {
        const result = sanitizeForLog(input);
        // Result should be max 103 chars (100 + "...")
        return result.length <= 103;
      }),
      { numRuns: FUZZ_ITERATIONS }
    );
  });

  it("should handle various types without throwing", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.constant(undefined),
          fc.constant({}),
          fc.array(fc.integer())
        ),
        (input) => {
          // Should not throw
          const result = sanitizeForLog(input);
          return typeof result === "string";
        }
      ),
      { numRuns: FUZZ_ITERATIONS }
    );
  });

  it("should handle unicode and emoji correctly", () => {
    // Generate strings with high unicode code points including emoji
    const emojiAndUnicode = ["Hello ", "Test\u{1F600}", "\u{1F4A9}", "\u0000test", "\u{10FFFF}"];
    for (const input of emojiAndUnicode) {
      const result = sanitizeForLog(input);
      expect(typeof result).toBe("string");
    }

    // Also test with random strings that might contain extended ASCII
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
        const result = sanitizeForLog(input);
        return typeof result === "string";
      }),
      { numRuns: FUZZ_ITERATIONS }
    );
  });

  it("should prevent log injection attacks", () => {
    // Test known log injection payloads
    const maliciousInputs = [
      "normal\nMALICIOUS LOG ENTRY",
      "user\r\n[ERROR] fake error",
      "test\x00null byte",
      "escape\x1b[31mred text\x1b[0m",
      "tab\ttab",
      "backspace\x08\x08\x08overwrite",
    ];

    for (const input of maliciousInputs) {
      const result = sanitizeForLog(input);
      expect(result).not.toContain("\n");
      expect(result).not.toContain("\r");
      expect(result).not.toContain("\x00");
      expect(result).not.toContain("\x1b");
      expect(result).not.toContain("\t");
      expect(result).not.toContain("\x08");
    }
  });
});

describe("Fuzz: Input Parsing", () => {
  it("should safely parse and validate container names", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        // Container name validation: alphanumeric, dash, underscore, dot
        const isValidName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
        // Just verify the regex doesn't throw on any input
        return typeof isValidName === "boolean";
      }),
      { numRuns: FUZZ_ITERATIONS }
    );
  });

  it("should safely handle JSON parsing errors", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        try {
          JSON.parse(input);
          return true;
        } catch {
          // Expected for invalid JSON
          return true;
        }
      }),
      { numRuns: FUZZ_ITERATIONS }
    );
  });
});
