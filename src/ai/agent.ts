import axios from "axios";
import dns from "dns/promises";
import net from "net";
import { XMLParser } from "fast-xml-parser";
import { evaluate } from "mathjs";
import {
  type ToolCall,
  type ToolResult,
  AGENT_TOOLS,
  formatToolsForPrompt,
  parseToolCall,
  isValidTool,
} from "./tools.js";
import { type AIService, getAIService } from "./service.js";
import { logger } from "../utils/logger.js";
import { getMemoryManager } from "./memory/index.js";

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
  private aiService: AIService;

  constructor() {
    this.aiService = getAIService();
  }

  /**
   * Run the agent with a user query
   * @param query - The task/question to process
   * @param userId - Discord user ID for memory isolation
   */
  async run(query: string, userId: string): Promise<AgentResponse> {
    const context: AgentContext = {
      messages: [],
      toolsUsed: [],
      iterations: 0,
    };

    const thinking: string[] = [];

    // Get memory context for this user
    const memoryManager = getMemoryManager();
    const memoryContext = await memoryManager.buildFullContext(userId, query);

    // System prompt with tool instructions and memory
    const systemPrompt = this.buildSystemPrompt(memoryContext);

    // Add user message
    context.messages.push({
      role: "user",
      content: query,
    });

    // Agent loop
    while (context.iterations < MAX_ITERATIONS) {
      context.iterations++;

      // Build prompt from context
      const prompt = this.buildPrompt(context);

      // Get LLM response
      const response = await this.aiService.chat(prompt, {
        systemPrompt,
        temperature: 0.7,
        maxTokens: 4096,
      });

      // Check for tool call
      const toolCall = parseToolCall(response);

      if (toolCall) {
        // Execute the tool
        if (isValidTool(toolCall.name)) {
          context.messages.push({
            role: "assistant",
            content: response,
            toolCall,
          });

          // Track thinking
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
        } else {
          // Invalid tool - tell the agent
          context.messages.push({
            role: "tool",
            content: `Error: Tool "${
              toolCall.name
            }" is not available. Available tools: ${AGENT_TOOLS.map((t) => t.name).join(", ")}`,
          });
        }
      } else {
        // No tool call - this is the final response
        return {
          response: this.cleanResponse(response),
          toolsUsed: [...new Set(context.toolsUsed)],
          iterations: context.iterations,
          thinking: thinking.length > 0 ? thinking : undefined,
        };
      }
    }

    // Max iterations reached
    return {
      response:
        "I've reached the maximum number of steps. Here's what I found so far based on the tools I used.",
      toolsUsed: [...new Set(context.toolsUsed)],
      iterations: context.iterations,
      thinking: thinking.length > 0 ? thinking : undefined,
    };
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
  private async toolWebSearch(query: string, maxResults = 5): Promise<ToolResult> {
    try {
      const trimmedQuery = query?.trim() ?? "";

      if (!trimmedQuery) {
        return {
          success: false,
          error: "Search query cannot be empty.",
        };
      }

      if (trimmedQuery.length > 300) {
        return {
          success: false,
          error: "Search query is too long. Please shorten it.",
        };
      }

      // Sanitize maxResults
      const safeMaxResults = Math.min(Math.max(1, maxResults || 5), 10);

      // Use DuckDuckGo instant answer API (no API key needed)
      const response = await axios.get("https://api.duckduckgo.com/", {
        params: {
          q: trimmedQuery,
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

      let result = "";

      if (data.AbstractText) {
        result += `Summary: ${data.AbstractText}\n`;
        if (data.AbstractSource) {
          result += `Source: ${data.AbstractSource}\n`;
        }
      }

      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        result += "\nRelated:\n";
        const topics = data.RelatedTopics.slice(0, safeMaxResults);
        for (const topic of topics) {
          if (topic.Text) {
            result += `- ${topic.Text}\n`;
          }
        }
      }

      if (!result) {
        result = "No results found. Try a different search query.";
      }

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
  private isPrivateIp(ip: string): boolean {
    const family = net.isIP(ip);
    if (!family) return false;

    // IPv4 handling
    if (family === 4) {
      const parts = ip.split(".").map(Number);
      if (parts.length !== 4) return false;

      const a = parts[0]!;
      const b = parts[1]!;
      const c = parts[2]!;
      const d = parts[3]!;

      // Validate each octet
      if ([a, b, c, d].some((n) => isNaN(n) || n < 0 || n > 255)) {
        return true; // Treat invalid IPs as private for safety
      }

      // 0.0.0.0/8 (current network)
      if (a === 0) return true;

      // 10.0.0.0/8
      if (a === 10) return true;

      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;

      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;

      // 127.0.0.0/8 (loopback)
      if (a === 127) return true;

      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true;

      // 100.64.0.0/10 (Carrier-grade NAT)
      if (a === 100 && b >= 64 && b <= 127) return true;

      // 192.0.0.0/24 (IETF Protocol Assignments)
      if (a === 192 && b === 0 && c === 0) return true;

      // 192.0.2.0/24 (TEST-NET-1)
      if (a === 192 && b === 0 && c === 2) return true;

      // 198.51.100.0/24 (TEST-NET-2)
      if (a === 198 && b === 51 && c === 100) return true;

      // 203.0.113.0/24 (TEST-NET-3)
      if (a === 203 && b === 0 && c === 113) return true;

      // 224.0.0.0/4 (Multicast)
      if (a >= 224 && a <= 239) return true;

      // 240.0.0.0/4 (Reserved for future use)
      if (a >= 240) return true;
    }

    // IPv6 handling
    if (family === 6) {
      const normalized = ip.toLowerCase();

      // Loopback ::1
      if (normalized === "::1") return true;

      // Unspecified address ::
      if (normalized === "::") return true;

      // Unique local addresses fc00::/7 (fc00::/8, fd00::/8)
      if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
        return true;
      }

      // Link-local addresses fe80::/10
      if (
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
      ) {
        return true;
      }

      // IPv4-mapped IPv6 addresses ::ffff:x.x.x.x
      if (normalized.startsWith("::ffff:")) {
        const ipv4Part = normalized.slice(7);
        if (net.isIPv4(ipv4Part)) {
          return this.isPrivateIp(ipv4Part);
        }
      }
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
  private async toolFetchUrl(url: string): Promise<ToolResult> {
    try {
      // Validate URL format
      if (!url || typeof url !== "string") {
        return { success: false, error: "URL is required" };
      }

      const trimmedUrl = url.trim();
      if (trimmedUrl.length > 2048) {
        return { success: false, error: "URL is too long" };
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmedUrl);
      } catch {
        return { success: false, error: "Invalid URL format" };
      }

      // Only allow HTTP/HTTPS
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return { success: false, error: "Only HTTP/HTTPS URLs are supported" };
      }

      // Check against hostname allowlist
      if (!this.isAllowedHostname(parsedUrl.hostname)) {
        return {
          success: false,
          error: `Fetching from "${parsedUrl.hostname}" is not allowed. Only specific trusted domains are permitted.`,
        };
      }

      // If hostname is an IP literal, check it directly
      if (net.isIP(parsedUrl.hostname)) {
        if (this.isPrivateIp(parsedUrl.hostname)) {
          return {
            success: false,
            error: "Fetching URLs to private or internal networks is not allowed.",
          };
        }
      } else {
        // Resolve hostname and block private addresses for SSRF protection
        try {
          const addresses = await dns.lookup(parsedUrl.hostname, { all: true });
          if (addresses.some((addr) => this.isPrivateIp(addr.address))) {
            return {
              success: false,
              error: "Fetching URLs to private or internal networks is not allowed.",
            };
          }
        } catch {
          return {
            success: false,
            error: "Failed to resolve URL hostname.",
          };
        }
      }

      // Make the request with redirects disabled to prevent SSRF via redirects
      const response = await axios.get(trimmedUrl, {
        timeout: TOOL_TIMEOUT,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DiscordBot/1.0)",
        },
        maxRedirects: 0, // Disable redirects to prevent SSRF
        maxContentLength: 100 * 1024, // Limit response size to 100KB
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Extract text content with safe HTML stripping
      // Uses iterative approach to handle nested/malformed tags like <scr<script>ipt>
      let content = "";
      if (typeof response.data === "string") {
        content = response.data;
        // Iteratively remove script tags to handle nested cases
        let prev = "";
        while (prev !== content) {
          prev = content;
          content = content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
        }
        // Iteratively remove style tags
        prev = "";
        while (prev !== content) {
          prev = content;
          content = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
        }
        // Iteratively remove remaining HTML tags
        prev = "";
        while (prev !== content) {
          prev = content;
          content = content.replace(/<[^>]+>/g, " ");
        }
        // Clean up whitespace and limit length
        content = content.replace(/\s+/g, " ").trim().slice(0, 4000);
      } else if (typeof response.data === "object" && response.data !== null) {
        // Handle JSON responses safely
        content = JSON.stringify(response.data).slice(0, 4000);
      }

      return { success: true, result: content };
    } catch (error) {
      logger.error("Fetch URL failed", error instanceof Error ? error.message : "Unknown error");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Search arXiv for papers
   */
  private async toolSearchArxiv(query: string, maxResults = 5): Promise<ToolResult> {
    try {
      const trimmedQuery = query?.trim() ?? "";

      if (!trimmedQuery) {
        return {
          success: false,
          error: "Search query cannot be empty.",
        };
      }

      if (trimmedQuery.length > 300) {
        return {
          success: false,
          error: "Search query is too long. Please shorten it.",
        };
      }

      // Sanitize maxResults
      const safeMaxResults = Math.min(Math.max(1, maxResults || 5), 20);

      const response = await axios.get("https://export.arxiv.org/api/query", {
        params: {
          search_query: `all:${trimmedQuery}`,
          start: 0,
          max_results: safeMaxResults,
          sortBy: "relevance",
          sortOrder: "descending",
        },
        timeout: TOOL_TIMEOUT,
      });

      // Parse XML response using a proper parser
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
      let entriesRaw: ArxivEntry[] = [];
      const rawEntry = parsed?.feed?.entry;

      if (rawEntry) {
        entriesRaw = Array.isArray(rawEntry) ? rawEntry : [rawEntry];
      }

      const entries: string[] = [];

      for (const entry of entriesRaw.slice(0, safeMaxResults)) {
        if (!entry) continue;

        const rawTitle = entry.title ?? "";
        const rawSummary = entry.summary ?? "";
        const rawId = entry.id ?? "";

        const title = String(rawTitle).replace(/\s+/g, " ").trim();
        const summary = String(rawSummary).replace(/\s+/g, " ").trim();
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

      if (entries.length === 0) {
        return { success: true, result: "No papers found for this query." };
      }

      return {
        success: true,
        result: `Found ${entries.length} papers:\n\n${entries.join("\n\n---\n\n")}`,
      };
    } catch (error) {
      logger.error("arXiv search failed", error instanceof Error ? error.message : "Unknown error");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
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

      if (typeof result !== "number" || !isFinite(result)) {
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
   * Get Wikipedia summary
   */
  private async toolWikipediaSummary(topic: string): Promise<ToolResult> {
    try {
      const trimmedTopic = topic?.trim() ?? "";

      if (!trimmedTopic) {
        return {
          success: false,
          error: "Topic cannot be empty.",
        };
      }

      if (trimmedTopic.length > 200) {
        return {
          success: false,
          error: "Topic is too long. Please shorten it.",
        };
      }

      // Validate topic doesn't contain path traversal attempts
      if (
        trimmedTopic.includes("..") ||
        trimmedTopic.includes("/") ||
        trimmedTopic.includes("\\")
      ) {
        return {
          success: false,
          error: "Topic contains invalid characters.",
        };
      }

      const response = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(trimmedTopic)}`,
        {
          timeout: TOOL_TIMEOUT,
          headers: {
            "User-Agent": "DiscordBot/1.0",
          },
        }
      );

      interface WikipediaResponse {
        type?: string;
        title?: string;
        extract?: string;
        content_urls?: {
          desktop?: {
            page?: string;
          };
        };
      }

      const data = response.data as WikipediaResponse;

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

      logger.error(
        "Wikipedia lookup failed",
        error instanceof Error ? error.message : "Unknown error"
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Clean the final response (remove any stray tool call formatting)
   */
  private cleanResponse(response: string): string {
    let cleaned = response;

    // Remove JSON code blocks that clearly look like tool call payloads
    cleaned = cleaned.replace(/```json[\s\S]*?"tool"\s*:[\s\S]*?```/gi, "");

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
  if (!instance) {
    instance = new AgentService();
  }
  return instance;
}

export default AgentService;
