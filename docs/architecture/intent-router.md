# Intelligent Intent Router

> **Architecture Document** - Last Updated: December 2025

This document describes the intelligent "router" AI layer that classifies user intent before loading heavy models, enabling significant VRAM savings and faster response times.

## Key Design Principle

**Keep image generation and main LLM local. Offload lightweight routing/embedding tasks to Cloudflare Workers AI to maximize local GPU resources.**

## Problem Statement

Without routing, the Discord bot would load the main LLM (~14GB) for **every** user message, even when:

- The user is requesting an image (could route directly to ComfyUI)
- The user is asking a simple greeting (could use a lightweight response)
- The user is asking a question that could be answered without tools

This leads to:

1. **VRAM contention** when other applications are using GPU memory
2. **Unnecessary latency** from loading a large model for simple tasks
3. **Resource waste** when the task could be handled by smaller models

## Routing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    ROUTING ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  TIER 0: Pattern Matching (LOCAL)                        │   │
│  │  Cost: FREE | Latency: <1ms | VRAM: 0                    │   │
│  │  → Regex for "draw", "create image", "imagine", etc.     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           │ No match                            │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  TIER 1: Cloudflare Workers AI (CLOUD FREE)              │   │
│  │  Cost: FREE | Latency: ~20-50ms | VRAM: 0                │   │
│  │  → Router: @cf/ibm-granite/granite-4.0-h-micro           │   │
│  │  → Embeddings: @cf/qwen/qwen3-embedding-0.6b             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           │ Quota exhausted or unavailable      │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  TIER 2: Local Ollama (FALLBACK)                         │   │
│  │  Cost: FREE | Latency: ~100-300ms | VRAM: ~1GB           │   │
│  │  → qwen3-embedding:0.6b for embeddings                   │   │
│  │  → Main LLM for classification if needed                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Intent Categories

```typescript
enum IntentCategory {
  // Direct routing - no LLM needed
  IMAGE_GENERATION = "image_generation", // Route directly to ComfyUI

  // Lightweight LLM sufficient
  SIMPLE_GREETING = "simple_greeting", // "hi", "hello", "hey"
  SIMPLE_FAREWELL = "simple_farewell", // "bye", "goodbye"
  SIMPLE_THANKS = "simple_thanks", // "thanks", "thank you"

  // Main LLM required
  GENERAL_CHAT = "general_chat", // Conversational responses
  KNOWLEDGE_QUESTION = "knowledge_question", // Factual questions
  REASONING = "reasoning", // Complex analysis

  // Main LLM + Tools required
  WEB_SEARCH = "web_search", // "search for", "find"
  MEMORY_OPERATION = "memory_operation", // "remember", "recall"
  CODE_EXECUTION = "code_execution", // "run", "calculate"
}
```

## Cloudflare Workers AI Integration

### Why Cloudflare?

| Feature            | Benefit                                              |
| ------------------ | ---------------------------------------------------- |
| **Free tier**      | 10,000 neurons/day (generous for routing)            |
| **Low latency**    | Edge compute, ~20-50ms response times                |
| **Same models**    | qwen3-embedding matches local Ollama version         |
| **No rate limits** | Quota-based, not request-limited                     |
| **Edge Worker**    | Optional low-latency proxy for even faster responses |

### Provider Implementation

The `CloudflareProvider` class in `src/ai/providers/cloudflare-provider.ts` handles:

- **Classification**: Uses Granite 4.0 micro for intent detection
- **Embeddings**: Uses Qwen3 embedding (1024 dimensions)
- **Quota tracking**: Automatically falls back when daily quota exhausted
- **Edge Worker support**: Optional Worker proxy for lower latency

```typescript
// Example: Classification request
const result = await cloudflareProvider.classify("draw me a cat in space", [
  "image_generation",
  "general_chat",
  "web_search",
  "memory_operation",
]);
// Returns: { intent: "image_generation", confidence: 0.9 }
```

### Quota Management

The provider tracks quota usage and gracefully degrades:

