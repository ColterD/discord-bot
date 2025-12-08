import { strict as assert } from "node:assert";
import type { Client, Message, TextChannel } from "discord.js";
import { SchedulerService } from "../../src/services/scheduler.js";

async function runTest() {
  console.log("🧪 Running Scheduler Integration Test");

  // 1. Initialize Scheduler with a test queue
  const testQueueName = `test-reminders-${Date.now()}`;
  const scheduler = new SchedulerService(testQueueName);

  // 2. Mock Discord Client
  const mockChannel = {
    isTextBased: () => true,
    send: async (msg: string) => {
      console.log(`Mock Channel received: ${msg}`);
      return {} as Message<boolean>;
    },
  } as unknown as TextChannel;

  const mockClient = {
    channels: {
      fetch: async (id: string) => {
        if (id === "test-channel") return mockChannel;
        return null;
      },
    },
  } as unknown as Client;

  scheduler.setClient(mockClient);

  // 3. Schedule a reminder
  const delay = 1000; // 1 second
  console.log(`Scheduling reminder in ${delay}ms...`);
  await scheduler.scheduleReminder("test-user", "test-channel", "Test Reminder", delay);

  // 4. Wait for processing
  console.log("Waiting for reminder to be processed...");

  // Wrap the mock send in a promise we can await
  const reminderReceived = new Promise<void>((resolve) => {
    (mockChannel as { send: (msg: string) => Promise<Message<boolean>> }).send = async (
      msg: string
    ) => {
      console.log(`✅ Mock Channel received: ${msg}`);
      assert.ok(msg.includes("Test Reminder"), "Message should contain reminder text");
      assert.ok(msg.includes("test-user"), "Message should mention user");
      resolve();
      return {} as Message<boolean>;
    };
  });

  // Timeout if not received
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout waiting for reminder")), 5000)
  );

  await Promise.race([reminderReceived, timeout]);

  console.log("✅ Reminder processed successfully");

  // 5. Cleanup
  await scheduler.close();
  console.log("Test complete");
  setTimeout(() => process.exit(0), 100);
}

await runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  setTimeout(() => process.exit(1), 100);
});
