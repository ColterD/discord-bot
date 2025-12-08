/**
 * Self-Healing Integration Tests
 *
 * Tests the health monitor and notification service with real Docker services.
 * These tests verify that the self-healing infrastructure actually works.
 *
 * Run with: npm run test:docker or npx vitest run tests/docker/
 */

// Load environment variables FIRST
import "dotenv/config";

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getServiceHealth,
  requireDockerServices,
  waitForDockerServices,
} from "../utils/docker-health.js";

const execAsync = promisify(exec);

// Skip destructive tests unless explicitly enabled
const DESTRUCTIVE_TESTS = process.env.RUN_DESTRUCTIVE_TESTS === "true";

describe("Self-Healing: Health Checks", () => {
  beforeAll(async () => {
    await requireDockerServices(["ollama", "valkey"]);
  });

  it("should detect healthy Ollama service", async () => {
    const health = await getServiceHealth("ollama");
    expect(health.healthy).toBe(true);
    expect(health.name).toBe("Ollama");
  });

  it("should detect healthy Valkey service", async () => {
    const health = await getServiceHealth("valkey");
    expect(health.healthy).toBe(true);
    expect(health.name).toBe("Valkey");
  });

  it("should return all service statuses", async () => {
    const { quickHealthCheck } = await import("../../src/utils/health.js");

    const results = await quickHealthCheck();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);

    // Each result should have the required properties
    for (const result of results) {
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("healthy");
    }
  });

  it("should wait for services with retry logic", async () => {
    const { waitForServices } = await import("../../src/utils/health.js");

    // Should return true when services are healthy
    const result = await waitForServices(3, 1000);
    expect(result).toBe(true);
  });
});

describe("Self-Healing: HealthMonitor", () => {
  beforeAll(async () => {
    await requireDockerServices(["ollama", "valkey"]);
  });

  it("should instantiate HealthMonitor via factory", async () => {
    const { getHealthMonitor } = await import("../../src/services/health-monitor.js");

    const monitor1 = getHealthMonitor();
    const monitor2 = getHealthMonitor();

    // Same instance (singleton pattern via factory)
    expect(monitor1).toBe(monitor2);
  });

  it("should start and stop without error", async () => {
    const { getHealthMonitor } = await import("../../src/services/health-monitor.js");

    const monitor = getHealthMonitor();

    // Start should not throw
    expect(() => monitor.start()).not.toThrow();

    // Stop should not throw
    expect(() => monitor.stop()).not.toThrow();
  });

  it("should be importable with correct exports", async () => {
    const healthMonitorModule = await import("../../src/services/health-monitor.js");

    // Should have these exports
    expect(healthMonitorModule).toHaveProperty("getHealthMonitor");
    expect(healthMonitorModule).toHaveProperty("startHealthMonitor");
    expect(healthMonitorModule).toHaveProperty("stopHealthMonitor");
    expect(healthMonitorModule).toHaveProperty("HealthMonitor");
  });
});

describe("Self-Healing: NotificationService", () => {
  it("should instantiate NotificationService via factory", async () => {
    const { getNotificationService } = await import("../../src/services/notifications.js");

    const service1 = getNotificationService();
    const service2 = getNotificationService();

    // Same instance (singleton pattern via factory)
    expect(service1).toBe(service2);
  });

  it("should be importable with correct exports", async () => {
    const notificationModule = await import("../../src/services/notifications.js");

    // Should have these exports
    expect(notificationModule).toHaveProperty("getNotificationService");
    expect(notificationModule).toHaveProperty("NotificationService");
  });
});

// Destructive tests that actually restart containers
// Only run when RUN_DESTRUCTIVE_TESTS=true
describe.skipIf(!DESTRUCTIVE_TESTS)("Self-Healing: Recovery (Destructive)", () => {
  beforeAll(async () => {
    await requireDockerServices(["ollama"]);
    console.log("⚠️  Running destructive tests - will restart containers");
  });

  afterAll(async () => {
    // Ensure services are back up
    await waitForDockerServices(30, 2000);
  });

  it("should recover from Ollama restart", async () => {
    // Record initial health
    const beforeHealth = await getServiceHealth("ollama");
    expect(beforeHealth.healthy).toBe(true);

    // Restart Ollama container
    console.log("Restarting Ollama container...");
    await execAsync("docker restart ollama");

    // Wait a moment for container to start stopping
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Service may be temporarily unhealthy during restart
    const duringHealth = await getServiceHealth("ollama");
    console.log(`During restart: ${duringHealth.healthy ? "healthy" : "unhealthy"}`);

    // Wait for recovery
    console.log("Waiting for Ollama to recover...");
    const recovered = await waitForDockerServices(30, 2000, true);
    expect(recovered).toBe(true);

    // Verify healthy again
    const afterHealth = await getServiceHealth("ollama");
    expect(afterHealth.healthy).toBe(true);
  }, 120000); // 2 minute timeout

  it("should handle model unload gracefully", async () => {
    // Unload all models
    const unloadResponse = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "qwen3:4b",
        keep_alive: 0,
      }),
    });

    // Should not crash, just unload
    expect(unloadResponse.ok).toBe(true);

    // Service should still be healthy
    const health = await getServiceHealth("ollama");
    expect(health.healthy).toBe(true);
  });
});

describe("Self-Healing: Error Detection", () => {
  it("should detect connection errors gracefully", async () => {
    // Try to connect to a non-existent service
    const result = await getServiceHealth("comfyui");

    // Should return a result without throwing
    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("healthy");

    // If ComfyUI is not running, healthy should be false
    if (!result.healthy) {
      expect(result.error).toBeDefined();
    }
  });

  it("should handle timeout gracefully", async () => {
    // This tests that our health checks have proper timeouts
    const startTime = Date.now();

    // Check a potentially slow service
    await getServiceHealth("chromadb");

    const elapsed = Date.now() - startTime;

    // Should complete within reasonable time (not hang)
    expect(elapsed).toBeLessThan(10000);
  });
});
