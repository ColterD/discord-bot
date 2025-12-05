// Test that writes diagnostic info immediately
require("dotenv").config();
const fs = require("node:fs");

// Write diagnostic info immediately
const diag = {
  timestamp: new Date().toISOString(),
  env: {
    TEST_WEBHOOK_URL: process.env.TEST_WEBHOOK_URL ? "SET" : "NOT SET",
    TEST_CHANNEL_IDS: process.env.TEST_CHANNEL_IDS || "NOT SET",
    DISCORD_TOKEN: process.env.DISCORD_TOKEN ? "SET" : "NOT SET",
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || "NOT SET",
    TEST_MODE: process.env.TEST_MODE || "NOT SET",
  },
};

fs.writeFileSync("test-diagnostic.json", JSON.stringify(diag, null, 2));
console.log("Diagnostic written");

const WEBHOOK = process.env.TEST_WEBHOOK_URL;
const CHANNEL = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!WEBHOOK || !CHANNEL || !TOKEN || !CLIENT_ID) {
  const error =
    "MISSING ENV VARS: " +
    JSON.stringify({
      WEBHOOK: !!WEBHOOK,
      CHANNEL: !!CHANNEL,
      TOKEN: !!TOKEN,
      CLIENT_ID: !!CLIENT_ID,
    });
  fs.writeFileSync("test-error.txt", error);
  console.error(error);
  process.exit(1);
}

const results = [
  "=== TEST STARTED ===",
  `Time: ${new Date().toISOString()}`,
  `Webhook: ${WEBHOOK.substring(0, 30)}...`,
  `Channel: ${CHANNEL}`,
  `Client ID: ${CLIENT_ID}`,
];
fs.writeFileSync("test-results.txt", results.join("\n"), "utf-8");

/** Appends entries to results and optionally writes to file */
function appendResults(...entries) {
  results.push(...entries);
}

async function runTest() {
  try {
    appendResults("\nSending webhook message...");
    fs.appendFileSync("test-results.txt", "\nSending webhook message...", "utf-8");

    const res = await fetch(`${WEBHOOK}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "🧪 Test - Please respond!", username: "Test" }),
    });

    if (!res.ok) {
      throw new Error(`Webhook: ${res.status}`);
    }

    const data = await res.json();
    const msgId = data.id;
    appendResults(`Message sent: ${msgId}`);
    fs.appendFileSync("test-results.txt", `\nMessage sent: ${msgId}`, "utf-8");

    await new Promise((r) => setTimeout(r, 5000));

    appendResults("Checking for bot response...");
    fs.appendFileSync("test-results.txt", "\nChecking for bot response...", "utf-8");

    const maxWait = 120000;
    const start = Date.now();
    let found = false;

    while (Date.now() - start < maxWait && !found) {
      const elapsed = Math.round((Date.now() - start) / 1000);

      const msgsRes = await fetch(
        `https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=10&after=${msgId}`,
        { headers: { Authorization: `Bot ${TOKEN}` } }
      );

      if (msgsRes.ok) {
        const messages = await msgsRes.json();
        const botMsg = messages.find(
          (m) =>
            m.author.bot &&
            m.author.id === CLIENT_ID &&
            BigInt(m.id) > BigInt(msgId) &&
            !m.content.includes("🎨 Generating") &&
            !(m.content.includes("⏳") && m.content.includes("Please wait"))
        );

        if (botMsg) {
          found = true;
          appendResults(
            `\n✓ SUCCESS! Bot responded after ${elapsed}s`,
            `Response: ${botMsg.content.substring(0, 200)}`
          );
          fs.appendFileSync(
            "test-results.txt",
            `\n✓ SUCCESS! Bot responded after ${elapsed}s\nResponse: ${botMsg.content.substring(0, 200)}`,
            "utf-8"
          );
        } else {
          fs.appendFileSync(
            "test-results.txt",
            `\nCheck ${elapsed}s: Found ${messages.length} messages, no bot response yet`,
            "utf-8"
          );
        }
      }

      if (!found) {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    if (!found) {
      appendResults(`\n✗ FAILED - No response after ${Math.round((Date.now() - start) / 1000)}s`);
      fs.appendFileSync(
        "test-results.txt",
        `\n✗ FAILED - No response after ${Math.round((Date.now() - start) / 1000)}s`,
        "utf-8"
      );
    }
  } catch (error) {
    const errMsg = `ERROR: ${error.message}`;
    appendResults(errMsg);
    fs.appendFileSync("test-results.txt", `\n${errMsg}`, "utf-8");
  } finally {
    appendResults(`\nCompleted: ${new Date().toISOString()}`);
    fs.writeFileSync("test-results.txt", results.join("\n"), "utf-8");
  }
}

// Run the test
await runTest();
