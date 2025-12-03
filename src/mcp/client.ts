/**
 * MCP Client Manager
 * Manages connections to MCP servers using the official SDK
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod/v4";
import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("MCP");

/**
 * MCP Server configuration schema
 */
const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  metadata: z
    .object({
      permissions: z.enum(["public", "owner-only", "admin-only"]).optional(),
      tools: z.array(z.string()).optional(),
    })
    .optional(),
});

const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema),
});

type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
type McpConfig = z.infer<typeof McpConfigSchema>;

/**
 * Tool definition from MCP server
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
  permissions: "public" | "owner-only" | "admin-only";
}

/**
 * MCP Server connection
 */
interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
  config: McpServerConfig;
  connected: boolean;
  tools: McpTool[];
}

/**
 * MCP Client Manager - singleton
 */
export class McpClientManager {
  private static instance: McpClientManager | null = null;
  private readonly connections = new Map<string, McpConnection>();
  private readonly configPath: string;
  private initialized = false;

  private constructor() {
    this.configPath = config.mcp.configPath;
  }

  static getInstance(): McpClientManager {
    McpClientManager.instance ??= new McpClientManager();
    return McpClientManager.instance;
  }

  /**
   * Initialize and connect to all configured MCP servers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const mcpConfig = await this.loadConfig();

      for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
        try {
          await this.connectToServer(serverName, serverConfig);
        } catch (error) {
          log.error(
            `Failed to connect to MCP server ${serverName}: ` +
              (error instanceof Error ? error.message : String(error)),
            error
          );
          // Continue with other servers
        }
      }

      this.initialized = true;
      log.info(`Initialized with ${this.connections.size} MCP server(s) connected`);
    } catch (error) {
      log.error(
        "Failed to initialize MCP client manager: " +
          (error instanceof Error ? error.message : String(error)),
        error
      );
    }
  }

  /**
   * Load MCP configuration from file
   */
  private async loadConfig(): Promise<McpConfig> {
    try {
      const configContent = await readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(configContent);

      // Expand environment variables in the config
      const expanded = this.expandEnvVars(parsed);

      return McpConfigSchema.parse(expanded);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        log.warn("MCP config file not found, using empty config");
        return { mcpServers: {} };
      }
      throw error;
    }
  }

  /**
   * Expand environment variables in config
   */
  private expandEnvVars(obj: unknown): unknown {
    if (typeof obj === "string") {
      return obj.replaceAll(/\$\{([^}]+)\}/g, (_, envVar) => {
        return process.env[envVar] ?? "";
      });
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.expandEnvVars(item));
    }
    if (obj && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.expandEnvVars(value);
      }
      return result;
    }
    return obj;
  }

  /**
   * Connect to a single MCP server
   */
  private async connectToServer(serverName: string, serverConfig: McpServerConfig): Promise<void> {
    log.debug(`Connecting to MCP server: ${serverName}`);

    // Prepare environment
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (serverConfig.env) {
      for (const [key, value] of Object.entries(serverConfig.env)) {
        env[key] = value;
      }
    }

    // Create transport
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args ?? [],
      env,
    });

    // Create client
    const client = new Client(
      {
        name: "discord-bot",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    // Connect with timeout
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Connection timeout for ${serverName}`));
      }, config.mcp.connectionTimeoutMs);
    });

    await Promise.race([connectPromise, timeoutPromise]);

    // Get tools from server
    const toolsResult = await client.listTools();
    const tools: McpTool[] = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      serverName,
      permissions: serverConfig.metadata?.permissions ?? "public",
    }));

    const connection: McpConnection = {
      client,
      transport,
      serverName,
      config: serverConfig,
      connected: true,
      tools,
    };

    this.connections.set(serverName, connection);
    log.info(`Connected to MCP server ${serverName} with ${tools.length} tool(s)`);
  }

  /**
   * Get all available tools across all connected servers
   */
  getAllTools(): McpTool[] {
    return Array.from(this.connections.values())
      .filter((connection) => connection.connected)
      .flatMap((connection) => connection.tools);
  }

  /**
   * Get tools filtered by permission level
   */
  getToolsForPermission(permissionLevel: "public" | "owner-only" | "admin-only"): McpTool[] {
    const allTools = this.getAllTools();

    switch (permissionLevel) {
      case "owner-only":
        // Owner can see all tools
        return allTools;
      case "admin-only":
        // Admin can see public and admin-only
        return allTools.filter((t) => t.permissions === "public" || t.permissions === "admin-only");
      case "public":
      default:
        // Public only sees public tools
        return allTools.filter((t) => t.permissions === "public");
    }
  }

  /**
   * Call a tool on an MCP server
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    // Find which server has this tool
    for (const connection of this.connections.values()) {
      const tool = connection.tools.find((t) => t.name === toolName);
      if (tool && connection.connected) {
        try {
          const result = await connection.client.callTool({
            name: toolName,
            arguments: args,
          });
          return result;
        } catch (error) {
          log.error(
            `Failed to call tool ${toolName}: ` +
              (error instanceof Error ? error.message : String(error)),
            error
          );
          throw error;
        }
      }
    }

    throw new Error(`Tool not found: ${toolName}`);
  }

  /**
   * Check if a tool exists
   */
  hasTool(toolName: string): boolean {
    for (const connection of this.connections.values()) {
      if (connection.tools.some((t) => t.name === toolName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): McpTool | undefined {
    for (const connection of this.connections.values()) {
      const tool = connection.tools.find((t) => t.name === toolName);
      if (tool) return tool;
    }
    return undefined;
  }

  /**
   * Disconnect from all servers
   */
  async shutdown(): Promise<void> {
    for (const [serverName, connection] of this.connections) {
      try {
        await connection.client.close();
        connection.connected = false;
        log.debug(`Disconnected from MCP server: ${serverName}`);
      } catch (error) {
        log.error(
          `Error disconnecting from ${serverName}: ` +
            (error instanceof Error ? error.message : String(error)),
          error
        );
      }
    }
    this.connections.clear();
    this.initialized = false;
  }

  /**
   * Get connection status
   */
  getStatus(): { serverName: string; connected: boolean; toolCount: number }[] {
    return Array.from(this.connections.values()).map((conn) => ({
      serverName: conn.serverName,
      connected: conn.connected,
      toolCount: conn.tools.length,
    }));
  }
}

// Export singleton
export const mcpManager = McpClientManager.getInstance();
