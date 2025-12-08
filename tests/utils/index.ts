/**
 * Shared Test Utilities
 *
 * Common functions and types used across test files to reduce code duplication.
 */

import "dotenv/config";

// Re-export Docker health utilities
export * from "./docker-health.js";

// ============ Security Constants ============

/** Discord webhook URL regex pattern - validates the expected format */
const DISCORD_WEBHOOK_URL_PATTERN =
  /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d{17,19}\/[\w-]{60,68}$/;

/** Discord snowflake ID pattern (17-19 digit number) */
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,19}$/;

/** Discord API base URL - only allow official Discord API */
const DISCORD_API_BASE = "https://discord.com/api/v10";

// ============ Types ============

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  timestamp: string;
  embeds?: {
    title?: string;
    description?: string;
  }[];
  attachments?: {
    id: string;
    filename: string;
    url: string;
    content_type?: string;
  }[];
  /** Message this is a reply to (if any) */
  referenced_message?: {
    id: string;
    content?: string;
  } | null;
  /** Message reference data (alternative to referenced_message) */
  message_reference?: {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
  };
}

export interface TestEnv {
  webhookUrl: string;
  channelId: string;
  botToken: string;
  botClientId: string;
  testMode: string | undefined;
}

export interface TestResult {
  test: string;
  passed: boolean;
  message: string;
}

// ============ Environment Utilities ============

/**
 * Get and validate required environment variables
 */
export function getRequiredEnv(): TestEnv {
  const webhookUrl = process.env.TEST_WEBHOOK_URL;
  const channelIds = process.env.TEST_CHANNEL_IDS;
  const botToken = process.env.DISCORD_TOKEN;
  const botClientId = process.env.DISCORD_CLIENT_ID;
  const testMode = process.env.TEST_MODE;

  if (!webhookUrl || !channelIds || !botToken || !botClientId) {
    const missing: string[] = [];
    if (!webhookUrl) missing.push("TEST_WEBHOOK_URL");
    if (!channelIds) missing.push("TEST_CHANNEL_IDS");
    if (!botToken) missing.push("DISCORD_TOKEN");
    if (!botClientId) missing.push("DISCORD_CLIENT_ID");

    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  const channelId = channelIds.split(",")[0]?.trim();
  if (!channelId) {
    console.error("Could not parse channel ID from TEST_CHANNEL_IDS");
    process.exit(1);
  }

  return {
    webhookUrl,
    channelId,
    botToken,
    botClientId,
    testMode,
  };
}

/**
 * Print environment status (for debugging)
 */
export function printEnvStatus(): void {
  console.log("Environment Variables:");
  console.log(`  TEST_WEBHOOK_URL: ${process.env.TEST_WEBHOOK_URL ? "✓ SET" : "✗ NOT SET"}`);
  console.log(`  TEST_CHANNEL_IDS: ${process.env.TEST_CHANNEL_IDS ? "✓ SET" : "✗ NOT SET"}`);
  console.log(`  DISCORD_TOKEN: ${process.env.DISCORD_TOKEN ? "✓ SET" : "✗ NOT SET"}`);
  console.log(`  DISCORD_CLIENT_ID: ${process.env.DISCORD_CLIENT_ID ?? "✗ NOT SET"}`);
  console.log(`  TEST_MODE: ${process.env.TEST_MODE ?? "NOT SET"}`);
}

// ============ Security Validation ============

/**
 * Validate a Discord webhook URL
 * @returns true if the URL matches the expected Discord webhook format
 */
export function isValidWebhookUrl(url: string): boolean {
  return DISCORD_WEBHOOK_URL_PATTERN.test(url);
}

/**
 * Validate a Discord snowflake ID (channel ID, message ID, user ID)
 * @returns true if the ID is a valid 17-19 digit snowflake
 */
export function isValidSnowflake(id: string): boolean {
  return DISCORD_SNOWFLAKE_PATTERN.test(id);
}

/**
 * Sanitize content for webhook message to prevent injection
 * Limits length and removes potentially dangerous characters
 */
function sanitizeWebhookContent(content: string): string {
  // Limit content length to Discord's max (2000 chars)
  const maxLength = 2000;
  const truncated = content.length > maxLength ? content.substring(0, maxLength) : content;
  // Remove null bytes and other control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
  // Build pattern from char codes to avoid embedding literal control characters in source
  let result = "";
  for (const char of truncated) {
    const code = char.codePointAt(0) ?? 0;
    // Allow tab (0x09), newline (0x0A), carriage return (0x0D), and all chars >= 0x20
    if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) {
      result += char;
    }
  }
  return result;
}

// ============ Discord API Utilities ============

/**
 * Send a message via Discord webhook
 * Security: Validates webhook URL format before making request
 */
