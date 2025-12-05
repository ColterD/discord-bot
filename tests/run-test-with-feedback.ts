/**
 * Test runner with real-time feedback
 */

import "dotenv/config";

const TEST_MESSAGE = "Hello! This is a test. Can you respond?";
const WEBHOOK_URL = process.env.TEST_WEBHOOK_URL;
const CHANNEL_ID = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const BOT_TOKEN = process.env.DISCORD_TOKEN;
const BOT_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// Force immediate output
process.stdout.write("Starting test...\n");
process.stdout.write(`Webhook URL: ${WEBHOOK_URL ? "SET" : "NOT SET"}\n`);
process.stdout.write(`Channel ID: ${CHANNEL_ID || "NOT SET"}\n`);
process.stdout.write(`Bot Token: ${BOT_TOKEN ? "SET" : "NOT SET"}\n`);
process.stdout.write(`Bot Client ID: ${BOT_CLIENT_ID || "NOT SET"}\n`);
process.stdout.write("\n");

if (!WEBHOOK_URL || !CHANNEL_ID || !BOT_TOKEN || !BOT_CLIENT_ID) {
  process.stderr.write("ERROR: Missing required environment variables!\n");
  process.exit(1);
}

async function sendWebhookMessage(webhookUrl: string, content: string): Promise<string | null> {
  process.stdout.write(`Sending message: "${content}"\n`);
  try {
    const response = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, username: "Test User 🧪" }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      process.stderr.write(`ERROR: Webhook failed: ${response.status} - ${errorText}\n`);
      return null;
    }

    const data = (await response.json()) as { id: string };
    process.stdout.write(`✓ Message sent (ID: ${data.id})\n`);
    return data.id;
  } catch (error) {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    return null;
  }
}

async function getChannelMessages(
  channelId: string,
  botToken: string,
  afterMessageId?: string
): Promise<{ id: string; content: string; author: { id: string; bot?: boolean } }[]> {
  try {
    let url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=10`;
    if (afterMessageId) {
      url += `&after=${afterMessageId}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bot ${botToken}` },
    });

    if (!response.ok) {
      return [];
    }

    return (await response.json()) as {
      id: string;
      content: string;
      author: { id: string; bot?: boolean };
    }[];
  } catch {
    return [];
  }
}

async function waitForResponse(
  channelId: string,
  botToken: string,
  afterMessageId: string,
  botClientId: string,
  maxWaitMs = 120000
): Promise<{ id: string; content: string } | null> {
  const startTime = Date.now();
  process.stdout.write(`Waiting for bot response (max ${maxWaitMs / 1000}s)...\n`);

  while (Date.now() - startTime < maxWaitMs) {
    const messages = await getChannelMessages(channelId, botToken, afterMessageId);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (elapsed % 10 === 0 && elapsed > 0) {
      process.stdout.write(
        `  Still waiting... (${elapsed}s elapsed, found ${messages.length} messages)\n`
      );
    }

    const botResponse = messages.find((msg) => {
      const isBot = msg.author.bot && msg.author.id === botClientId;
      const isAfter = BigInt(msg.id) > BigInt(afterMessageId);
      if (!isBot || !isAfter) return false;
      if (msg.content.includes("🎨 Generating")) return false;
      if (msg.content.includes("⏳") && msg.content.includes("Please wait")) return false;
      return true;
    });

    if (botResponse) {
      process.stdout.write(`✓ Bot responded after ${elapsed}s\n`);
      return { id: botResponse.id, content: botResponse.content };
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  process.stderr.write(`✗ No response after ${maxWaitMs / 1000}s\n`);
  return null;
}

async function main() {
  process.stdout.write("=".repeat(60) + "\n");
  process.stdout.write("Discord Bot Test\n");
  process.stdout.write("=".repeat(60) + "\n\n");

  const messageId = await sendWebhookMessage(WEBHOOK_URL!, TEST_MESSAGE);
  if (!messageId) {
    process.exit(1);
  }

  process.stdout.write("\nWaiting 3 seconds for Discord API consistency...\n");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const response = await waitForResponse(CHANNEL_ID!, BOT_TOKEN!, messageId, BOT_CLIENT_ID!);

  process.stdout.write("\n" + "=".repeat(60) + "\n");
  if (response) {
    process.stdout.write("✓ TEST PASSED\n");
    process.stdout.write("=".repeat(60) + "\n");
    process.stdout.write("Bot Response:\n");
    process.stdout.write(response.content.substring(0, 500));
    if (response.content.length > 500) {
      process.stdout.write("...\n");
    }
    process.stdout.write("\n");
  } else {
    process.stdout.write("✗ TEST FAILED - No response from bot\n");
    process.stdout.write("=".repeat(60) + "\n");
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Unhandled error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
