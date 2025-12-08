/**
 * Docker Health Check Utilities for Tests
 *
 * Provides health verification for Docker services before running integration tests.
 * Tests should import and call these utilities to ensure the Docker stack is ready.
 */

import { createLogger } from "../../src/utils/logger.js";

const log = createLogger("TestHealth");

export interface ServiceHealth {
  name: string;
  url: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface DockerHealthResult {
  allHealthy: boolean;
  requiredHealthy: boolean;
  services: ServiceHealth[];
}

// Service configuration - matches docker-compose.yml
const SERVICES = {
  ollama: {
    name: "Ollama",
    url: process.env.OLLAMA_HOST ?? "http://localhost:11434",
    healthPath: "/api/tags",
    required: true,
  },
  chromadb: {
    name: "ChromaDB",
    url: process.env.CHROMA_URL ?? "http://localhost:8000",
    healthPath: "/api/v2/tenants/default_tenant/databases",
    required: false,
  },
  valkey: {
    name: "Valkey",
    url: process.env.VALKEY_URL ?? "valkey://localhost:6379",
    healthPath: null, // TCP check
    required: true,
  },
  comfyui: {
    name: "ComfyUI",
    url: process.env.COMFYUI_URL ?? "http://localhost:8188",
    healthPath: "/system_stats",
    required: false,
  },
  searxng: {
    name: "SearXNG",
    url: process.env.SEARXNG_URL ?? "http://localhost:8080",
    healthPath: "/healthz",
    required: false,
  },
};

/**
 * Check if a single HTTP service is healthy
 */
async function checkHttpService(
  name: string,
  baseUrl: string,
  path: string,
  timeout = 5000
): Promise<ServiceHealth> {
  const start = Date.now();
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeout),
    });

    const latencyMs = Date.now() - start;

    return {
      name,
      url: baseUrl,
      healthy: response.ok,
      latencyMs,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      url: baseUrl,
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Check if Valkey is healthy via TCP
 */
async function checkValkey(timeout = 5000): Promise<ServiceHealth> {
  const start = Date.now();
  const url = process.env.VALKEY_URL ?? "valkey://localhost:6379";
  const match = /:\/\/([^:]+):(\d+)/.exec(url);

  if (!match) {
    return {
      name: "Valkey",
      url,
      healthy: false,
      error: "Invalid VALKEY_URL format",
    };
  }

  const [, host, portStr] = match;
  if (!host || !portStr) {
    return {
      name: "Valkey",
      url,
      healthy: false,
      error: "Invalid VALKEY_URL format - missing host or port",
    };
  }
  const port = Number.parseInt(portStr, 10);

  const net = await import("node:net");

  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on("connect", () => {
      // Send PING command
      socket.write("PING\r\n");
    });

    socket.on("data", (data) => {
      const response = data.toString().trim();
      socket.destroy();

      resolve({
        name: "Valkey",
        url,
        healthy: response === "+PONG",
        latencyMs: Date.now() - start,
        error: response === "+PONG" ? undefined : `Unexpected response: ${response}`,
      });
    });

    socket.on("error", (error) => {
      socket.destroy();
      resolve({
        name: "Valkey",
        url,
        healthy: false,
        latencyMs: Date.now() - start,
        error: error.message,
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        name: "Valkey",
        url,
        healthy: false,
        latencyMs: Date.now() - start,
        error: "Connection timeout",
      });
    });

    socket.connect({ port, host });
  });
}

/**
 * Check all Docker services health
 */
