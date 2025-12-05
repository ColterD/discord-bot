/**
 * Execute test NOW - send message via webhook and wait for bot response
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";

const WEBHOOK_URL = process.env.TEST_WEBHOOK_URL;
const CHANNEL_ID = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const BOT_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

console.log("=".repeat(60));
console.log("EXECUTING TEST NOW");
console.log("=".repeat(60));
console.log(`Webhook: ${WEBHOOK_URL ? "✓ SET" : "✗ NOT SET"}`);
console.log(`Channel: ${CHANNEL_ID || "✗ NOT SET"}`);
console.log(`Token: ${BOT_TOKEN ? "✓ SET" : "✗ NOT SET"}`);
console.log(`Client ID: ${BOT_CLIENT_ID || "✗ NOT SET"}`);
console.log(`Test Mode: ${process.env.TEST_MODE || "NOT SET"}`);
console.log("");

if (!WEBHOOK_URL || !CHANNEL_ID || !BOT_TOKEN || !BOT_CLIENT_ID) {
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
  "TEST EXECUTION RESULTS",
  "=".repeat(60),
  `Started: ${new Date().toISOString()}`,
  "",
];

function addResults(...lines: string[]): void {
  results.push(...lines);
}

function isValidBotResponse(msg: DiscordMessage, afterMsgId: string): boolean {
  const isBot = msg.author.bot && msg.author.id === BOT_CLIENT_ID;
  const isAfter = BigInt(msg.id) > BigInt(afterMsgId);
  if (!isBot || !isAfter) return false;
  if (msg.content.includes("🎨 Generating")) return false;
  if (msg.content.includes("⏳") && msg.content.includes("Please wait")) return false;
  return true;
}

async function sendTestMessage(): Promise<string> {
  console.log("Step 1: Sending test message via webhook...");
  addResults("Step 1: Sending test message via webhook");

  const webhookResponse = await fetch(`${WEBHOOK_URL}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "🧪 Hello! This is a test message. Please respond if you can see this!",
      username: "Test Bot",
    }),
  });

  if (!webhookResponse.ok) {
    const errorText = await webhookResponse.text();
    throw new Error(`Webhook failed: ${webhookResponse.status} - ${errorText}`);
  }

  const messageData = (await webhookResponse.json()) as { id: string };
  console.log(`✓ Message sent! ID: ${messageData.id}`);
  addResults(
    `✓ Message sent successfully`,
    `  Message ID: ${messageData.id}`,
    `  Timestamp: ${new Date().toISOString()}`
  );

  return messageData.id;
}

async function fetchMessages(afterMsgId: string): Promise<DiscordMessage[]> {
  const msgsRes = await fetch(
    `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=10&after=${afterMsgId}`,
    { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
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

function logFailureResult(waitTime: number, checkCount: number): void {
  console.log(`\n✗✗✗ FAILED! No response from bot after ${waitTime} seconds`);

  addResults(
    "",
    "=".repeat(60),
    "✗✗✗ TEST FAILED - NO BOT RESPONSE",
    "=".repeat(60),
    `Waited: ${waitTime} seconds`,
    `Checks performed: ${checkCount}`,
    "",
    "Possible reasons:",
    "1. Bot is not running (check: npm run dev)",
    "2. TEST_MODE is not set to 'true' in .env",
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
  checkCount: number,
  elapsed: number
): Promise<DiscordMessage | null> {
  const messages = await fetchMessages(msgId);
  addResults(`  Check ${checkCount} (${elapsed}s): Found ${messages.length} messages`);

  const botMsg = messages.find((m) => isValidBotResponse(m, msgId));
  if (botMsg) return botMsg;

  if (messages.length > 0) {
    addResults(`  Found ${messages.length} messages, but none from bot ${BOT_CLIENT_ID}`);
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
  console.log("\nStep 3: Checking for bot response (will check for 2 minutes)...");
  addResults(
    "",
    "Step 3: Checking for bot response",
    `  Looking for messages from bot ID: ${BOT_CLIENT_ID}`,
    `  In channel: ${CHANNEL_ID}`,
    `  After message ID: ${msgId}`
  );

  const maxWaitMs = 120000; // 2 minutes
  const startTime = Date.now();
  let checkCount = 0;

  while (Date.now() - startTime < maxWaitMs) {
    checkCount++;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    try {
      const botMsg = await checkForBotResponse(msgId, checkCount, elapsed);
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

  logFailureResult(Math.round((Date.now() - startTime) / 1000), checkCount);
}

async function executeTest(): Promise<void> {
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
    writeFileSync("test-execution-results.txt", output, "utf-8");
    console.log("\n" + output);
    console.log("\nResults written to: test-execution-results.txt");
  }
}

try {
  await executeTest();
} catch (err) {
  console.error("Fatal error:", err);
  process.exit(1);
}
