/**
 * Provider Factory
 *
 * Factory for creating and managing LLM provider instances.
 * Supports lazy initialization, caching, and provider lifecycle management.
 */

import { config } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import type { LLMProvider } from "./base-provider.js";
import { CloudflareProvider } from "./cloudflare-provider.js";
import { OllamaProvider } from "./ollama-provider.js";

const logger = createLogger("ProviderFactory");

/**
 * Provider types supported by the factory
 */
export type ProviderType = "ollama" | "cloudflare";

/**
 * Provider purpose - determines which provider to use for specific tasks
 */
export type ProviderPurpose =
  | "chat" // Main chat/conversation (Ollama)
  | "routing" // Intent classification (Cloudflare)
  | "embedding" // Vector embeddings (Cloudflare preferred, Ollama fallback)
  | "agent"; // Agent/tool calling (Ollama)

/**
 * Provider factory configuration
 */
interface ProviderFactoryConfig {
  /**
   * Whether to prefer cloud providers for routing/embeddings
   * Default: true if Cloudflare credentials are configured
   */
  preferCloudOffload?: boolean;

  /**
   * Custom provider mapping by purpose
   */
  providerMapping?: Partial<Record<ProviderPurpose, ProviderType>>;
}

/**
 * Singleton factory for managing LLM providers
 */
class ProviderFactory {
  private static instance: ProviderFactory | undefined;

  private readonly providers = new Map<ProviderType, LLMProvider>();
  private readonly initializationPromises = new Map<ProviderType, Promise<LLMProvider>>();

  private readonly defaultMapping: Record<ProviderPurpose, ProviderType>;
  private readonly cloudflareAvailable: boolean;

  private constructor(factoryConfig?: ProviderFactoryConfig) {
    // Check if Cloudflare is configured
    this.cloudflareAvailable = this.isCloudflareConfigured();

    const preferCloud = factoryConfig?.preferCloudOffload ?? this.cloudflareAvailable;

    // Default provider mapping based on architecture
    // Cloudflare for lightweight routing/embeddings, Ollama for heavy lifting
    this.defaultMapping = {
      chat: "ollama", // Main chat always uses local Ollama
      agent: "ollama", // Tool calling requires local model
      routing: preferCloud && this.cloudflareAvailable ? "cloudflare" : "ollama",
      embedding: preferCloud && this.cloudflareAvailable ? "cloudflare" : "ollama",
      ...factoryConfig?.providerMapping,
    };

    logger.info(
      `Provider factory initialized: cloudflare=${this.cloudflareAvailable}, mapping=${JSON.stringify(this.defaultMapping)}`
    );
  }

  /**
   * Get or create the factory singleton
   */
  static getInstance(factoryConfig?: ProviderFactoryConfig): ProviderFactory {
    ProviderFactory.instance ??= new ProviderFactory(factoryConfig);
    return ProviderFactory.instance;
  }

  /**
   * Reset the factory instance (primarily for testing)
   */
  static resetInstance(): void {
    if (ProviderFactory.instance) {
      ProviderFactory.instance.shutdownAll().catch((err) => {
        logger.error("Error during factory reset shutdown", { error: err });
      });
      ProviderFactory.instance = undefined;
    }
  }

  /**
   * Check if Cloudflare credentials are configured
   */
  private isCloudflareConfigured(): boolean {
    return config.cloudflare.isConfigured;
  }

  /**
   * Get the appropriate provider type for a given purpose
   */
  getProviderTypeForPurpose(purpose: ProviderPurpose): ProviderType {
    return this.defaultMapping[purpose];
  }

  /**
   * Get a provider by type with lazy initialization
   */
  async getProvider(type: ProviderType): Promise<LLMProvider> {
    // Return cached provider if available
    const cached = this.providers.get(type);
    if (cached) {
      return cached;
    }

    // Check if initialization is already in progress
    const pending = this.initializationPromises.get(type);
    if (pending) {
      return pending;
    }

    // Create and cache the initialization promise
    const initPromise = this.createProvider(type);
    this.initializationPromises.set(type, initPromise);

    try {
      const provider = await initPromise;
      this.providers.set(type, provider);
      return provider;
    } finally {
      this.initializationPromises.delete(type);
    }
  }

  /**
   * Get a provider for a specific purpose
   */
  async getProviderForPurpose(purpose: ProviderPurpose): Promise<LLMProvider> {
    const type = this.getProviderTypeForPurpose(purpose);
    return this.getProvider(type);
  }

  /**
   * Get the chat provider (Ollama)
   */
  async getChatProvider(): Promise<LLMProvider> {
    return this.getProviderForPurpose("chat");
  }

  /**
   * Get the routing provider (Cloudflare if available)
   */
  async getRoutingProvider(): Promise<LLMProvider> {
    return this.getProviderForPurpose("routing");
  }

  /**
   * Get the embedding provider (Cloudflare if available)
   */
  async getEmbeddingProvider(): Promise<LLMProvider> {
    return this.getProviderForPurpose("embedding");
  }

