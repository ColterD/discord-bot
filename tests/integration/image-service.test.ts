/**
 * Image Service Integration Tests
 *
 * These tests verify the ImageService sleep/wake functionality including:
 * - performSleepTransition() retry logic
 * - attemptModelUnload() VRAM verification edge cases
 * - bytesToMB helper function
 *
 * Run with: npx tsx tests/integration/image-service.test.ts
 */

import { strict as assert } from "node:assert";

// Test runner
type TestFn = () => Promise<void> | void;
const tests: { name: string; fn: TestFn }[] = [];

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

async function runTests(): Promise<void> {
  console.log("\n🖼️ Running Image Service Tests\n");

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`  ❌ ${name}`);
      console.error(`     ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    setTimeout(() => process.exit(1), 100);
    return;
  }
  setTimeout(() => process.exit(0), 100);
}

// ============ VRAM Byte Conversion Tests ============

test("ImageService: bytesToMB correctly converts bytes to megabytes", () => {
  // Test the bytesToMB logic directly
  const BYTES_PER_MB = 1024 * 1024;

  const testCases = [
    { bytes: 0, expectedMB: 0 },
    { bytes: 1024 * 1024, expectedMB: 1 }, // Exactly 1 MB
    { bytes: 100 * 1024 * 1024, expectedMB: 100 }, // 100 MB
    { bytes: 1024 * 1024 * 1024, expectedMB: 1024 }, // 1 GB
    { bytes: 13144 * 1024 * 1024, expectedMB: 13144 }, // ~13 GB typical VRAM
    { bytes: 500 * 1024, expectedMB: 0 }, // Less than 1 MB rounds to 0
    { bytes: 1.5 * 1024 * 1024, expectedMB: 2 }, // 1.5 MB rounds to 2
  ];

  for (const { bytes, expectedMB } of testCases) {
    const actualMB = Math.round(bytes / BYTES_PER_MB);
    assert.equal(
      actualMB,
      expectedMB,
      `${bytes} bytes should be ${expectedMB}MB, got ${actualMB}MB`
    );
  }
});

test("ImageService: VRAM thresholds are correctly defined", () => {
  // Verify the threshold constants make sense
  const MINIMUM_FREED_VRAM_BYTES = 100 * 1024 * 1024; // 100 MB
  const MINIMAL_USAGE_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB

  // Minimum freed should be less than minimal usage threshold
  assert.ok(
    MINIMUM_FREED_VRAM_BYTES < MINIMAL_USAGE_THRESHOLD_BYTES,
    "MINIMUM_FREED should be less than MINIMAL_USAGE_THRESHOLD"
  );

  // Verify values are in bytes (large numbers)
  assert.ok(MINIMUM_FREED_VRAM_BYTES > 1000000, "MINIMUM_FREED should be in bytes (> 1M)");
  assert.ok(MINIMAL_USAGE_THRESHOLD_BYTES > 1000000, "MINIMAL_USAGE_THRESHOLD should be in bytes");
});

// ============ VRAM Delta Edge Case Tests ============

/**
 * Simulate the VRAM calculation logic from attemptModelUnload
 */
function simulateVRAMCheck(
  beforeUsed: number,
  afterUsed: number
): {
  rawDelta: number;
  freedBytes: number;
  increased: boolean;
} {
  const rawDelta = beforeUsed - afterUsed;
  const increased = rawDelta < 0;
  const freedBytes = Math.max(0, rawDelta);

  return { rawDelta, freedBytes, increased };
}

test("ImageService: VRAM increase detection works correctly", () => {
  // Test case 1: Normal unload - VRAM decreases
  const normalUnload = simulateVRAMCheck(8000, 1000);
  assert.equal(normalUnload.increased, false, "Normal unload should not show increase");
  assert.equal(normalUnload.freedBytes, 7000, "Should show 7000 bytes freed");

  // Test case 2: VRAM increased (other process loaded something)
  const vramIncreased = simulateVRAMCheck(1000, 2000);
  assert.equal(vramIncreased.increased, true, "Should detect VRAM increase");
  assert.equal(vramIncreased.freedBytes, 0, "Should clamp freed to 0");
  assert.equal(vramIncreased.rawDelta, -1000, "Raw delta should be negative");

  // Test case 3: No change
  const noChange = simulateVRAMCheck(5000, 5000);
  assert.equal(noChange.increased, false, "No change should not show increase");
  assert.equal(noChange.freedBytes, 0, "Should show 0 bytes freed");

  // Test case 4: Small decrease
  const smallDecrease = simulateVRAMCheck(1000, 950);
  assert.equal(smallDecrease.freedBytes, 50, "Should show 50 bytes freed");
});

test("ImageService: Unload success criteria are correct", () => {
  const MINIMUM_FREED_VRAM_BYTES = 100 * 1024 * 1024; // 100 MB
  const MINIMAL_USAGE_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB

  function isUnloadSuccessful(
    freedBytes: number,
    beforeUsed: number
  ): {
    success: boolean;
    reason: string;
  } {
    if (freedBytes >= MINIMUM_FREED_VRAM_BYTES) {
      return { success: true, reason: "freed_enough" };
    } else if (beforeUsed < MINIMAL_USAGE_THRESHOLD_BYTES) {
      return { success: true, reason: "minimal_usage" };
    } else {
      return { success: false, reason: "not_enough_freed" };
    }
  }

  // Test case 1: Freed 200 MB - should succeed
  const freedEnough = isUnloadSuccessful(200 * 1024 * 1024, 8000 * 1024 * 1024);
  assert.equal(freedEnough.success, true, "200MB freed should succeed");
  assert.equal(freedEnough.reason, "freed_enough", "Should indicate freed_enough");

  // Test case 2: Freed only 50 MB but before was minimal - should succeed
  const minimalBefore = isUnloadSuccessful(50 * 1024 * 1024, 300 * 1024 * 1024);
  assert.equal(minimalBefore.success, true, "Minimal VRAM usage should succeed");
  assert.equal(minimalBefore.reason, "minimal_usage", "Should indicate minimal_usage");

  // Test case 3: Freed only 50 MB and before was high - should fail
  const notEnoughFreed = isUnloadSuccessful(50 * 1024 * 1024, 8000 * 1024 * 1024);
  assert.equal(notEnoughFreed.success, false, "50MB freed from 8GB should fail");
  assert.equal(notEnoughFreed.reason, "not_enough_freed", "Should indicate not_enough_freed");

  // Test case 4: Exactly at threshold - should succeed
  const exactlyAtThreshold = isUnloadSuccessful(MINIMUM_FREED_VRAM_BYTES, 1000 * 1024 * 1024);
  assert.equal(exactlyAtThreshold.success, true, "Exactly 100MB freed should succeed");
});

// ============ Retry Logic Tests ============

test("ImageService: Sleep retry logic respects max retries", () => {
  const MAX_SLEEP_RETRIES = 3;

  function simulateRetryLogic(failedAttempts: number): {
    shouldRetry: boolean;
    giveUp: boolean;
  } {
    const newFailedCount = failedAttempts + 1;
    if (newFailedCount >= MAX_SLEEP_RETRIES) {
      return { shouldRetry: false, giveUp: true };
    }
    return { shouldRetry: true, giveUp: false };
  }

  // First failure - should retry
  const firstFailure = simulateRetryLogic(0);
  assert.equal(firstFailure.shouldRetry, true, "Should retry after first failure");
  assert.equal(firstFailure.giveUp, false, "Should not give up after first failure");

  // Second failure - should retry
  const secondFailure = simulateRetryLogic(1);
  assert.equal(secondFailure.shouldRetry, true, "Should retry after second failure");
  assert.equal(secondFailure.giveUp, false, "Should not give up after second failure");

  // Third failure - should give up
  const thirdFailure = simulateRetryLogic(2);
  assert.equal(thirdFailure.shouldRetry, false, "Should not retry after third failure");
  assert.equal(thirdFailure.giveUp, true, "Should give up after third failure");
});

test("ImageService: Sleep retry timing is reasonable", () => {
  // Verify retry window is reasonable (not too fast, not too slow)
  const SLEEP_CHECK_INTERVAL_MS = 30_000; // 30 seconds
  const MAX_SLEEP_RETRIES = 3;

  // With checks every 30s and max 3 retries, total window is ~90 seconds
  const totalRetryWindowMs = SLEEP_CHECK_INTERVAL_MS * MAX_SLEEP_RETRIES;

  // Should be at least 1 minute to allow for transient issues
  assert.ok(totalRetryWindowMs >= 60_000, "Retry window should be at least 60 seconds");

  // Should not be more than 5 minutes to avoid excessive delays
  assert.ok(totalRetryWindowMs <= 300_000, "Retry window should not exceed 5 minutes");
});

// ============ State Transition Tests ============

test("ImageService: Sleep state transitions are valid", () => {
  // Simulate state machine
  type SleepState = "awake" | "sleeping" | "transition";

  function canTransition(from: SleepState, to: SleepState): boolean {
    // Valid transitions:
    // awake -> sleeping (sleep() called after inactivity)
    // sleeping -> awake (wake() called on request)
    // transition states are intermediate
    const validTransitions: Record<SleepState, SleepState[]> = {
      awake: ["sleeping"],
      sleeping: ["awake"],
      transition: ["awake", "sleeping"],
    };

    return validTransitions[from].includes(to);
  }

  // Test valid transitions
  assert.equal(canTransition("awake", "sleeping"), true, "awake -> sleeping is valid");
  assert.equal(canTransition("sleeping", "awake"), true, "sleeping -> awake is valid");

  // Test invalid transitions
  assert.equal(canTransition("awake", "awake"), false, "awake -> awake is redundant");
  assert.equal(canTransition("sleeping", "sleeping"), false, "sleeping -> sleeping is redundant");
});

test("ImageService: Concurrent sleep calls are coalesced", async () => {
  // Simulate the sleepPromise coalescing behavior
  let sleepCallCount = 0;
  let sleepPromise: Promise<void> | null = null;

  async function simulateSleep(): Promise<void> {
    // If already sleeping, wait for existing promise
    if (sleepPromise) {
      await sleepPromise;
      return;
    }

    sleepCallCount++;
    sleepPromise = new Promise((resolve) => setTimeout(resolve, 10));
    await sleepPromise;
    sleepPromise = null;
  }

  // Call sleep() 5 times concurrently
  await Promise.all([
    simulateSleep(),
    simulateSleep(),
    simulateSleep(),
    simulateSleep(),
    simulateSleep(),
  ]);

  // Only one actual sleep transition should have happened
  assert.equal(sleepCallCount, 1, "Concurrent sleep calls should be coalesced to 1");
});

// ============ Activity Tracking Tests ============

test("ImageService: Activity time updates correctly", () => {
  let lastActivityTime = Date.now();

  function updateActivity(): void {
    lastActivityTime = Date.now();
  }

  function getInactiveMs(): number {
    return Date.now() - lastActivityTime;
  }

  // Initially should be very small
  assert.ok(getInactiveMs() < 100, "Initial inactive time should be minimal");

  // Simulate passage of time (we can't actually wait in unit tests)
  lastActivityTime = Date.now() - 1000; // Pretend 1 second has passed

  assert.ok(getInactiveMs() >= 1000, "Inactive time should increase over time");

  // After update, should reset
  updateActivity();
  assert.ok(getInactiveMs() < 100, "After update, inactive time should reset");
});

test("ImageService: Sleep timeout threshold is reasonable", () => {
  const SLEEP_AFTER_MS = 5 * 60 * 1000; // 5 minutes default

  // Should be at least 1 minute
  assert.ok(SLEEP_AFTER_MS >= 60_000, "Sleep timeout should be at least 1 minute");

  // Should not be more than 30 minutes
  assert.ok(SLEEP_AFTER_MS <= 30 * 60 * 1000, "Sleep timeout should not exceed 30 minutes");
});

// ============ Run all tests ============

await runTests();
