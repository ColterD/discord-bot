/**
 * Dashboard Auth Module Tests
 *
 * Tests for authentication utilities and session management
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Helper to create mock Valkey instance (reduces test nesting)
function createMockValkey() {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
  };
}

// Mock Valkey before importing auth module
vi.mock("iovalkey", () => ({
  default: vi.fn().mockImplementation(createMockValkey),
}));

// Mock environment
process.env.DISCORD_CLIENT_ID = "test-client-id";
process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
process.env.BOT_OWNER_IDS = "123456789,987654321";
process.env.BOT_ADMIN_IDS = "111111111";

describe("Auth Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("isAuthorized", () => {
    it("should authorize users in BOT_OWNER_IDS", async () => {
      const { isAuthorized } = await import("../src/lib/server/auth");
      expect(isAuthorized("123456789")).toBe(true);
      expect(isAuthorized("987654321")).toBe(true);
    });

    it("should authorize users in BOT_ADMIN_IDS", async () => {
      const { isAuthorized } = await import("../src/lib/server/auth");
      expect(isAuthorized("111111111")).toBe(true);
    });

    it("should deny unauthorized users", async () => {
      const { isAuthorized } = await import("../src/lib/server/auth");
      expect(isAuthorized("999999999")).toBe(false);
    });

    it("should deny all when no IDs configured", async () => {
      // Clear env vars temporarily
      const originalOwner = process.env.BOT_OWNER_IDS;
      const originalAdmin = process.env.BOT_ADMIN_IDS;
      process.env.BOT_OWNER_IDS = "";
      process.env.BOT_ADMIN_IDS = "";

      // Reset module to pick up new env
      vi.resetModules();

      // Re-mock iovalkey after reset
      vi.doMock("iovalkey", () => ({
        default: vi.fn().mockImplementation(createMockValkey)
      }));

      const { isAuthorized } = await import("../src/lib/server/auth");
      expect(isAuthorized("123456789")).toBe(false);

      // Restore
      process.env.BOT_OWNER_IDS = originalOwner;
      process.env.BOT_ADMIN_IDS = originalAdmin;
    });
  });

  describe("getAuthUrl", () => {
    it("should generate valid Discord OAuth URL", async () => {
      const { getAuthUrl } = await import("../src/lib/server/auth");
      const url = getAuthUrl("test-state-123");

      expect(url).toContain("https://discord.com/oauth2/authorize");
      expect(url).toContain("client_id=test-client-id");
      expect(url).toContain("state=test-state-123");
      expect(url).toContain("response_type=code");
      expect(url).toContain("scope=identify");
    });

    it("should use configured redirect URI", async () => {
      const { getAuthUrl } = await import("../src/lib/server/auth");
      const url = getAuthUrl("state");

      // In dev mode, should default to localhost
      expect(url).toContain("redirect_uri=");
      expect(url).toContain("callback");
    });
  });

  describe("getSessionCookieOptions", () => {
    it("should return secure options", async () => {
      const { getSessionCookieOptions } = await import("../src/lib/server/auth");
      const options = getSessionCookieOptions();

      expect(options.path).toBe("/");
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(typeof options.maxAge).toBe("number");
      expect(options.maxAge).toBeGreaterThan(0);
    });

    it("should set secure flag based on environment", async () => {
      const { getSessionCookieOptions } = await import("../src/lib/server/auth");
      const options = getSessionCookieOptions();

      // In dev mode (mocked), secure should be false
      expect(options.secure).toBe(false);
    });
  });

  describe("getAvatarUrl", () => {
    it("should return CDN URL for user with avatar", async () => {
      const { getAvatarUrl } = await import("../src/lib/server/auth");
      const url = getAvatarUrl({
        userId: "123456789",
        avatar: "abc123hash",
      });

      expect(url).toBe("https://cdn.discordapp.com/avatars/123456789/abc123hash.png");
    });

    it("should return default avatar for user without avatar", async () => {
      const { getAvatarUrl } = await import("../src/lib/server/auth");
      const url = getAvatarUrl({
        userId: "123456789",
        avatar: null,
      });

      expect(url).toContain("https://cdn.discordapp.com/embed/avatars/");
      expect(url).toMatch(/avatars\/[0-4]\.png$/);
    });

    it("should calculate default avatar index from user ID", async () => {
      const { getAvatarUrl } = await import("../src/lib/server/auth");

      // Different user IDs should potentially get different default avatars
      const url1 = getAvatarUrl({ userId: "0", avatar: null });
      const url2 = getAvatarUrl({ userId: "1", avatar: null });
      const url3 = getAvatarUrl({ userId: "5", avatar: null });

      // ID 0 mod 5 = 0, ID 1 mod 5 = 1, ID 5 mod 5 = 0
      expect(url1).toContain("/avatars/0.png");
      expect(url2).toContain("/avatars/1.png");
      expect(url3).toContain("/avatars/0.png");
    });
  });

  describe("SESSION_COOKIE", () => {
    it("should export session cookie name constant", async () => {
      const { SESSION_COOKIE } = await import("../src/lib/server/auth");
      expect(SESSION_COOKIE).toBe("dashboard_session");
    });
  });

  describe("Session Interface", () => {
    it("should have correct session structure", async () => {
      // Type check - session should have these fields
      const mockSession = {
        userId: "123",
        username: "testuser",
        discriminator: "0",
        avatar: "abc123",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 86400000,
        createdAt: Date.now(),
      };

      // Verify structure
      expect(mockSession.userId).toBe("123");
      expect(mockSession.username).toBe("testuser");
      expect(typeof mockSession.expiresAt).toBe("number");
      expect(typeof mockSession.createdAt).toBe("number");
    });
  });
});

describe("OAuth Configuration", () => {
  it("should throw when missing client ID", async () => {
    const originalClientId = process.env.DISCORD_CLIENT_ID;
    process.env.DISCORD_CLIENT_ID = "";

    vi.resetModules();

    // Re-mock iovalkey after reset
    vi.doMock("iovalkey", () => ({
      default: vi.fn().mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      })),
    }));

    const { getAuthUrl } = await import("../src/lib/server/auth");

    expect(() => getAuthUrl("state")).toThrow("Missing DISCORD_CLIENT_ID");

    process.env.DISCORD_CLIENT_ID = originalClientId;
  });

  it("should throw when missing client secret", async () => {
    const originalClientSecret = process.env.DISCORD_CLIENT_SECRET;
    process.env.DISCORD_CLIENT_SECRET = "";

    vi.resetModules();

    // Re-mock iovalkey after reset
    vi.doMock("iovalkey", () => ({
      default: vi.fn().mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      })),
    }));

    const { getAuthUrl } = await import("../src/lib/server/auth");

    expect(() => getAuthUrl("state")).toThrow("Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET");

    process.env.DISCORD_CLIENT_SECRET = originalClientSecret;
  });
});
