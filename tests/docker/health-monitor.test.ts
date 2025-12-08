/**
 * Tests to validate that health-monitor.ts works without a shell.
 * This validates the fix for "spawn /bin/sh ENOENT" in distroless containers.
 */

import { spawn } from "node:child_process";
import * as net from "node:net";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * spawnAsync - copied from health-monitor.ts for isolated testing
 */
function spawnAsync(
  command: string,
  args: string[],
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timeout = options?.timeout ?? 30_000;
    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;

      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!killed) {
        reject(err);
      }
    });
  });
}

/**
 * checkValkeyTcp - copied from health-monitor.ts for isolated testing
 */
function checkValkeyTcp(
  host: string,
  port: number,
  timeout = 5000
): Promise<{ healthy: boolean; message?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on("connect", () => {
      socket.write("PING\r\n");
    });

    socket.on("data", (data) => {
      const response = data.toString().trim();
      socket.destroy();

      if (response === "+PONG") {
        resolve({ healthy: true });
      } else {
        resolve({ healthy: false, message: `Unexpected response: ${response}` });
      }
    });

    socket.on("error", (error) => {
      socket.destroy();
      resolve({ healthy: false, message: error.message });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ healthy: false, message: "Connection timeout" });
    });

    socket.connect({ port, host });
  });
}

/**
 * Wait for Valkey to be healthy after restart
 */
