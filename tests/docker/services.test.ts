/**
 * Docker Integration Tests
 *
 * These tests require the Docker stack to be running.
 * Run with: npm run test:docker or npx vitest run tests/docker/
 *
 * Before running:
 *   .\devctl.ps1 start  # Start Docker stack
 *   .\devctl.ps1 health # Verify services are healthy
 */

// Load environment variables FIRST
import "dotenv/config";

import { beforeAll, describe, expect, it } from "vitest";
import {
  checkDockerServices,
  getServiceHealth,
  requireDockerServices,
} from "../utils/docker-health.js";

describe("Docker Services Health", () => {
  it("should verify Docker stack is running", async () => {
    const result = await checkDockerServices();

    // At minimum, Ollama should be running for AI tests
    const ollama = result.services.find((s) => s.name === "Ollama");
    expect(ollama?.healthy).toBe(true);
  });

  it("should check Ollama health", async () => {
    const health = await getServiceHealth("ollama");
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeLessThan(5000);
  });

  it("should check Valkey health", async () => {
    const health = await getServiceHealth("valkey");
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeLessThan(1000);
  });

  it("should check ChromaDB health", async () => {
    const health = await getServiceHealth("chromadb");
    // ChromaDB is optional but should be healthy if running
    if (health.healthy) {
      expect(health.latencyMs).toBeLessThan(2000);
    }
  });
});

describe("Ollama Integration", () => {
  beforeAll(async () => {
    await requireDockerServices(["ollama"]);
  });

  it("should list available models", async () => {
    const response = await fetch("http://localhost:11434/api/tags");
    expect(response.ok).toBe(true);

    const data = (await response.json()) as { models: { name: string }[] };
    expect(data).toHaveProperty("models");
    expect(Array.isArray(data.models)).toBe(true);
  });

  it("should generate a simple response", async () => {
    // Use a very simple prompt and limit tokens to speed up test with large models
    const model = process.env.LLM_MODEL ?? "qwen3:4b";
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "/no_think Say: test",
        stream: false,
        options: {
          num_predict: 5,
          temperature: 0,
        },
      }),
    });

    expect(response.ok).toBe(true);

    const data = (await response.json()) as { response: string };
    expect(data).toHaveProperty("response");
    expect(typeof data.response).toBe("string");
    expect(data.response.length).toBeGreaterThan(0);
  }, 120000); // 120s timeout for large models
});

describe("Valkey Integration", () => {
  beforeAll(async () => {
    await requireDockerServices(["valkey"]);
  });

  it("should connect and store a value", async () => {
    // Use ioredis to test Valkey
    const Redis = (await import("ioredis")).default;
    const redis = new Redis(process.env.VALKEY_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });

    try {
      // Set and get a test value
      const testKey = `test:${Date.now()}`;
      const testValue = "docker-integration-test";

      await redis.set(testKey, testValue, "EX", 60);
      const result = await redis.get(testKey);

      expect(result).toBe(testValue);

      // Cleanup
      await redis.del(testKey);
    } finally {
      await redis.quit();
    }
  });

  it("should handle pub/sub", async () => {
    const Redis = (await import("ioredis")).default;
    const pub = new Redis(process.env.VALKEY_URL ?? "redis://localhost:6379");
    const sub = new Redis(process.env.VALKEY_URL ?? "redis://localhost:6379");

    try {
      const channel = `test:channel:${Date.now()}`;
      const testMessage = "hello-docker";

      const messagePromise = new Promise<string>((resolve) => {
        sub.on("message", (_ch, message) => {
          resolve(message);
        });
      });

      await sub.subscribe(channel);

      // Small delay to ensure subscription is ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      await pub.publish(channel, testMessage);

      const received = await Promise.race([
        messagePromise,
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000)),
      ]);

      expect(received).toBe(testMessage);
    } finally {
      await pub.quit();
      await sub.quit();
    }
  });
});

describe("ChromaDB Integration", () => {
  const CHROMA_BASE = "http://localhost:8000/api/v2";
  const CHROMA_COLLECTIONS = `${CHROMA_BASE}/tenants/default_tenant/databases/default_database/collections`;

  beforeAll(async () => {
    await requireDockerServices(["chromadb"]);
  });

  it("should connect and list collections", async () => {
    const response = await fetch(CHROMA_COLLECTIONS);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it("should create and delete a test collection", async () => {
    const collectionName = `test_collection_${Date.now()}`;

    // Create collection
    const createResponse = await fetch(CHROMA_COLLECTIONS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: collectionName,
        metadata: { test: "true" },
      }),
    });
    expect(createResponse.ok).toBe(true);

    // Delete collection
    const deleteResponse = await fetch(`${CHROMA_COLLECTIONS}/${collectionName}`, {
      method: "DELETE",
    });
    expect(deleteResponse.ok).toBe(true);
  });
});