export async function checkDockerServices(): Promise<DockerHealthResult> {
  const results: ServiceHealth[] = [];

  // Check HTTP services in parallel
  const httpChecks = Object.entries(SERVICES)
    .filter(([, config]) => config.healthPath !== null)
    .map(([, config]) => {
      const healthPath = config.healthPath ?? "/";
      return checkHttpService(config.name, config.url, healthPath, 5000);
    });

  const httpResults = await Promise.all(httpChecks);
  results.push(...httpResults);

  // Check Valkey separately (TCP)
  const valkeyResult = await checkValkey();
  results.push(valkeyResult);

  const allHealthy = results.every((r) => r.healthy);
  const requiredHealthy = results
    .filter((r) => {
      const config = Object.values(SERVICES).find((s) => s.name === r.name);
      return config?.required ?? false;
    })
    .every((r) => r.healthy);

  return { allHealthy, requiredHealthy, services: results };
}

/**
 * Log healthy services after successful check
 */
function logHealthyServices(services: ServiceHealth[]): void {
  log.info("All required Docker services are healthy!");
  const healthyServices = services.filter((s) => s.healthy);
  for (const service of healthyServices) {
    log.info(`  ✓ ${service.name}: ${service.latencyMs}ms`);
  }
}

/**
 * Log unhealthy services during retry
 */
function logUnhealthyServices(
  attempt: number,
  maxRetries: number,
  services: ServiceHealth[]
): void {
  const unhealthy = services.filter((s) => !s.healthy);
  log.warn(`Attempt ${attempt}/${maxRetries}: Waiting for ${unhealthy.length} services...`);
  for (const service of unhealthy) {
    log.warn(`  ✗ ${service.name}: ${service.error}`);
  }
}

/**
 * Wait for Docker services to be healthy with retries
 */
export async function waitForDockerServices(
  maxRetries = 30,
  retryDelayMs = 2000,
  requiredOnly = true
): Promise<boolean> {
  log.info(`Waiting for Docker services (max ${maxRetries} retries)...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await checkDockerServices();
    const healthy = requiredOnly ? result.requiredHealthy : result.allHealthy;

    if (healthy) {
      logHealthyServices(result.services);
      return true;
    }

    logUnhealthyServices(attempt, maxRetries, result.services);

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  log.error("Timed out waiting for Docker services");
  return false;
}

/**
 * Skip test if Docker services are not available
 * Use in describe() or it() blocks
 */
export async function requireDockerServices(
  services: string[] = ["ollama", "valkey"]
): Promise<void> {
  const result = await checkDockerServices();

  const missingServices = services.filter((serviceName) => {
    const service = result.services.find((s) => s.name.toLowerCase() === serviceName.toLowerCase());
    return !service?.healthy;
  });

  if (missingServices.length > 0) {
    throw new Error(
      `Docker services not available: ${missingServices.join(", ")}. ` +
        `Start the Docker stack with: ./devctl.ps1 start`
    );
  }
}

/**
 * Get a specific service's health status
 */
export async function getServiceHealth(serviceName: keyof typeof SERVICES): Promise<ServiceHealth> {
  const config = SERVICES[serviceName];

  if (!config) {
    return {
      name: serviceName,
      url: "unknown",
      healthy: false,
      error: `Unknown service: ${serviceName}`,
    };
  }

  if (serviceName === "valkey") {
    return checkValkey();
  }

  const healthPath = config.healthPath ?? "/";
  return checkHttpService(config.name, config.url, healthPath, 5000);
}

/**
 * Print health summary to console
 */
export async function printHealthSummary(): Promise<void> {
  const result = await checkDockerServices();

  console.log("\n🐳 Docker Services Health\n");
  console.log("─".repeat(50));

  for (const service of result.services) {
    const status = service.healthy ? "✅" : "❌";
    const latency = service.latencyMs ? `(${service.latencyMs}ms)` : "";
    const error = service.error ? ` - ${service.error}` : "";
    console.log(`${status} ${service.name.padEnd(12)} ${latency}${error}`);
  }

  console.log("─".repeat(50));
  const getStatusMessage = (): string => {
    if (result.allHealthy) return "All healthy";
    if (result.requiredHealthy) return "Required services healthy";
    return "Some services unhealthy";
  };
  console.log(`Status: ${getStatusMessage()}`);
  console.log();
}
