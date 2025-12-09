/**
 * Health Monitor Service
 *
 * Monitors the health of all services in the stack and triggers
 * self-healing recovery when issues are detected. Escalates to
 * owner notifications when recovery fails.
 *
 * Uses Docker Engine API over Unix socket for container management.
 * This approach works in distroless containers without requiring
 * shell or docker CLI.
 */

import * as http from "node:http";
import * as net from "node:net";
import config from "../config.js";
import { createLogger } from "../utils/logger.js";
import { getNotificationService, type RecoveryAttempt } from "./notifications.js";

const log = createLogger("HealthMonitor");

/**
 * Docker socket path - standard location on Linux hosts
 */
const DOCKER_SOCKET_PATH = "/var/run/docker.sock";

/**
 * Docker Engine API client using Unix socket.
 * No shell or docker CLI required - pure HTTP over Unix socket.
 */
class DockerClient {
  private readonly socketPath: string;

  constructor(socketPath: string = DOCKER_SOCKET_PATH) {
    this.socketPath = socketPath;
  }

  /**
   * Make an HTTP request to the Docker Engine API
   */
  private request(
    method: string,
    path: string,
    options?: { timeout?: number; body?: string }
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const timeout = options?.timeout ?? 30_000;

      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: options?.body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(options.body),
              }
            : undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString();
            resolve({ statusCode: res.statusCode ?? 500, body });
          });
        }
      );

      req.setTimeout(timeout, () => {
        req.destroy();
        reject(new Error(`Docker API request timed out after ${timeout}ms`));
      });

      req.on("error", (err) => {
        reject(new Error(`Docker API error: ${err.message}`));
      });

      if (options?.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Check if Docker socket is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.request("GET", "/_ping", { timeout: 5000 });
      return result.statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Restart a container by name
   */
  async restartContainer(
    containerName: string,
    timeoutSeconds = 10
  ): Promise<{ success: boolean; message: string }> {
    try {
      log.debug(`Restarting container ${containerName} via Docker API`);
      const result = await this.request(
        "POST",
        `/containers/${containerName}/restart?t=${timeoutSeconds}`,
        { timeout: (timeoutSeconds + 30) * 1000 }
      );

      if (result.statusCode === 204) {
        return { success: true, message: `Container ${containerName} restarted successfully` };
      } else if (result.statusCode === 404) {
        return { success: false, message: `Container ${containerName} not found` };
      } else {
        return {
          success: false,
          message: `Restart failed with status ${result.statusCode}: ${result.body}`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  /**
   * Get container health status
   */
  async getContainerHealth(
    containerName: string
  ): Promise<{ running: boolean; health?: string; error?: string }> {
    try {
      const result = await this.request("GET", `/containers/${containerName}/json`, {
        timeout: 10_000,
      });

      if (result.statusCode === 404) {
        return { running: false, error: "Container not found" };
      }

      if (result.statusCode !== 200) {
        return { running: false, error: `API returned ${result.statusCode}` };
      }

      const info = JSON.parse(result.body) as {
        State?: { Running?: boolean; Health?: { Status?: string } };
      };

      const health = info.State?.Health?.Status;
      return {
        running: info.State?.Running ?? false,
        ...(health !== undefined && { health }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { running: false, error: message };
    }
  }
}

/**
 * Singleton Docker client instance
 */
const dockerClient = new DockerClient();

/**
 * Check Valkey health using direct TCP connection.
 * Sends Redis PING command and expects PONG response.
 * Works in distroless containers without requiring docker exec.
 */
function checkValkeyTcp(
  host: string,
  port: number,
  timeout = 5000
): Promise<{ healthy: boolean; message?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    // Accumulate data chunks - TCP doesn't guarantee single-chunk delivery
    let buffer = "";

    socket.on("connect", () => {
      // Send Redis PING command
      socket.write("PING\r\n");
    });

    socket.on("data", (data) => {
      buffer += data.toString();

      // Check for complete RESP response (ends with \r\n)
      if (buffer.includes("\r\n")) {
        socket.destroy();
        const response = buffer.trim();

        if (response === "+PONG") {
          resolve({ healthy: true });
        } else {
          resolve({ healthy: false, message: `Unexpected response: ${response}` });
        }
      }
    });

    socket.on("error", (error) => {
      socket.destroy();
      resolve({ healthy: false, message: error.message });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ healthy: false, message: "Connection timeout" });
    });

    socket.connect({ port, host });
  });
}

/**
 * Service health status
 */
export enum HealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
  UNKNOWN = "unknown",
}

/**
 * Service definition for monitoring
 */
export interface MonitoredService {
  name: string;
  displayName: string;
  healthCheck: () => Promise<HealthCheckResult>;
  recover: () => Promise<RecoveryResult>;
  containerName?: string;
  critical: boolean; // If true, alerts are sent immediately
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  responseTime?: number;
  details?: Record<string, unknown>;
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  success: boolean;
  message: string;
  action: string;
}

/**
 * Service state tracking
 */
interface ServiceState {
  status: HealthStatus;
  lastCheck: Date;
  lastHealthy: Date | null;
  consecutiveFailures: number;
  recoveryAttempts: RecoveryAttempt[];
  isRecovering: boolean;
}

/**
 * Health monitor configuration
 */
interface HealthMonitorConfig {
  checkIntervalMs: number;
  alertThresholdMs: number;
  maxRecoveryAttempts: number;
  recoveryBackoffMs: number[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: HealthMonitorConfig = {
  checkIntervalMs: 30_000, // 30 seconds
  alertThresholdMs: 300_000, // 5 minutes
  maxRecoveryAttempts: 3,
  recoveryBackoffMs: [30_000, 60_000, 120_000], // 30s, 1m, 2m
};

/**
 * Health Monitor class
 */
class HealthMonitor {
  private readonly services = new Map<string, MonitoredService>();
  private readonly states = new Map<string, ServiceState>();
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly config: HealthMonitorConfig;
  private isRunning = false;

  constructor(monitorConfig?: Partial<HealthMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...monitorConfig };
  }

  /**
   * Register a service for monitoring
   */
  registerService(service: MonitoredService): void {
    this.services.set(service.name, service);
    this.states.set(service.name, {
      status: HealthStatus.UNKNOWN,
      lastCheck: new Date(0),
      lastHealthy: null,
      consecutiveFailures: 0,
      recoveryAttempts: [],
      isRecovering: false,
    });
    log.info(`Registered service for monitoring: ${service.displayName}`);
  }

  /**
   * Start the health monitor
   */
  start(): void {
    if (this.isRunning) {
      log.warn("Health monitor is already running");
      return;
    }

    this.isRunning = true;
    log.info(
      `Starting health monitor (interval: ${this.config.checkIntervalMs / 1000}s, threshold: ${this.config.alertThresholdMs / 1000}s)`
    );

    // Run initial check
    void this.runHealthChecks();

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      void this.runHealthChecks();
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the health monitor
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    log.info("Health monitor stopped");
  }

  /**
   * Run health checks for all services
   */
  private async runHealthChecks(): Promise<void> {
    const checks = Array.from(this.services.entries()).map(async ([name, service]) => {
      const state = this.states.get(name);
      if (!state || state.isRecovering) return;

      try {
        const startTime = Date.now();
        const result = await service.healthCheck();
        const responseTime = Date.now() - startTime;

        await this.handleHealthCheckResult(name, service, state, {
          ...result,
          responseTime,
        });
      } catch (error) {
        await this.handleHealthCheckResult(name, service, state, {
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.allSettled(checks);
  }

  /**
   * Handle a health check result
   */
  private async handleHealthCheckResult(
    name: string,
    service: MonitoredService,
    state: ServiceState,
    result: HealthCheckResult
  ): Promise<void> {
    const previousStatus = state.status;
    state.status = result.status;
    state.lastCheck = new Date();

    if (result.status === HealthStatus.HEALTHY) {
      // Service is healthy
      if (state.consecutiveFailures > 0) {
        log.info(`${service.displayName} recovered after ${state.consecutiveFailures} failures`);
      }
      state.lastHealthy = new Date();
      state.consecutiveFailures = 0;
      state.recoveryAttempts = [];
      return;
    }

    // Service is unhealthy
    state.consecutiveFailures++;
    log.warn(
      `${service.displayName} health check failed (${state.consecutiveFailures}x): ${result.message ?? "unknown"}`
    );

    // Check if we should attempt recovery
    if (state.consecutiveFailures >= 2 && !state.isRecovering) {
      await this.attemptRecovery(name, service, state, result.message ?? "Health check failed");
    }

    // Check if we should alert the owner
    if (state.lastHealthy) {
      const downDuration = Date.now() - state.lastHealthy.getTime();
      if (
        downDuration >= this.config.alertThresholdMs &&
        previousStatus !== HealthStatus.UNHEALTHY
      ) {
        await this.sendDownAlert(service, state, result);
      }
    }
  }

  /**
   * Attempt to recover a service
   */
  private async attemptRecovery(
    name: string,
    service: MonitoredService,
    state: ServiceState,
    errorMessage: string
  ): Promise<void> {
    if (state.recoveryAttempts.length >= this.config.maxRecoveryAttempts) {
      // Max attempts reached, escalate to owner
      await this.escalateToOwner(service, state, errorMessage);
      return;
    }

    state.isRecovering = true;
    const attemptNumber = state.recoveryAttempts.length + 1;

    log.info(
      `Attempting recovery for ${service.displayName} (attempt ${attemptNumber}/${this.config.maxRecoveryAttempts})`
    );

    try {
      const result = await service.recover();

      const attemptRecord: RecoveryAttempt = {
        step: result.action,
        success: result.success,
        timestamp: new Date(),
      };
      if (!result.success) {
        attemptRecord.error = result.message;
      }
      state.recoveryAttempts.push(attemptRecord);

      if (result.success) {
        log.info(`${service.displayName} recovery succeeded: ${result.message}`);

        // Wait for service to stabilize
        const backoffMs = this.config.recoveryBackoffMs[attemptNumber - 1] ?? 30_000;
        await this.sleep(backoffMs);

        // Verify recovery with health check
        const healthResult = await service.healthCheck();
        if (healthResult.status === HealthStatus.HEALTHY) {
          log.info(`${service.displayName} verified healthy after recovery`);
          state.consecutiveFailures = 0;
          state.recoveryAttempts = [];
        } else {
          log.warn(`${service.displayName} still unhealthy after recovery attempt`);
        }
      } else {
        log.warn(`${service.displayName} recovery failed: ${result.message}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`${service.displayName} recovery threw error: ${errorMsg}`);

      state.recoveryAttempts.push({
        step: "recovery attempt",
        success: false,
        error: errorMsg,
        timestamp: new Date(),
      });
    }

    state.isRecovering = false;

    // Check if we need more recovery attempts
    const lastAttempt = state.recoveryAttempts.at(-1);
    if (!lastAttempt?.success && state.recoveryAttempts.length < this.config.maxRecoveryAttempts) {
      // Schedule next attempt with backoff
      const backoffMs = this.config.recoveryBackoffMs[state.recoveryAttempts.length - 1] ?? 60_000;
      log.info(`Scheduling next recovery attempt in ${backoffMs / 1000}s`);
      setTimeout(() => {
        void this.attemptRecovery(name, service, state, errorMessage);
      }, backoffMs);
    } else if (!lastAttempt?.success) {
      // All attempts exhausted
      await this.escalateToOwner(service, state, errorMessage);
    }
  }

  /**
   * Escalate to owner when self-healing fails
   */
  private async escalateToOwner(
    service: MonitoredService,
    state: ServiceState,
    errorMessage: string
  ): Promise<void> {
    log.error(`Self-healing failed for ${service.displayName}, escalating to owner`);

    const notifications = getNotificationService();
    const claudePrompt = this.generateClaudePrompt(service, state, errorMessage);

    await notifications.sendSelfHealFailed(
      service.displayName,
      errorMessage,
      state.recoveryAttempts,
      claudePrompt
    );
  }

  /**
   * Send a down alert when service has been unhealthy for too long
   */
  private async sendDownAlert(
    service: MonitoredService,
    state: ServiceState,
    result: HealthCheckResult
  ): Promise<void> {
    const notifications = getNotificationService();
    const downDuration = state.lastHealthy
      ? Math.round((Date.now() - state.lastHealthy.getTime()) / 1000 / 60)
      : 0;

    await notifications.sendHealthCritical(
      service.displayName,
      `${result.message ?? "Service unhealthy"} (down for ${downDuration} minutes)`,
      service.containerName ? `Run: \`docker compose restart ${service.containerName}\`` : undefined
    );
  }

  /**
   * Generate a Claude prompt for debugging
   */
  private generateClaudePrompt(
    service: MonitoredService,
    state: ServiceState,
    errorMessage: string
  ): string {
    const attemptsSummary = state.recoveryAttempts
      .map((a) => {
        const status = a.success ? "succeeded" : `failed (${a.error})`;
        return `- ${a.step}: ${status}`;
      })
      .join("\n");

    return `My Discord bot's ${service.displayName} service won't recover.

Error: ${errorMessage}

Recovery attempts:
${attemptsSummary}

Service has been down since: ${state.lastHealthy?.toISOString() ?? "unknown"}
Consecutive failures: ${state.consecutiveFailures}

Container name: ${service.containerName ?? "N/A"}

Please help me diagnose the root cause and provide a permanent fix.`;
  }

  /**
   * Get current status of all services
   */
  getStatus(): Map<string, { service: string; state: ServiceState }> {
    const status = new Map<string, { service: string; state: ServiceState }>();

    for (const [name, service] of this.services) {
      const state = this.states.get(name);
      if (state) {
        status.set(name, { service: service.displayName, state });
      }
    }

    return status;
  }

  /**
   * Get status of a specific service
   */
  getServiceStatus(name: string): ServiceState | undefined {
    return this.states.get(name);
  }

  /**
   * Force a health check for a specific service
   */
  async checkService(name: string): Promise<HealthCheckResult | null> {
    const service = this.services.get(name);
    if (!service) return null;

    return service.healthCheck();
  }

  /**
   * Force recovery for a specific service
   */
  async recoverService(name: string): Promise<RecoveryResult | null> {
    const service = this.services.get(name);
    if (!service) return null;

    return service.recover();
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Service Definitions
// ============================================================================

/**
 * Create Ollama service definition
 */
function createOllamaService(): MonitoredService {
  const baseUrl = config.llm.apiUrl;

  return {
    name: "ollama",
    displayName: "Ollama",
    containerName: "ollama",
    critical: true,

    async healthCheck(): Promise<HealthCheckResult> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          return {
            status: HealthStatus.UNHEALTHY,
            message: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        const data = (await response.json()) as { models?: unknown[] };
        return {
          status: HealthStatus.HEALTHY,
          details: { modelCount: data.models?.length ?? 0 },
        };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    },

    async recover(): Promise<RecoveryResult> {
      try {
        // First try to unload models to free memory
        try {
          await fetch(`${baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: config.llm?.model ?? "qwen3:14b", keep_alive: 0 }),
          });
          await new Promise((r) => setTimeout(r, 2000));
        } catch {
          // Ignore - service might be completely down
        }

        // Restart the container using Docker API (no shell or docker CLI required)
        const result = await dockerClient.restartContainer("ollama");

        if (!result.success) {
          return {
            success: false,
            action: "Restart Ollama container",
            message: result.message,
          };
        }

        // Wait for startup
        await new Promise((r) => setTimeout(r, 10_000));

        return {
          success: true,
          action: "Restarted Ollama container",
          message: result.message,
        };
      } catch (error) {
        return {
          success: false,
          action: "Restart Ollama container",
          message: error instanceof Error ? error.message : "Restart failed",
        };
      }
    },
  };
}

/**
 * Create ChromaDB service definition
 */
function createChromaDBService(): MonitoredService {
  const baseUrl = config.chroma?.url ?? "http://localhost:8000";

  return {
    name: "chromadb",
    displayName: "ChromaDB",
    containerName: "chromadb",
    critical: true,

    async healthCheck(): Promise<HealthCheckResult> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(`${baseUrl}/api/v2/heartbeat`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          return {
            status: HealthStatus.UNHEALTHY,
            message: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        return { status: HealthStatus.HEALTHY };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    },

    async recover(): Promise<RecoveryResult> {
      try {
        // Restart the container using Docker API (no shell or docker CLI required)
        const result = await dockerClient.restartContainer("chromadb");

        if (!result.success) {
          return {
            success: false,
            action: "Restart ChromaDB container",
            message: result.message,
          };
        }

        await new Promise((r) => setTimeout(r, 10_000));

        return {
          success: true,
          action: "Restarted ChromaDB container",
          message: result.message,
        };
      } catch (error) {
        return {
          success: false,
          action: "Restart ChromaDB container",
          message: error instanceof Error ? error.message : "Restart failed",
        };
      }
    },
  };
}

/**
 * Create Valkey service definition
 */
function createValkeyService(): MonitoredService {
  // Parse Valkey URL to get host and port for direct TCP connection
  // Use config.valkey.url which already handles environment-aware defaults
  const valkeyUrl = config.valkey?.url ?? "valkey://localhost:6379";
  // NOSONAR - safe: simple linear URL parsing, no nested quantifiers
  const match = /:?\/\/([^:]+):(\d+)/.exec(valkeyUrl);
  const host = match?.[1] ?? "localhost";
  const port = match?.[2] ? Number.parseInt(match[2], 10) : 6379;

  return {
    name: "valkey",
    displayName: "Valkey",
    containerName: "valkey",
    critical: true,

    async healthCheck(): Promise<HealthCheckResult> {
      try {
        // Use direct TCP connection - works in distroless containers
        const result = await checkValkeyTcp(host, port, 5000);

        if (result.healthy) {
          return { status: HealthStatus.HEALTHY };
        }

        return {
          status: HealthStatus.UNHEALTHY,
          message: result.message ?? "Health check failed",
        };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : "PING failed",
        };
      }
    },

    async recover(): Promise<RecoveryResult> {
      try {
        // Restart the container using Docker API (no shell or docker CLI required)
        const result = await dockerClient.restartContainer("valkey");

        if (!result.success) {
          return {
            success: false,
            action: "Restart Valkey container",
            message: result.message,
          };
        }

        await new Promise((r) => setTimeout(r, 5_000));

        return {
          success: true,
          action: "Restarted Valkey container",
          message: result.message,
        };
      } catch (error) {
        return {
          success: false,
          action: "Restart Valkey container",
          message: error instanceof Error ? error.message : "Restart failed",
        };
      }
    },
  };
}

/**
 * Create ComfyUI service definition
 */
function createComfyUIService(): MonitoredService {
  const baseUrl = config.comfyui?.url ?? "http://localhost:8188";

  return {
    name: "comfyui",
    displayName: "ComfyUI",
    containerName: "comfyui",
    critical: false, // Image generation is optional

    async healthCheck(): Promise<HealthCheckResult> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        const response = await fetch(`${baseUrl}/system_stats`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          return {
            status: HealthStatus.UNHEALTHY,
            message: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        const stats = (await response.json()) as {
          devices?: { vram_free?: number; vram_total?: number }[];
        };
        const device = stats.devices?.[0];

        // Check for low VRAM as degraded status
        if (device?.vram_free !== undefined && device.vram_total !== undefined) {
          const vramPercent = (device.vram_free / device.vram_total) * 100;
          if (vramPercent < 10) {
            return {
              status: HealthStatus.DEGRADED,
              message: `Low VRAM: ${vramPercent.toFixed(1)}% free`,
              details: { vramFreePercent: vramPercent },
            };
          }
        }

        return { status: HealthStatus.HEALTHY, details: { devices: stats.devices } };
      } catch (error) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    },

    async recover(): Promise<RecoveryResult> {
      try {
        // Try to free VRAM first
        try {
          await fetch(`${baseUrl}/free`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ unload_models: true, free_memory: true }),
          });
          await new Promise((r) => setTimeout(r, 5_000));
        } catch {
          // Ignore - service might be completely down
        }

        // Restart the container using Docker API (no shell or docker CLI required)
        // Note: GPU reset would require nvidia-smi which isn't available in distroless
        const result = await dockerClient.restartContainer("comfyui", 15);

        if (!result.success) {
          return {
            success: false,
            action: "Restart ComfyUI container",
            message: result.message,
          };
        }

        // Wait for GPU initialization
        await new Promise((r) => setTimeout(r, 15_000));

        return {
          success: true,
          action: "Restarted ComfyUI container",
          message: result.message,
        };
      } catch (error) {
        return {
          success: false,
          action: "Restart ComfyUI container",
          message: error instanceof Error ? error.message : "Restart failed",
        };
      }
    },
  };
}

// ============================================================================
// Singleton and Initialization
// ============================================================================

let instance: HealthMonitor | null = null;

/**
 * Get the health monitor singleton
 */
export function getHealthMonitor(): HealthMonitor {
  if (!instance) {
    instance = new HealthMonitor({
      checkIntervalMs: config.healthMonitor.checkIntervalMs,
      alertThresholdMs: config.healthMonitor.alertThresholdMs,
    });

    // Register all services
    instance.registerService(createOllamaService());
    instance.registerService(createChromaDBService());
    instance.registerService(createValkeyService());

    // Only register ComfyUI if image generation is enabled
    if (config.comfyui?.enabled) {
      instance.registerService(createComfyUIService());
    }
  }

  return instance;
}

/**
 * Start the health monitor (call from index.ts)
 */
export function startHealthMonitor(): void {
  getHealthMonitor().start();
}

/**
 * Stop the health monitor (call from shutdown)
 */
export function stopHealthMonitor(): void {
  if (instance) {
    instance.stop();
  }
}

export { HealthMonitor };
