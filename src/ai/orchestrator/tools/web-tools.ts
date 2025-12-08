/**
 * Web Tools
 *
 * Web search and URL fetching tool implementations.
 */

import axios from "axios";
import { config } from "../../../config.js";
import { TOOL_TIMEOUT_MS } from "../../../constants.js";
import { createLogger } from "../../../utils/logger.js";
import { isUrlSafe, stripHtmlTags } from "../../../utils/security.js";
import type { ToolResult } from "../types.js";

const log = createLogger("WebTools");

/**
 * State interface for tracking fetched data
 */
export interface WebToolState {
  fetchedUrls: Set<string>;
  gatheredInfo: string[];
}

/**
 * Web search tool using DuckDuckGo
 */
export async function executeWebSearch(
  query: string,
  state: { gatheredInfo: string[] }
): Promise<ToolResult> {
  try {
    const response = await axios.get("https://api.duckduckgo.com/", {
      params: { q: query, format: "json", no_html: 1 },
      timeout: TOOL_TIMEOUT_MS,
    });

    const data = response.data as {
      AbstractText?: string;
      RelatedTopics?: { Text?: string }[];
    };

    let result = "";
    if (data.AbstractText) {
      result += `Summary: ${data.AbstractText}\n`;
      state.gatheredInfo.push(`[Search: ${query}] ${data.AbstractText}`);
    }
    if (data.RelatedTopics?.length) {
      result += "\nRelated:\n";
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text) result += `- ${topic.Text}\n`;
      }
    }

    return {
      success: true,
      result:
        result ||
        "No results found. This search tool only works for factual queries (like 'capital of France'), not news or current events. DO NOT retry this search - instead, tell the user you cannot access current news and provide any relevant knowledge you have.",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Search failed",
    };
  }
}

/**
 * Format a single SearXNG result for display
 */
function formatSearchResult(
  result: {
    title?: string;
    url?: string;
    content?: string;
    engine?: string;
    publishedDate?: string;
  },
  state: { gatheredInfo: string[] }
): string | null {
  const parts: string[] = [];
  if (result.title) parts.push(`**${result.title}**`);
  if (result.url) parts.push(`URL: ${result.url}`);
  if (result.content) {
    parts.push(result.content.slice(0, 300));
    // Store search snippet for fallback
    state.gatheredInfo.push(`[${result.title}] ${result.content.slice(0, 200)}`);
  }
  if (result.publishedDate) parts.push(`Published: ${result.publishedDate}`);
  if (result.engine) parts.push(`(via ${result.engine})`);
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Build safe search params
 */
function buildSearchParams(
  query: string,
  maxResults?: number,
  engines?: string[],
  categories?: string[]
): { params: URLSearchParams; safeMaxResults: number } {
  const defaultMaxResults = config.searxng?.defaultResults ?? 10;
  const safeMaxResults = Math.min(Math.max(1, maxResults ?? defaultMaxResults), 50);

  const safeEngines = engines?.filter((e) => typeof e === "string" && /^\w+$/.test(e)).slice(0, 10);

  const safeCategories = categories
    ?.filter((c) => typeof c === "string" && /^\w+$/.test(c))
    .slice(0, 5);

  const params = new URLSearchParams();
  params.set("q", query);
  params.set("format", "json");
  params.set("safesearch", "0");

  if (safeEngines?.length) {
    params.set("engines", safeEngines.join(","));
  }
  if (safeCategories?.length) {
    params.set("categories", safeCategories.join(","));
  }

  return { params, safeMaxResults };
}

/**
 * Process SearXNG response data
 */
function processDeepSearchResults(
  data: {
    results?: {
      title?: string;
      url?: string;
      content?: string;
      engine?: string;
      publishedDate?: string;
    }[];
    answers?: string[];
    infoboxes?: { content?: string }[];
  },
  safeMaxResults: number,
  state: { gatheredInfo: string[] }
): string[] {
  const results: string[] = [];

  // Add any direct answers
  if (data.answers?.[0]) {
    results.push(`Direct Answer: ${data.answers[0]}`);
    state.gatheredInfo.push(`[Search Answer] ${data.answers[0]}`);
  }

  // Add infobox content if available
  if (data.infoboxes?.[0]?.content) {
    results.push(`Info: ${data.infoboxes[0].content.slice(0, 500)}`);
    state.gatheredInfo.push(`[Search Info] ${data.infoboxes[0].content.slice(0, 300)}`);
  }

  // Add search results (limited by safeMaxResults)
  if (data.results?.length) {
    for (const result of data.results.slice(0, safeMaxResults)) {
      const formatted = formatSearchResult(result, state);
      if (formatted) results.push(formatted);
    }
  }

  return results;
}

/**
 * Deep web search using SearXNG - for comprehensive web search including news and current events
 * Security: Validates and sanitizes query parameters to prevent injection
 */
export async function executeDeepWebSearch(
  query: string,
  state: { gatheredInfo: string[] },
  maxResults?: number,
  engines?: string[],
  categories?: string[]
): Promise<ToolResult> {
  try {
    const searxngUrl = config.searxng?.url ?? "http://searxng:8080";
    const timeout = config.searxng?.timeout ?? 30000;

    const { params, safeMaxResults } = buildSearchParams(query, maxResults, engines, categories);

    const response = await axios.get(`${searxngUrl}/search`, {
      params,
      timeout,
      headers: { Accept: "application/json" },
    });

    const data = response.data;
    const results = processDeepSearchResults(data, safeMaxResults, state);

    if (results.length === 0) {
      return {
        success: true,
        result: "No search results found for this query.",
      };
    }

    return { success: true, result: results.join("\n\n---\n\n") };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Search failed";
    log.error(`Deep web search failed: ${errorMessage}`);
    return { success: false, error: `Deep web search failed: ${errorMessage}` };
  }
}

/**
 * Get user-friendly error message for fetch failures
 */
function getFetchErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Failed to fetch URL";
  }
  if (error.message.includes("timeout")) {
    return "Request timed out";
  }
  if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
    return "Could not connect to server";
  }
  if (error.message.includes("404")) {
    return "Page not found";
  }
  return "Failed to fetch URL";
}

