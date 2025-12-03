/**
 * Fetch Utilities
 * Provides consistent fetch patterns with timeouts and abort handling
 */

import { createLogger } from "./logger.js";

const log = createLogger("Fetch");

/**
 * Default timeout for fetch requests (30 seconds)
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Active abort controllers for cleanup during shutdown
 */
const activeControllers = new Set<AbortController>();

/**
 * Fetch with timeout using AbortController
 * Automatically cleans up on completion or abort
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const {
    timeout = DEFAULT_TIMEOUT,
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const controller = new AbortController();
  activeControllers.add(controller);

  // Combine with external signal if provided
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort());
  }

  const timeoutId = setTimeout(() => {
    controller.abort();
    log.debug(`Request to ${url} timed out after ${timeout}ms`);
  }, timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
    activeControllers.delete(controller);
  }
}

/**
 * Abort all pending fetch requests
 * Call this during graceful shutdown
 */
export function abortAllPendingRequests(): void {
  const count = activeControllers.size;
  if (count > 0) {
    log.debug(`Aborting ${count} pending fetch request(s)`);
    for (const controller of activeControllers) {
      controller.abort();
    }
    activeControllers.clear();
  }
}

/**
 * Get the number of active fetch requests
 */
export function getActiveRequestCount(): number {
  return activeControllers.size;
}
