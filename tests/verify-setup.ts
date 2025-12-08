/**
 * Verify test setup - checks environment and connectivity
 * Usage: npx tsx tests/verify-setup.ts
 */

import {
  fetchChannelMessages,
  getRequiredEnv,
  printEnvStatus,
  sendWebhookMessage,
} from "./utils/index.js";

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Verifying Test Setup");
  console.log("=".repeat(60));

  // Check environment variables
  console.log("\nEnvironment Variables:");
  printEnvStatus();

  const env = getRequiredEnv();

  // Test webhook connectivity
  console.log("\nTesting Webhook Connectivity...");
  const messageId = await sendWebhookMessage(
    env.webhookUrl,
    "🧪 Test setup verification message",
    "Test Setup Verifier"
  );

  if (!messageId) {
    console.error("✗ Webhook test failed");
    process.exit(1);
  }
  console.log(`✓ Webhook test successful (Message ID: ${messageId})`);

  // Test Discord API connectivity
  console.log("\nTesting Discord API Connectivity...");
  const messages = await fetchChannelMessages(env.channelId, env.botToken, undefined, 1);

  if (messages.length === 0) {
    console.error("✗ Discord API test failed - no messages retrieved");
    process.exit(1);
  }
  console.log("✓ Discord API test successful");

  console.log(`\n${"=".repeat(60)}`);
  console.log("✓ All checks passed! Ready to run tests.");
  console.log("=".repeat(60));
}

try {
  await main();
  // Graceful exit
  setTimeout(() => process.exit(0), 100);
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  setTimeout(() => process.exit(1), 100);
}