```typescript
// Automatic fallback when quota exhausted
if (cloudflareProvider.isQuotaExhausted()) {
  // Falls back to local Ollama
  return await ollamaProvider.embed(text);
}

// Quota resets at midnight UTC daily
const resetTime = cloudflareProvider.getQuotaResetTime();
```

## Pattern Detection

### Image Generation Patterns

Fast, zero-VRAM detection for common image requests:

```javascript
const imagePatterns = [
  /\b(draw|create|generate|paint|design|make|render|imagine)\s+(me\s+)?(a|an|the|some)?\s*(picture|image|art|artwork|illustration|portrait|sketch)/i,
  /\b(picture|image|art|artwork)\s+of\b/i,
  /\bcan you (draw|create|make|paint)/i,
  /\bimagine\s+(a|an|the)/i,
  /\bshow me (a|an|the)?\s*(picture|image|drawing)/i,
  /as\s+(a\s+)?(space marine|character|superhero|anime|cartoon)/i,
  /in the style of\b/i,
  /\bportrait of\b/i,
];

// Examples that match:
// "draw me a cat"
// "create an image of a sunset"
// "imagine a cyberpunk city"
```

### Greeting Patterns

```javascript
const greetingPatterns = [
  /^(hi|hello|hey|yo|sup|greetings|howdy|hiya|what's up|wassup)\s*[!?.,]*$/i,
  /^good (morning|afternoon|evening|night)\s*[!?.,]*$/i,
];
```

## VRAM Budget Analysis

| Scenario      | Without Router                        | With Router                  |
| ------------- | ------------------------------------- | ---------------------------- |
| Image Request | 14GB (LLM) + 6GB (ComfyUI) = **20GB** | **6GB** (0 routing overhead) |
| Simple Chat   | 14GB (LLM) = **14GB**                 | **14GB** (no savings)        |
| Web Search    | 14GB (LLM) = **14GB**                 | **14GB** (no savings)        |

**Savings for image requests: 14GB VRAM + 2-5 seconds latency**

## ComfyUI Optimizations

The following optimizations reduce VRAM usage for image generation:

### Docker Configuration

```yaml
comfyui:
  environment:
    - CLI_ARGS=--fast --fp8_e4m3fn-text-enc --lowvram --cuda-malloc
    - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,garbage_collection_threshold:0.8
```

### Optimizations Breakdown

| Optimization          | Flag                    | Effect                    | VRAM Impact           |
| --------------------- | ----------------------- | ------------------------- | --------------------- |
| **Torch Compile**     | `--fast`                | 10-30% faster inference   | Neutral               |
| **FP8 Text Encoder**  | `--fp8_e4m3fn-text-enc` | Quantizes text encoder    | **~4GB saved**        |
| **Low VRAM Mode**     | `--lowvram`             | Offloads to CPU when idle | **~10GB freed**       |
| **CUDA Malloc Async** | `--cuda-malloc`         | Better allocation         | Reduces fragmentation |

## Configuration

All configuration is via environment variables (see `.env.example`):

```env
# Cloudflare Workers AI
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
CLOUDFLARE_ROUTER_MODEL=@cf/ibm-granite/granite-4.0-h-micro
CLOUDFLARE_EMBEDDING_MODEL=@cf/qwen/qwen3-embedding-0.6b

# Optional: Edge Worker for lower latency
CLOUDFLARE_WORKER_URL=https://your-worker.your-subdomain.workers.dev
CLOUDFLARE_WORKER_SECRET=your_secret

# Local fallback
EMBEDDING_MODEL=qwen3-embedding:0.6b
```

## Edge Worker (Optional)

For even lower latency (~10-20ms), deploy the Edge Worker from `cloudflare-worker/`:

```bash
cd cloudflare-worker
npm install
npm run deploy
```

The Worker provides:

- Lower latency (edge compute vs REST API)
- Request caching
- Datacenter affinity tracking

## References

- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Granite 4.0 Model Card](https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/)
- [Qwen3 Embedding Model](https://developers.cloudflare.com/workers-ai/models/qwen3-embedding-0.6b/)
