import dns from "node:dns/promises";
import net from "node:net";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { evaluate } from "mathjs";
import { logger } from "../utils/logger.js";
import { stripHtmlTags } from "../utils/security.js";
import { getMemoryManager } from "./memory/index.js";
import { type AIService, getAIService } from "./service.js";
import {
  AGENT_TOOLS,
  formatToolsForPrompt,
  isValidTool,
  parseToolCall,
  type ToolCall,
  type ToolResult,
} from "./tools.js";

interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
}

interface AgentContext {
  messages: AgentMessage[];
  toolsUsed: string[];
  iterations: number;
}

interface AgentResponse {
  response: string;
  toolsUsed: string[];
  iterations: number;
  thinking?: string[] | undefined;
}

const MAX_ITERATIONS = 8;
const TOOL_TIMEOUT = 30000;

// Allowlist of safe URL hostnames for fetch_url tool
const ALLOWED_FETCH_HOSTNAMES = new Set([
  "en.wikipedia.org",
  "www.wikipedia.org",
  "arxiv.org",
  "export.arxiv.org",
  "api.duckduckgo.com",
  "github.com",
  "raw.githubusercontent.com",
  "docs.python.org",
  "developer.mozilla.org",
  "stackoverflow.com",
]);

/**
 * Agent Service - Orchestrates tool-calling with the LLM
 */
export class AgentService {
  private readonly aiService: AIService;

  constructor() {
    this.aiService = getAIService();
  }

  /**
   * Run the agent with a user query
   * @param query - The task/question to process
   * @param userId - Discord user ID for memory isolation
   */
  /**
   * Initialize agent context and prepare for execution
   */
  private async initializeContext(
    query: string,
    userId: string
  ): Promise<{ context: AgentContext; systemPrompt: string }> {
    const context: AgentContext = {
      messages: [{ role: "user", content: query }],
      toolsUsed: [],
      iterations: 0,
    };

    const memoryManager = getMemoryManager();
    const memoryContext = await memoryManager.buildFullContext(userId, query);
    const systemPrompt = this.buildSystemPrompt(memoryContext);

    return { context, systemPrompt };
  }

  /**
   * Handle tool execution and result
   */
  private async handleToolExecution(
    toolCall: { name: string; arguments: Record<string, unknown> },
    context: AgentContext,
    thinking: string[]
  ): Promise<void> {
    if (toolCall.name === "think") {
      thinking.push(toolCall.arguments.thought as string);
    }

    try {
      const result = await this.executeTool(toolCall);
      context.toolsUsed.push(toolCall.name);

      const toolContent = result.success
        ? result.result
        : `Error: ${result.error ?? "Unknown error"}`;

      context.messages.push({
        role: "tool",
        content: `Tool "${toolCall.name}" result:\n${toolContent}`,
        toolResult: result,
      });
    } catch (error) {
      logger.error(
        "Tool execution failed",
        error instanceof Error ? error.message : "Unknown error"
      );
      context.messages.push({
        role: "tool",
        content: `Error: Tool "${toolCall.name}" execution failed.`,
      });
    }
  }

  /**
   * Build final response object
   */
  private buildFinalResponse(
    response: string | undefined,
    context: AgentContext,
    thinking: string[]
  ): AgentResponse {
    return {
      response:
        response ??
        "I've reached the maximum number of steps. Here's what I found so far based on the tools I used.",
      toolsUsed: [...new Set(context.toolsUsed)],
      iterations: context.iterations,
      thinking: thinking.length > 0 ? thinking : undefined,
    };
  }

  async run(query: string, userId: string): Promise<AgentResponse> {
    const { context, systemPrompt } = await this.initializeContext(query, userId);
    const thinking: string[] = [];

    while (context.iterations < MAX_ITERATIONS) {
      context.iterations++;

      const prompt = this.buildPrompt(context);
      const response = await this.aiService.chat(prompt, {
        systemPrompt,
        temperature: 0.7,
        maxTokens: 4096,
      });

      const toolCall = parseToolCall(response);

      if (!toolCall) {
        return this.buildFinalResponse(this.cleanResponse(response), context, thinking);
      }

      if (!isValidTool(toolCall.name)) {
        context.messages.push({
          role: "tool",
          content: `Error: Tool "${toolCall.name}" is not available. Available tools: ${AGENT_TOOLS.map((t) => t.name).join(", ")}`,
        });
        continue;
      }

      context.messages.push({
        role: "assistant",
        content: response,
        toolCall,
      });

      await this.handleToolExecution(toolCall, context, thinking);
    }

    return this.buildFinalResponse(undefined, context, thinking);
  }

