// Simple Node.js test using webhook
import "dotenv/config";
import fs from "node:fs";

const WEBHOOK = process.env.TEST_WEBHOOK_URL;
const CHANNEL = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

console.log("=== WEBHOOK TEST ===");
console.log("Webhook:", WEBHOOK ? "SET" : "NOT SET");
console.log("Channel:", CHANNEL || "NOT SET");
console.log("Token:", TOKEN ? "SET" : "NOT SET");
console.log("Client ID:", CLIENT_ID || "NOT SET");

if (!WEBHOOK || !CHANNEL || !TOKEN || !CLIENT_ID) {
  console.error("MISSING ENV VARS!");
  process.exit(1);
}

const log = ["=== WEBHOOK TEST RESULTS ===", `Started: ${new Date().toISOString()}`];

/** Appends entries to log array */
function appendLog(...entries) {
  log.push(...entries);
}

/** Polls for bot response */
async function pollForResponse(msgId, maxWait) {
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < maxWait) {
    attempts++;
    const elapsed = Math.round((Date.now() - start) / 1000);

    try {
      const msgsRes = await fetch(
        `https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=10&after=${msgId}`,
        { headers: { Authorization: `Bot ${TOKEN}` } }
      );

      if (!msgsRes.ok) {
        throw new Error(`API failed: ${msgsRes.status}`);
      }

      const messages = await msgsRes.json();
      appendLog(`  Check ${attempts} (${elapsed}s): Found ${messages.length} messages`);

      const botMsg = messages.find((m) => {
        const isBot = m.author.bot && m.author.id === CLIENT_ID;
        const isAfter = BigInt(m.id) > BigInt(msgId);
        if (!isBot || !isAfter) return false;
        if (m.content.includes("🎨 Generating")) return false;
        if (m.content.includes("⏳") && m.content.includes("Please wait")) return false;
        return true;
      });

      if (botMsg) {
        appendLog(
          "\n✓✓✓ SUCCESS! BOT RESPONDED!",
          `Response after: ${elapsed} seconds`,
          `Bot: ${botMsg.author.username}`,
          `Content: ${botMsg.content}`
        );
        console.log(`\n✓✓✓ SUCCESS! Bot responded after ${elapsed}s`);
        console.log(`Response: ${botMsg.content.substring(0, 200)}`);
        return true;
      }

      if (messages.length > 0) {
        appendLog(`  Found ${messages.length} messages, but none from bot ${CLIENT_ID}`);
      }

      await new Promise((r) => setTimeout(r, 5000));
      if (elapsed % 15 === 0 && elapsed > 0) {
        console.log(`  Still waiting... (${elapsed}s)`);
        appendLog(`  Still waiting... (${elapsed}s)`);
      }
    } catch (error) {
      appendLog(`  Error: ${error.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  appendLog(
    "\n✗✗✗ FAILED - NO BOT RESPONSE",
    `Waited: ${Math.round((Date.now() - start) / 1000)} seconds`
  );
  console.log(`\n✗ FAILED - No response after ${Math.round((Date.now() - start) / 1000)}s`);
  return false;
}

async function test() {
  try {
    appendLog("\nStep 1: Sending message via webhook...");
    console.log("Sending message...");

    const res = await fetch(`${WEBHOOK}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content:
          "I need three things: 1) Generate an image of a futuristic city at night, 2) Tell me what the capital of Japan is, and 3) Search the web for the latest news about SpaceX",
        username: "Test Bot",
      }),
    });

    if (!res.ok) {
      throw new Error(`Webhook failed: ${res.status}`);
    }

    const data = await res.json();
    const msgId = data.id;
    appendLog(`✓ Message sent! ID: ${msgId}`);
    console.log(`✓ Message sent! ID: ${msgId}`);

    appendLog("\nStep 2: Waiting 5 seconds...");
    await new Promise((r) => setTimeout(r, 5000));

    appendLog("\nStep 3: Checking for bot response...");
    console.log("Checking for bot response...");

    await pollForResponse(msgId, 120000);
  } catch (error) {
    appendLog(`\nERROR: ${error.message}`);
    console.error("ERROR:", error);
  } finally {
    appendLog(`\nCompleted: ${new Date().toISOString()}`);
    const output = log.join("\n");
    fs.writeFileSync("webhook-test-results.txt", output, "utf-8");
    console.log("\n" + output);
    console.log("\nResults written to: webhook-test-results.txt");
  }
}

// Top-level await
await test().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

// Keep process alive
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
