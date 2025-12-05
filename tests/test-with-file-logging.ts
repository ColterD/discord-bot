/**
 * Test with file logging for debugging
 */

import "dotenv/config";
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_FILE = join(process.cwd(), "test-run.log");

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  appendFileSync(LOG_FILE, logMessage, "utf-8");
  console.log(message);
}

// Clear log file
writeFileSync(LOG_FILE, `Test started at ${new Date().toISOString()}\n`, "utf-8");

log("=".repeat(60));
log("Discord Bot Test Suite");
log("=".repeat(60));

// Check environment
const env = {
  TEST_WEBHOOK_URL: process.env.TEST_WEBHOOK_URL,
  TEST_CHANNEL_IDS: process.env.TEST_CHANNEL_IDS,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  TEST_MODE: process.env.TEST_MODE,
};

log("\nEnvironment Check:");
for (const [key, value] of Object.entries(env)) {
  const status = value ? "✓ SET" : "✗ NOT SET";
  log(`  ${key}: ${status}`);
}

if (
  !env.TEST_WEBHOOK_URL ||
  !env.TEST_CHANNEL_IDS ||
  !env.DISCORD_TOKEN ||
  !env.DISCORD_CLIENT_ID
) {
  log("\n✗ Missing required environment variables!");
  process.exit(1);
}

const CHANNEL_ID = env.TEST_CHANNEL_IDS.split(",")[0]!.trim();
log(`\nUsing Channel ID: ${CHANNEL_ID}`);
log(`Bot Client ID: ${env.DISCORD_CLIENT_ID}`);

// Test webhook
log("\nTesting webhook...");
try {
  const response = await fetch(`${env.TEST_WEBHOOK_URL}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "🧪 Test message from automated test suite",
      username: "Test Bot",
    }),
  });

  if (response.ok) {
    const data = (await response.json()) as { id: string };
    log(`✓ Webhook test successful (Message ID: ${data.id})`);

    // Wait for bot response
    log("\nWaiting for bot response...");
    const startTime = Date.now();
    const maxWait = 120000; // 2 minutes

    while (Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      try {
        const messagesResponse = await fetch(
          `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=10&after=${data.id}`,
          {
            headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` },
          }
        );

        if (messagesResponse.ok) {
          const messages = (await messagesResponse.json()) as {
            id: string;
            content: string;
            author: { id: string; bot?: boolean };
          }[];

          log(`  Checked messages (found ${messages.length} after test message)`);

          const botResponse = messages.find((msg) => {
            const isBot = msg.author.bot && msg.author.id === env.DISCORD_CLIENT_ID;
            const isAfter = BigInt(msg.id) > BigInt(data.id);
            if (!isBot || !isAfter) return false;
            if (msg.content.includes("🎨 Generating")) return false;
            if (msg.content.includes("⏳") && msg.content.includes("Please wait")) return false;
            return true;
          });

          if (botResponse) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            log(`\n✓ Bot responded after ${elapsed}s`);
            log("=".repeat(60));
            log("Bot Response:");
            log(botResponse.content.substring(0, 500));
            if (botResponse.content.length > 500) {
              log("... (truncated)");
            }
            log("=".repeat(60));
            log("\n✓ TEST PASSED");
            process.exit(0);
          }
        }
      } catch (error) {
        log(`  Error checking messages: ${error instanceof Error ? error.message : String(error)}`);
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 15 === 0) {
        log(`  Still waiting... (${elapsed}s elapsed)`);
      }
    }

    log(`\n✗ TEST FAILED - No response after ${maxWait / 1000}s`);
    process.exit(1);
  } else {
    const errorText = await response.text();
    log(`✗ Webhook test failed: ${response.status} - ${errorText}`);
    process.exit(1);
  }
} catch (error) {
  log(`✗ Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
