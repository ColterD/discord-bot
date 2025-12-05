import "dotenv/config";
import { writeFileSync } from "node:fs";

const results: Record<string, unknown> = {
  timestamp: new Date().toISOString(),
  env: {
    TEST_MODE: process.env.TEST_MODE,
    HAS_WEBHOOK: !!process.env.TEST_WEBHOOK_URL,
    HAS_CHANNEL: !!process.env.TEST_CHANNEL_IDS,
    HAS_TOKEN: !!process.env.DISCORD_TOKEN,
    HAS_CLIENT_ID: !!process.env.DISCORD_CLIENT_ID,
  },
  steps: [] as string[],
  success: false,
  error: null as string | null,
};

function step(msg: string) {
  results.steps.push(`${new Date().toISOString()}: ${msg}`);
  console.log(msg);
}

step("Starting minimal test");

if (
  !process.env.TEST_WEBHOOK_URL ||
  !process.env.TEST_CHANNEL_IDS ||
  !process.env.DISCORD_TOKEN ||
  !process.env.DISCORD_CLIENT_ID
) {
  results.error = "Missing environment variables";
  writeFileSync("test-results.json", JSON.stringify(results, null, 2));
  process.exit(1);
}

step("Environment check passed");

try {
  step("Sending webhook message");
  const webhookRes = await fetch(`${process.env.TEST_WEBHOOK_URL}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "🧪 Test", username: "Test" }),
  });

  if (!webhookRes.ok) {
    throw new Error(`Webhook failed: ${webhookRes.status}`);
  }

  const msgData = (await webhookRes.json()) as { id: string };
  step(`Message sent: ${msgData.id}`);
  results.messageId = msgData.id;

  step("Waiting 10 seconds...");
  await new Promise((r) => setTimeout(r, 10000));

  step("Checking for bot response");
  const channelId = process.env.TEST_CHANNEL_IDS!.split(",")[0]!.trim();
  const msgsRes = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages?limit=5&after=${msgData.id}`,
    { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } }
  );

  if (msgsRes.ok) {
    const messages = (await msgsRes.json()) as {
      id: string;
      author: { id: string; bot?: boolean };
      content: string;
    }[];
    step(`Found ${messages.length} messages`);
    results.messagesFound = messages.length;

    const botMsg = messages.find(
      (m) => m.author.bot && m.author.id === process.env.DISCORD_CLIENT_ID
    );
    if (botMsg) {
      step("Bot responded!");
      results.success = true;
      results.botResponse = botMsg.content.substring(0, 200);
    } else {
      step("No bot response found");
      results.success = false;
    }
  } else {
    throw new Error(`API failed: ${msgsRes.status}`);
  }
} catch (error) {
  results.error = error instanceof Error ? error.message : String(error);
  step(`Error: ${results.error}`);
} finally {
  results.completed = new Date().toISOString();
  writeFileSync("test-results.json", JSON.stringify(results, null, 2));
  step("Results written to test-results.json");
}
