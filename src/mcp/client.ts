/**
 * MCP Client Manager
 * Manages connections to MCP servers using the official SDK
 * Supports both stdio transport (local servers) and HTTP transport (Docker MCP Gateway)
 *
 * Uses StreamableHTTPClientTransport for HTTP connections (MCP protocol 2025-03-26+)
 */

import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod/v4";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("MCP");

/**
 * Sanitize error objects to prevent sensitive data exposure in logs
 * Removes potential bearer tokens, auth headers, and config objects
 */
function sanitizeError(error: unknown): Error | string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  // Create a clean error with just the message and stack
  const sanitized = new Error(error.message);
  sanitized.name = error.name;
  if (error.stack) {
    sanitized.stack = error.stack;
  }

  // Don't copy over any additional properties that might contain secrets
  return sanitized;
}

/**
 * Race a promise against a timeout with proper cleanup
 * Unlike raw Promise.race, this clears the timeout to prevent memory leaks
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

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
  /** Source of the tool (local stdio server or Docker MCP Gateway) */
  source: "stdio" | "docker-gateway";
}

/**
 * MCP Server connection (stdio-based)
 */
interface McpStdioConnection {
  type: "stdio";
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
  config: McpServerConfig;
  connected: boolean;
  tools: McpTool[];
}

/**
 * Docker MCP Gateway connection
 * Supports both stdio (recommended) and StreamableHTTP transports
 */
interface McpGatewayConnection {
  type: "docker-gateway";
  transportType: "stdio" | "streamable-http";
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  url?: string; // Only for HTTP transports
  connected: boolean;
  tools: McpTool[];
  reconnectAttempts: number;
}

/**
 * MCP Client Manager - singleton
 */
