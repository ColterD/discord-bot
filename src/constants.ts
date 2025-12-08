/**
 * Centralized constants for the Discord bot
 * Organized by category for easy discovery and maintenance
 */

// =============================================================================
// TIME CONSTANTS (in milliseconds unless noted)
// =============================================================================

/** One second in milliseconds */
export const ONE_SECOND_MS = 1_000;
/** One minute in milliseconds */
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
/** One hour in milliseconds */
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

// =============================================================================
// AI ORCHESTRATOR CONSTANTS
// =============================================================================

/** Maximum iterations for AI orchestrator loop */
export const AI_MAX_ITERATIONS = 15;
/** Standard tool execution timeout (1 minute) */
export const TOOL_TIMEOUT_MS = ONE_MINUTE_MS;
/** Image generation tool timeout (10 minutes) */
export const IMAGE_TOOL_TIMEOUT_MS = 10 * ONE_MINUTE_MS;
/** Maximum consecutive think tool calls before forcing action */
export const MAX_CONSECUTIVE_THINK_CALLS = 5;
/** Maximum consecutive tool failures before stopping */
export const MAX_CONSECUTIVE_FAILURES = 3;

// =============================================================================
// AGENT CONSTANTS
// =============================================================================

/** Maximum agent execution iterations */
export const AGENT_MAX_ITERATIONS = 8;
/** Agent tool execution timeout */
export const AGENT_TOOL_TIMEOUT_MS = 30 * ONE_SECOND_MS;

// =============================================================================
// CONVERSATION CONSTANTS
// =============================================================================

/** Conversation context timeout - clear after inactivity (30 minutes) */
export const CONVERSATION_TIMEOUT_MS = 30 * ONE_MINUTE_MS;
/** Maximum messages to keep in conversation context */
export const MAX_CONTEXT_MESSAGES = 20;

// =============================================================================
// MESSAGE EVENT CONSTANTS
// =============================================================================

/** Typing indicator delay for natural feel */
export const TYPING_DELAY_MS = 300;
/** Typing indicator refresh interval (Discord typing lasts ~10 seconds) */
export const TYPING_INTERVAL_MS = 8_000;
/** Message deduplication window */
export const DEDUPE_WINDOW_MS = 5_000;
/** Maximum entries in deduplication cache */
export const MAX_DEDUPE_ENTRIES = 1_000;

// =============================================================================
// SERVICE INTERVALS
// =============================================================================

/** Maintenance service interval (12 hours) */
export const MAINTENANCE_INTERVAL_MS = 12 * ONE_HOUR_MS;
/** Memory cleanup interval (5 minutes) */
export const CLEANUP_INTERVAL_MS = 5 * ONE_MINUTE_MS;
/** Presence update interval */
export const PRESENCE_UPDATE_INTERVAL_MS = 15_000;
/** Health check interval */
export const HEALTH_CHECK_INTERVAL_MS = 30 * ONE_SECOND_MS;

// =============================================================================
// RETRY AND BACKOFF CONSTANTS
// =============================================================================

/** Maximum retry attempts for AI service calls */
export const MAX_RETRIES = 3;
/** Fixed retry delays for exponential backoff */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

// =============================================================================
// SIZE LIMITS
// =============================================================================

/** Maximum input length for security validation */
export const MAX_INPUT_LENGTH = 10_000;
/** Maximum output length for security validation (100KB) */
export const MAX_OUTPUT_LENGTH = 100_000;
/** Maximum argument size for security validation (50KB) */
export const MAX_ARG_SIZE = 50_000;
/** Maximum prompt length for image generation */
export const MAX_PROMPT_LENGTH = 2_000;
/** Maximum regex pattern length */
export const MAX_PATTERN_LENGTH = 256;
/** Maximum activity name length for Discord presence */
export const MAX_ACTIVITY_NAME_LENGTH = 128;

// =============================================================================
// MEMORY AND CACHE CONSTANTS
// =============================================================================

/** Minimum VRAM to free when memory is low (100MB) */
export const MINIMUM_FREED_VRAM_BYTES = 100 * 1024 * 1024;
/** Minimal VRAM usage threshold (500MB) */
export const MINIMAL_VRAM_USAGE_THRESHOLD_BYTES = 500 * 1024 * 1024;
/** Maximum consecutive presence update failures before going offline */
export const MAX_CONSECUTIVE_PRESENCE_FAILURES = 3;