export async function sendWebhookMessage(
  webhookUrl: string,
  content: string,
  username = "Test User 🧪"
): Promise<string | null> {
  // Validate webhook URL format to prevent SSRF
  if (!isValidWebhookUrl(webhookUrl)) {
    console.error("Invalid webhook URL format - must be a valid Discord webhook URL");
    return null;
  }

  // Sanitize content
  const sanitizedContent = sanitizeWebhookContent(content);
  const sanitizedUsername = sanitizeWebhookContent(username).substring(0, 80);

  try {
    const response = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: sanitizedContent, username: sanitizedUsername }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Webhook failed: ${response.status} - ${errorText}`);
      return null;
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  } catch (error) {
    console.error(`Webhook error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Fetch messages from a Discord channel
 * Security: Validates channel ID and constructs URL safely
 */
export async function fetchChannelMessages(
  channelId: string,
  botToken: string,
  afterMessageId?: string,
  limit = 10
): Promise<DiscordMessage[]> {
  // Validate channel ID is a proper snowflake to prevent injection
  if (!isValidSnowflake(channelId)) {
    console.error("Invalid channel ID format - must be a valid Discord snowflake");
    return [];
  }

  // Validate afterMessageId if provided
  if (afterMessageId && !isValidSnowflake(afterMessageId)) {
    console.error("Invalid afterMessageId format - must be a valid Discord snowflake");
    return [];
  }

  // Validate limit is within reasonable bounds
  const safeLimit = Math.min(Math.max(1, limit), 100);

  try {
    // Construct URL safely using URLSearchParams
    const url = new URL(`${DISCORD_API_BASE}/channels/${channelId}/messages`);
    url.searchParams.set("limit", String(safeLimit));
    if (afterMessageId) {
      url.searchParams.set("after", afterMessageId);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch messages: ${response.status} - ${errorText}`);
      return [];
    }

    return (await response.json()) as DiscordMessage[];
  } catch (error) {
    console.error(
      `Error fetching messages: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

// ============ Response Validation Utilities ============

/**
 * Check if a message is a valid bot response (not a status/generating message)
 * Prioritizes messages that are direct replies to the triggering message
 */
export function isValidBotResponse(
  msg: DiscordMessage,
  afterMsgId: string,
  botClientId: string
): boolean {
  const isBot = msg.author.bot && msg.author.id === botClientId;
  const isAfter = BigInt(msg.id) > BigInt(afterMsgId);

  if (!isBot || !isAfter) return false;

  // Ignore status messages
  if (msg.content.includes("🎨 Generating")) return false;
  if (msg.content.includes("⏳") && msg.content.includes("Please wait")) return false;

  return true;
}

/**
 * Check if a message is a direct reply to a specific message
 */
export function isDirectReplyTo(msg: DiscordMessage, targetMsgId: string): boolean {
  // Check referenced_message (populated when fetching with message content)
  if (msg.referenced_message?.id === targetMsgId) {
    return true;
  }

  // Check message_reference (always populated for replies)
  if (msg.message_reference?.message_id === targetMsgId) {
    return true;
  }

  return false;
}

/**
 * Wait for a bot response after sending a message
 * Prioritizes direct replies (message.reply()) over generic bot messages
 */
export async function waitForBotResponse(
  env: TestEnv,
  afterMsgId: string,
  maxWaitMs = 120000,
  pollIntervalMs = 2000
): Promise<DiscordMessage | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const messages = await fetchChannelMessages(env.channelId, env.botToken, afterMsgId);

    // Filter to valid bot responses
    const validResponses = messages.filter((msg) =>
      isValidBotResponse(msg, afterMsgId, env.botClientId)
    );

    // Priority 1: Find a direct reply to our message
    const directReply = validResponses.find((msg) => isDirectReplyTo(msg, afterMsgId));
    if (directReply) {
      return directReply;
    }

    // Priority 2: If no direct reply yet, wait for one
    // Only accept non-reply responses after waiting a bit (to allow for reply to arrive)
    const elapsed = Date.now() - startTime;
    if (validResponses.length > 0 && elapsed > 10000) {
      // After 10 seconds, accept any valid response as fallback
      // Sort by timestamp (earliest first) to get the first response
      validResponses.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      return validResponses[0] ?? null;
    }

    await sleep(pollIntervalMs);

    // Periodic status update
    const elapsedSec = Math.round(elapsed / 1000);
    if (elapsedSec % 15 === 0 && elapsedSec > 0) {
      console.log(`  Still waiting for bot response... (${elapsedSec}s elapsed)`);
    }
  }

  return null;
}

// ============ Helper Utilities ============

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength = 200): string {
  if (str.length <= maxLength) return str;
  return `${str.substring(0, maxLength)}...`;
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