export class McpClientManager {
  private static instance: McpClientManager | null = null;
  private readonly stdioConnections = new Map<string, McpStdioConnection>();
  private gatewayConnection: McpGatewayConnection | null = null;
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
      // Initialize stdio-based MCP servers from config file
      const mcpConfig = await this.loadConfig();
      for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
        try {
          await this.connectToStdioServer(serverName, serverConfig);
        } catch (error) {
          log.error(
            `Failed to connect to MCP server ${serverName}: ` +
              (error instanceof Error ? error.message : String(error)),
            sanitizeError(error)
          );
        }
      }

      // Initialize Docker MCP Gateway if enabled
      if (config.mcp.dockerGateway.enabled) {
        await this.connectToDockerGateway();
      }

      this.initialized = true;
      const stdioCount = this.stdioConnections.size;
      const gatewayStatus = this.gatewayConnection?.connected ? " + Docker MCP Gateway" : "";
      log.info(`MCP initialized: ${stdioCount} stdio server(s)${gatewayStatus}`);
    } catch (error) {
      log.error(
        "Failed to initialize MCP client manager: " +
          (error instanceof Error ? error.message : String(error)),
        sanitizeError(error)
      );
    }
  }

  /**
   * Connect to Docker MCP Gateway
   * Supports both stdio (recommended) and HTTP transports
   */
  private async connectToDockerGateway(): Promise<void> {
    const gatewayConfig = config.mcp.dockerGateway;
    const transportType = gatewayConfig.transport;

    log.info(`Connecting to Docker MCP Gateway via ${transportType.toUpperCase()} transport...`);

    try {
      if (transportType === "stdio") {
        await this.connectToDockerGatewayStdio();
      } else {
        await this.connectToDockerGatewayHttp();
      }
    } catch (error) {
      log.warn(
        `Failed to connect to Docker MCP Gateway (${transportType}): ${error instanceof Error ? error.message : String(error)}`
      );
      this.gatewayConnection = null;
    }
  }

  /**
   * Connect to Docker MCP Gateway using stdio transport (recommended)
   * Spawns `docker mcp gateway run` as a child process
   */
  private async connectToDockerGatewayStdio(): Promise<void> {
    // Create stdio transport that spawns the gateway process
    // The gateway communicates via stdin/stdout using JSON-RPC over MCP protocol
    const transport = new StdioClientTransport({
      command: "docker",
      args: ["mcp", "gateway", "run"],
      // Pass through environment variables
      env: { ...process.env } as Record<string, string>,
    });

    const client = new Client(
      {
        name: "discord-bot",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    // Connect with timeout (using helper to prevent timeout leak)
    await withTimeout(
      client.connect(transport),
      config.mcp.connectionTimeoutMs,
      "Docker MCP Gateway connection timeout (stdio)"
    );

    // Get tools from gateway
    const toolsResult = await client.listTools();
    const tools: McpTool[] = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      serverName: "docker-gateway",
      permissions: "public" as const,
      source: "docker-gateway" as const,
    }));

    this.gatewayConnection = {
      type: "docker-gateway",
      transportType: "stdio",
      client,
      transport,
      connected: true,
      tools,
      reconnectAttempts: 0,
    };

    log.info(`Connected to Docker MCP Gateway (stdio) with ${tools.length} tool(s)`);
  }

  /**
   * Connect to Docker MCP Gateway using StreamableHTTP transport
   */
  private async connectToDockerGatewayHttp(): Promise<void> {
    const gatewayConfig = config.mcp.dockerGateway;
    const fullUrl = `${gatewayConfig.url}${gatewayConfig.endpoint}`;

    log.info(`Connecting to Docker MCP Gateway at ${fullUrl}...`);

    const transport = new StreamableHTTPClientTransport(new URL(fullUrl), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${gatewayConfig.bearerToken}`,
        },
      },
    });

    const client = new Client(
      {
        name: "discord-bot",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    // Connect with timeout (using helper to prevent timeout leak)
    // Cast transport to satisfy exactOptionalPropertyTypes
    await withTimeout(
      client.connect(transport as unknown as Parameters<typeof client.connect>[0]),
      config.mcp.connectionTimeoutMs,
      "Docker MCP Gateway connection timeout"
    );

    // Get tools from gateway
    const toolsResult = await client.listTools();
    const tools: McpTool[] = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      serverName: "docker-gateway",
      permissions: "public" as const,
      source: "docker-gateway" as const,
    }));

    this.gatewayConnection = {
      type: "docker-gateway",
      transportType: "streamable-http",
      client,
      transport,
      url: fullUrl,
      connected: true,
      tools,
      reconnectAttempts: 0,
    };

    log.info(`Connected to Docker MCP Gateway with ${tools.length} tool(s)`);
  }

  /**
   * Attempt to reconnect to Docker MCP Gateway
   */
  async reconnectDockerGateway(): Promise<boolean> {
    if (!config.mcp.dockerGateway.enabled) return false;

    const maxAttempts = config.mcp.dockerGateway.maxReconnectAttempts;
    const attempts = this.gatewayConnection?.reconnectAttempts ?? 0;

    if (attempts >= maxAttempts) {
      log.warn(`Docker MCP Gateway reconnection limit reached (${maxAttempts} attempts)`);
      return false;
    }

    log.info(
      `Attempting to reconnect to Docker MCP Gateway (attempt ${attempts + 1}/${maxAttempts})...`
    );

    // Disconnect existing connection if any
    if (this.gatewayConnection?.connected) {
      try {
        await this.gatewayConnection.client.close();
      } catch {
        // Ignore close errors
      }
    }

    await this.connectToDockerGateway();

    if (this.gatewayConnection) {
      this.gatewayConnection.reconnectAttempts = attempts + 1;
    }

    return this.gatewayConnection?.connected ?? false;
  }

  /**
   * Load MCP configuration from file
   */
  private async loadConfig(): Promise<McpConfig> {
    try {
      const configContent = await readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(configContent) as unknown;

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
      return obj.replaceAll(/\$\{([^}]+)\}/g, (_, envVar: string) => {
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
   * Connect to a single stdio-based MCP server
   */
  private async connectToStdioServer(
    serverName: string,
    serverConfig: McpServerConfig
  ): Promise<void> {
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

    // Connect with timeout (using helper to prevent timeout leak)
    await withTimeout(
      client.connect(transport),
      config.mcp.connectionTimeoutMs,
      `Connection timeout for ${serverName}`
    );

    // Get tools from server
    const toolsResult = await client.listTools();
    const tools: McpTool[] = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      serverName,
      permissions: serverConfig.metadata?.permissions ?? "public",
      source: "stdio" as const,
    }));

    const connection: McpStdioConnection = {
      type: "stdio",
      client,
      transport,
      serverName,
      config: serverConfig,
      connected: true,
      tools,
    };

    this.stdioConnections.set(serverName, connection);
    log.info(`Connected to MCP server ${serverName} with ${tools.length} tool(s)`);
  }

  /**
   * Get all available tools across all connected servers (stdio + gateway)
   */
  getAllTools(): McpTool[] {
    const tools: McpTool[] = [];

    // Add tools from stdio connections
    for (const connection of this.stdioConnections.values()) {
      if (connection.connected) {
        tools.push(...connection.tools);
      }
    }

    // Add tools from Docker MCP Gateway
    if (this.gatewayConnection?.connected) {
      tools.push(...this.gatewayConnection.tools);
    }

    return tools;
  }

  /**
   * Get tools from Docker MCP Gateway only
   */
  getDockerGatewayTools(): McpTool[] {
    if (!this.gatewayConnection?.connected) return [];
    return [...this.gatewayConnection.tools];
  }

  /**
   * Check if Docker MCP Gateway is connected
   */
  isDockerGatewayConnected(): boolean {
    return this.gatewayConnection?.connected ?? false;
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
      default:
        // Public only sees public tools
        return allTools.filter((t) => t.permissions === "public");
    }
  }

  /**
   * Call a tool on an MCP server (auto-routes to correct connection)
   */
  /**
   * Find connection that has a specific tool
   */
  private findStdioConnectionForTool(
    toolName: string
  ): { connection: McpStdioConnection; tool: McpTool } | null {
    for (const connection of this.stdioConnections.values()) {
      const tool = connection.tools.find((t: McpTool) => t.name === toolName);
      if (tool && connection.connected) {
        return { connection, tool };
      }
    }
    return null;
  }

  /**
   * Call a tool via stdio connection
   */
  private async callStdioTool(
    connection: McpStdioConnection,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    try {
      return await connection.client.callTool({
        name: toolName,
        arguments: args,
      });
    } catch (error) {
      log.error(
        `Failed to call tool ${toolName}: ` +
          (error instanceof Error ? error.message : String(error)),
        sanitizeError(error)
      );
      throw error;
    }
  }

  /**
   * Call a tool via Docker MCP Gateway with reconnection support
   */
  private async callGatewayTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.gatewayConnection) {
      throw new Error("Docker Gateway not connected");
    }

    try {
      return await this.gatewayConnection.client.callTool({
        name: toolName,
        arguments: args,
      });
    } catch (error) {
      log.error(
        `Failed to call Docker Gateway tool ${toolName}: ` +
          (error instanceof Error ? error.message : String(error)),
        sanitizeError(error)
      );

      // Attempt reconnection if auto-reconnect is enabled
      if (config.mcp.dockerGateway.autoReconnect && this.gatewayConnection) {
        const reconnected = await this.reconnectDockerGateway();
        if (reconnected && this.gatewayConnection) {
          return this.gatewayConnection.client.callTool({
            name: toolName,
            arguments: args,
          });
        }
      }
      throw error;
    }
  }

  /**
   * Call a tool by name
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    // First check stdio connections
    const stdioMatch = this.findStdioConnectionForTool(toolName);
    if (stdioMatch) {
      return this.callStdioTool(stdioMatch.connection, toolName, args);
    }

    // Then check Docker MCP Gateway
    if (this.gatewayConnection?.connected) {
      const tool = this.gatewayConnection.tools.find((t: McpTool) => t.name === toolName);
      if (tool) {
        return this.callGatewayTool(toolName, args);
      }
    }

    throw new Error(`Tool not found: ${toolName}`);
  }

  /**
   * Check if a tool exists
   */
  hasTool(toolName: string): boolean {
    // Check stdio connections
    for (const connection of this.stdioConnections.values()) {
      if (connection.tools.some((t: McpTool) => t.name === toolName)) {
        return true;
      }
    }

    // Check Docker MCP Gateway
    if (this.gatewayConnection?.connected) {
      if (this.gatewayConnection.tools.some((t: McpTool) => t.name === toolName)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): McpTool | undefined {
    // Check stdio connections first
    for (const connection of this.stdioConnections.values()) {
      const tool = connection.tools.find((t: McpTool) => t.name === toolName);
      if (tool) return tool;
    }

    // Then check Docker MCP Gateway
    if (this.gatewayConnection?.connected) {
      const tool = this.gatewayConnection.tools.find((t: McpTool) => t.name === toolName);
      if (tool) return tool;
    }

    return undefined;
  }

  /**
   * Disconnect from all servers
   */
  async shutdown(): Promise<void> {
    // Shutdown stdio connections
    for (const [serverName, connection] of this.stdioConnections) {
      try {
        await connection.client.close();
        connection.connected = false;
        log.debug(`Disconnected from MCP server: ${serverName}`);
      } catch (error) {
        log.error(
          `Error disconnecting from ${serverName}: ` +
            (error instanceof Error ? error.message : String(error)),
          sanitizeError(error)
        );
      }
    }
    this.stdioConnections.clear();

    // Shutdown Docker MCP Gateway
    if (this.gatewayConnection) {
      try {
        await this.gatewayConnection.client.close();
        this.gatewayConnection.connected = false;
        log.debug("Disconnected from Docker MCP Gateway");
      } catch (error) {
        log.error(
          `Error disconnecting from Docker MCP Gateway: ` +
            (error instanceof Error ? error.message : String(error)),
          sanitizeError(error)
        );
      }
    }

    this.initialized = false;
  }

  /**
   * Get connection status
   */
  getStatus(): { serverName: string; connected: boolean; toolCount: number; source: string }[] {
    const status: { serverName: string; connected: boolean; toolCount: number; source: string }[] =
      [];

    // Stdio connections
    for (const conn of this.stdioConnections.values()) {
      status.push({
        serverName: conn.serverName,
        connected: conn.connected,
        toolCount: conn.tools.length,
        source: "stdio",
      });
    }

    // Docker MCP Gateway
    if (this.gatewayConnection) {
      status.push({
        serverName: "docker-gateway",
        connected: this.gatewayConnection.connected,
        toolCount: this.gatewayConnection.tools.length,
        source: "docker-gateway",
      });
    }

    return status;
  }

  /**
   * Refresh tools from Docker MCP Gateway
   * Useful when new MCP servers are enabled in Docker Desktop
   */
  async refreshDockerGatewayTools(): Promise<McpTool[]> {
    if (!this.gatewayConnection?.connected) {
      throw new Error("Docker MCP Gateway is not connected");
    }

    try {
      const toolsResult = await this.gatewayConnection.client.listTools();
      const tools: McpTool[] = toolsResult.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
        serverName: "docker-gateway",
        permissions: "public" as const,
        source: "docker-gateway" as const,
      }));

      this.gatewayConnection.tools = tools;
      log.info(`Refreshed Docker MCP Gateway tools: ${tools.length} tool(s) available`);

      return tools;
    } catch (error) {
      log.error(
        `Failed to refresh Docker MCP Gateway tools: ` +
          (error instanceof Error ? error.message : String(error)),
        sanitizeError(error)
      );
      throw error;
    }
  }
}

// Export singleton
export const mcpManager = McpClientManager.getInstance();
