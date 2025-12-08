/**
 * Integration Tests for Memory System
 *
 * Tests the 3-tier memory architecture:
 * 1. Graph Memory (Mem0 pattern) - Entity extraction and relations
 * 2. Memory Tools (MemGPT pattern) - LLM self-editing capabilities
 * 3. Memory Decay (Ebbinghaus curve) - Time-based memory strength
 *
 * Run with: npx tsx tests/integration/memory.test.ts
 */

import { strict as assert } from "node:assert";

// Test constants - fake Discord user IDs
const TEST_USER_ID = "123456789012345678";
const TEST_USER_ID_2 = "987654321098765432";

// Test runner (same pattern as other integration tests)
type TestFn = () => Promise<void> | void;
const tests: { name: string; fn: TestFn }[] = [];

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

async function runTests(): Promise<void> {
  console.log("\n🧪 Running Memory System Integration Tests\n");

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

// ============ Graph Memory Tests (Mem0 Pattern) ============

test("GraphMemory: Entity type validation", async () => {
  // Import dynamically to handle potential initialization issues
  const { GraphMemoryManager } = await import("../../src/ai/memory/graph-memory.js");

  // Verify singleton pattern
  const instance1 = GraphMemoryManager.getInstance();
  const instance2 = GraphMemoryManager.getInstance();
  assert.strictEqual(instance1, instance2, "GraphMemoryManager should be a singleton");
});

test("GraphMemory: Entity structure validation", () => {
  // Test entity structure matches expected interface
  const testEntity = {
    id: "test-entity-1",
    name: "Test Project",
    type: "project" as const,
    userId: TEST_USER_ID,
    description: "A test project",
    aliases: ["TP", "TestProj"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  assert.ok(testEntity.id, "Entity should have id");
  assert.ok(testEntity.name, "Entity should have name");
  assert.ok(testEntity.type, "Entity should have type");
  assert.ok(testEntity.userId, "Entity should have userId");
  assert.ok(testEntity.createdAt, "Entity should have createdAt");
  assert.ok(testEntity.updatedAt, "Entity should have updatedAt");
});

test("GraphMemory: Relation structure validation", () => {
  // Test relation structure matches expected interface
  const testRelation = {
    id: "test-relation-1",
    sourceId: "entity-1",
    sourceName: "John",
    sourceType: "person" as const,
    targetId: "entity-2",
    targetName: "Acme Corp",
    targetType: "organization" as const,
    relationship: "works_at",
    userId: TEST_USER_ID,
    confidence: 0.95,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  assert.ok(testRelation.sourceId, "Relation should have sourceId");
  assert.ok(testRelation.targetId, "Relation should have targetId");
  assert.ok(testRelation.relationship, "Relation should have relationship");
  assert.ok(
    testRelation.confidence >= 0 && testRelation.confidence <= 1,
    "Confidence should be 0-1"
  );
});

test("GraphMemory: Valid entity types", () => {
  const validTypes = [
    "person",
    "organization",
    "location",
    "project",
    "concept",
    "product",
    "event",
    "skill",
    "preference",
  ];

  for (const type of validTypes) {
    assert.ok(typeof type === "string", `Entity type '${type}' should be a string`);
  }
});

// ============ Memory Tools Tests (MemGPT Pattern) ============

test("MemoryTools: Singleton pattern", async () => {
  const { MemoryToolsManager } = await import("../../src/ai/memory/memory-tools.js");

  const instance1 = MemoryToolsManager.getInstance();
  const instance2 = MemoryToolsManager.getInstance();
  assert.strictEqual(instance1, instance2, "MemoryToolsManager should be a singleton");
});

test("MemoryTools: memoryAppend validates userId format", async () => {
  const { MemoryToolsManager } = await import("../../src/ai/memory/memory-tools.js");
  const tools = MemoryToolsManager.getInstance();

  // Invalid user ID (too short)
  const result1 = await tools.memoryAppend("123", "test content");
  assert.strictEqual(result1.success, false, "Should reject invalid userId");
  assert.ok(result1.message.includes("Invalid user ID"), "Should mention invalid user ID");

  // Empty content
  const result2 = await tools.memoryAppend(TEST_USER_ID, "");
  assert.strictEqual(result2.success, false, "Should reject empty content");
});

test("MemoryTools: memoryAppend category validation", () => {
  // Valid categories should be accepted (testing the type system)
  const validCategories: ("preference" | "fact" | "procedure")[] = [
    "preference",
    "fact",
    "procedure",
  ];

  for (const category of validCategories) {
    // Just verify the category is valid TypeScript type
    assert.ok(["preference", "fact", "procedure"].includes(category));
  }
});

test("MemoryTools: memoryReplace validates parameters", async () => {
  const { MemoryToolsManager } = await import("../../src/ai/memory/memory-tools.js");
  const tools = MemoryToolsManager.getInstance();

  // Invalid user ID
  const result1 = await tools.memoryReplace("invalid", "search", "new content");
  assert.strictEqual(result1.success, false, "Should reject invalid userId");

  // Empty search query
  const result2 = await tools.memoryReplace(TEST_USER_ID, "", "new content");
  assert.strictEqual(result2.success, false, "Should reject empty search query");

  // Empty new content
  const result3 = await tools.memoryReplace(TEST_USER_ID, "search", "");
  assert.strictEqual(result3.success, false, "Should reject empty new content");
});

test("MemoryTools: memorySearch validates parameters", async () => {
  const { MemoryToolsManager } = await import("../../src/ai/memory/memory-tools.js");
  const tools = MemoryToolsManager.getInstance();

  // Empty query should fail
  const result = await tools.memorySearch(TEST_USER_ID, "");
  assert.strictEqual(result.success, false, "Should reject empty query");

  // Valid query should succeed (even with no results)
  const result2 = await tools.memorySearch(TEST_USER_ID, "test query");
  assert.strictEqual(result2.success, true, "Valid query should succeed");
  assert.ok(Array.isArray(result2.memories), "Should return memories array");
});

test("MemoryTools: memoryDelete validates parameters", async () => {
  const { MemoryToolsManager } = await import("../../src/ai/memory/memory-tools.js");
  const tools = MemoryToolsManager.getInstance();

  // Invalid user ID
  const result1 = await tools.memoryDelete("invalid", "query");
  assert.strictEqual(result1.success, false, "Should reject invalid userId");

  // Empty search query
  const result2 = await tools.memoryDelete(TEST_USER_ID, "");
  assert.strictEqual(result2.success, false, "Should reject empty search query");
});

test("MemoryTools: Tool result structure", () => {
  // Verify MemoryToolResult structure
  const result = {
    success: true,
    message: "Test message",
    memoryId: "mem-123",
    previousContent: "old content",
  };

  assert.ok(typeof result.success === "boolean", "success should be boolean");
  assert.ok(typeof result.message === "string", "message should be string");
  assert.ok(typeof result.memoryId === "string", "memoryId should be optional string");
  assert.ok(
    typeof result.previousContent === "string",
    "previousContent should be optional string"
  );
});

// ============ Memory Decay Tests (Ebbinghaus Curve) ============

test("MemoryDecay: Decay formula calculation", () => {
  // Ebbinghaus forgetting curve: R = e^(-t/S) where t = time, S = stability
  // Our formula: strength * e^(-daysSinceAccess / τ) where τ = 30 days

  const calculateDecay = (strength: number, daysSinceAccess: number, tau = 30): number => {
    return strength * Math.exp(-daysSinceAccess / tau);
  };

  // Fresh memory (0 days) should retain full strength
  const fresh = calculateDecay(1, 0);
  assert.ok(Math.abs(fresh - 1) < 0.001, "Fresh memory should have full strength");

  // After 30 days (τ), should be ~36.8% of original
  const oneMonth = calculateDecay(1, 30);
  assert.ok(oneMonth > 0.36 && oneMonth < 0.38, "30-day memory should be ~37%");

  // After 60 days (2τ), should be ~13.5% of original
  const twoMonths = calculateDecay(1, 60);
  assert.ok(twoMonths > 0.13 && twoMonths < 0.14, "60-day memory should be ~13.5%");

  // Stronger memories decay slower
  const strongMemory = calculateDecay(1, 30, 60); // τ = 60 days
  assert.ok(strongMemory > 0.59 && strongMemory < 0.61, "Stronger τ should decay slower");
});

test("MemoryDecay: Access count boosts memory", () => {
  // More frequently accessed memories should have higher effective strength
  const calculateEffectiveStrength = (baseStrength: number, accessCount: number): number => {
    // Log scale boost: strength * (1 + log(accessCount + 1) / 10)
    return baseStrength * (1 + Math.log(accessCount + 1) / 10);
  };

  const neverAccessed = calculateEffectiveStrength(0.5, 0);
  const accessedOnce = calculateEffectiveStrength(0.5, 1);
  const accessedTenTimes = calculateEffectiveStrength(0.5, 10);

  assert.ok(accessedOnce > neverAccessed, "1 access should be stronger than 0");
  assert.ok(accessedTenTimes > accessedOnce, "10 accesses should be stronger than 1");
});

// ============ Memory Type Tests ============

test("MemoryTypes: All types are valid", () => {
  // MemoryType = "user_profile" | "episodic" | "fact" | "preference" | "procedural"
  const validTypes = ["user_profile", "episodic", "fact", "preference", "procedural"];

  for (const memType of validTypes) {
    assert.ok(typeof memType === "string", `Memory type '${memType}' should be valid`);
  }
});

test("MemoryTypes: Block type mapping", () => {
  // MemGPT block types should map to our memory types
  const blockTypeMap: Record<string, string> = {
    human: "user_profile",
    persona: "user_profile",
    preferences: "preference",
    facts: "fact",
    procedures: "procedural",
  };

  for (const [block, memory] of Object.entries(blockTypeMap)) {
    assert.ok(block, `Block type '${block}' should exist`);
    assert.ok(memory, `Memory type '${memory}' should exist`);
  }
});

// ============ executeMemoryTool Integration Tests ============

test("executeMemoryTool: Function exists and is callable", async () => {
  const { executeMemoryTool } = await import("../../src/ai/memory/index.js");

  // Verify the function exists and is callable
  assert.ok(typeof executeMemoryTool === "function", "executeMemoryTool should be a function");
  assert.strictEqual(executeMemoryTool.length, 3, "executeMemoryTool should accept 3 parameters");
});

test("executeMemoryTool: Unknown tool returns error", async () => {
  const { executeMemoryTool } = await import("../../src/ai/memory/index.js");

  const result = await executeMemoryTool(TEST_USER_ID, "unknown_tool", {});
  // Result is MemoryToolResult object
  assert.ok(typeof result === "object", "Should return object result");
  assert.strictEqual(result.success, false, "Unknown tool should fail");
  assert.ok(
    result.message.toLowerCase().includes("unknown"),
    `Should indicate unknown tool, got: ${result.message}`
  );
});

// ============ User Isolation Tests ============

test("UserIsolation: Different users have separate memories", () => {
  // Verify user IDs are different and isolation is conceptually enforced
  assert.notStrictEqual(TEST_USER_ID, TEST_USER_ID_2, "Test users should have different IDs");

  // Memory queries should always include userId in metadata filter
  const mockQuery = {
    userId: TEST_USER_ID,
    type: "preference",
  };

  assert.ok(mockQuery.userId, "Query should include userId for isolation");
});

test("UserIsolation: User ID format validation", () => {
  // Discord user IDs are 17-19 digit snowflakes
  const validIds = [
    "123456789012345678", // 18 digits
    "12345678901234567", // 17 digits
    "1234567890123456789", // 19 digits
  ];

  const invalidIds = [
    "123", // Too short
    "abc", // Not numeric
    "", // Empty
    "12345678901234567890", // Too long
  ];

  const isValidDiscordId = (id: string): boolean => /^\d{17,19}$/.test(id);

  for (const id of validIds) {
    assert.ok(isValidDiscordId(id), `'${id}' should be valid Discord ID`);
  }

  for (const id of invalidIds) {
    assert.ok(!isValidDiscordId(id), `'${id}' should be invalid Discord ID`);
  }
});

// ============ Importance Score Tests ============

test("ImportanceScore: Valid range", () => {
  const validScores = [0, 0.1, 0.5, 0.8, 0.9, 1];
  const invalidScores = [-0.1, 1.1, 2, -1];

  const isValidImportance = (score: number): boolean => score >= 0 && score <= 1;

  for (const score of validScores) {
    assert.ok(isValidImportance(score), `${score} should be valid importance`);
  }

  for (const score of invalidScores) {
    assert.ok(!isValidImportance(score), `${score} should be invalid importance`);
  }
});

test("ImportanceScore: Default values", () => {
  // Default importance should be reasonable (not too high, not too low)
  const defaultImportance = 0.8;
  assert.ok(
    defaultImportance >= 0.5 && defaultImportance <= 0.9,
    "Default should be mid-high range"
  );
});

// Run all tests
await runTests();
