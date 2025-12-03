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

/**
 * Available tools for the agent
 */
export const AGENT_TOOLS: Tool[] = [
  {
    name: "web_search",
    description:
      "Search the web for information. Use this when you need current information, facts, or data that may not be in your training data.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "The search query",
        required: true,
      },
      {
        name: "max_results",
        type: "number",
        description: "Maximum number of results to return (default: 5)",
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
    description: "Get current time in a specific timezone or convert between timezones.",
    parameters: [
      {
        name: "timezone",
        type: "string",
        description: "IANA timezone name (e.g., 'America/New_York', 'Europe/London', 'Asia/Tokyo')",
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
      "Use this tool to think through complex problems step by step before providing a final answer. Good for reasoning, planning, and breaking down complex tasks.",
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
      "Generate an image from a text description using AI. Use this when the user asks for image creation, artwork, or visual content.",
    parameters: [
      {
        name: "prompt",
        type: "string",
        description:
          "Detailed description of the image to generate. Be specific about style, subject, colors, and composition.",
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
];

/**
 * Format tools for LLM prompt
 */
export function formatToolsForPrompt(): string {
  let output = "# Available Tools\n\n";
  output += "You can call tools by responding with a JSON block in this format:\n";
  output += "```json\n";
  output += '{"tool": "tool_name", "arguments": {"param1": "value1"}}\n';
  output += "```\n\n";
  output += "## Tools:\n\n";

  for (const tool of AGENT_TOOLS) {
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
 * Parse tool call from LLM response
 */
export function parseToolCall(response: string): ToolCall | null {
  // Look for JSON blocks in various formats
  const patterns = [
    /```json\s*\n?([\s\S]*?)\n?```/i,
    /```\s*\n?([\s\S]*?)\n?```/,
    /\{[\s\S]*?"tool"[\s\S]*?\}/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(response);
    if (match) {
      try {
        const jsonStr = match[1] || match[0];
        const parsed = JSON.parse(jsonStr.trim());

        if (parsed.tool && typeof parsed.tool === "string") {
          return {
            name: parsed.tool,
            arguments: parsed.arguments || {},
          };
        }
      } catch {
        // Try next pattern
        continue;
      }
    }
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
