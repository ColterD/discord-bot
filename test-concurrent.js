// Test concurrent prompts to the bot
import "dotenv/config";
import fs from "node:fs";

const WEBHOOK = process.env.TEST_WEBHOOK_URL;
const CHANNEL = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

console.log("=== CONCURRENT PROMPT TEST ===");
console.log("Webhook:", WEBHOOK ? "SET" : "NOT SET");
console.log("Channel:", CHANNEL || "NOT SET");
console.log("Token:", TOKEN ? "SET" : "NOT SET");
console.log("Client ID:", CLIENT_ID || "NOT SET");

if (!WEBHOOK || !CHANNEL || !TOKEN || !CLIENT_ID) {
  console.error("MISSING ENV VARS!");
  process.exit(1);
}

const log = ["=== CONCURRENT PROMPT TEST RESULTS ===", `Started: ${new Date().toISOString()}`];

/** Appends entries to log array */
function appendLog(...entries) {
  log.push(...entries);
}

// Two complex prompts to test concurrency
const prompts = [
  {
    id: "PROMPT_A",
    message:
      "Create a picture of a majestic dragon flying over a fantasy castle, and explain what causes the northern lights. Also calculate the square root of 2048.",
  },
  {
    id: "PROMPT_B",
    message:
      "Generate an image of a cyberpunk cat with neon glasses, tell me what the deepest part of the ocean is called, and search the web for recent news about AI.",
  },
];

async function sendPrompt(prompt) {
  const res = await fetch(`${WEBHOOK}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: prompt.message,
      username: `Test ${prompt.id}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Webhook failed for ${prompt.id}: ${res.status}`);
  }

  const data = await res.json();
  return { ...prompt, msgId: data.id, sentAt: Date.now() };
}

async function waitForResponse(sentPrompt) {
  const maxWait = 180000; // 3 minutes for complex prompts
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      const msgsRes = await fetch(
        `https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=15&after=${sentPrompt.msgId}`,
        { headers: { Authorization: `Bot ${TOKEN}` } }
      );

      if (!msgsRes.ok) {
        throw new Error(`API failed: ${msgsRes.status}`);
      }

      const messages = await msgsRes.json();

      const botMsg = messages.find((m) => {
        const isBot = m.author.bot && m.author.id === CLIENT_ID;
        const isAfter = BigInt(m.id) > BigInt(sentPrompt.msgId);
        if (!isBot || !isAfter) return false;
        // Skip "generating" messages
        if (m.content.includes("🎨 Generating")) return false;
        if (m.content.includes("⏳") && m.content.includes("Please wait")) return false;
        return true;
      });

      if (botMsg) {
        const responseTime = (Date.now() - sentPrompt.sentAt) / 1000;
        return {
          ...sentPrompt,
          success: true,
          responseTime,
          response: botMsg.content,
          hasImage: botMsg.attachments?.length > 0,
        };
      }

      await new Promise((r) => setTimeout(r, 5000));
    } catch (error) {
      appendLog(`  [${sentPrompt.id}] Error: ${error.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return {
    ...sentPrompt,
    success: false,
    error: "Timeout waiting for response",
  };
}

/** Logs individual result details */
function logResultDetails(result) {
  appendLog(`\n[${result.id}]`);
  console.log(`\n[${result.id}]`);

  if (result.success) {
    appendLog(
      `  ✓ SUCCESS - Response in ${result.responseTime.toFixed(1)}s`,
      `  Has Image: ${result.hasImage ? "YES" : "NO"}`,
      `  Response Preview: ${result.response.substring(0, 300)}...`
    );
    console.log(
      `  ✓ Response in ${result.responseTime.toFixed(1)}s | Image: ${result.hasImage ? "YES" : "NO"}`
    );
    console.log(`  Preview: ${result.response.substring(0, 200)}...`);
  } else {
    appendLog(`  ✗ FAILED: ${result.error}`);
    console.log(`  ✗ FAILED: ${result.error}`);
  }
}

/** Logs test summary */
function logSummary(results) {
  const successCount = results.filter((r) => r.success).length;
  appendLog(
    `\n--- SUMMARY ---`,
    `Total Prompts: ${results.length}`,
    `Successful: ${successCount}`,
    `Failed: ${results.length - successCount}`
  );

  if (successCount === results.length) {
    appendLog(`\n✓✓✓ ALL CONCURRENT PROMPTS HANDLED SUCCESSFULLY!`);
    console.log(`\n✓✓✓ ALL ${successCount} PROMPTS SUCCEEDED!`);
  } else {
    appendLog(`\n✗ Some prompts failed`);
    console.log(`\n✗ ${results.length - successCount} prompts failed`);
  }
}

async function test() {
  try {
    appendLog("\n--- Sending concurrent prompts ---");
    console.log("Sending both prompts simultaneously...");

    // Send both prompts at the same time
    const sentPrompts = await Promise.all(prompts.map(sendPrompt));

    for (const p of sentPrompts) {
      appendLog(`✓ ${p.id} sent! Message ID: ${p.msgId}`);
      console.log(`✓ ${p.id} sent! Message ID: ${p.msgId}`);
    }

    appendLog("\n--- Waiting for responses ---");
    console.log("Waiting for bot responses (up to 3 minutes each)...");

    // Wait for responses concurrently
    const results = await Promise.all(sentPrompts.map(waitForResponse));

    appendLog("\n--- RESULTS ---");
    console.log("\n=== RESULTS ===");

    for (const result of results) {
      logResultDetails(result);
    }

    logSummary(results);
  } catch (error) {
    appendLog(`\nERROR: ${error.message}`);
    console.error("ERROR:", error);
  } finally {
    appendLog(`\nCompleted: ${new Date().toISOString()}`);
    const output = log.join("\n");
    fs.writeFileSync("concurrent-test-results.txt", output, "utf-8");
    console.log("\nResults written to: concurrent-test-results.txt");
  }
}

// Top-level await
await test().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
