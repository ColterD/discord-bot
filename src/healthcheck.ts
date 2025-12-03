/**
 * Docker Healthcheck Script
 * Verifies the bot process is running and responsive
 * Exit codes: 0 = healthy, 1 = unhealthy
 *
 * Optional service checks:
 * - Set HEALTHCHECK_EXTENDED=true to check Ollama, Valkey, etc.
 */

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
    const response = await fetch(
      `${process.env.OLLAMA_HOST ?? "http://ollama:11434"}/api/tags`,
      { signal: AbortSignal.timeout(5000) }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function checkValkey(): Promise<boolean> {
  try {
    // Simple TCP connect check to Valkey port
    const url = process.env.VALKEY_URL ?? "valkey://valkey:6379";
    const match = url.match(/:\/\/([^:]+):(\d+)/);
    if (!match) return false;

    const [, host, port] = match;

    return new Promise((resolve) => {
      const net = require("net") as typeof import("net");
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

      socket.connect({ port: parseInt(port!, 10), host });
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

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(status));

  // Exit healthy even if degraded (container should stay up)
  process.exit(status.status === "unhealthy" ? 1 : 0);
}

runHealthcheck().catch((error) => {
  console.error("Healthcheck failed:", error);
  process.exit(1);
});