  /**
   * Get the agent provider (Ollama)
   */
  async getAgentProvider(): Promise<LLMProvider> {
    return this.getProviderForPurpose("agent");
  }

  /**
   * Create a provider instance based on type
   */
  private async createProvider(type: ProviderType): Promise<LLMProvider> {
    logger.info(`Creating provider: ${type}`);

    switch (type) {
      case "ollama":
        return this.createOllamaProvider();
      case "cloudflare":
        return this.createCloudflareProvider();
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  /**
   * Create and configure Ollama provider
   */
  private createOllamaProvider(): LLMProvider {
    return new OllamaProvider({
      apiUrl: config.llm.apiUrl,
      model: config.llm.model,
      fallbackModel: config.llm.fallbackModel,
      embeddingModel: config.embedding.model,
      keepAlive: config.llm.keepAlive,
      timeoutMs: config.llm.requestTimeout,
    });
  }

  /**
   * Create and configure Cloudflare provider
   */
  private createCloudflareProvider(): LLMProvider {
    if (!config.cloudflare.isConfigured) {
      throw new Error(
        "Cloudflare provider requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables"
      );
    }

    // Build base config
    const baseConfig = {
      accountId: config.cloudflare.accountId,
      apiToken: config.cloudflare.apiToken,
      // Use configured models or defaults
      chatModel: config.cloudflare.routerModel,
      embeddingModel: config.cloudflare.embeddingModel,
      // Conservative timeout for cloud calls
      timeoutMs: 30000,
    };

    // Only add worker config if fully configured
    if (config.cloudflare.worker.isConfigured) {
      return new CloudflareProvider({
        ...baseConfig,
        worker: {
          url: config.cloudflare.worker.url,
          secret: config.cloudflare.worker.secret,
        },
      });
    }

    return new CloudflareProvider(baseConfig);
  }

  /**
   * Check if a specific provider is available and healthy
   */
  async isProviderHealthy(type: ProviderType): Promise<boolean> {
    try {
      const provider = await this.getProvider(type);
      const health = await provider.checkHealth();
      return health.available;
    } catch {
      return false;
    }
  }

  /**
   * Get health status for all configured providers
   */
  async getHealthStatus(): Promise<
    Record<ProviderType, { available: boolean; latencyMs?: number }>
  > {
    const results: Record<ProviderType, { available: boolean; latencyMs?: number }> = {
      ollama: { available: false },
      cloudflare: { available: false },
    };

    // Check Ollama
    try {
      const ollamaProvider = await this.getProvider("ollama");
      const ollamaHealth = await ollamaProvider.checkHealth();
      results.ollama = {
        available: ollamaHealth.available,
        ...(ollamaHealth.latencyMs ? { latencyMs: ollamaHealth.latencyMs } : {}),
      };
    } catch {
      results.ollama = { available: false };
    }

    // Check Cloudflare if configured
    if (this.cloudflareAvailable) {
      try {
        const cfProvider = await this.getProvider("cloudflare");
        const cfHealth = await cfProvider.checkHealth();
        results.cloudflare = {
          available: cfHealth.available,
          ...(cfHealth.latencyMs ? { latencyMs: cfHealth.latencyMs } : {}),
        };
      } catch {
        results.cloudflare = { available: false };
      }
    }

    return results;
  }

  /**
   * Shutdown all providers
   */
  async shutdownAll(): Promise<void> {
    logger.info("Shutting down all providers");

    const shutdownPromises = Array.from(this.providers.entries()).map(async ([type, provider]) => {
      try {
        await provider.dispose();
        logger.info(`Provider shutdown complete: ${type}`);
      } catch (error) {
        logger.error(`Provider shutdown failed: ${type} - ${error}`);
      }
    });

    await Promise.all(shutdownPromises);
    this.providers.clear();
  }

  /**
   * Whether Cloudflare offloading is available
   */
  get isCloudOffloadAvailable(): boolean {
    return this.cloudflareAvailable;
  }

  /**
   * Get current provider mapping
   */
  get currentMapping(): Record<ProviderPurpose, ProviderType> {
    return { ...this.defaultMapping };
  }
}

/**
 * Get the provider factory singleton
 */
export function getProviderFactory(config?: ProviderFactoryConfig): ProviderFactory {
  return ProviderFactory.getInstance(config);
}

/**
 * Convenience function to get a provider for a specific purpose
 */
export async function getProviderForPurpose(purpose: ProviderPurpose): Promise<LLMProvider> {
  return getProviderFactory().getProviderForPurpose(purpose);
}

/**
 * Convenience function to get the chat provider
 */
export async function getChatProvider(): Promise<LLMProvider> {
  return getProviderFactory().getChatProvider();
}

/**
 * Convenience function to get the embedding provider
 */
export async function getEmbeddingProvider(): Promise<LLMProvider> {
  return getProviderFactory().getEmbeddingProvider();
}

/**
 * Convenience function to get the routing provider
 */
export async function getRoutingProvider(): Promise<LLMProvider> {
  return getProviderFactory().getRoutingProvider();
}

export { ProviderFactory };