// =============================================================================
// MEMORY IMPORTANCE SCORES
// =============================================================================

/** Importance score for procedural memories (how to interact with the user) */
export const MEMORY_IMPORTANCE_PROCEDURAL = 0.95;
/** Importance score for user preferences */
export const MEMORY_IMPORTANCE_PREFERENCE = 0.9;
/** Importance score for user profile/facts */
export const MEMORY_IMPORTANCE_USER_PROFILE = 0.8;
/** Importance score for substantive episodic content */
export const MEMORY_IMPORTANCE_EPISODIC_SUBSTANTIVE = 0.5;
/** Importance score for default episodic content */
export const MEMORY_IMPORTANCE_EPISODIC_DEFAULT = 0.35;
/** Importance score for short messages */
export const MEMORY_IMPORTANCE_SHORT_MESSAGE = 0.2;
/** Importance score for low-value content (chatter) */
export const MEMORY_IMPORTANCE_LOW_VALUE = 0.1;

// =============================================================================
// FETCH AND NETWORK CONSTANTS
// =============================================================================

/** Default HTTP fetch timeout */
export const DEFAULT_FETCH_TIMEOUT_MS = 30 * ONE_SECOND_MS;

// =============================================================================
// VRAM MANAGER CONSTANTS
// =============================================================================

/** Bytes per megabyte for VRAM calculations */
export const BYTES_PER_MB = 1024 * 1024;

/** VRAM status polling interval */
export const VRAM_POLL_INTERVAL_MS = 5 * ONE_SECOND_MS;

/** Quick API request timeout (status checks) */
export const VRAM_STATUS_TIMEOUT_MS = 5 * ONE_SECOND_MS;

/** Model unload operation timeout */
export const VRAM_UNLOAD_TIMEOUT_MS = 30 * ONE_SECOND_MS;

/** Model reload operation timeout (loading to GPU/RAM) */
export const VRAM_RELOAD_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

/** Delay after unload before reload to allow cleanup */
export const VRAM_UNLOAD_SETTLE_MS = 2 * ONE_SECOND_MS;

/** Wait for VRAM availability check interval */
export const VRAM_WAIT_CHECK_INTERVAL_MS = 2 * ONE_SECOND_MS;

/** Default timeout when waiting for VRAM to become available */
export const VRAM_WAIT_DEFAULT_TIMEOUT_MS = ONE_MINUTE_MS;

/** Estimated time per active task for wait calculations */
export const VRAM_ESTIMATED_TASK_DURATION_MS = 45 * ONE_SECOND_MS;

/** Estimated VRAM for embedding model (MB) */
export const VRAM_EMBEDDING_ESTIMATE_MB = 500;

/** Estimated VRAM for summarization model (MB) */
export const VRAM_SUMMARIZATION_ESTIMATE_MB = 2000;

/** Default model size for layer calculations (MB) - 30B model */
export const VRAM_DEFAULT_MODEL_SIZE_MB = 14500;

/** Estimated transformer layers in large models */
export const VRAM_TRANSFORMER_LAYERS = 60;

/** Cooldown between autonomous migrations (prevents thrashing) */
export const VRAM_MIGRATION_COOLDOWN_MS = 30 * ONE_SECOND_MS;

/** Consecutive pressure checks before migrating to RAM */
export const VRAM_PRESSURE_CHECKS_THRESHOLD = 3;

/** Consecutive available checks before migrating back to VRAM */
export const VRAM_AVAILABLE_CHECKS_THRESHOLD = 5;

/** VRAM increase threshold indicating external consumer (MB) */
export const VRAM_EXTERNAL_CONSUMER_THRESHOLD_MB = 2000;

/** VRAM usage threshold for reclaiming (50% = migrate back to GPU) */
export const VRAM_RECLAIM_THRESHOLD = 0.5;

/** VRAM ratio threshold - below this, model is in RAM */
export const VRAM_RAM_RATIO_THRESHOLD = 0.1;

/** VRAM ratio threshold - above this, model is in VRAM */
export const VRAM_FULL_GPU_RATIO_THRESHOLD = 0.9;
