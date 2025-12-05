/**
 * ACTUAL TEST - This will send a message and verify the bot responds
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";

const WEBHOOK = process.env.TEST_WEBHOOK_URL;
const CHANNEL = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

console.log("=".repeat(60));
console.log("ACTUAL BOT TEST");
console.log("=".repeat(60));
console.log(`Webhook: ${WEBHOOK ? "✓" : "✗"}`);
console.log(`Channel: ${CHANNEL || "✗"}`);
console.log(`Token: ${TOKEN ? "✓" : "✗"}`);
console.log(`Client ID: ${CLIENT_ID || "✗"}`);
console.log(`Test Mode: ${process.env.TEST_MODE || "NOT SET"}`);
console.log("");

if (!WEBHOOK || !CHANNEL || !TOKEN || !CLIENT_ID) {
  console.error("ERROR: Missing required environment variables!");
  process.exit(1);
}

// Types
interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; bot?: boolean; username: string };
  timestamp: string;
}

// Result collector
const results: string[] = [
  "=".repeat(60),
  "ACTUAL BOT TEST RESULTS",
  "=".repeat(60),
  `Started: ${new Date().toISOString()}`,
  "",
];

function addResults(...lines: string[]): void {
  results.push(...lines);
}

function isValidBotResponse(msg: DiscordMessage, afterMsgId: string): boolean {
  const isBot = msg.author.bot && msg.author.id === CLIENT_ID;
  const isAfter = BigInt(msg.id) > BigInt(afterMsgId);
  if (!isBot || !isAfter) return false;
  // Skip status messages
  if (msg.content.includes("🎨 Generating")) return false;
  if (msg.content.includes("⏳") && msg.content.includes("Please wait")) return false;
  return true;
}

async function sendTestMessage(): Promise<string> {
  console.log("Step 1: Sending test message...");
  addResults("Step 1: Sending test message via webhook");

  const webhookRes = await fetch(`${WEBHOOK}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "🧪 Hello! This is a test message. Please respond!",
      username: "Test Bot",
    }),
  });

  if (!webhookRes.ok) {
    const errorText = await webhookRes.text();
    throw new Error(`Webhook failed: ${webhookRes.status} - ${errorText}`);
  }

  const msgData = (await webhookRes.json()) as { id: string };
  console.log(`✓ Message sent! ID: ${msgData.id}`);
  addResults(
    `✓ Message sent successfully`,
    `  Message ID: ${msgData.id}`,
    `  Timestamp: ${new Date().toISOString()}`
  );

  return msgData.id;
}

async function fetchMessages(afterMsgId: string): Promise<DiscordMessage[]> {
  const msgsRes = await fetch(
    `https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=10&after=${afterMsgId}`,
    { headers: { Authorization: `Bot ${TOKEN}` } }
  );

  if (!msgsRes.ok) {
    const errorText = await msgsRes.text();
    addResults(`  ✗ API request failed: ${msgsRes.status} - ${errorText}`);
    throw new Error(`API failed: ${msgsRes.status}`);
  }

  return (await msgsRes.json()) as DiscordMessage[];
}

function logSuccessResult(botMsg: DiscordMessage, elapsed: number): void {
  console.log(`\n✓✓✓ SUCCESS! Bot responded after ${elapsed} seconds!`);
  console.log(`Response: ${botMsg.content.substring(0, 200)}...`);

  addResults(
    "",
    "=".repeat(60),
    "✓✓✓ TEST PASSED - BOT RESPONDED!",
    "=".repeat(60),
    `Response received after: ${elapsed} seconds`,
    `Bot username: ${botMsg.author.username}`,
    `Message ID: ${botMsg.id}`,
    `Timestamp: ${botMsg.timestamp}`,
    "",
    "Response content:",
    botMsg.content,
    "=".repeat(60)
  );
}

function logFailureResult(waitTime: number, attempts: number): void {
  console.log(`\n✗✗✗ FAILED! No response from bot after ${waitTime} seconds`);

  addResults(
    "",
    "=".repeat(60),
    "✗✗✗ TEST FAILED - NO BOT RESPONSE",
    "=".repeat(60),
    `Waited: ${waitTime} seconds`,
    `Attempts: ${attempts}`,
    "",
    "Possible reasons:",
    "1. Bot is not running",
    "2. TEST_MODE is not set to 'true'",
    "3. Channel ID doesn't match TEST_CHANNEL_IDS",
    "4. Bot doesn't have read/send permissions",
    "5. Bot is rate limited",
    "6. AI service (Ollama) is unavailable",
    "7. Bot is sleeping and needs to be woken",
    "=".repeat(60)
  );
}

async function checkForBotResponse(
  msgId: string,
  attempts: number,
  elapsed: number
): Promise<DiscordMessage | null> {
  const messages = await fetchMessages(msgId);
  addResults(`  Attempt ${attempts} (${elapsed}s): Found ${messages.length} messages`);

  const botMsg = messages.find((m) => isValidBotResponse(m, msgId));
  if (botMsg) return botMsg;

  if (messages.length > 0) {
    addResults(`  Found ${messages.length} messages, but none from bot ${CLIENT_ID}`);
    for (const msg of messages.slice(0, 3)) {
      const type = msg.author.bot ? "BOT" : "USER";
      addResults(
        `    - ${msg.author.username} (${type}, ID: ${msg.author.id}): ${msg.content.substring(0, 60)}`
      );
    }
  }
  return null;
}

async function waitForBotResponse(msgId: string): Promise<void> {
  console.log("\nStep 3: Checking for bot response...");
  addResults(
    "",
    "Step 3: Checking for bot response",
    `  Looking for messages from bot ID: ${CLIENT_ID}`,
    `  In channel: ${CHANNEL}`,
    `  After message ID: ${msgId}`
  );

  const maxWait = 120000; // 2 minutes
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < maxWait) {
    attempts++;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    try {
      const botMsg = await checkForBotResponse(msgId, attempts, elapsed);
      if (botMsg) {
        logSuccessResult(botMsg, elapsed);
        return;
      }

      await new Promise((r) => setTimeout(r, 5000));
      if (elapsed % 15 === 0 && elapsed > 0) {
        console.log(`  Still waiting... (${elapsed}s elapsed)`);
        addResults(`  Still waiting... (${elapsed}s elapsed)`);
      }
    } catch (error) {
      addResults(
        `  ✗ Error checking messages: ${error instanceof Error ? error.message : String(error)}`
      );
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  logFailureResult(Math.round((Date.now() - startTime) / 1000), attempts);
}

async function test(): Promise<void> {
  try {
    const msgId = await sendTestMessage();

    console.log("\nStep 2: Waiting 5 seconds for Discord API...");
    addResults("", "Step 2: Waiting for Discord API consistency");
    await new Promise((r) => setTimeout(r, 5000));

    await waitForBotResponse(msgId);
  } catch (error) {
    console.error("\n✗ ERROR:", error);
    addResults(
      "",
      "=".repeat(60),
      "✗ TEST ERROR",
      "=".repeat(60),
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    if (error instanceof Error && error.stack) {
      addResults(`Stack: ${error.stack}`);
    }
    addResults("=".repeat(60));
  } finally {
    addResults("", `Completed: ${new Date().toISOString()}`, "=".repeat(60));

    const output = results.join("\n");
    writeFileSync("actual-test-results.txt", output, "utf-8");
    console.log("\n" + output);
    console.log("\nResults written to: actual-test-results.txt");
  }
}

try {
  await test();
} catch (err) {
  console.error("Fatal:", err);
  process.exit(1);
}
