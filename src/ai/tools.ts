/**
 * Tool Definitions for LLM Agent
 * These tools can be called by the AI agent to perform actions
 */

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

import config from "../config.js";

/**
 * Get the list of available tools, filtered based on configuration
 * This filters out tools that are disabled (e.g., generate_image when image generation is off)
 */
export function getAvailableTools(): Tool[] {
  return AGENT_TOOLS.filter((tool) => {
    // Filter out generate_image when image generation is disabled
    if (tool.name === "generate_image" && !config.comfyui.enabled) {
      return false;
    }
    return true;
  });
}

/**
 * Available tools for the agent
 */
export const AGENT_TOOLS: Tool[] = [
  {
    name: "web_search",
    description:
      "Quick search for simple factual information (like 'capital of France'). For complex queries, current news, or in-depth research, use deep_search instead.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "The search query - best for simple factual questions",
        required: true,
      },
    ],
  },
  {
    name: "deep_web_search",
    description:
      "Comprehensive web search for current news, complex topics, or in-depth research. Use this for queries about recent events, detailed information, or when web_search returns no results.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "The search query - can be complex or specific",
        required: true,
      },
      {
        name: "max_results",
        type: "number",
        description: "Maximum number of results to return (default: 10)",
        required: false,
      },
      {
        name: "categories",
        type: "string",
        description:
          "Search categories: 'general', 'news', 'images', 'science', 'it' (default: 'general')",
        required: false,
      },
    ],
  },
  {
    name: "fetch_url",
    description:
      "Fetch the content of a webpage. Use this to read documentation, articles, or web pages.",
    parameters: [
      {
        name: "url",
        type: "string",
        description: "The URL to fetch",
        required: true,
      },
    ],
  },
  {
    name: "search_arxiv",
    description:
      "Search for academic papers on arXiv. Use for scientific or technical research queries.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "Search query for papers",
        required: true,
      },
      {
        name: "max_results",
        type: "number",
        description: "Maximum results (default: 5)",
        required: false,
      },
    ],
  },
  {
    name: "get_time",
    description:
      "Get current time. If no timezone specified, returns all US timezones (CST, PST, MST, EST). For non-US timezones, specify the IANA timezone name.",
    parameters: [
      {
        name: "timezone",
        type: "string",
        description:
          "Optional IANA timezone name (e.g., 'Europe/London', 'Asia/Tokyo'). Omit for US timezones.",
        required: false,
      },
    ],
  },
  {
    name: "calculate",
    description:
      "Perform mathematical calculations. Supports basic arithmetic, trigonometry, logarithms, etc.",
    parameters: [
      {
        name: "expression",
        type: "string",
        description:
          "Mathematical expression to evaluate (e.g., '2 + 2 * 3', 'sin(45)', 'log(100)')",
        required: true,
      },
    ],
  },
  {
    name: "wikipedia_summary",
    description: "Get a summary of a Wikipedia article on a topic.",
    parameters: [
      {
        name: "topic",
        type: "string",
        description: "The topic to look up on Wikipedia",
        required: true,
      },
    ],
  },
  {
    name: "think",
    description:
      "Use this tool to think through complex problems step by step before providing a final answer. You can use this tool as many times as needed - thinking does NOT count against your tool call limit. Perfect for reasoning, planning, breaking down complex tasks, and reaching a well-considered conclusion.",
    parameters: [
      {
        name: "thought",
        type: "string",
        description: "Your current thinking or reasoning step",
        required: true,
      },
    ],
  },
  {
    name: "generate_image",
    description:
      "Generate an image from a text description using AI. Use this when the user asks for image creation, artwork, or visual content. Pass the user's request as-is - the system will optimize the prompt automatically.",
    parameters: [
      {
        name: "prompt",
        type: "string",
        description:
          "The user's image request. Pass their description directly - do NOT expand or elaborate on it. Keep it under 300 characters.",
        required: true,
      },
      {
        name: "negative_prompt",
        type: "string",
        description: "Things to avoid in the image (e.g., 'blurry, low quality, distorted')",
        required: false,
      },
      {
        name: "style",
        type: "string",
        description: "Art style preset to apply",
        required: false,
        enum: [
          "realistic",
          "anime",
          "digital-art",
          "oil-painting",
          "watercolor",
          "sketch",
          "3d-render",
        ],
      },
    ],
  },
  {
    name: "remember",
    description:
      "Store important information about the user for future conversations. Use this when the user shares preferences, facts about themselves, or asks you to remember something.",
    parameters: [
      {
        name: "fact",
        type: "string",
        description: "The information to remember about the user",
        required: true,
      },
      {
        name: "category",
        type: "string",
        description: "Category of the information",
        required: false,
        enum: ["preference", "personal", "work", "hobby", "other"],
      },
    ],
  },
  {
    name: "recall",
    description:
      "Search your memory for information about the user. Use this when you need to remember something the user told you previously.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "What to search for in memory",
        required: true,
      },
    ],
  },
  // ========================================
  // Memory Self-Editing Tools (MemGPT Pattern)
  // These tools allow the AI to directly modify its memory
  // ========================================
  {
    name: "memory_append",
    description:
      "Store new information about the user for future conversations. Use this when learning something important that should be remembered long-term, like preferences, facts, or how they want to be responded to.",
    parameters: [
      {
        name: "content",
        type: "string",
        description: "The information to remember about the user (be specific and detailed)",
        required: true,
      },
      {
        name: "category",
        type: "string",
        description:
          "Category: 'preference' (likes/dislikes), 'fact' (personal info), 'procedure' (how they want responses)",
        required: false,
        enum: ["preference", "fact", "procedure"],
      },
    ],
  },
  {
    name: "memory_replace",
    description:
      "Update or correct existing memory. Use when the user provides new information that supersedes something you previously remembered, like a job change or name correction.",
    parameters: [
      {
        name: "search_query",
        type: "string",
        description: "Query to find the memory to update (e.g., 'user job' or 'user location')",
        required: true,
      },
      {
        name: "new_content",
        type: "string",
        description: "The corrected/updated information to replace with",
        required: true,
      },
      {
        name: "reason",
        type: "string",
        description: "Why this memory is being updated",
        required: false,
      },
    ],
  },
  {
    name: "graph_query",
    description:
      "Query the knowledge graph for relationships between entities the user mentioned. Use for questions like 'Who does X work with?' or 'What projects is Y involved in?' or to recall complex relationships.",
    parameters: [
      {
        name: "question",
        type: "string",
        description:
          "Natural language question about relationships (e.g., 'Who is Sarah's manager?')",
        required: true,
      },
    ],
  },
];

