/**
 * Unit Tests for Date Parsing Logic
 *
 * Tests the chrono-node library integration for natural language date parsing.
 */

import * as chrono from "chrono-node";
import { describe, expect, it } from "vitest";

describe("Date Parsing", () => {
  describe("chrono-node integration", () => {
    it("should parse 'in 10 minutes' correctly", () => {
      const now = Date.now();
      const parsed = chrono.parseDate("in 10 minutes");

      expect(parsed).toBeDefined();
      expect(parsed).not.toBeNull();

      const diff = parsed?.getTime() - now;
      const expectedDiff = 10 * 60 * 1000;

      // Allow 2 second variance
      expect(Math.abs(diff - expectedDiff)).toBeLessThan(2000);
    });

    it("should parse 'in 1 hour' correctly", () => {
      const now = Date.now();
      const parsed = chrono.parseDate("in 1 hour");

      expect(parsed).toBeDefined();
      expect(parsed).not.toBeNull();

      const diff = parsed?.getTime() - now;
      const expectedDiff = 60 * 60 * 1000;

      // Allow 2 second variance
      expect(Math.abs(diff - expectedDiff)).toBeLessThan(2000);
    });

    it("should parse 'tomorrow at 5pm' correctly", () => {
      const now = new Date();
      const parsed = chrono.parseDate("tomorrow at 5pm");

      expect(parsed).toBeDefined();
      expect(parsed).not.toBeNull();

      // Should be 5pm (17:00)
      expect(parsed?.getHours()).toBe(17);

      // Should be a different day than today
      expect(parsed?.getDate()).not.toBe(now.getDate());
    });

    it("should parse 'next Monday' correctly", () => {
      const now = new Date();
      const parsed = chrono.parseDate("next Monday");

      expect(parsed).toBeDefined();
      expect(parsed).not.toBeNull();

      // Should be in the future
      expect(parsed?.getTime()).toBeGreaterThan(now.getTime());

      // Should be a Monday (1)
      expect(parsed?.getDay()).toBe(1);
    });

    it("should return null for unparseable input", () => {
      const parsed = chrono.parseDate("not a date at all xyz");

      // chrono-node returns null for unparseable input
      expect(parsed).toBeNull();
    });

    it("should handle relative time expressions", () => {
      const now = Date.now();

      const in30Mins = chrono.parseDate("in 30 minutes");
      expect(in30Mins).not.toBeNull();
      expect(in30Mins?.getTime() - now).toBeGreaterThan(29 * 60 * 1000);
      expect(in30Mins?.getTime() - now).toBeLessThan(31 * 60 * 1000);

      const in2Hours = chrono.parseDate("in 2 hours");
      expect(in2Hours).not.toBeNull();
      expect(in2Hours?.getTime() - now).toBeGreaterThan(119 * 60 * 1000);
      expect(in2Hours?.getTime() - now).toBeLessThan(121 * 60 * 1000);
    });
  });
});
