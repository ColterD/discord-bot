import "dotenv/config";

const WEBHOOK = process.env.TEST_WEBHOOK_URL;
const CHANNEL = process.env.TEST_CHANNEL_IDS?.split(",")[0]?.trim();
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

console.log("ENV CHECK:");
console.log("  WEBHOOK:", WEBHOOK ? "SET" : "NOT SET");
console.log("  CHANNEL:", CHANNEL || "NOT SET");
console.log("  TOKEN:", TOKEN ? "SET" : "NOT SET");
console.log("  CLIENT_ID:", CLIENT_ID || "NOT SET");
console.log("  TEST_MODE:", process.env.TEST_MODE || "NOT SET");

if (!WEBHOOK || !CHANNEL || !TOKEN || !CLIENT_ID) {
  console.error("MISSING ENV VARS!");
  process.exit(1);
}

console.log("\nSending test message...");

try {
  const sendRes = await fetch(`${WEBHOOK}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "🧪 Test message", username: "Test" }),
  });

  const data = (await sendRes.json()) as { id: string };
  console.log("Message sent! ID:", data.id);
  console.log("Waiting 10 seconds...");

  await new Promise((resolve) => setTimeout(resolve, 10000));

  const msgsRes = await fetch(
    `https://discord.com/api/v10/channels/${CHANNEL}/messages?limit=5&after=${data.id}`,
    { headers: { Authorization: `Bot ${TOKEN}` } }
  );

  const messages = (await msgsRes.json()) as {
    author: { id: string; bot?: boolean };
    content: string;
  }[];
  console.log(`Found ${messages.length} messages`);

  const botMsg = messages.find((m) => m.author.bot && m.author.id === CLIENT_ID);
  if (botMsg) {
    console.log("✓ BOT RESPONDED!");
    console.log("Response:", botMsg.content.substring(0, 200));
  } else {
    console.log("✗ No bot response found");
  }
} catch (err) {
  console.error("Error:", err);
}