/**
 * Fetch URL tool - allows fetching any public URL
 * SSRF protection is handled by isUrlSafe() which blocks private IPs and dangerous protocols
 * Tracks fetched URLs to prevent infinite loops
 */
export async function executeFetchUrl(url: string, state: WebToolState): Promise<ToolResult> {
  try {
    // Check for duplicate URL fetch (prevents loops)
    if (state.fetchedUrls.has(url)) {
      log.debug(`Skipping duplicate fetch for URL: ${url}`);
      return {
        success: true,
        result: `[Already fetched] This URL was already fetched earlier. Use the previously retrieved content instead of fetching again. Move on to synthesizing a response from all gathered information.`,
      };
    }

    // Validate URL format
    const parsed = new URL(url);

    // Only allow http/https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        success: false,
        error: `Invalid protocol "${parsed.protocol}" - only http and https are allowed`,
      };
    }

    // SSRF protection: check for private IPs, localhost, dangerous protocols, etc.
    const urlSafety = isUrlSafe(url);
    if (!urlSafety.safe) {
      return {
        success: false,
        error: urlSafety.reason ?? "URL not safe for fetching",
      };
    }

    // Mark URL as fetched BEFORE the request (to prevent race conditions in parallel calls)
    state.fetchedUrls.add(url);

    const response = await axios.get(url, {
      timeout: TOOL_TIMEOUT_MS,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Bot)" },
      maxRedirects: 3,
    });

    // Safe HTML stripping using shared utility
    let content: string;
    const rawData = response.data;
    if (typeof rawData === "string") {
      content = stripHtmlTags(rawData, 4000);
    } else if (typeof rawData === "object" && rawData !== null) {
      content = JSON.stringify(rawData, null, 2).slice(0, 4000);
    } else {
      content = String(rawData).slice(0, 4000);
    }

    // Store meaningful content for fallback response
    if (content && content.length > 100) {
      state.gatheredInfo.push(`[${parsed.hostname}] ${content.slice(0, 500)}`);
      log.debug(`Fetched ${url}: ${content.length} chars`);
    }

    return { success: true, result: content };
  } catch (error) {
    // Mark URL as fetched even on error to prevent retry loops
    state.fetchedUrls.add(url);

    const errorMessage = getFetchErrorMessage(error);
    log.debug(
      `URL fetch error for ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      success: false,
      error: errorMessage,
    };
  }
}
