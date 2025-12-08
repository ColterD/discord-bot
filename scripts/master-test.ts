/**
 * Master Test Runner
 * Unifies execution of all test suites (Unit, Docker, Integration)
 * with parallel execution, retries, and unified reporting.
 *
 * Usage:
 *   npx tsx scripts/master-test.ts [flags]
 *
 * Flags:
 *   --all          Run all tests
 *   --unit         Run unit tests
 *   --docker       Run docker tests
 *   --integration  Run integration tests
 *   --quick        Skip slow tests
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import dotenv from "dotenv";
import prompts from "prompts";
import { fileURLToPath } from "node:url";

// Load environment
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

// Configuration
const CONFIG = {
  retries: 2, // Retries for flaky integration tests
  colors: {
    pass: chalk.green,
    fail: chalk.red,
    warn: chalk.yellow,
    info: chalk.cyan,
    dim: chalk.dim,
  },
};

// Types
interface TestResult {
  suite: string;
  passed: boolean;
  duration: number;
  error?: string;
  skipped?: boolean;
}

interface TestCommand {
  name: string;
  command: string;
  args: string[];
  type: "unit" | "integration" | "docker";
  parallel?: boolean;
}

// ============ Helpers ============

async function runCommand(cmd: TestCommand, attempt = 1): Promise<TestResult> {
  const start = Date.now();
  const displayName = attempt > 1 ? `${cmd.name} (Attempt ${attempt})` : cmd.name;

  console.log(
    CONFIG.colors.info(`\n🚀 Starting: ${displayName}`) + CONFIG.colors.dim(` [${cmd.type}]`)
  );

  return new Promise((resolve) => {
    // Fix for DEP0190: When shell is true, pass the full command string
    const fullCommand = `${cmd.command} ${cmd.args.join(" ")}`;

    // NOSONAR - Command strings are hardcoded in this test runner, not user input
    const proc = spawn(fullCommand, [], {
      stdio: "inherit",
      shell: true,
      cwd: ROOT_DIR,
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    proc.on("close", async (code) => {
      const duration = Date.now() - start;
      const passed = code === 0;

      if (!passed && attempt <= CONFIG.retries && cmd.type === "integration") {
        console.log(CONFIG.colors.warn(`\n⚠️  ${displayName} failed. Retrying in 2s...`));
        await new Promise((r) => setTimeout(r, 2000));
        resolve(runCommand(cmd, attempt + 1));
      } else {
        if (passed) {
          console.log(CONFIG.colors.pass(`\n✅ ${displayName} passed in ${duration}ms`));
        } else {
          console.log(CONFIG.colors.fail(`\n❌ ${displayName} failed`));
        }
        resolve({
          suite: cmd.name,
          passed,
          duration,
          error: passed ? undefined : `Exit code ${code}`,
        });
      }
    });

    proc.on("error", (err) => {
      resolve({
        suite: cmd.name,
        passed: false,
        duration: Date.now() - start,
        error: err.message,
      });
    });
  });
}

async function checkEnvironment(): Promise<boolean> {
  console.log(CONFIG.colors.info("\n🔍 Running Pre-flight Checks..."));

  const required = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.log(CONFIG.colors.fail(`❌ Missing environment variables: ${missing.join(", ")}`));
    console.log(CONFIG.colors.warn("   Please check your .env file."));
    return false;
  }

  // Basic connectivity check (optional, can be expanded)
  if (process.env.TEST_WEBHOOK_URL) {
    try {
      // Verify URL format/DNS only to fail fast, actual request is in tests
      new URL(process.env.TEST_WEBHOOK_URL);
    } catch {
      console.log(CONFIG.colors.fail("❌ Invalid TEST_WEBHOOK_URL format"));
      return false;
    }
  }

  console.log(CONFIG.colors.pass("✅ Environment OK"));
  return true;
}

function printSummary(results: TestResult[]) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 TEST EXECUTION SUMMARY");
  console.log("=".repeat(60));

  let totalPassed = 0;
  let totalFailed = 0;

  console.log(
    chalk.bold("Suite".padEnd(30)) + chalk.bold("Result".padEnd(10)) + chalk.bold("Duration")
  );
  console.log("-".repeat(60));

  results.forEach((r) => {
    const icon = r.passed ? "✅" : "❌";
    const status = r.passed ? "PASS" : "FAIL";
    const color = r.passed ? CONFIG.colors.pass : CONFIG.colors.fail;

    if (r.passed) totalPassed++;
    else totalFailed++;

    console.log(
      `${r.suite.padEnd(30)} ${icon} ${color(status.padEnd(8))} ${CONFIG.colors.dim(
        (r.duration + "ms").padStart(8)
      )}`
    );
  });

  console.log("=".repeat(60));
  const finalColor = totalFailed === 0 ? CONFIG.colors.pass : CONFIG.colors.fail;
  console.log(finalColor(`Total: ${totalPassed} Passed, ${totalFailed} Failed`));
  console.log("=".repeat(60) + "\n");

  process.exit(totalFailed === 0 ? 0 : 1);
}

// ============ Main ============

async function main() {
  console.log(chalk.bold.magenta("\n🤖 Discord Bot Master Test Runner 🤖"));

  if (!(await checkEnvironment())) {
    process.exit(1);
  }

  const args = process.argv.slice(2);
  let selectedTypes: string[] = [];

  // Argument Parsing
  if (args.includes("--all")) selectedTypes = ["unit", "docker", "integration"];
  else {
    if (args.includes("--unit")) selectedTypes.push("unit");
    if (args.includes("--docker")) selectedTypes.push("docker");
    if (args.includes("--integration")) selectedTypes.push("integration");
  }

  // Quick mode - skip slow tests if requested
  const isQuick = args.includes("--quick");

  // Interactive Mode
  if (selectedTypes.length === 0 && args.length === 0) {
    const response = await prompts({
      type: "multiselect",
      name: "tests",
      message: "Which tests would you like to run?",
      choices: [
        { title: "Unit Tests (Fast)", value: "unit", selected: true },
        { title: "Integration Tests (Bot Logic)", value: "integration", selected: true },
        { title: "Docker Tests (Infrastructure)", value: "docker" },
      ],
      instructions: false,
    });

    if (!response.tests || response.tests.length === 0) {
      console.log(CONFIG.colors.warn("No tests selected. Exiting."));
      process.exit(0);
    }
    selectedTypes = response.tests;
  }

  // Define Commands
  const commands: TestCommand[] = [];

  if (selectedTypes.includes("unit")) {
    commands.push({
      name: "Unit Tests",
      // Call vitest directly to avoid recursion (test:unit -> test:master -> test:unit)
      command: "npx vitest run",
      args: ["--dir", "tests/unit"],
      type: "unit",
      parallel: true,
    });
  }

  if (selectedTypes.includes("docker")) {
    // Docker health check first
    commands.push({
      name: "Docker Health",
      command: "npm run test:docker:health",
      args: [],
      type: "docker",
      parallel: false,
    });
    commands.push({
      name: "Docker Tests",
      command: "npm run test:docker",
      args: [],
      type: "docker",
      parallel: true,
    });
  }

  if (selectedTypes.includes("integration")) {
    commands.push({
      name: "Integration: Orchestrator",
      command: "tsx",
      args: ["tests/integration/orchestrator.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: Owner DM",
      command: "tsx",
      args: ["tests/integration/owner-dm.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: Cloudflare",
      command: "tsx",
      args: ["tests/integration/cloudflare.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: Cloudflare Provider",
      command: "tsx",
      args: ["tests/integration/cloudflare-provider.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: Image Service",
      command: "tsx",
      args: ["tests/integration/image-service.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: Memory",
      command: "tsx",
      args: ["tests/integration/memory.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: Scheduler",
      command: "tsx",
      args: ["tests/integration/scheduler.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: Security",
      command: "tsx",
      args: ["tests/integration/security.test.ts"],
      type: "integration",
    });
    commands.push({
      name: "Integration: VRAM Migration",
      command: "tsx",
      args: ["tests/integration/vram-migration.test.ts"],
      type: "integration",
    });

    // Only run slow send-message test if NOT quick mode or explicitly requested
    if (!isQuick) {
      commands.push({
        name: "Integration: Send Message",
        command: "tsx",
        args: ["tests/integration/send-message.test.ts"],
        type: "integration",
      });
    }
  }

  // Handle specific script override
  const scriptIndex = args.indexOf("--script");
  if (scriptIndex !== -1 && args[scriptIndex + 1]) {
    const scriptName = args[scriptIndex + 1];
    console.log(CONFIG.colors.info(`Overriding execution to run specific script: ${scriptName}`));

    // Clear auto-selected commands
    commands.length = 0;

    // Try to find the script in common locations
    const candidates = [
      `tests/integration/${scriptName}.test.ts`,
      `tests/integration/${scriptName}.ts`,
      `tests/${scriptName}.ts`,
      scriptName,
    ];

    let found = false;
    for (const candidate of candidates) {
      try {
        await fs.access(path.resolve(ROOT_DIR, candidate));
        commands.push({
          name: `Script: ${scriptName}`,
          command: "tsx",
          args: [candidate],
          type: "integration",
          parallel: false,
        });
        found = true;
        break;
      } catch {}
    }

    if (!found) {
      console.log(CONFIG.colors.fail(`Could not find script matching '${scriptName}'`));
      process.exit(1);
    }
  }

  // Execution Strategy
  const results: TestResult[] = [];

  // 1. Parallel Block (Unit & Docker)
  const parallelCmds = commands.filter((c) => c.parallel);
  if (parallelCmds.length > 0) {
    console.log(CONFIG.colors.info("\n🏃 Running Parallel Tests..."));
    const parallelResults = await Promise.all(parallelCmds.map((cmd) => runCommand(cmd)));
    results.push(...parallelResults);
  }

  // 2. Sequential Block (Integration & others)
  const sequentialCmds = commands.filter((c) => !c.parallel);
  for (const cmd of sequentialCmds) {
    results.push(await runCommand(cmd));
  }

  printSummary(results);
}

main().catch(console.error);