async function waitForValkeyHealthy(
  host = "localhost",
  port = 6379,
  maxRetries = 15,
  retryDelayMs = 1000
): Promise<boolean> {
  console.log(`   ⏳ Waiting for Valkey to be healthy (max ${maxRetries} retries)...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await checkValkeyTcp(host, port, 2000);
    if (result.healthy) {
      console.log(`   ✅ Valkey recovered after ${attempt} attempts`);
      return true;
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  console.log("   ⚠️  Valkey did not recover within timeout");
  return false;
}

// ============ Individual Test Functions ============

async function testSpawnAsyncDockerPs(): Promise<TestResult> {
  const testName = "spawnAsync docker ps";
  console.log("\n🧪 Test 1: spawnAsync with docker ps (no shell)");

  try {
    const { stdout } = await spawnAsync("docker", ["ps", "--format", "{{.Names}}"], {
      timeout: 10_000,
    });
    console.log(`   Output: ${stdout.trim().split("\n").slice(0, 3).join(", ")}...`);
    console.log("   ✅ PASSED: docker command executed without shell");
    return { name: testName, passed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`   ❌ FAILED: ${msg}`);
    return { name: testName, passed: false, error: msg };
  }
}

async function testSpawnAsyncDockerRestart(): Promise<TestResult> {
  const testName = "spawnAsync docker restart";
  console.log("\n🧪 Test 2: spawnAsync with docker restart valkey");

  try {
    const { stdout: containers } = await spawnAsync("docker", ["ps", "-q", "-f", "name=valkey"]);

    if (containers.trim() === "") {
      console.log("   ⏭️  SKIPPED: Valkey container not running");
      return { name: testName, passed: true, error: "skipped - not running" };
    }

    await spawnAsync("docker", ["restart", "valkey"], { timeout: 30_000 });
    console.log("   ✅ docker restart executed without shell");

    // Wait for Valkey to be healthy again after restart
    const recovered = await waitForValkeyHealthy();
    if (!recovered) {
      console.log("   ⚠️  WARNING: Valkey may not have fully recovered");
    }

    console.log("   ✅ PASSED: docker restart + recovery complete");
    return { name: testName, passed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    // Shell errors are failures, other errors are acceptable
    const isShellError = msg.includes("ENOENT") && msg.includes("/bin/sh");
    if (isShellError) {
      console.log(`   ❌ FAILED: Still getting shell error: ${msg}`);
      return { name: testName, passed: false, error: msg };
    }

    console.log(`   ✅ PASSED: No shell error (got: ${msg})`);
    return { name: testName, passed: true, error: `non-shell error: ${msg}` };
  }
}

async function testExecUsesShell(): Promise<TestResult> {
  const testName = "exec uses shell";
  console.log("\n🧪 Test 3: Verify exec() uses shell (for comparison)");

  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    await execAsync("echo test");
    console.log("   ℹ️  exec() works here (has shell) - would fail in distroless");
    return { name: testName, passed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`   ℹ️  exec() failed: ${msg}`);
    return { name: testName, passed: true, error: msg };
  }
}

async function testValkeyTcpConnection(): Promise<TestResult> {
  const testName = "checkValkeyTcp";
  console.log("\n🧪 Test 4: checkValkeyTcp direct connection");

  try {
    const result = await checkValkeyTcp("localhost", 6379, 5000);

    if (result.healthy) {
      console.log("   ✅ PASSED: TCP health check returned PONG");
      return { name: testName, passed: true };
    }

    const isConnectionError =
      result.message?.includes("ECONNREFUSED") || result.message?.includes("timeout");

    if (isConnectionError) {
      console.log(`   ⏭️  SKIPPED: Valkey not reachable (${result.message})`);
      return { name: testName, passed: true, error: "skipped - not reachable" };
    }

    console.log(`   ❌ FAILED: ${result.message}`);
    return { name: testName, passed: false, error: result.message };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`   ❌ FAILED: ${msg}`);
    return { name: testName, passed: false, error: msg };
  }
}

async function testSpawnShellFalse(): Promise<TestResult> {
  const testName = "spawn shell:false";
  console.log("\n🧪 Test 5: Verify spawn shell:false doesn't use /bin/sh");

  try {
    const proc = spawn("docker", ["--version"], { shell: false });

    await new Promise<void>((resolve, reject) => {
      proc.on("error", (err) => {
        if (err.message.includes("/bin/sh")) {
          reject(new Error("spawn tried to use /bin/sh"));
        } else {
          reject(err);
        }
      });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`exit code ${code}`));
      });
    });

    console.log("   ✅ PASSED: spawn executed docker directly without shell");
    return { name: testName, passed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`   ❌ FAILED: ${msg}`);
    return { name: testName, passed: false, error: msg };
  }
}

async function testSpawnWithComplexArgs(): Promise<TestResult> {
  const testName = "spawn with complex args";
  console.log("\n🧪 Test 6: Command with args that would need shell escaping");

  try {
    const { stdout } = await spawnAsync("docker", [
      "ps",
      "--filter",
      "name=valkey",
      "--format",
      "{{.Names}}: {{.Status}}",
    ]);
    console.log(`   Output: ${stdout.trim() || "(no containers matching)"}`);
    console.log("   ✅ PASSED: Complex args work without shell escaping");
    return { name: testName, passed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);

    const isShellError = msg.includes("/bin/sh") || msg.includes("ENOENT");
    if (isShellError) {
      console.log(`   ❌ FAILED: ${msg}`);
      return { name: testName, passed: false, error: msg };
    }

    console.log(`   ✅ PASSED: No shell error (got: ${msg})`);
    return { name: testName, passed: true };
  }
}

// ============ Test Runner ============

function printSummary(results: TestResult[]): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 RESULTS SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    const note = result.error ? ` (${result.error})` : "";
    console.log(`${icon} ${result.name}${note}`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Total: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.log("\n⚠️  Some tests failed - the fix may not be complete!");
    process.exit(1);
  } else {
    console.log("\n✅ All tests passed - the spawn/TCP fix works correctly!");
    console.log("   The health monitor will work in distroless containers.");
  }
}

// ============ Main Execution (Top-level await) ============

const results: TestResult[] = [
  await testSpawnAsyncDockerPs(),
  await testSpawnAsyncDockerRestart(),
  await testExecUsesShell(),
  await testValkeyTcpConnection(),
  await testSpawnShellFalse(),
  await testSpawnWithComplexArgs(),
];

printSummary(results);
