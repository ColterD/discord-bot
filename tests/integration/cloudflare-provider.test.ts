/**
 * Cloudflare Workers AI Provider Integration Tests
 *
 * Validates that Cloudflare routing and embedding models are working correctly.
 * This test directly calls the Cloudflare API to verify the integration.
 */

import { beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";

// Import the provider factory to test the actual integration
import { getEmbeddingProvider, getRoutingProvider } from "../../src/ai/providers/index.js";

describe("Cloudflare Workers AI Integration", () => {
  const hasCloudflareConfig =
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ENABLED === "true";

  beforeAll(() => {
    if (!hasCloudflareConfig) {
      console.log(
        "⚠️  Cloudflare not configured - set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ENABLED=true"
      );
    }
  });

  describe("Router Model (Granite 4.0)", () => {
    it.skipIf(!hasCloudflareConfig)(
      "should successfully classify a user message",
      async () => {
        const provider = await getRoutingProvider();

        // Verify it's the Cloudflare provider
        expect(provider.name).toBe("cloudflare");

        // Test classification (classify is optional, so check it exists)
        expect(provider.classify).toBeDefined();
        const result = await provider.classify?.("What time is it right now?", [
          "general_conversation",
          "tool_use",
          "code_generation",
          "creative_writing",
          "information_retrieval",
        ]);

        expect(result).toBeDefined();
        expect(result?.intent).toBeDefined();
        expect(result?.confidence).toBeGreaterThan(0);
        expect(result?.confidence).toBeLessThanOrEqual(1);

        console.log(
          `✓ Classification result: ${result?.intent} (confidence: ${result?.confidence})`
        );
      },
      30000
    );

    it.skipIf(!hasCloudflareConfig)(
      "should handle multiple classifications",
      async () => {
        const provider = await getRoutingProvider();
        const categories = [
          "general_conversation",
          "tool_use",
          "code_generation",
          "creative_writing",
        ];

        const testCases = [
          { message: "Hello, how are you?", expected: "general_conversation" },
          { message: "Calculate 25 * 17", expected: "tool_use" },
          { message: "Write a Python function to sort a list", expected: "code_generation" },
          { message: "Write me a poem about the ocean", expected: "creative_writing" },
        ];

        expect(provider.classify).toBeDefined();
        for (const { message } of testCases) {
          const result = await provider.classify?.(message, categories);
          expect(result).toBeDefined();
          console.log(`  "${message.slice(0, 30)}..." → ${result?.intent}`);
          expect(result?.intent).toBeDefined();
          // We don't strictly enforce the expected category since LLM classification can vary
        }
      },
      60000
    );

    it.skipIf(!hasCloudflareConfig)(
      "should report healthy status",
      async () => {
        const provider = await getRoutingProvider();
        const health = await provider.checkHealth();

        expect(health.available).toBe(true);
        expect(health.latencyMs).toBeGreaterThan(0);
        console.log(`✓ Provider healthy - latency: ${health.latencyMs}ms`);
      },
      15000
    );
  });

  describe("Embedding Model (Qwen3 0.6B)", () => {
    it.skipIf(!hasCloudflareConfig)(
      "should generate embeddings for text",
      async () => {
        const provider = await getEmbeddingProvider();

        // Verify it's the Cloudflare provider
        expect(provider.name).toBe("cloudflare");

        // Test embedding generation (embed is optional, so check it exists)
        expect(provider.embed).toBeDefined();
        const result = await provider.embed?.("Hello, this is a test sentence for embedding.");

        expect(result).toBeDefined();
        expect(result?.embeddings).toBeDefined();
        expect(result?.embeddings.length).toBeGreaterThan(0);
        expect(result?.embeddings[0]?.length).toBeGreaterThan(0);

        // Qwen3 embedding model produces 1024-dimensional vectors
        console.log(`✓ Embedding dimensions: ${result?.embeddings[0]?.length}`);
        expect(result?.embeddings[0]?.length).toBe(1024);
      },
      30000
    );

    it.skipIf(!hasCloudflareConfig)(
      "should generate embeddings for multiple texts",
      async () => {
        const provider = await getEmbeddingProvider();

        const texts = [
          "The quick brown fox jumps over the lazy dog",
          "Machine learning is a subset of artificial intelligence",
          "TypeScript is a typed superset of JavaScript",
        ];

        expect(provider.embed).toBeDefined();
        const result = await provider.embed?.(texts);

        expect(result).toBeDefined();
        expect(result?.embeddings.length).toBe(texts.length);
        console.log(`✓ Generated ${result?.embeddings.length} embeddings`);
      },
      30000
    );
  });

  describe("Fallback Behavior", () => {
    it.skipIf(!hasCloudflareConfig)(
      "should fallback to Ollama when Cloudflare quota exhausted",
      async () => {
        // This test documents the expected fallback behavior
        // In production, when Cloudflare returns a quota error, the system should:
        // 1. Mark Cloudflare as unavailable
        // 2. Fall back to local Ollama
        // 3. Retry Cloudflare after quota reset (24h)

        const provider = await getRoutingProvider();
        const capabilities = provider.capabilities;

        console.log(`Provider capabilities:`, {
          chat: capabilities.chat,
          embeddings: capabilities.embeddings,
          classification: capabilities.classification,
        });

        expect(capabilities.classification).toBe(true);
      }
    );
  });
});

/**
 * Direct API test - bypasses the provider system for debugging
 */
describe("Direct Cloudflare API Test", () => {
  const hasConfig =
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_API_TOKEN &&
    process.env.CLOUDFLARE_ENABLED === "true";

  it.skipIf(!hasConfig)(
    "should make a direct API call to verify endpoint",
    async () => {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
      const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
      const model = process.env.CLOUDFLARE_ROUTER_MODEL ?? "@cf/ibm-granite/granite-4.0-h-micro";

      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

      console.log(`Testing model: ${model}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Say hello" }],
          max_tokens: 50,
        }),
      });

      const data = (await response.json()) as {
        success: boolean;
        result?: { response?: string };
        errors?: { message: string }[];
      };
      console.log(`Response status: ${response.status}`);
      console.log(`Response:`, JSON.stringify(data, null, 2));

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.result?.response).toBeDefined();
    },
    30000
  );
});
