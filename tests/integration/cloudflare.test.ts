/**
 * Quick Cloudflare API validation script
 * Run with: npx tsx tests/validate-cloudflare.ts
 */

import "dotenv/config";

/**
 * Cloudflare API result type (supports both simple and OpenAI-compatible formats)
 */
interface CloudflareResult {
  response?: string;
  choices?: { message: { content: string } }[];
}

/**
 * Cloudflare API response envelope
 */
interface CloudflareResponse {
  success: boolean;
  result?: CloudflareResult;
  errors?: { message: string }[];
}

/**
 * Cloudflare embedding response
 */
interface EmbeddingResponse {
  success: boolean;
  result?: { data?: number[][] };
  errors?: { message: string }[];
}

/**
 * Test result tracking
 */
interface TestContext {
  accountId: string;
  apiToken: string;
  routerModel: string;
  embeddingModel: string;
}

/**
 * Extract content from Cloudflare API response (handles both formats)
 */
function extractContent(result?: CloudflareResult): string {
  if (result?.choices?.[0]?.message?.content) {
    return result.choices[0].message.content;
  }
  return result?.response ?? "";
}

/**
 * Print test header
 */
function printHeader(testNumber: number, testName: string): void {
  console.log("─".repeat(60));
  console.log(`Test ${testNumber}: ${testName}`);
  console.log("─".repeat(60));
}

/**
 * Test router model functionality
 */
async function testRouterModel(ctx: TestContext): Promise<void> {
  printHeader(1, "Router Model (Granite 4.0 H Micro)");

  const routerUrl = `https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/ai/run/${ctx.routerModel}`;
  console.log(`  Model: ${ctx.routerModel}\n`);

  try {
    const routerResponse = await fetch(routerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Say hello in exactly 5 words" }],
        max_tokens: 50,
      }),
    });

    const routerData = (await routerResponse.json()) as CloudflareResponse;

    if (routerResponse.ok && routerData.success) {
      const content = extractContent(routerData.result);
      console.log(`✅ Router model working!`);
      console.log(`   Response: "${content}"\n`);
    } else {
      console.log(`❌ Router model failed`);
      console.log(`   Status: ${routerResponse.status}`);
      console.log(`   Errors: ${JSON.stringify(routerData.errors)}\n`);
    }
  } catch (error) {
    console.log(`❌ Router model error: ${error instanceof Error ? error.message : error}\n`);
  }
}

/**
 * Test embedding model functionality
 */
async function testEmbeddingModel(ctx: TestContext): Promise<void> {
  printHeader(2, "Embedding Model (Qwen3 0.6B)");

  const embedUrl = `https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/ai/run/${ctx.embeddingModel}`;
  console.log(`  Model: ${ctx.embeddingModel}\n`);

  try {
    const embedResponse = await fetch(embedUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: ["Hello, this is a test sentence for embedding."],
      }),
    });

    const embedData = (await embedResponse.json()) as EmbeddingResponse;

    if (embedResponse.ok && embedData.success) {
      const dims = embedData.result?.data?.[0]?.length ?? 0;
      console.log(`✅ Embedding model working!`);
      console.log(`   Dimensions: ${dims}`);
      console.log(
        `   First 5 values: [${embedData.result?.data?.[0]?.slice(0, 5).join(", ")}...]\n`
      );
    } else {
      console.log(`❌ Embedding model failed`);
      console.log(`   Status: ${embedResponse.status}`);
      console.log(`   Errors: ${JSON.stringify(embedData.errors)}\n`);
    }
  } catch (error) {
    console.log(`❌ Embedding model error: ${error instanceof Error ? error.message : error}\n`);
  }
}

/**
 * Test bot integration - classifyIntent
 */
async function testBotIntegration(_ctx: TestContext): Promise<void> {
  printHeader(3, "Bot Integration (classifyIntent)");

  try {
    // Dynamic import to avoid issues if build isn't ready
    const { classifyIntent } = await import("../../dist/ai/router.js");
    const result = await classifyIntent("What's the weather like today?");

    console.log("  Intent:", result.intent);
    console.log("  Confidence:", result.confidence.toFixed(2));
    console.log("  Used Fallback:", result.usedFallback);
    console.log("  Duration:", `${result.durationMs}ms`);

    if (!result.usedFallback) {
      console.log("✅ Bot integration working (Cloudflare used)!\n");
    } else {
      console.log("⚠️  Bot integration acting, but used fallback (Check Cloudflare status)\n");
    }
  } catch (error) {
    console.log(`❌ Bot integration error: ${error instanceof Error ? error.message : error}\n`);
    console.log("   (Make sure you have run 'npm run build' first)\n");
  }
}

/**
 * Test classification functionality
 */
async function testClassification(ctx: TestContext): Promise<void> {
  printHeader(3, "Classification (using Router Model)");
  const routerUrl = `https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/ai/run/${ctx.routerModel}`;
  const classificationPrompt = `Classify this user message into one of these categories:
- general_conversation
- tool_use
- code_generation
- creative_writing

User message: "What time is it right now?"

Respond with ONLY the category name, nothing else.`;

  try {
    const classifyResponse = await fetch(routerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: classificationPrompt }],
        max_tokens: 20,
        temperature: 0.1,
      }),
    });

    const classifyData = (await classifyResponse.json()) as CloudflareResponse;

    if (classifyResponse.ok && classifyData.success) {
      const content = extractContent(classifyData.result);
      console.log(`✅ Classification working!`);
      console.log(`   Result: "${content.trim()}"\n`);
    } else {
      console.log(`❌ Classification failed`);
      console.log(`   Status: ${classifyResponse.status}`);
      console.log(`   Errors: ${JSON.stringify(classifyData.errors)}\n`);
    }
  } catch (error) {
    console.log(`❌ Classification error: ${error instanceof Error ? error.message : error}\n`);
  }
}

/**
 * Print configuration info
 */
function printConfig(ctx: TestContext): void {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║         Cloudflare Workers AI Validation Script              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Configuration:");
  console.log(`  Account ID: ✓ SET`);
  console.log(`  API Token: ✓ SET`);
  console.log(`  Router Model: ${ctx.routerModel}`);
  console.log(`  Embedding Model: ${ctx.embeddingModel}`);
  console.log(`  CF Enabled: ${process.env.CLOUDFLARE_ENABLED}\n`);
}

/**
 * Validate and load configuration from environment
 */
function loadConfig(): TestContext | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const routerModel = process.env.CLOUDFLARE_ROUTER_MODEL ?? "@cf/ibm-granite/granite-4.0-h-micro";
  const embeddingModel = process.env.CLOUDFLARE_EMBEDDING_MODEL ?? "@cf/qwen/qwen3-embedding-0.6b";

  if (!accountId || !apiToken) {
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║         Cloudflare Workers AI Validation Script              ║");
    console.log("╚══════════════════════════════════════════════════════════════╝\n");
    console.log("Configuration:");
    console.log(`  Account ID: ${accountId ? "✓ SET" : "✗ NOT SET"}`);
    console.log(`  API Token: ${apiToken ? "✓ SET" : "✗ NOT SET"}`);
    console.error("\n❌ Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN in .env");
    return null;
  }

  return { accountId, apiToken, routerModel, embeddingModel };
}

// ============ Main Execution (Top-level await) ============

const config = loadConfig();

if (!config) {
  process.exit(1);
}

printConfig(config);

await testRouterModel(config);
await testEmbeddingModel(config);
await testBotIntegration(config);
await testClassification(config);

console.log("═".repeat(60));
console.log("Validation complete!");
console.log(`${"═".repeat(60)}\n`);
