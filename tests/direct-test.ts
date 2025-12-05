/**
 * Direct webhook test for Discord bot
 */

import "dotenv/config";

const WEBHOOK_URL = process.env.TEST_WEBHOOK_URL;
const BOT_ID = process.env.BOT_ID ?? "1373056702071390303";

interface Message {
  id: string;
  content: string;
  author: { id: string; bot?: boolean };
  timestamp: string;
}

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
}

// Helper functions to reduce complexity
const results: TestResult[] = [];

function addResults(...items: TestResult[]): void {
  results.push(...items);
}

async function sendTestMessage(content: string): Promise<Message | null> {
  if (!WEBHOOK_URL) return null;

  const response = await fetch(`${WEBHOOK_URL}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    console.error("Failed to send:", response.status);
    return null;
  }

  return response.json() as Promise<Message>;
}

function extractChannelId(): string | null {
  if (!WEBHOOK_URL) return null;
  const match = WEBHOOK_URL.match(/channels\/(\d+)/);
  return match?.[1] ?? null;
}

async function fetchMessages(channelId: string): Promise<Message[]> {
  const botToken = process.env.DISCORD_TOKEN;
  if (!botToken) return [];

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages?limit=10`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );

  if (!response.ok) return [];
  return response.json() as Promise<Message[]>;
}

function isValidBotResponse(msg: Message): boolean {
  return msg.author.id === BOT_ID && msg.author.bot === true;
}

function isGeneratingMessage(msg: Message): boolean {
  return msg.content.includes("Generating") || msg.content.includes("...");
}

function logSuccessResult(testName: string, msg: Message): void {
  console.log(`✅ ${testName}: Bot responded`);
  console.log(`   Response: ${msg.content.substring(0, 100)}...`);
  addResults({ test: testName, passed: true, message: msg.content.substring(0, 100) });
}

function logFailureResult(testName: string, reason: string): void {
  console.log(`❌ ${testName}: ${reason}`);
  addResults({ test: testName, passed: false, message: reason });
}

async function checkForBotResponse(
  channelId: string,
  afterTimestamp: string,
  testName: string
): Promise<boolean> {
  const messages = await fetchMessages(channelId);

  for (const msg of messages) {
    if (new Date(msg.timestamp) <= new Date(afterTimestamp)) continue;
    if (!isValidBotResponse(msg)) continue;
    if (isGeneratingMessage(msg)) continue;

    logSuccessResult(testName, msg);
    return true;
  }

  return false;
}

async function waitForBotResponse(
  channelId: string,
  afterTimestamp: string,
  testName: string,
  maxAttempts = 30
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const found = await checkForBotResponse(channelId, afterTimestamp, testName);
    if (found) return;

    await new Promise((r) => setTimeout(r, 2000));
  }

  logFailureResult(testName, "No response after timeout");
}

async function runTest(): Promise<void> {
  console.log("\n🧪 Direct Webhook Test\n");

  if (!WEBHOOK_URL) {
    console.log("❌ TEST_WEBHOOK_URL not set");
    addResults({ test: "config", passed: false, message: "Missing webhook URL" });
    return;
  }

  addResults({ test: "config", passed: true, message: "Webhook URL configured" });

  const channelId = extractChannelId();
  if (!channelId) {
    logFailureResult("channel", "Could not extract channel ID");
    return;
  }

  const testMessage = `Test ${Date.now()}: Hello bot!`;
  const sent = await sendTestMessage(testMessage);

  if (!sent) {
    logFailureResult("send", "Failed to send test message");
    return;
  }

  console.log(`📤 Sent: ${testMessage}`);
  addResults({ test: "send", passed: true, message: "Message sent" });

  await waitForBotResponse(channelId, sent.timestamp, "response");
}

function printSummary(): void {
  console.log("\n" + "=".repeat(50));
  console.log("📊 Test Summary");
  console.log("=".repeat(50));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${result.test}: ${result.message}`);
  }

  console.log("=".repeat(50));
  console.log(`Total: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

// Top-level await
try {
  await runTest();
} catch (error) {
  console.error("Test failed:", error);
  addResults({ test: "execution", passed: false, message: String(error) });
}

printSummary();
