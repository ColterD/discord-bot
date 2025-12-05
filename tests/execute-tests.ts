/**
 * Execute test suite and write results to file
 */

import "dotenv/config";
import { writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const RESULTS_FILE = join(process.cwd(), "test-execution-results.txt");

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  appendFileSync(RESULTS_FILE, logMessage, "utf-8");
  console.log(message);
}

// Clear results file
writeFileSync(
  RESULTS_FILE,
  `Test Execution Started: ${new Date().toISOString()}\n${"=".repeat(80)}\n\n`,
  "utf-8"
);

log("Starting Discord Bot Test Suite");
log("=".repeat(80));

// Import and run the actual test suite
async function _runTests() {
  try {
    // Import the test script
    const _testModule = await import("./send-test-message.js");

    // The test script uses top-level await, so it should run automatically
    // But we'll wait a bit to let it start
    log("Test module imported, waiting for execution...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } catch (error) {
    log(`ERROR: Failed to run tests: ${error instanceof Error ? error.message : String(error)}`);
    log(`Stack: ${error instanceof Error ? error.stack : "N/A"}`);
    process.exit(1);
  }
}

// Also run the test script directly
log("Executing test script...");
log("");

// Import the test script - it has top-level await so it will run
try {
  await import("./send-test-message.js");
} catch (error) {
  log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// Keep process alive for a while to let tests run
setTimeout(() => {
  log("\n" + "=".repeat(80));
  log("Test execution monitoring complete");
  log(`Results written to: ${RESULTS_FILE}`);
}, 60000); // Wait 1 minute for initial tests
