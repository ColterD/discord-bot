/**
 * Quick Test Script
 * Sends a single test message and waits for bot response
 * Usage: npx tsx tests/quick-test.ts
 */

import "dotenv/config";

const TEST_MESSAGE = "Hello! This is a test message. Can you respond?";
const WEBHOOK_URL = process.env.TEST_WEBHOOK_URL;
const CHANNEL_ID = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const BOT_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!WEBHOOK_URL || !CHANNEL_ID || !BOT_TOKEN || !BOT_CLIENT_ID) {
  console.error("Missing required environment variables!");
  console.error("Required: TEST_WEBHOOK_URL, TEST_CHANNEL_IDS, DISCORD_TOKEN, DISCORD_CLIENT_ID");
  process.exit(1);
}

// Type assertions after validation
const webhookUrl: string = WEBHOOK_URL;
const channelId: string = CHANNEL_ID;
const botToken: string = BOT_TOKEN;
const botClientId: string = BOT_CLIENT_ID;

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  timestamp: string;
  attachments?: { id: string; filename: string; url: string }[];
}

async function sendWebhookMessage(webhookUrl: string, content: string): Promise<string | null> {
  try {
    const response = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, username: "Test User 🧪" }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Webhook failed: ${response.status} - ${errorText}`);
      return null;
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  } catch (error) {
    console.error("Webhook error:", error);
    return null;
  }
}

async function getChannelMessages(
  channelId: string,
  botToken: string,
  afterMessageId?: string
): Promise<DiscordMessage[]> {
  try {
    let url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=10`;
    if (afterMessageId) {
      url += `&after=${afterMessageId}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to fetch messages: ${response.status} - ${errorText}`);
      return [];
    }

    return (await response.json()) as DiscordMessage[];
  } catch (error) {
    console.error("Error fetching messages:", error);
    return [];
  }
}

async function waitForResponse(
  channelId: string,
  botToken: string,
  afterMessageId: string,
  botClientId: string,
  maxWaitMs = 120000
): Promise<DiscordMessage | null> {
  const startTime = Date.now();
  console.log(`Waiting for bot response (max ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    const messages = await getChannelMessages(channelId, botToken, afterMessageId);

    const botResponse = messages.find((msg) => {
      const isBot = msg.author.bot && msg.author.id === botClientId;
      const isAfter = BigInt(msg.id) > BigInt(afterMessageId);
      if (!isBot || !isAfter) return false;

      // Ignore status messages
      if (msg.content.includes("🎨 Generating")) return false;
      if (msg.content.includes("⏳") && msg.content.includes("Please wait")) return false;

      return true;
    });

    if (botResponse) {
      console.log(`✓ Bot responded after ${Math.round((Date.now() - startTime) / 1000)}s`);
      return botResponse;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 10 === 0) {
      console.log(`  Still waiting... (${elapsed}s elapsed)`);
    }
  }

  console.error(`✗ No response after ${maxWaitMs / 1000}s`);
  return null;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Quick Bot Test");
  console.log("=".repeat(60));
  console.log(`Channel ID: ${channelId}`);
  console.log(`Bot Client ID: ${botClientId}`);
  console.log(`Test Message: "${TEST_MESSAGE}"`);
  console.log("");

  console.log("Sending test message...");
  const messageId = await sendWebhookMessage(webhookUrl, TEST_MESSAGE);

  if (!messageId) {
    console.error("Failed to send message!");
    process.exit(1);
  }

  console.log(`✓ Message sent (ID: ${messageId})`);
  console.log("");

  // Wait a moment for Discord API consistency
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const response = await waitForResponse(channelId, botToken, messageId, botClientId);

  if (!response) {
    console.error("\n✗ Test FAILED - No response from bot");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Bot Response:");
  console.log("=".repeat(60));
  console.log(response.content);
  if (response.attachments && response.attachments.length > 0) {
    console.log(`\nAttachments: ${response.attachments.length}`);
    for (const att of response.attachments) {
      console.log(`  - ${att.filename}`);
    }
  }
  console.log("=".repeat(60));
  console.log("\n✓ Test PASSED - Bot responded successfully!");
}

try {
  await main();
} catch (error) {
  console.error("Unhandled error:", error);
  process.exit(1);
}
