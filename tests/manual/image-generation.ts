/**
 * Quick Image Generation Test
 *
 * Tests ComfyUI Z-Image-Turbo directly without Discord bot
 * Run with: npx tsx tests/test-image-generation.ts "your prompt here"
 */

import { randomInt, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const COMFYUI_URL = process.env.COMFYUI_URL ?? "http://localhost:8188";
const CLIENT_ID = randomUUID();

interface QueuePromptResponse {
  prompt_id: string;
  number: number;
}

type HistoryResponse = Record<
  string,
  {
    outputs: Record<
      string,
      {
        images?: {
          filename: string;
          subfolder: string;
          type: string;
        }[];
      }
    >;
    status: {
      completed: boolean;
      status_str: string;
    };
  }
>;

/**
 * Build Z-Image-Turbo workflow
 */
function buildWorkflow(
  prompt: string,
  options: { width?: number; height?: number; steps?: number; seed?: number } = {}
): Record<string, unknown> {
  const {
    width = 1024,
    height = 1024,
    steps = 9, // Official Tongyi-MAI: num_inference_steps=9
    seed = randomInt(1000000000),
  } = options;

  return {
    // Load diffusion model (UNet)
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: "z_image_turbo_bf16.safetensors",
        weight_dtype: "default",
      },
    },
    // Load text encoder - official workflow uses CLIPLoader with dtype "default"
    "2": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: "qwen_3_4b.safetensors",
        type: "lumina2",
        device: "default",
      },
    },
    // Apply AuraFlow sampling
    "3": {
      class_type: "ModelSamplingAuraFlow",
      inputs: {
        model: ["1", 0],
        shift: 3,
      },
    },
    // Positive prompt
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 0],
        text: prompt,
      },
    },
    // Negative prompt - official workflow uses "blurry ugly bad"
    "5": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["2", 0],
        text: "blurry ugly bad",
      },
    },
    // SD3 latent
    "6": {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    },
    // Load VAE
    "7": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "ae.safetensors",
      },
    },
    // KSampler - official settings: steps=9, cfg=1, euler, simple
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["3", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed,
        steps,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
      },
    },
    // Decode latent to image
    "9": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["8", 0],
        vae: ["7", 0],
      },
    },
    // Save image
    "10": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "test_image",
        images: ["9", 0],
      },
    },
  };
}

/**
 * Wait for prompt completion
 */
async function waitForCompletion(
  promptId: string,
  maxWaitMs = 120000
): Promise<{ filename: string; subfolder: string; type: string } | null> {
  const startTime = Date.now();
  const pollInterval = 1000;

  console.log("⏳ Waiting for image generation...");

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetch(`${COMFYUI_URL}/history/${promptId}`);

    if (!response.ok) {
      await delay(pollInterval);
      continue;
    }

    const history = (await response.json()) as HistoryResponse;
    const promptHistory = history[promptId];

    if (promptHistory?.status?.completed) {
      // Find the output image
      for (const nodeOutput of Object.values(promptHistory.outputs)) {
        if (nodeOutput.images?.length) {
          return nodeOutput.images[0];
        }
      }
      return null;
    }

    process.stdout.write(".");
    await delay(pollInterval);
  }

  throw new Error("Timeout waiting for image generation");
}

/**
 * Download the generated image
 */
async function downloadImage(filename: string, subfolder: string, type: string): Promise<Buffer> {
  const params = new URLSearchParams({
    filename,
    subfolder,
    type,
  });

  const response = await fetch(`${COMFYUI_URL}/view?${params}`);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const prompt = process.argv[2] ?? "tony and paulie from the sopranos as space marines";

  console.log("🖼️  Z-Image-Turbo Test");
  console.log("━".repeat(50));
  console.log(`📝 Prompt: ${prompt}`);
  console.log(`🔗 ComfyUI URL: ${COMFYUI_URL}`);
  console.log("━".repeat(50));

  try {
    // Check ComfyUI is running
    console.log("\n📡 Checking ComfyUI connection...");
    const healthResponse = await fetch(`${COMFYUI_URL}/system_stats`);
    if (!healthResponse.ok) {
      throw new Error(`ComfyUI not responding: ${healthResponse.statusText}`);
    }
    const stats = await healthResponse.json();
    console.log(
      `✅ Connected! GPU: ${(stats as { devices: { name: string }[] }).devices?.[0]?.name ?? "Unknown"}`
    );

    // Build and queue the workflow
    console.log("\n🔧 Building workflow...");
    const workflow = buildWorkflow(prompt);

    console.log("📤 Queuing prompt...");
    const startTime = Date.now();

    const queueResponse = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: workflow,
        client_id: CLIENT_ID,
      }),
    });

    if (!queueResponse.ok) {
      const errorText = await queueResponse.text();
      throw new Error(`Failed to queue prompt: ${errorText}`);
    }

    const queueData = (await queueResponse.json()) as QueuePromptResponse;
    console.log(`✅ Queued with ID: ${queueData.prompt_id}`);

    // Wait for completion
    const imageInfo = await waitForCompletion(queueData.prompt_id);
    const generationTime = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!imageInfo) {
      throw new Error("No image in output");
    }

    console.log(`\n✅ Generated in ${generationTime}s!`);

    // Download and save
    console.log("\n📥 Downloading image...");
    const imageBuffer = await downloadImage(
      imageInfo.filename,
      imageInfo.subfolder,
      imageInfo.type
    );

    const outputPath = `tests/output_${Date.now()}.png`;
    // codeql[js/http-to-file-access] - Intentional test: save generated image from local ComfyUI
    writeFileSync(outputPath, imageBuffer);
    console.log(`💾 Saved to: ${outputPath}`);
    console.log(`📊 Size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);

    console.log(`\n${"━".repeat(50)}`);
    console.log("🎉 Test completed successfully!");
    console.log("━".repeat(50));

    // Graceful exit
    setTimeout(() => process.exit(0), 100);
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : error);
    setTimeout(() => process.exit(1), 100);
  }
}

await main();
