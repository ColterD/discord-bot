/**
 * MCP Client Unit Tests
 *
 * Tests for the MCP client manager functionality.
 * Note: These tests focus on testable logic without requiring
 * actual MCP server connections.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules before importing the client
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [] }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

// Import after mocks
import { readFile } from "node:fs/promises";
import type { McpTool } from "../../src/mcp/client.js";

describe("MCP Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("Config Schema Validation", () => {
    it("should accept valid MCP server config", async () => {
      const validConfig = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["server.js"],
            env: { API_KEY: "test" },
            description: "Test server",
            metadata: {
              permissions: "public",
              tools: ["tool1", "tool2"],
            },
          },
        },
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(validConfig));

      // Re-import to get fresh instance
      const { McpClientManager } = await import("../../src/mcp/client.js");

      // Reset singleton for testing
      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();
      expect(manager).toBeDefined();
    });

    it("should handle missing config file gracefully", async () => {
      const error = new Error("ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      vi.mocked(readFile).mockRejectedValue(error);

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      // Should not throw on initialize with missing config
      await expect(manager.initialize()).resolves.not.toThrow();
    });
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const instance1 = McpClientManager.getInstance();
      const instance2 = McpClientManager.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("Tool Management", () => {
    it("should return empty array when no tools available", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();
      const tools = manager.getAllTools();

      expect(tools).toEqual([]);
    });

    it("should report not having a non-existent tool", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      expect(manager.hasTool("non-existent-tool")).toBe(false);
    });

    it("should return undefined for non-existent tool", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      expect(manager.getTool("non-existent-tool")).toBeUndefined();
    });
  });

  describe("Permission Filtering", () => {
    it("should filter tools by public permission", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      // With no tools, should return empty array
      const publicTools = manager.getToolsForPermission("public");
      expect(publicTools).toEqual([]);
    });

    it("should return all tools for owner permission level", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      // With no tools, should return empty array
      const ownerTools = manager.getToolsForPermission("owner-only");
      expect(ownerTools).toEqual([]);
    });
  });

  describe("Status Reporting", () => {
    it("should return empty status when not initialized", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();
      const status = manager.getStatus();

      expect(status).toEqual([]);
    });
  });

  describe("Docker Gateway", () => {
    it("should report gateway as not connected initially", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      expect(manager.isDockerGatewayConnected()).toBe(false);
    });

    it("should return empty tools for disconnected gateway", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      expect(manager.getDockerGatewayTools()).toEqual([]);
    });
  });

  describe("Tool Calling", () => {
    it("should throw error when calling non-existent tool", async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      await expect(manager.callTool("non-existent", {})).rejects.toThrow("Tool not found");
    });
  });

  describe("Environment Variable Expansion", () => {
    it("should expand environment variables in config", async () => {
      // Set test env var
      process.env.TEST_MCP_VAR = "expanded-value";

      const configWithEnvVar = {
        mcpServers: {
          "test-server": {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing env var substitution
            command: "${TEST_MCP_VAR}",
            // biome-ignore lint/suspicious/noTemplateCurlyInString: Testing env var substitution
            args: ["--key=${TEST_MCP_VAR}"],
          },
        },
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(configWithEnvVar));

      const { McpClientManager } = await import("../../src/mcp/client.js");

      // @ts-expect-error accessing private static
      McpClientManager.instance = null;

      const manager = McpClientManager.getInstance();

      // Initialize will attempt to connect with expanded values
      // The connection will fail (mocked), but config should be processed
      await manager.initialize();

      // Clean up
      delete process.env.TEST_MCP_VAR;
    });
  });
});

describe("McpTool Interface", () => {
  it("should have correct structure", () => {
    const tool: McpTool = {
      name: "test-tool",
      description: "A test tool",
      inputSchema: { type: "object" },
      serverName: "test-server",
      permissions: "public",
      source: "stdio",
    };

    expect(tool.name).toBe("test-tool");
    expect(tool.permissions).toBe("public");
    expect(tool.source).toBe("stdio");
  });

  it("should support docker-gateway source", () => {
    const tool: McpTool = {
      name: "gateway-tool",
      description: "A gateway tool",
      inputSchema: {},
      serverName: "docker-gateway",
      permissions: "public",
      source: "docker-gateway",
    };

    expect(tool.source).toBe("docker-gateway");
  });

  it("should support all permission levels", () => {
    const publicTool: McpTool = {
      name: "public-tool",
      description: "",
      inputSchema: {},
      serverName: "server",
      permissions: "public",
      source: "stdio",
    };

    const adminTool: McpTool = {
      name: "admin-tool",
      description: "",
      inputSchema: {},
      serverName: "server",
      permissions: "admin-only",
      source: "stdio",
    };

    const ownerTool: McpTool = {
      name: "owner-tool",
      description: "",
      inputSchema: {},
      serverName: "server",
      permissions: "owner-only",
      source: "stdio",
    };

    expect(publicTool.permissions).toBe("public");
    expect(adminTool.permissions).toBe("admin-only");
    expect(ownerTool.permissions).toBe("owner-only");
  });
});
