# Intelligent Intent Router Design

> **Living Document** - Last Updated: December 2025

This document outlines the design for an intelligent "router" AI layer that sits at the top of the orchestration flow. The router classifies user intent before loading heavy models, enabling significant VRAM savings and faster response times.

## Key Design Principle

**Keep image generation and main LLM local. Offload lightweight routing/embedding tasks to free cloud APIs to maximize local GPU resources.**

## Problem Statement

Currently, the Discord bot loads the main LLM (qwen3-abliterated:30b, ~14GB) for **every** user message, even when:

- The user is requesting an image (could route directly to ComfyUI)
- The user is asking a simple greeting (could use a lightweight response)
- The user is asking a question that could be answered without tools

This leads to:

1. **VRAM contention** when other applications are using GPU memory
2. **Unnecessary latency** from loading a 30B model for simple tasks
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
│  │  TIER 1: Groq llama-prompt-guard-2-22m (CLOUD FREE)      │   │
│  │  Cost: FREE | Latency: ~50-100ms | VRAM: 0               │   │
│  │  → Intent classification via free API                    │   │
│  │  → Fallback: Cloudflare text-classification              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           │ API unavailable                     │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  TIER 2: Local Small LLM (FALLBACK)                      │   │
│  │  Cost: FREE | Latency: ~200-500ms | VRAM: ~300MB         │   │
│  │  → smollm2:135m or granite4:350m                         │   │
│  │  → Only loaded when cloud APIs fail                      │   │
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

## Cloud Offloading Strategy

**Goal:** Preserve local VRAM for image generation (~6GB) and main LLM (~14GB) by offloading lightweight routing tasks to free cloud APIs.

### Free API Options

| Provider                  | Free Tier                | Best Use Case                                 | Latency    | Rate Limits        |
| ------------------------- | ------------------------ | --------------------------------------------- | ---------- | ------------------ |
| **Groq**                  | Unlimited (rate-limited) | Classification via `llama-prompt-guard-2-22m` | ~50-100ms  | 30 RPM, 15K TPM    |
| **Cloudflare Workers AI** | 10,000 neurons/day       | Embeddings (`bge-small-en-v1.5`)              | ~20-50ms   | None (quota-based) |
| **HuggingFace Inference** | $0.10/month credits      | Fallback embeddings                           | ~100-200ms | Varies by provider |

### Groq Integration (Primary)

```typescript
import Groq from "groq-sdk";

class GroqRouter {
  private readonly client = new Groq({ apiKey: process.env.GROQ_API_KEY });

  private readonly systemPrompt = `You are an intent classifier. Respond with ONLY one word:
- IMAGE: User wants to generate/create/draw an image
- CHAT: General conversation or greetings
- SEARCH: User wants to search or find information
- TOOLS: User needs tools (code, memory, calculations)`;

  async classify(message: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: "llama-prompt-guard-2-22m", // FREE, 22M params
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: message },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    return response.choices[0]?.message?.content?.trim() ?? "CHAT";
  }
}
```

### Rate Limit Handling

```typescript
class ResilientRouter {
  private groqFailures = 0;
  private cloudflareQuotaExhausted = false;

  async classify(message: string): Promise<RoutingDecision> {
    // Tier 0: Always try pattern matching first (free, instant)
    const patternResult = this.patternRouter.match(message);
    if (patternResult.confidence > 0.95) {
      return patternResult;
    }

    // Tier 1: Try Groq (free, fast)
    if (this.groqFailures < 3) {
      try {
        return await this.groqRouter.classify(message);
      } catch (error) {
        if (error.status === 429) {
          this.groqFailures++;
          setTimeout(() => (this.groqFailures = 0), 60000);
        }
      }
    }

    // Tier 1b: Try Cloudflare (free quota)
    if (!this.cloudflareQuotaExhausted) {
      try {
        return await this.cloudflareRouter.classify(message);
      } catch (error) {
        if (error.message.includes("quota")) {
          this.cloudflareQuotaExhausted = true;
          this.scheduleQuotaReset();
        }
      }
    }

    // Tier 2: Fall back to local small LLM
    return await this.localRouter.classify(message);
  }
}
```

## Pattern Detection Examples

### Image Generation Patterns

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

// Examples that would match:
// "draw me a cat"
// "create an image of a sunset"
// "tony and paulie from the sopranos as space marines"
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

| Scenario      | Without Router                        | With Router (Cloud)       |
| ------------- | ------------------------------------- | ------------------------- |
| Image Request | 14GB (LLM) + 6GB (Z-Image) = **20GB** | **6GB** (0 VRAM overhead) |
| Simple Chat   | 14GB (LLM) = **14GB**                 | **14GB**                  |
| Web Search    | 14GB (LLM) = **14GB**                 | **14GB**                  |

**Savings for image requests: 14GB VRAM + 2-5 seconds latency**

## ComfyUI Optimizations Applied

The following optimizations reduce VRAM usage for Z-Image-Turbo:

### Docker Configuration

```yaml
comfyui:
  environment:
    - CLI_ARGS=--fast --fp8_e4m3fn-text-enc --lowvram --cuda-malloc
    - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,garbage_collection_threshold:0.8
```

### Optimizations Breakdown

| Optimization          | Flag                    | Effect                                 | VRAM Impact               |
| --------------------- | ----------------------- | -------------------------------------- | ------------------------- |
| **Torch Compile**     | `--fast`                | 10-30% faster inference                | Neutral                   |
| **FP8 Text Encoder**  | `--fp8_e4m3fn-text-enc` | Quantizes text encoder to FP8          | **~4GB saved**            |
| **Low VRAM Mode**     | `--lowvram`             | Offloads models to CPU when not in use | **~10GB freed** when idle |
| **CUDA Malloc Async** | `--cuda-malloc`         | Better memory allocation               | Reduces fragmentation     |

## Implementation Phases

### Phase 1: Pattern-Based Router (IMMEDIATE)

**Timeline:** 1-2 hours | **VRAM:** 0 | **Cost:** FREE

- Implement regex patterns for image generation detection
- Route image requests directly to ComfyUI, bypassing LLM entirely
- **Impact:** 14GB VRAM saved for every image request

### Phase 2: Groq Cloud Classification (RECOMMENDED)

**Timeline:** 2-3 hours | **VRAM:** 0 | **Cost:** FREE

- Integrate Groq API with `llama-prompt-guard-2-22m`
- Use for ambiguous requests that don't match patterns
- **Impact:** More accurate routing, still 0 local VRAM

### Phase 3: Local Fallback Router (RESILIENCE)

**Timeline:** 2-3 hours | **VRAM:** ~300MB when active | **Cost:** FREE

- Download `smollm2:135m` as offline backup
- Only loaded when cloud APIs fail
- **Impact:** 100% availability even without internet

## Configuration

```bash
# .env additions for cloud routing
GROQ_API_KEY=gsk_xxxxxxxxxxxx          # Free at console.groq.com
CLOUDFLARE_ACCOUNT_ID=xxxxxxxxxx       # Free at dash.cloudflare.com
CLOUDFLARE_API_TOKEN=xxxxxxxxxx        # Workers AI API token
HF_TOKEN=hf_xxxxxxxxxxxx               # Free at huggingface.co/settings/tokens

# Feature flags
ROUTER_USE_CLOUD=true                  # Enable cloud routing
ROUTER_FALLBACK_LOCAL=true             # Fall back to local if cloud fails
```

## References

- [Eagle Training-Free Router](https://arxiv.org/abs/...)
- [Router-R1 RL-based Routing](https://arxiv.org/abs/...)
- [Groq API Documentation](https://console.groq.com/docs)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
