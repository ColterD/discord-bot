/**
 * Service Health Check Utility
 * Provides startup health checks for external dependencies
 */

import config from "../config.js";
import { createLogger } from "./logger.js";

const log = createLogger("Health");

interface HealthCheckResult {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

interface ServiceConfig {
  name: string;
  url: string;
  path?: string;
  optional?: boolean;
}

/**
 * Check if a single service is healthy
 *
 * @security The service.url comes from config, which validates URLs at load time
 * via validateInternalServiceUrl(). These are trusted internal Docker service URLs,
 * not user-supplied input.
 */
async function checkService(service: ServiceConfig, timeout = 5000): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const url = `${service.url}${service.path ?? ""}`;

  try {
    // SECURITY: service.url is validated at config load time via validateInternalServiceUrl()
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeout),
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return {
        name: service.name,
        healthy: true,
        latencyMs,
      };
    }

    return {
      name: service.name,
      healthy: false,
      latencyMs,
      error: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name: service.name,
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Check a service with retries
 */
async function checkWithRetry(
  service: ServiceConfig,
  maxRetries = 5,
  baseDelayMs = 2000
): Promise<HealthCheckResult> {
  let lastResult: HealthCheckResult | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await checkService(service);

    if (result.healthy) {
      log.info(`${service.name} is healthy (${result.latencyMs}ms)`);
      return result;
    }

    lastResult = result;

    if (attempt < maxRetries) {
      const delay = baseDelayMs * 1.5 ** (attempt - 1);
      log.warn(
        `${service.name} not ready (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(
          delay
        )}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return (
    lastResult ?? {
      name: service.name,
      healthy: false,
      error: "Max retries exceeded",
    }
  );
}

/**
 * Define all services to check
 */
function getServiceConfigs(): ServiceConfig[] {
  const services: ServiceConfig[] = [
    {
      name: "Ollama",
      url: config.llm.apiUrl,
      path: "/api/tags",
      optional: false,
    },
    {
      name: "ChromaDB",
      url: config.chroma.url,
      path: "/api/v2/heartbeat",
      optional: true, // Memory system is optional
    },
  ];

  // Only include ComfyUI if image generation is enabled
  if (config.comfyui.enabled) {
    services.push({
      name: "ComfyUI",
      url: config.comfyui.url,
      path: "/system_stats",
      optional: true, // Image generation is optional even when enabled
    });
  }

  return services;
}

/**
 * Wait for all services to be healthy
 * Returns true if all required services are healthy
 */
export async function waitForServices(maxRetries = 10, retryDelayMs = 2000): Promise<boolean> {
  log.info("Checking service health...");

  const services = getServiceConfigs();
  const results: HealthCheckResult[] = [];

  // Check all services with retries
  for (const service of services) {
    const result = await checkWithRetry(service, maxRetries, retryDelayMs);
    results.push(result);

    if (!result.healthy && !service.optional) {
      log.error(`Required service ${service.name} is not healthy: ${result.error}`);
      return false;
    }

    if (!result.healthy && service.optional) {
      log.warn(`Optional service ${service.name} is not healthy: ${result.error}`);
    }
  }

  // Log summary
  const healthyCount = results.filter((r) => r.healthy).length;
  const requiredServices = services.filter((s) => !s.optional);
  const requiredHealthy = results.filter((r, i) => {
    const service = services[i];
    return r.healthy && service && !service.optional;
  }).length;

  log.info(
    `Health check complete: ${healthyCount}/${services.length} services healthy (${requiredHealthy}/${requiredServices.length} required)`
  );

  return requiredHealthy === requiredServices.length;
}

/**
 * Quick health check without retries (for monitoring)
 */
export async function quickHealthCheck(): Promise<HealthCheckResult[]> {
  const services = getServiceConfigs();
  const results = await Promise.all(services.map((service) => checkService(service)));
  return results;
}

export { checkService, checkWithRetry, type HealthCheckResult };
