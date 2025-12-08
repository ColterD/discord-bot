/**
 * Async Utilities
 *
 * Modern TypeScript async helper functions for cleaner, more readable code.
 * These utilities help reduce boilerplate and improve error handling.
 */

/**
 * Delay execution for a specified number of milliseconds
 * Uses a more descriptive name than "sleep" and follows modern patterns
 *
 * @example
 * await delay(1000); // Wait 1 second
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with a timeout
 * Throws TimeoutError if the operation doesn't complete in time
 *
 * @example
 * const result = await withTimeout(fetchData(), 5000, "Fetch operation timed out");
 */
export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(message ?? `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Retry an async operation with exponential backoff
 *
 * @example
 * const result = await retry(() => fetchData(), {
 *   maxAttempts: 3,
 *   initialDelayMs: 1000,
 *   maxDelayMs: 10000,
 * });
 */
export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Optional predicate to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Optional callback for each retry attempt */
  onRetry?: (attempt: number, error: unknown) => void;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    isRetryable = () => true,
    onRetry,
  } = options;

  let lastError: unknown;
  let currentDelay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }

      onRetry?.(attempt, error);

      await delay(currentDelay);
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Execute multiple promises with concurrency limit
 * Uses a proper semaphore pattern with Set for O(1) removal
 *
 * @example
 * const urls = ["url1", "url2", "url3", "url4", "url5"];
 * const results = await withConcurrency(
 *   urls.map(url => () => fetch(url)),
 *   2 // Max 2 concurrent requests
 * );
 */
export async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();

  for (const [index, task] of tasks.entries()) {
    // Create wrapped promise that removes itself when settled
    // promiseRef is assigned immediately after the IIFE is created but before
    // any async code runs, so it will always be defined in the finally block
    let promiseRef!: Promise<void>;
    const promise = (async () => {
      try {
        results[index] = await task();
      } finally {
        executing.delete(promiseRef);
      }
    })();
    promiseRef = promise;

    executing.add(promise);

    // If at limit, wait for one to complete before continuing
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  // Wait for remaining tasks
  await Promise.all(executing);
  return results;
}

/**
 * Create a debounced version of an async function
 * Only the last call within the delay window will execute
 *
 * @example
 * const debouncedSave = debounceAsync(saveData, 500);
 * debouncedSave(data1); // Cancelled if called again within 500ms
 * debouncedSave(data2); // This one executes
 */
export function debounceAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: NodeJS.Timeout | undefined;
  let pendingPromise: Promise<ReturnType<T>> | undefined;
  let pendingResolve: ((value: ReturnType<T>) => void) | undefined;
  let pendingReject: ((error: unknown) => void) | undefined;

  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!pendingPromise) {
      pendingPromise = new Promise<ReturnType<T>>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    }

    timeoutId = setTimeout(async () => {
      try {
        const result = await fn(...args);
        pendingResolve?.(result as ReturnType<T>);
      } catch (error) {
        pendingReject?.(error);
      } finally {
        pendingPromise = undefined;
        pendingResolve = undefined;
        pendingReject = undefined;
      }
    }, delayMs);

    return pendingPromise;
  };
}

/**
 * Create a throttled version of an async function
 * Ensures the function is not called more than once per interval
 *
 * @example
 * const throttledFetch = throttleAsync(fetchData, 1000);
 * throttledFetch(); // Executes immediately
 * throttledFetch(); // Queued, executes after 1000ms
 */
export function throttleAsync<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  intervalMs: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let lastCall = 0;
  let pending: Promise<ReturnType<T>> | undefined;

  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= intervalMs) {
      lastCall = now;
      return fn(...args) as Promise<ReturnType<T>>;
    }

    if (pending) {
      return pending;
    }

    pending = (async () => {
      await delay(intervalMs - timeSinceLastCall);
      lastCall = Date.now();
      const result = await fn(...args);
      pending = undefined;
      return result as ReturnType<T>;
    })();

    return pending;
  };
}
