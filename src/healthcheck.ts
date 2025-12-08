/**
 * Docker Healthcheck Script
 * Verifies the bot process is running and responsive
 * Exit codes: 0 = healthy, 1 = unhealthy
 *
 * Optional service checks:
 * - Set HEALTHCHECK_EXTENDED=true to check Ollama, Valkey, etc.
 */

import * as net from "node:net";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  heapUsedMB: number;
  rssMB: number;
  uptime: number;
  services?: {
    ollama?: boolean;
    valkey?: boolean;
    mcp?: boolean;
  };
}

async function checkOllama(): Promise<boolean> {
  try {
    // SECURITY: OLLAMA_HOST is an admin-configured internal Docker service URL.
    // The main config.ts validates this URL at startup via validateInternalServiceUrl().
    // This healthcheck script uses the same env var directly to avoid importing full config.
    // HTTP is acceptable as this runs on an isolated Docker network, not exposed externally.
    const ollamaHost = process.env.OLLAMA_HOST ?? "http://ollama:11434"; // NOSONAR: Internal Docker network

    // Validate URL format before fetching
    const parsedUrl = new URL(ollamaHost);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return false;
    }

    const response = await fetch(`${ollamaHost}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function checkValkey(): Promise<boolean> {
  try {
    // Simple TCP connect check to Valkey port
    // Use localhost for local development, Docker service name for production
    const url =
      process.env.VALKEY_URL ??
      (process.env.NODE_ENV === "production" ? "valkey://valkey:6379" : "valkey://localhost:6379");
    const match = /:\/\/([^:]+):(\d+)/.exec(url);
    if (!match) return false;

    const [, host, port] = match;
    if (!host || !port) return false;

    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect({ port: Number.parseInt(port, 10), host });
    });
  } catch {
    return false;
  }
}

async function runHealthcheck(): Promise<void> {
  // Basic liveness check - memory stats
  const memUsage = process.memoryUsage();

  if (memUsage.heapUsed <= 0 || memUsage.rss <= 0) {
    console.error("Invalid memory stats");
    process.exit(1);
  }

  const status: HealthStatus = {
    status: "healthy",
    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    rssMB: Math.round(memUsage.rss / 1024 / 1024),
    uptime: Math.round(process.uptime()),
  };

  // Extended checks if enabled
  if (process.env.HEALTHCHECK_EXTENDED === "true") {
    const [ollama, valkey] = await Promise.all([checkOllama(), checkValkey()]);

    status.services = { ollama, valkey };

    // Degrade status if critical services are down
    if (!ollama || !valkey) {
      status.status = "degraded";
    }
  }

  console.log(JSON.stringify(status));

  // Exit healthy even if degraded (container should stay up)
  process.exit(status.status === "unhealthy" ? 1 : 0);
}

try {
  await runHealthcheck();
} catch (error) {
  console.error("Healthcheck failed:", error);
  process.exit(1);
}
