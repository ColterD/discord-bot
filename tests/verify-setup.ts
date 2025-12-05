/**
 * Verify test setup - checks environment and connectivity
 */

import "dotenv/config";

console.log("=".repeat(60));
console.log("Verifying Test Setup");
console.log("=".repeat(60));

// Check environment variables
const required = {
  TEST_WEBHOOK_URL: process.env.TEST_WEBHOOK_URL,
  TEST_CHANNEL_IDS: process.env.TEST_CHANNEL_IDS,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  TEST_MODE: process.env.TEST_MODE,
};

console.log("\nEnvironment Variables:");
let allSet = true;
for (const [key, value] of Object.entries(required)) {
  const isSet = !!value;
  const status = isSet ? "✓ SET" : "✗ NOT SET";
  console.log(`  ${key}: ${status}`);
  if (!isSet && key !== "TEST_MODE") {
    allSet = false;
  }
}

if (!allSet) {
  console.error("\n✗ Missing required environment variables!");
  process.exit(1);
}

// Test webhook connectivity
console.log("\nTesting Webhook Connectivity...");
try {
  const webhookUrl = process.env.TEST_WEBHOOK_URL!;
  const testResponse = await fetch(`${webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "🧪 Test setup verification message",
      username: "Test Setup Verifier",
    }),
  });

  if (testResponse.ok) {
    const data = await testResponse.json();
    console.log(`✓ Webhook test successful (Message ID: ${data.id})`);
  } else {
    const errorText = await testResponse.text();
    console.error(`✗ Webhook test failed: ${testResponse.status} - ${errorText}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`✗ Webhook test error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

// Test Discord API connectivity
console.log("\nTesting Discord API Connectivity...");
try {
  const channelId = process.env.TEST_CHANNEL_IDS!.split(",")[0]!.trim();
  const botToken = process.env.DISCORD_TOKEN!;
  
  const apiResponse = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages?limit=1`,
    {
      headers: { Authorization: `Bot ${botToken}` },
    }
  );

  if (apiResponse.ok) {
    console.log(`✓ Discord API test successful`);
  } else {
    const errorText = await apiResponse.text();
    console.error(`✗ Discord API test failed: ${apiResponse.status} - ${errorText}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`✗ Discord API test error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

console.log("\n" + "=".repeat(60));
console.log("✓ All checks passed! Ready to run tests.");
console.log("=".repeat(60));