  /**
   * Build the system prompt with tool definitions and memory context
   */
  private buildSystemPrompt(memoryContext: string): string {
    return `You are a helpful AI assistant with access to tools. You can use these tools to help answer questions and complete tasks.

${formatToolsForPrompt()}

${memoryContext}

When you have enough information to answer the user's question, provide your final response WITHOUT using a tool call.
Be concise and helpful. Focus on answering the user's actual question.
Do not include raw JSON tool-calls in your final response.`;
  }

  /**
   * Build the conversation prompt from context
   */
  private buildPrompt(context: AgentContext): string {
    let prompt = "";

    for (const message of context.messages) {
      switch (message.role) {
        case "user":
          prompt += `User: ${message.content}\n\n`;
          break;
        case "assistant":
          prompt += `Assistant: ${message.content}\n\n`;
          break;
        case "tool":
          prompt += `${message.content}\n\n`;
          break;
      }
    }

    prompt += "Assistant: ";
    return prompt;
  }

  /**
   * Execute a tool and return the result
   */
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    try {
      switch (toolCall.name) {
        case "web_search":
          return await this.toolWebSearch(
            toolCall.arguments.query as string,
            toolCall.arguments.max_results as number | undefined
          );

        case "fetch_url":
          return await this.toolFetchUrl(toolCall.arguments.url as string);

        case "search_arxiv":
          return await this.toolSearchArxiv(
            toolCall.arguments.query as string,
            toolCall.arguments.max_results as number | undefined
          );

        case "get_time":
          return await this.toolGetTime(toolCall.arguments.timezone as string | undefined);

        case "calculate":
          return await this.toolCalculate(toolCall.arguments.expression as string);

        case "wikipedia_summary":
          return await this.toolWikipediaSummary(toolCall.arguments.topic as string);

        case "think":
          return {
            success: true,
            result: `Thought recorded: ${toolCall.arguments.thought}`,
          };

        default:
          return {
            success: false,
            error: `Unknown tool: ${toolCall.name}`,
          };
      }
    } catch (error) {
      logger.error(
        "Unhandled error in executeTool",
        error instanceof Error ? error.message : "Unknown error"
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Tool execution failed",
      };
    }
  }

  /**
   * Web search tool - uses DuckDuckGo instant answer API
   */
  /**
   * Validate search query input
   */
  private validateSearchQuery(query: string): {
    valid: boolean;
    error?: string;
    trimmedQuery?: string;
  } {
    const trimmedQuery = query?.trim() ?? "";

    if (!trimmedQuery) {
      return { valid: false, error: "Search query cannot be empty." };
    }

    if (trimmedQuery.length > 300) {
      return { valid: false, error: "Search query is too long. Please shorten it." };
    }

    return { valid: true, trimmedQuery };
  }

  /**
   * Format DuckDuckGo search results
   */
  private formatSearchResults(
    data: { AbstractText?: string; AbstractSource?: string; RelatedTopics?: { Text?: string }[] },
    maxResults: number
  ): string {
    const parts: string[] = [];

    if (data.AbstractText) {
      parts.push(`Summary: ${data.AbstractText}`);
      if (data.AbstractSource) {
        parts.push(`Source: ${data.AbstractSource}`);
      }
    }

    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      parts.push("\nRelated:");
      const topics = data.RelatedTopics.slice(0, maxResults);
      for (const topic of topics) {
        if (topic.Text) {
          parts.push(`- ${topic.Text}`);
        }
      }
    }

    return parts.length > 0 ? parts.join("\n") : "No results found. Try a different search query.";
  }

  private async toolWebSearch(query: string, maxResults = 5): Promise<ToolResult> {
    try {
      const validation = this.validateSearchQuery(query);
      if (!validation.valid) {
        return { success: false, error: validation.error ?? "Invalid query" };
      }

      const safeMaxResults = Math.min(Math.max(1, maxResults || 5), 10);

      const response = await axios.get("https://api.duckduckgo.com/", {
        params: {
          q: validation.trimmedQuery,
          format: "json",
          no_html: 1,
          skip_disambig: 1,
        },
        timeout: TOOL_TIMEOUT,
      });

      const data = response.data as {
        AbstractText?: string;
        AbstractSource?: string;
        RelatedTopics?: { Text?: string }[];
      };

      const result = this.formatSearchResults(data, safeMaxResults);
      return { success: true, result };
    } catch (error) {
      logger.error("Web search failed", error instanceof Error ? error.message : "Unknown error");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Helper to determine if an IP address is private/internal
   */
  /**
   * Check if IPv4 address matches a private/reserved range
   */
  private isPrivateIPv4(octets: readonly number[]): boolean {
    const [a, b, c] = octets as [number, number, number, number];

    // IPv4 private ranges with helper closures
    const ipv4PrivateRanges: readonly (() => boolean)[] = [
      () => a === 0, // 0.0.0.0/8 (current network)
      () => a === 10, // 10.0.0.0/8
      () => a === 172 && b >= 16 && b <= 31, // 172.16.0.0/12
      () => a === 192 && b === 168, // 192.168.0.0/16
      () => a === 127, // 127.0.0.0/8 (loopback)
      () => a === 169 && b === 254, // 169.254.0.0/16 (link-local)
      () => a === 100 && b >= 64 && b <= 127, // 100.64.0.0/10 (Carrier-grade NAT)
      () => a === 192 && b === 0 && c === 0, // 192.0.0.0/24 (IETF Protocol Assignments)
      () => a === 192 && b === 0 && c === 2, // 192.0.2.0/24 (TEST-NET-1)
      () => a === 198 && b === 51 && c === 100, // 198.51.100.0/24 (TEST-NET-2)
      () => a === 203 && b === 0 && c === 113, // 203.0.113.0/24 (TEST-NET-3)
      () => a >= 224 && a <= 239, // 224.0.0.0/4 (Multicast)
      () => a >= 240, // 240.0.0.0/4 (Reserved for future use)
    ];

    return ipv4PrivateRanges.some((check) => check());
  }

  /**
   * Check if IPv6 address is private/reserved
   */
  private isPrivateIPv6(ip: string): boolean {
    const normalized = ip.toLowerCase();

    // Define IPv6 private/reserved prefixes
    const ipv6PrivatePrefixes = ["::1", "::", "fc", "fd", "fe8", "fe9", "fea", "feb"];

    // Check exact matches and prefixes
    if (normalized === "::1" || normalized === "::") return true;
    if (ipv6PrivatePrefixes.slice(2).some((prefix) => normalized.startsWith(prefix))) return true;

    // IPv4-mapped IPv6 addresses ::ffff:x.x.x.x
    if (normalized.startsWith("::ffff:")) {
      const ipv4Part = normalized.slice(7);
      if (net.isIPv4(ipv4Part)) {
        return this.isPrivateIp(ipv4Part);
      }
    }

    return false;
  }

  /**
   * Check if IP address is private/reserved (SSRF protection)
   */
  private isPrivateIp(ip: string): boolean {
    const family = net.isIP(ip);
    if (!family) return false;

    if (family === 4) {
      const parts = ip.split(".").map(Number);
      if (parts.length !== 4) return false;

      // Validate each octet - treat invalid IPs as private for safety
      if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
        return true;
      }

      return this.isPrivateIPv4(parts);
    }

    if (family === 6) {
      return this.isPrivateIPv6(ip);
    }

    return false;
  }

  /**
   * Validate URL is in the allowlist
   */
  private isAllowedHostname(hostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase();
    return ALLOWED_FETCH_HOSTNAMES.has(normalizedHostname);
  }

  /**
   * Fetch URL content with SSRF protection
   */
  /**
   * Validate URL for fetching
   */
  private validateFetchUrl(url: string): { valid: boolean; error?: string; parsedUrl?: URL } {
    if (!url || typeof url !== "string") {
      return { valid: false, error: "URL is required" };
    }

    const trimmedUrl = url.trim();
    if (trimmedUrl.length > 2048) {
      return { valid: false, error: "URL is too long" };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      return { valid: false, error: "Invalid URL format" };
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { valid: false, error: "Only HTTP/HTTPS URLs are supported" };
    }

    if (!this.isAllowedHostname(parsedUrl.hostname)) {
      return {
        valid: false,
        error: `Fetching from "${parsedUrl.hostname}" is not allowed. Only specific trusted domains are permitted.`,
      };
    }

    return { valid: true, parsedUrl };
  }

  /**
   * Check if URL resolves to private IP (SSRF protection)
   */
  private async checkSSRF(hostname: string): Promise<{ blocked: boolean; error?: string }> {
    if (net.isIP(hostname)) {
      if (this.isPrivateIp(hostname)) {
        return {
          blocked: true,
          error: "Fetching URLs to private or internal networks is not allowed.",
        };
      }
      return { blocked: false };
    }

    try {
      const addresses = await dns.lookup(hostname, { all: true });
      if (addresses.some((addr) => this.isPrivateIp(addr.address))) {
        return {
          blocked: true,
          error: "Fetching URLs to private or internal networks is not allowed.",
        };
      }
      return { blocked: false };
    } catch {
      return { blocked: true, error: "Failed to resolve URL hostname." };
    }
  }

  private async toolFetchUrl(url: string): Promise<ToolResult> {
    try {
      const validation = this.validateFetchUrl(url);
      if (!validation.valid) {
        return { success: false, error: validation.error ?? "Invalid URL" };
      }

      const hostname = validation.parsedUrl?.hostname;
      if (!hostname) {
        return { success: false, error: "Could not determine URL hostname" };
      }

      const ssrfCheck = await this.checkSSRF(hostname);
      if (ssrfCheck.blocked) {
        return { success: false, error: ssrfCheck.error ?? "SSRF blocked" };
      }

      const response = await axios.get(url.trim(), {
        timeout: TOOL_TIMEOUT,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0)" },
        maxRedirects: 0,
        maxContentLength: 100 * 1024,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      let content = "";
      if (typeof response.data === "string") {
        content = stripHtmlTags(response.data, 4000);
      } else if (typeof response.data === "object" && response.data !== null) {
        content = JSON.stringify(response.data).slice(0, 4000);
      }

      return { success: true, result: content };
    } catch (error) {
      logger.error("Fetch URL failed", error instanceof Error ? error.message : "Unknown error");
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  /**
   * Search arXiv for papers
   */
  /**
   * Format arXiv paper entries
   */
  private formatArxivEntries(
    entriesRaw: { title?: string; summary?: string; id?: string }[],
    maxResults: number
  ): string[] {
    const entries: string[] = [];

    for (const entry of entriesRaw.slice(0, maxResults)) {
      if (!entry) continue;

      const rawTitle = entry.title ?? "";
      const rawSummary = entry.summary ?? "";
      const rawId = entry.id ?? "";

      const title = String(rawTitle).replaceAll(/\s+/g, " ").trim();
      const summary = String(rawSummary).replaceAll(/\s+/g, " ").trim();
      const id = String(rawId).trim();

      if (title) {
        let paperInfo = `Title: ${title}`;
        if (id) paperInfo += `\nLink: ${id}`;
        if (summary) {
          paperInfo += `\nAbstract: ${summary.slice(0, 300)}...`;
        }
        entries.push(paperInfo);
      }
    }

    return entries;
  }

  private async toolSearchArxiv(query: string, maxResults = 5): Promise<ToolResult> {
    try {
      const validation = this.validateSearchQuery(query);
      if (!validation.valid) {
        return { success: false, error: validation.error ?? "Invalid query" };
      }

      const safeMaxResults = Math.min(Math.max(1, maxResults || 5), 20);

      const response = await axios.get("https://export.arxiv.org/api/query", {
        params: {
          search_query: `all:${validation.trimmedQuery}`,
          start: 0,
          max_results: safeMaxResults,
          sortBy: "relevance",
          sortOrder: "descending",
        },
        timeout: TOOL_TIMEOUT,
      });

      const xml = response.data as string;
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
      });

      interface ArxivEntry {
        title?: string;
        summary?: string;
        id?: string;
      }

      interface ArxivFeed {
        feed?: {
          entry?: ArxivEntry | ArxivEntry[];
        };
      }

      const parsed = parser.parse(xml) as ArxivFeed;
      const rawEntry = parsed?.feed?.entry;
      let entriesRaw: ArxivEntry[] = [];
      if (rawEntry) {
        entriesRaw = Array.isArray(rawEntry) ? rawEntry : [rawEntry];
      }

      const entries = this.formatArxivEntries(entriesRaw, safeMaxResults);

      if (entries.length === 0) {
        return { success: true, result: "No papers found for this query." };
      }

      return {
        success: true,
        result: `Found ${entries.length} papers:\n\n${entries.join("\n\n---\n\n")}`,
      };
    } catch (error) {
      logger.error("arXiv search failed", error instanceof Error ? error.message : "Unknown error");
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  /**
   * Get current time
   */
  private async toolGetTime(timezone?: string): Promise<ToolResult> {
    try {
      // Validate timezone to prevent injection
      const tz = timezone?.trim() || "UTC";

      // Basic validation - timezone should only contain alphanumeric, underscore, slash
      if (!/^[a-zA-Z0-9_/+-]+$/.test(tz) || tz.length > 50) {
        return {
          success: false,
          error: "Invalid timezone format.",
        };
      }

      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        dateStyle: "full",
        timeStyle: "long",
      });

      return {
        success: true,
        result: `Current time in ${tz}: ${formatter.format(now)}`,
      };
    } catch (error) {
      logger.error("Get time failed", error instanceof Error ? error.message : "Unknown error");
      return {
        success: false,
        error: error instanceof Error ? "Invalid timezone specified." : "Unknown error",
      };
    }
  }

  /**
   * Calculate mathematical expression
   */
  private async toolCalculate(expression: string): Promise<ToolResult> {
    try {
      const expr = expression?.trim() ?? "";

      if (!expr) {
        return { success: false, error: "Expression cannot be empty." };
      }

      if (expr.length > 500) {
        return { success: false, error: "Expression is too long." };
      }

      // Additional validation: only allow safe characters for math expressions
      if (!/^[0-9+\-*/().^%\s,a-zA-Z_]+$/.test(expr)) {
        return {
          success: false,
          error: "Expression contains invalid characters.",
        };
      }

      // Use mathjs for safe expression evaluation
      const result = evaluate(expr);

      if (typeof result !== "number" || !Number.isFinite(result)) {
        return { success: false, error: "Invalid result." };
      }

      return {
        success: true,
        result: `${expression} = ${result}`,
      };
    } catch (error) {
      logger.error("Calculation failed", error instanceof Error ? error.message : "Unknown error");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Helper to extract error message
   */
  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }

  /**
   * Get Wikipedia summary
   */
  private async toolWikipediaSummary(topic: string): Promise<ToolResult> {
    try {
      const trimmedTopic = topic?.trim() ?? "";

      if (!trimmedTopic) {
        return { success: false, error: "Topic cannot be empty." };
      }

      if (trimmedTopic.length > 200) {
        return {
          success: false,
          error: "Topic is too long. Please shorten it.",
        };
      }

      // Validate topic doesn't contain path traversal attempts
      if (/[/\\]|\.\./.test(trimmedTopic)) {
        return {
          success: false,
          error: "Topic contains invalid characters.",
        };
      }

      const response = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(trimmedTopic)}`,
        {
          timeout: TOOL_TIMEOUT,
          headers: { "User-Agent": "DiscordBot/1.0" },
        }
      );

      const data = response.data as {
        type?: string;
        title?: string;
        extract?: string;
        content_urls?: { desktop?: { page?: string } };
      };

      if (data.type === "disambiguation") {
        return {
          success: true,
          result: `"${trimmedTopic}" has multiple meanings. Try being more specific.`,
        };
      }

      let result = `# ${data.title ?? trimmedTopic}\n\n`;
      result += data.extract ?? "No summary available.";

      if (data.content_urls?.desktop?.page) {
        result += `\n\nRead more: ${data.content_urls.desktop.page}`;
      }

      return { success: true, result };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return {
          success: false,
          error: `No Wikipedia article found for "${topic}"`,
        };
      }

      const msg = this.getErrorMessage(error);
      logger.error("Wikipedia lookup failed", msg);
      return { success: false, error: msg };
    }
  }

  /**
   * Clean the final response (remove any stray tool call formatting)
   */
  private cleanResponse(response: string): string {
    let cleaned = response;

    // Remove JSON code blocks that clearly look like tool call payloads
    cleaned = cleaned.replaceAll(/```json[\s\S]*?"tool"\s*:[\s\S]*?```/gi, "");

    // Remove standalone lines that are obvious tool call JSON
    cleaned = cleaned
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (/^\{"tool"\s*:/.test(trimmed)) {
          return false;
        }
        return true;
      })
      .join("\n")
      .trim();

    // Do NOT remove generic code blocks so that normal examples are preserved
    return cleaned || response;
  }
}

// Singleton instance
let instance: AgentService | null = null;

export function getAgentService(): AgentService {
  instance ??= new AgentService();
  return instance;
}

export default AgentService;
