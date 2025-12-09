/**
 * Test script to validate Owner DM notification flow
 * Run with: npx tsx tests/test-owner-dm.ts
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { AlertCategory, getNotificationService } from "../../src/services/notifications.js";
import { createLogger } from "../../src/utils/logger.js";

const log = createLogger("TestOwnerDM");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

try {
  log.info("Starting Owner DM notification test...");

  // Login to Discord
  log.info("Logging in to Discord...");
  await client.login(process.env.DISCORD_TOKEN);

  // Wait for client to be ready
  await new Promise<void>((resolve) => {
    if (client.isReady()) {
      resolve();
    } else {
      client.once("ready", () => resolve());
    }
  });

  log.info(`Logged in as ${client.user?.tag}`);

  // Get and initialize the notification service
  const notificationService = getNotificationService();
  notificationService.setClient(client);

  // Send a test notification
  log.info("Sending test Owner DM notification...");

  const testAlert = {
    category: AlertCategory.SECURITY_ALERT, // No cooldown
    title: "🧪 Test Notification",
    error: "This is a test of the Owner DM notification system.",
  };

  const success = await notificationService.sendAlert(testAlert, "test-1");

  if (success) {
    log.info("✅ Test notification sent successfully!");
  } else {
    log.error("❌ Failed to send test notification");
  }

  // Wait a moment between notifications
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Also test the self-healing failure format
  log.info("Sending simulated self-healing failure notification...");

  const escalationAlert = {
    category: AlertCategory.SELF_HEAL_FAILED,
    title: "TestService",
    error: "Connection refused after 3 recovery attempts",
    triedSteps: [
      "Restart container → Failed (exit code 1)",
      "Clear cache and restart → Failed (timeout)",
      "Full reset → Failed (service unresponsive)",
    ],
    proposedFix: "```bash\ndocker-compose down testservice\ndocker-compose up -d testservice\n```",
    claudePrompt: "Check logs with `docker logs testservice --tail 100`",
  };

  const escalationSuccess = await notificationService.sendAlert(escalationAlert, "test-escalation");

  if (escalationSuccess) {
    log.info("✅ Escalation notification sent successfully!");
  } else {
    log.error("❌ Failed to send escalation notification (may be on cooldown)");
  }

  // Give time for messages to be sent
  await new Promise((resolve) => setTimeout(resolve, 2000));

  log.info("Test complete! Check your Discord DMs.");
} catch (error) {
  log.error(`Test failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  setTimeout(() => process.exit(1), 100);
} finally {
  // Cleanup
  client.destroy();
}

// Graceful exit
setTimeout(() => process.exit(0), 100);
