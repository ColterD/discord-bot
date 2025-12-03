/**
 * Shared AI Constants
 *
 * Common configuration values used across agent and orchestrator
 */

/** Maximum agent loop iterations */
export const MAX_AGENT_ITERATIONS = 8;

/** Tool execution timeout in milliseconds */
export const TOOL_TIMEOUT_MS = 30000;

/** LLM request timeout in milliseconds */
export const LLM_TIMEOUT_MS = 120000;

/**
 * Allowlist of safe URL hostnames for fetch_url tool
 * Used by both agent and orchestrator for URL validation
 */
export const ALLOWED_FETCH_HOSTNAMES = new Set([
  "en.wikipedia.org",
  "www.wikipedia.org",
  "arxiv.org",
  "export.arxiv.org",
  "api.duckduckgo.com",
  "github.com",
  "raw.githubusercontent.com",
  "docs.python.org",
  "developer.mozilla.org",
  "stackoverflow.com",
]);
