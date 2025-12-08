/**
 * LLM Providers Module
 *
 * Provides a unified interface for multiple LLM backends:
 * - Ollama: Local LLM with GPU acceleration
 * - Cloudflare: Cloud-based Workers AI (free tier)
 *
 * @example
 * ```typescript
 * import { getChatProvider, getEmbeddingProvider } from "./providers/index.js";
 *
 * // Get providers for specific purposes
 * const chatProvider = await getChatProvider();       // Ollama
 * const embedProvider = await getEmbeddingProvider(); // Cloudflare if available
 *
 * // Generate a response
 * const response = await chatProvider.chat([
 *   { role: "user", content: "Hello!" }
 * ]);
 *
 * // Generate embeddings
 * const embeddings = await embedProvider.embed("Some text");
 * ```
 */

// Base types and interfaces
export type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ClassificationResult,
  EmbeddingOptions,
  EmbeddingResponse,
  LLMProvider,
  ProviderCapabilities,
  ProviderHealth,
  ProviderMessage,
} from "./base-provider.js";

export {
  BaseLLMProvider,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from "./base-provider.js";
export { CloudflareProvider, type CloudflareProviderConfig } from "./cloudflare-provider.js";
// Provider implementations
export { OllamaProvider, type OllamaProviderConfig } from "./ollama-provider.js";

// Factory and convenience functions
export {
  getChatProvider,
  getEmbeddingProvider,
  getProviderFactory,
  getProviderForPurpose,
  getRoutingProvider,
  ProviderFactory,
  type ProviderPurpose,
  type ProviderType,
} from "./provider-factory.js";
