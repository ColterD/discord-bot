/**
 * Quick Test Script
 * Sends a single test message and waits for bot response
 * Usage: npx tsx tests/quick-test.ts
 */

import {
  getRequiredEnv,
  sendWebhookMessage,
  waitForBotResponse,
  truncate,
  type DiscordMessage,
} from "./utils/index.js";

const TEST_MESSAGE = "Hello! This is a test message. Can you respond?";

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Quick Bot Test");
  console.log("=".repeat(60));

  const env = getRequiredEnv();
  console.log(`Channel ID: ${env.channelId}`);
  console.log(`Bot Client ID: ${env.botClientId}`);
  console.log(`Test Message: "${TEST_MESSAGE}"`);
  console.log("");

  console.log("Sending test message...");
  const messageId = await sendWebhookMessage(env.webhookUrl, TEST_MESSAGE);

  if (!messageId) {
    console.error("Failed to send message!");
    process.exit(1);
  }

  console.log(`✓ Message sent (ID: ${messageId})`);
  console.log("");

  // Wait a moment for Discord API consistency
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("Waiting for bot response (max 2 minutes)...");
  const response = await waitForBotResponse(env, messageId);

  if (!response) {
    console.error("\n✗ Test FAILED - No response from bot");
    process.exit(1);
  }

  printResponse(response);
}

function printResponse(response: DiscordMessage): void {
  console.log("\n" + "=".repeat(60));
  console.log("Bot Response:");
  console.log("=".repeat(60));
  console.log(truncate(response.content, 500));
  if (response.attachments && response.attachments.length > 0) {
    console.log(`\nAttachments: ${response.attachments.length}`);
    for (const att of response.attachments) {
      console.log(`  - ${att.filename}`);
    }
  }
  console.log("=".repeat(60));
  console.log("\n✓ Test PASSED - Bot responded successfully!");
}

try {
  await main();
} catch (error) {
  console.error("Unhandled error:", error);
  process.exit(1);
}
