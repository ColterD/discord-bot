/**
 * Run test and wait for completion with file output
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_FILE = join(process.cwd(), "test-run-output.txt");

// Clear and write initial output
writeFileSync(OUTPUT_FILE, `Test started at ${new Date().toISOString()}\n`, "utf-8");

function output(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  writeFileSync(OUTPUT_FILE, line, { flag: "a" });
  console.log(message);
}

/**
 * Format environment variable value for display
 */
function formatEnvValue(key: string, value: string | undefined): string {
  if (!value) return "NOT SET";
  // Mask sensitive values
  if (key.includes("TOKEN") || key.includes("WEBHOOK")) return "SET";
  return value;
}

output("=".repeat(60));
output("Discord Bot Test Execution");
output("=".repeat(60));

// Check environment
const env = {
  TEST_WEBHOOK_URL: process.env.TEST_WEBHOOK_URL,
  TEST_CHANNEL_IDS: process.env.TEST_CHANNEL_IDS,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  TEST_MODE: process.env.TEST_MODE,
};

output("\nEnvironment Variables:");
let envOk = true;
for (const [key, value] of Object.entries(env)) {
  const status = value ? "✓" : "✗";
  output(`  ${status} ${key}: ${formatEnvValue(key, value)}`);
  if (!value && key !== "TEST_MODE") {
    envOk = false;
  }
}

if (!envOk) {
  output("\n✗ Missing required environment variables!");
  output("Test cannot proceed.");
  process.exit(1);
}

output("\n✓ Environment check passed");
output(`\nTest Mode: ${env.TEST_MODE === "true" ? "ENABLED" : "DISABLED"}`);
output(`Channel ID: ${env.TEST_CHANNEL_IDS?.split(",")[0]?.trim()}`);

// Now run the actual test
output("\n" + "=".repeat(60));
output("Executing test...");
output("=".repeat(60) + "\n");

// Import and execute the test using top-level await
try {
  await import("./direct-test.js");
  output("\nTest script executed");
} catch (error) {
  output(`\n✗ Error executing test: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// Keep process alive
setTimeout(() => {
  output("\n" + "=".repeat(60));
  output("Test execution monitoring complete");
  output(`Check ${OUTPUT_FILE} and direct-test-results.txt for results`);
  output("=".repeat(60));
}, 150000); // 2.5 minutes
