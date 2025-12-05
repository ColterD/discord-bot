/**
 * FINAL VERIFICATION TEST
 * This test sends a message and waits for bot response, writing all results to a file
 */

import "dotenv/config";
import { appendFileSync } from "node:fs";

const LOG_FILE = "final-test-log.txt";

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(LOG_FILE, line, "utf-8");
  console.log(msg);
}

log("=".repeat(60));
log("FINAL VERIFICATION TEST");
log("=".repeat(60));

const WEBHOOK = process.env.TEST_WEBHOOK_URL;
const CHANNEL = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

log(`Webhook: ${WEBHOOK ? "SET" : "NOT SET"}`);
log(`Channel: ${CHANNEL || "NOT SET"}`);
log(`Token: ${TOKEN ? "SET" : "NOT SET"}`);
log(`Client ID: ${CLIENT_ID || "NOT SET"}`);
log(`Test Mode: ${process.env.TEST_MODE || "NOT SET"}`);

if (!WEBHOOK || !CHANNEL || !TOKEN || !CLIENT_ID) {
  log("ERROR: Missing environment variables!");
  process.exit(1);
}

// Types
interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; bot?: boolean; username: string };
}

function isValidBotResponse(msg: DiscordMessage, afterMsgId: string): boolean {
  const isBot = msg.author.bot && msg.author.id === CLIENT_ID;
  const isAfter = BigInt(msg.id) > BigInt(afterMsgId);
  if (!isBot || !isAfter) return false;
  if (msg.content.includes("🎨 Generating")) return false;
  if (msg.content.includes("⏳") && msg.content.includes("Please wait")) return false;
  return true;
}

async function sendTestMessage(): Promise<string> {
  log("\nStep 1: Sending test message via webhook...");
  const webhookRes = await fetch(`${WEBHOOK}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: "🧪 Final verification test - Please respond!",
      username: "Test Bot",
    }),
  });

  if (!webhookRes.ok) {
    const errorText = await webhookRes.text();
    log(`ERROR: Webhook failed: ${webhookRes.status} - ${errorText}`);
    throw new Error(`Webhook failed: ${webhookRes.status}`);
  }

  const msgData = (await webhookRes.json()) as { id: string };
  log(`✓ Message sent! ID: ${msgData.id}`);
  return msgData.id;
}

async function fetchMessages(afterMsgId: string): Promise<DiscordMessage[]> {
  const msgsRes = await fetch(
    `https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=10&after=${afterMsgId}`,
    { headers: { Authorization: `Bot ${TOKEN}` } }
  );

  if (!msgsRes.ok) {
    const errorText = await msgsRes.text();
    log(`ERROR: API failed: ${msgsRes.status} - ${errorText}`);
    throw new Error(`API failed: ${msgsRes.status}`);
  }

  return (await msgsRes.json()) as DiscordMessage[];
}

function logSuccessResult(botMsg: DiscordMessage, elapsed: number): void {
  log("\n" + "=".repeat(60));
  log("✓✓✓ SUCCESS! BOT RESPONDED!");
  log("=".repeat(60));
  log(`Response received after: ${elapsed} seconds`);
  log(`Bot username: ${botMsg.author.username}`);
  log(`Message ID: ${botMsg.id}`);
  log(`Response content: ${botMsg.content}`);
  log("=".repeat(60));
}

function logFailureResult(waitTime: number, attempts: number): void {
  log("\n" + "=".repeat(60));
  log("✗✗✗ FAILED - NO BOT RESPONSE");
  log("=".repeat(60));
  log(`Waited: ${waitTime} seconds`);
  log(`Attempts: ${attempts}`);
  log("=".repeat(60));
}

async function checkForBotResponse(
  msgId: string,
  attempts: number,
  elapsed: number
): Promise<DiscordMessage | null> {
  const messages = await fetchMessages(msgId);
  log(`  Attempt ${attempts} (${elapsed}s): Found ${messages.length} messages`);

  const botMsg = messages.find((m) => isValidBotResponse(m, msgId));
  if (botMsg) return botMsg;

  if (messages.length > 0) {
    log(`  Found ${messages.length} messages, but none from bot ${CLIENT_ID}`);
    for (const msg of messages.slice(0, 2)) {
      const type = msg.author.bot ? "BOT" : "USER";
      log(`    - ${msg.author.username} (${type}, ID: ${msg.author.id})`);
    }
  }
  return null;
}

async function waitForBotResponse(msgId: string): Promise<void> {
  log("\nStep 3: Checking for bot response (will check for 2 minutes)...");
  const maxWait = 120000;
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
        log(`  Still waiting... (${elapsed}s elapsed)`);
      }
    } catch (error) {
      log(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  logFailureResult(Math.round((Date.now() - startTime) / 1000), attempts);
}

async function runTest(): Promise<void> {
  try {
    const msgId = await sendTestMessage();

    log("\nStep 2: Waiting 5 seconds for Discord API...");
    await new Promise((r) => setTimeout(r, 5000));

    await waitForBotResponse(msgId);
  } catch (error) {
    log(`\nFATAL ERROR: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      log(`Stack: ${error.stack}`);
    }
  } finally {
    log(`\nTest completed at: ${new Date().toISOString()}`);
    log("=".repeat(60));
  }
}

await runTest();
