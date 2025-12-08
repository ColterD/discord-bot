/**
 * AI Orchestrator Docker Integration Tests
 *
 * Tests the AI orchestrator with real Ollama, memory systems, and tools.
 * These tests require the Docker stack to be running.
 *
 * Run with: npm run test:docker or npx vitest run tests/docker/
 */

// Load environment variables FIRST
import "dotenv/config";

import { beforeAll, describe, expect, it } from "vitest";
import { requireDockerServices } from "../utils/docker-health.js";

describe("AI Orchestrator Integration", () => {
  beforeAll(async () => {
    await requireDockerServices(["ollama"]);
  });

  it("should import orchestrator without errors", async () => {
    const { Orchestrator } = await import("../../src/ai/orchestrator/index.js");
    expect(Orchestrator).toBeDefined();
  });

  it("should build system prompt with tools", async () => {
    const { buildSystemPromptWithTools } =
      await import("../../src/ai/orchestrator/system-prompt.js");
    const { getAvailableTools } = await import("../../src/ai/tools.js");

    // Get tool info list (convert Tool[] to ToolInfo[])
    const tools = getAvailableTools();
    const toolInfoList = tools.map((t) => ({
      name: t.name,
      description: t.description,
    }));

    const prompt = buildSystemPromptWithTools("Test memory context", toolInfoList);

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
    // Should contain tool call instructions (JSON format)
    expect(prompt).toContain("json");
    expect(prompt).toContain("tool");
  });

  it("should parse tool calls correctly", async () => {
    const { parseToolCallFromContent } = await import("../../src/ai/orchestrator/tool-parser.js");

    // The correct format is JSON code block with "tool" key (not "name")
    const content = `Let me search for that.
\`\`\`json
{"tool": "web_search", "arguments": {"query": "test query"}}
\`\`\``;

    const result = parseToolCallFromContent(content);

    expect(result).not.toBeNull();
    expect(result?.name).toBe("web_search");
    expect(result?.arguments).toHaveProperty("query");
  });

  it("should clean response text", async () => {
    const { cleanResponse } = await import("../../src/ai/orchestrator/response-cleaner.js");

    // cleanResponse removes JSON code blocks and LaTeX
    const dirty =
      'Here is the answer ```json\n{"tool": "test"}\n``` and more text with $x^2$ math.';
    const clean = cleanResponse(dirty);

    expect(clean).not.toContain("```json");
    expect(clean).toContain("Here is the answer");
    expect(clean).not.toContain("$");
  });

  it("should get tool definitions", async () => {
    const { getAvailableTools, formatToolsForPrompt } = await import("../../src/ai/tools.js");

    const tools = getAvailableTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // Each tool should have required properties
    expect(tools[0]).toHaveProperty("name");
    expect(tools[0]).toHaveProperty("description");
    expect(tools[0]).toHaveProperty("parameters");

    // Format for prompt (no parameters needed)
    const formatted = formatToolsForPrompt();
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("AI Tool Execution", () => {
  beforeAll(async () => {
    await requireDockerServices(["ollama"]);
  });

  it("should execute calculate tool", async () => {
    const { executeTool } = await import("../../src/ai/orchestrator/tools/index.js");

    // executeTool requires: (toolCall, userId, state)
    const state = { fetchedUrls: new Set<string>(), gatheredInfo: [] };
    const result = await executeTool(
      {
        name: "calculate",
        arguments: { expression: "2 + 2" },
      },
      "test-user-123456789012",
      state
    );

    expect(result.success).toBe(true);
    expect(result.result).toContain("4");
  });

  it("should execute get_time tool", async () => {
    const { executeTool } = await import("../../src/ai/orchestrator/tools/index.js");

    const state = { fetchedUrls: new Set<string>(), gatheredInfo: [] };
    const result = await executeTool(
      {
        name: "get_time",
        arguments: {},
      },
      "test-user-123456789012",
      state
    );

    expect(result.success).toBe(true);
    // Time output includes timezone info like "PST", "EST", etc.
    expect(result.result).toMatch(/[A-Z]{3}/);
  });

  it("should reject unauthorized tools for non-owners", async () => {
    const { checkToolAccess } = await import("../../src/security/tool-permissions.js");

    // Regular user should not have filesystem access
    const access = checkToolAccess("999999999999999999", "filesystem_read");
    expect(access.allowed).toBe(false);
  });
});

describe("AI with Ollama", () => {
  beforeAll(async () => {
    await requireDockerServices(["ollama"]);
  });

  it("should make a simple LLM call", async () => {
    const model = process.env.LLM_MODEL ?? "qwen3:4b";
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "/no_think 2+2=",
        stream: false,
        options: {
          num_predict: 5,
          temperature: 0,
        },
      }),
    });

    expect(response.ok).toBe(true);

    const data = (await response.json()) as { response: string };
    expect(data.response.length).toBeGreaterThan(0);
  }, 120000); // 120s timeout for large models

  it("should handle chat format", async () => {
    const model = process.env.LLM_MODEL ?? "qwen3:4b";
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Respond in one word only." },
          { role: "user", content: "/no_think Say: hi" },
        ],
        stream: false,
        options: {
          num_predict: 5,
          temperature: 0,
        },
      }),
    });

    expect(response.ok).toBe(true);

    const data = (await response.json()) as { message: { content: string } };
    expect(data.message).toHaveProperty("content");
    expect(data.message.content.length).toBeGreaterThan(0);
  }, 120000); // 120s timeout for large models
});

describe("Memory System with ChromaDB", () => {
  beforeAll(async () => {
    await requireDockerServices(["chromadb"]);
  });

  it("should import memory manager", async () => {
    const { MemoryManager } = await import("../../src/ai/memory/memory-manager.js");
    expect(MemoryManager).toBeDefined();
  });

  it("should import graph memory", async () => {
    const { GraphMemoryManager } = await import("../../src/ai/memory/graph-memory.js");
    expect(GraphMemoryManager).toBeDefined();

    const instance = GraphMemoryManager.getInstance();
    expect(instance).toBeDefined();
  });

  it("should import memory tools", async () => {
    const { MemoryToolsManager } = await import("../../src/ai/memory/memory-tools.js");
    expect(MemoryToolsManager).toBeDefined();

    const instance = MemoryToolsManager.getInstance();
    expect(instance).toBeDefined();
  });

  it("should connect to ChromaDB", async () => {
    const response = await fetch("http://localhost:8000/api/v2/tenants/default_tenant/databases");
    expect(response.ok).toBe(true);

    const data = (await response.json()) as { name: string }[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("name");
  });
});