/**
 * Format tools for LLM prompt
 */
export function formatToolsForPrompt(): string {
  const availableTools = getAvailableTools();
  let output = "# Available Tools\n\n";
  output += "You can call tools by responding with a JSON block in this format:\n";
  output += "```json\n";
  output += '{"tool": "tool_name", "arguments": {"param1": "value1"}}\n';
  output += "```\n\n";
  output += "## Tools:\n\n";

  for (const tool of availableTools) {
    output += `### ${tool.name}\n`;
    output += `${tool.description}\n\n`;
    output += "Parameters:\n";
    for (const param of tool.parameters) {
      const required = param.required ? "(required)" : "(optional)";
      output += `- \`${param.name}\` (${param.type}) ${required}: ${param.description}\n`;
    }
    output += "\n";
  }

  output += "## Guidelines:\n";
  output += "- Use tools when you need current information or to perform actions\n";
  output += "- You can call multiple tools in sequence by waiting for each result\n";
  output += "- After getting tool results, synthesize them into a helpful response\n";
  output += "- If a tool fails, try an alternative approach or inform the user\n";
  output += "- Always provide a final answer to the user after using tools\n";

  return output;
}

/**
 * Extract content between code block markers starting at a given position
 */
function extractCodeBlockContent(response: string, blockStart: number): string | null {
  const contentStart = response.indexOf("\n", blockStart);
  if (contentStart === -1) return null;

  const blockEnd = response.indexOf("```", contentStart);
  if (blockEnd === -1) return null;

  return response.slice(contentStart + 1, blockEnd).trim();
}

/**
 * Find the matching closing brace for a JSON object
 */
function findMatchingBrace(response: string, braceStart: number): number {
  let depth = 1;
  for (let i = braceStart + 1; i < response.length && depth > 0; i++) {
    if (response[i] === "{") depth++;
    else if (response[i] === "}") depth--;
    if (depth === 0) return i;
  }
  return -1;
}

/**
 * Extract raw JSON object containing "tool" key
 */
function extractRawToolJson(response: string): string | null {
  const toolKeyIndex = response.indexOf('"tool"');
  if (toolKeyIndex === -1) return null;

  const braceStart = response.lastIndexOf("{", toolKeyIndex);
  if (braceStart === -1) return null;

  const braceEnd = findMatchingBrace(response, braceStart);
  if (braceEnd === -1) return null;

  return response.slice(braceStart, braceEnd + 1);
}

/**
 * Try to parse a JSON string as a tool call
 */
function tryParseToolCall(jsonStr: string): ToolCall | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.tool && typeof parsed.tool === "string") {
      return {
        name: parsed.tool,
        arguments: parsed.arguments || {},
      };
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

/**
 * Parse tool call from LLM response
 * Uses manual parsing to avoid ReDoS vulnerabilities from complex regex patterns
 */
export function parseToolCall(response: string): ToolCall | null {
  const jsonCandidates: string[] = [];

  // Extract content from ```json ... ``` blocks
  const jsonBlockStart = response.indexOf("```json");
  if (jsonBlockStart !== -1) {
    const content = extractCodeBlockContent(response, jsonBlockStart);
    if (content) jsonCandidates.push(content);
  }

  // Extract content from ``` ... ``` blocks (without json specifier)
  const genericBlockStart = response.indexOf("```");
  if (genericBlockStart !== -1 && genericBlockStart !== jsonBlockStart) {
    const content = extractCodeBlockContent(response, genericBlockStart);
    if (content) jsonCandidates.push(content);
  }

  // Try to find raw JSON object with "tool" key
  const rawJson = extractRawToolJson(response);
  if (rawJson) jsonCandidates.push(rawJson);

  // Try each candidate
  for (const jsonStr of jsonCandidates) {
    const result = tryParseToolCall(jsonStr);
    if (result) return result;
  }

  return null;
}

/**
 * Check if a tool exists
 */
export function isValidTool(name: string): boolean {
  return AGENT_TOOLS.some((tool) => tool.name === name);
}

/**
 * Get tool by name
 */
export function getTool(name: string): Tool | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}
