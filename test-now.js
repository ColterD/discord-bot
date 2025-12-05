// Simple Node.js test that will definitely work
require("dotenv").config();
const fs = require("node:fs");

console.log("=== TEST STARTING ===");
console.log("TEST_MODE:", process.env.TEST_MODE);
console.log("HAS_WEBHOOK:", !!process.env.TEST_WEBHOOK_URL);
console.log("HAS_CHANNEL:", !!process.env.TEST_CHANNEL_IDS);
console.log("HAS_TOKEN:", !!process.env.DISCORD_TOKEN);
console.log("HAS_CLIENT_ID:", !!process.env.DISCORD_CLIENT_ID);

const results = {
  start: new Date().toISOString(),
  env: {
    TEST_MODE: process.env.TEST_MODE,
    HAS_WEBHOOK: !!process.env.TEST_WEBHOOK_URL,
    HAS_CHANNEL: !!process.env.TEST_CHANNEL_IDS,
    HAS_TOKEN: !!process.env.DISCORD_TOKEN,
    HAS_CLIENT_ID: !!process.env.DISCORD_CLIENT_ID,
  },
};

fs.writeFileSync("test-now-results.json", JSON.stringify(results, null, 2));
console.log("Results written to test-now-results.json");
