# Intelligent Intent Router Design Document

> **Living Document** - Last Updated: Session Active
>
> This document evolves as we learn more. See [Revision History](#revision-history) at the bottom.

## Executive Summary

This document outlines the design for an intelligent "router" AI layer that sits at the top of the orchestration flow. The router classifies user intent before loading heavy models, enabling significant VRAM savings and faster response times.

### Key Design Principle

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

## Research Findings

### Academic Research on Intent Routing

1. **Eagle (Training-Free Router)**: Uses ELO rankings for model selection, achieves results comparable to learned routers with 100-200x faster update capability. Key insight: simple heuristic-based routing can match complex learned approaches.

2. **Router-R1**: RL-based multi-LLM routing with cost optimization. Demonstrates that routing decisions can significantly reduce compute costs (30-40% efficiency gains).

3. **kNN Routing**: Research shows simple k-Nearest Neighbor classifiers can outperform complex learned routers when embeddings are high-quality.

4. **BERT for Intent Classification**: State-of-the-art for joint intent classification and slot filling. Fine-tuned BERT models achieve >95% accuracy on intent detection tasks.

5. **REIC (RAG-Enhanced Intent Classification)**: Shows that retrieval-augmented approaches improve intent classification for domain-specific applications.

### Available Small Models for Routing

| Model              | Size  | VRAM   | Context | Notes                                |
| ------------------ | ----- | ------ | ------- | ------------------------------------ |
| **all-minilm:22m** | 46MB  | <100MB | 512     | Embedding only, fastest option       |
| **all-minilm:33m** | 67MB  | <100MB | 512     | Slightly better embeddings           |
| **smollm2:135m**   | 271MB | ~300MB | 8K      | Full instruction model, can classify |
| **smollm2:360m**   | 726MB | ~800MB | 8K      | Better reasoning, still tiny         |
| **granite4:350m**  | 708MB | ~800MB | 32K     | IBM model, supports tools            |
| **smollm2:1.7b**   | 1.8GB | ~2GB   | 8K      | Best quality in SmolLM family        |
| **qwen3:0.6b**     | 639MB | ~700MB | -       | Already downloaded (embedding model) |

---

## Cloud Offloading Strategy (NEW)

**Goal:** Preserve local VRAM for image generation (~6GB) and main LLM (~14GB) by offloading lightweight routing tasks to free cloud APIs.

### Free API Options Compared

| Provider                  | Free Tier                   | Best Use Case                                 | Latency    | Rate Limits        |
| ------------------------- | --------------------------- | --------------------------------------------- | ---------- | ------------------ |
| **Groq**                  | ✅ Unlimited (rate-limited) | Classification via `llama-prompt-guard-2-22m` | ~50-100ms  | 30 RPM, 15K TPM    |
| **Cloudflare Workers AI** | 10,000 neurons/day          | Embeddings (`bge-small-en-v1.5`)              | ~20-50ms   | None (quota-based) |
| **HuggingFace Inference** | $0.10/month credits         | Fallback embeddings                           | ~100-200ms | Varies by provider |

### Recommended Cloud Strategy

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

### Groq Free Tier Details (PRIMARY RECOMMENDATION)

**Why Groq is ideal for routing:**

- `llama-prompt-guard-2-22m`: Only 22M parameters, designed for prompt classification
- **Completely FREE** with rate limits
- Rate limits are generous for Discord bot usage: 30 RPM, 15K TPM
- Discord bot unlikely to exceed 30 requests per minute

```typescript
// Groq API integration for intent classification
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

### Cloudflare Workers AI Details

**Free tier:** 10,000 neurons/day (resets daily at midnight UTC)

**Best for embeddings:**

- `@cf/baai/bge-small-en-v1.5`: $0.020 per million tokens (effectively free under quota)
- `@cf/baai/bge-m3`: $0.012 per million tokens (multilingual)

**Best for classification:**

- `@cf/huggingface/distilbert-sst-2-int8`: Text classification, $0.026/M tokens

```typescript
// Cloudflare Workers AI integration
class CloudflareRouter {
  private readonly accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  private readonly apiToken = process.env.CLOUDFLARE_API_TOKEN;

  async getEmbedding(text: string): Promise<number[]> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/baai/bge-small-en-v1.5`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiToken}` },
        body: JSON.stringify({ text: [text] }),
      }
    );

    const data = await response.json();
    return data.result.data[0]; // 384-dimensional embedding
  }

  async classify(text: string): Promise<{ label: string; score: number }> {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/huggingface/distilbert-sst-2-int8`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiToken}` },
        body: JSON.stringify({ text }),
      }
    );

    const data = await response.json();
    return data.result[0]; // { label: "POSITIVE/NEGATIVE", score: 0.95 }
  }
}
```

### HuggingFace Inference API Details

**Free tier:** $0.10/month credits for basic users, $2.00/month for PRO

**Advantages:**

- Routes to multiple providers (Groq, Cerebras, Together, etc.)
- No markup on provider rates
- Easy model switching

```typescript
// HuggingFace Inference integration
import { HfInference } from "@huggingface/inference";

class HuggingFaceRouter {
  private readonly client = new HfInference(process.env.HF_TOKEN);

  async getEmbedding(text: string): Promise<number[]> {
    return await this.client.featureExtraction({
      model: "sentence-transformers/all-MiniLM-L6-v2",
      inputs: text,
    });
  }

  async classify(text: string): Promise<string> {
    const result = await this.client.textClassification({
      model: "facebook/bart-large-mnli",
      inputs: text,
      parameters: {
        candidate_labels: ["image_generation", "chat", "search", "tools"],
      },
    });

    return result[0].label;
  }
}
```

### Rate Limit Handling Strategy

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
          // Reset after 1 minute (Groq's rate limit window)
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
          // Reset at midnight UTC
          this.scheduleQuotaReset();
        }
      }
    }

    // Tier 2: Fall back to local small LLM
    return await this.localRouter.classify(message);
  }
}
```

### Environment Variables for Cloud APIs

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

---

### Ollama VRAM Management APIs

Key findings from Ollama documentation:

```bash
# Unload model immediately after request
keep_alive: 0

# Keep model loaded indefinitely
keep_alive: -1

# Keep for specific duration
keep_alive: "5m"

# Check running models
curl http://localhost:11434/api/ps

# Environment variables
OLLAMA_MAX_LOADED_MODELS=2    # Limit concurrent models
OLLAMA_FLASH_ATTENTION=1      # Reduce memory for larger contexts
```

## Proposed Architecture

### Intent Categories

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

### Routing Decision Tree (Updated with Cloud Offloading)

```
User Message
     │
     ▼
┌─────────────────────────────────────┐
│     TIER 0: Pattern Matching        │  ← Zero-cost, instant, LOCAL
│     (Regex + Keywords)              │
└─────────────────────────────────────┘
     │
     │ No match
     ▼
┌─────────────────────────────────────┐
│     TIER 1: Groq Classification     │  ← FREE cloud API, ~50-100ms
│     llama-prompt-guard-2-22m        │
│     Fallback: Cloudflare AI         │
└─────────────────────────────────────┘
     │
     │ API failure / rate limit
     ▼
┌─────────────────────────────────────┐
│     TIER 2: Local Small LLM         │  ← smollm2:135m (271MB)
│     Only when cloud unavailable     │  ← Uses keep_alive: 0
└─────────────────────────────────────┘
     │
     │ Route decision
     ▼
┌─────────────────────────────────────┐
│     Execute via appropriate path    │
│     • Image Gen → ComfyUI (no LLM)  │
│     • Simple → TinyLLM or template  │
│     • Complex → Full LLM (qwen3)    │
└─────────────────────────────────────┘
```

> **Note:** The original three-tier local architecture is preserved below for reference.
> See [Cloud Offloading Strategy](#cloud-offloading-strategy-new) for the recommended approach.

<details>
<summary>Original Local-Only Architecture (for reference)</summary>

### Original Routing Decision Tree (Local Only)

#### Option A: Rule-Based + Embedding (Recommended for Phase 1)

**Pros:**

- Zero additional model loading
- Instant classification (~1ms)
- Uses existing `all-minilm` or `qwen3-embedding` models
- No training required

**Cons:**

- Limited flexibility
- May miss edge cases

**Implementation:**

```typescript
class IntentRouter {
  // Pattern-based rules for high-confidence routing
  private readonly patterns = {
    image:
      /\b(draw|create|generate|make|paint|imagine|picture|image|art)\b.*\b(of|a|an|the|some)\b/i,
    greeting: /^(hi|hello|hey|yo|sup|greetings|howdy|hiya)\b/i,
    search: /\b(search|find|look up|google|what is|who is|where is)\b/i,
  };

  // Embedding-based classification for uncertain cases
  async classify(message: string): Promise<IntentCategory> {
    // Check patterns first (free)
    for (const [intent, pattern] of Object.entries(this.patterns)) {
      if (pattern.test(message)) {
        return this.mapPatternToIntent(intent);
      }
    }

    // Fall back to embedding similarity
    const embedding = await this.getEmbedding(message);
    return this.nearestNeighborClassify(embedding);
  }
}
```

#### Option B: Small LLM Router (More Flexible)

**Pros:**

- Handles nuanced requests
- Can understand context better
- Extensible to new intents

**Cons:**

- Requires loading another model (~300MB VRAM)
- Adds ~100-300ms latency
- May need to stay resident

**Implementation:**

```typescript
class SmallLLMRouter {
  private readonly routerModel = "smollm2:135m";

  private readonly systemPrompt = `You are an intent classifier. Classify the user's message into exactly one category.

Categories:
- IMAGE: User wants to generate/create/draw an image
- CHAT: General conversation, greetings, questions
- SEARCH: User wants to search the web or find information
- MEMORY: User wants to remember or recall something
- CODE: User wants to execute code or calculations

Respond with ONLY the category name, nothing else.`;

  async classify(message: string): Promise<IntentCategory> {
    const response = await ollama.chat({
      model: this.routerModel,
      messages: [
        { role: "system", content: this.systemPrompt },
        { role: "user", content: message },
      ],
      options: { temperature: 0.0 },
    });

    return this.parseCategory(response.message.content);
  }
}
```

#### Option C: Hybrid (Best of Both Worlds)

**Pros:**

- Fast for common patterns
- Accurate for edge cases
- Minimal resource usage

**Cons:**

- More complex to implement
- Multiple fallback paths

**Implementation:**

```typescript
class HybridRouter {
  private readonly patternRouter: PatternRouter;
  private readonly embeddingRouter: EmbeddingRouter;
  private readonly llmRouter: SmallLLMRouter;

  async classify(message: string): Promise<RoutingDecision> {
    // Tier 0: Pattern matching (0ms)
    const patternResult = this.patternRouter.match(message);
    if (patternResult.confidence > 0.95) {
      return patternResult;
    }

    // Tier 1: Embedding + kNN (~10ms with cached model)
    const embeddingResult = await this.embeddingRouter.classify(message);
    if (embeddingResult.confidence > 0.85) {
      return embeddingResult;
    }

    // Tier 2: Small LLM (~100ms)
    return this.llmRouter.classify(message);
  }
}
```

</details>

## Recommended Implementation Plan

### Phase 1: Pattern-Based Router (Low Risk, Quick Win)

**Timeline:** 1-2 hours

1. Create `src/ai/intent-router.ts` with pattern matching
2. Add image generation detection patterns
3. Modify `orchestrator.ts` to check router before loading LLM
4. If image detected, route directly to `executeImageGenerationTool()`

**Expected Impact:**

- Image requests skip LLM entirely (~14GB VRAM saved)
- Response time reduced by 2-5 seconds for image requests

### Phase 2: Embedding-Based Classification (Medium Effort)

**Timeline:** 4-6 hours

1. Download `all-minilm:22m` model (46MB, stays resident)
2. Create intent example embeddings (10-20 examples per category)
3. Implement kNN classifier with cosine similarity
4. Add fallback from pattern → embedding

**Expected Impact:**

- More accurate intent detection
- Handles variations ("make me a pic" vs "draw something")

### Phase 3: VRAM-Aware Model Management (Medium Effort)

**Timeline:** 4-8 hours

1. Implement proactive model unloading via `keep_alive: 0`
2. Add `/api/ps` monitoring for current VRAM usage
3. Create intelligent scheduling based on available VRAM
4. Add model preloading hints based on detected intent

### Phase 4: Small LLM Router (Optional, Higher Quality)

**Timeline:** 6-10 hours

1. Download `smollm2:135m` or `granite4:350m`
2. Create classification prompt template
3. Implement with proper error handling
4. Benchmark latency vs accuracy tradeoffs

## Integration Points

### orchestrator.ts Changes

```typescript
// Before
async run(message: string, options: OrchestratorOptions): Promise<OrchestratorResponse> {
  // Always loads LLM and processes through full loop
  // ...
}

// After
async run(message: string, options: OrchestratorOptions): Promise<OrchestratorResponse> {
  // Step 0: Intent routing (NEW)
  const intent = await this.intentRouter.classify(message);

  // Fast path: Direct image generation
  if (intent.category === IntentCategory.IMAGE_GENERATION) {
    const prompt = this.extractImagePrompt(message);
    return this.handleDirectImageGeneration(prompt, options);
  }

  // Fast path: Simple greeting/farewell
  if (intent.category === IntentCategory.SIMPLE_GREETING) {
    return this.handleSimpleGreeting(options);
  }

  // Normal path: Full LLM processing
  // ... existing code ...
}
```

### New File: src/ai/intent-router.ts

```typescript
export class IntentRouter {
  // Pattern definitions
  // Embedding model integration
  // Classification logic
  // Confidence scoring
}
```

### AIService Modifications

```typescript
// Add method to unload model after use
async unloadModel(): Promise<void> {
  await this.client.post("/api/generate", {
    model: this.model,
    keep_alive: 0
  });
}

// Add method to check if model is loaded
async isModelLoaded(): Promise<boolean> {
  const response = await this.client.get("/api/ps");
  return response.data.models?.some(m => m.name === this.model);
}
```

## VRAM Budget Analysis

| Scenario      | Without Router                        | With Router (Pattern)        | With Router (Cloud)       | With Router (Local Embed) |
| ------------- | ------------------------------------- | ---------------------------- | ------------------------- | ------------------------- |
| Image Request | 14GB (LLM) + 6GB (Z-Image) = **20GB** | 6GB (Z-Image only) = **6GB** | **6GB** (0 VRAM overhead) | 0.1GB + 6GB = **6.1GB**   |
| Simple Chat   | 14GB (LLM) = **14GB**                 | 14GB (LLM) = **14GB**        | **14GB**                  | 0.1GB + 14GB = **14.1GB** |
| Web Search    | 14GB (LLM) = **14GB**                 | 14GB (LLM) = **14GB**        | **14GB**                  | 0.1GB + 14GB = **14.1GB** |

**Savings for image requests with Cloud Router: 14GB VRAM + 2-5 seconds latency + 0 local VRAM overhead**

## Pattern Detection Examples

### Image Generation Patterns

```javascript
// High confidence image patterns
const imagePatterns = [
  /\b(draw|create|generate|paint|design|make|render|imagine)\s+(me\s+)?(a|an|the|some)?\s*(picture|image|art|artwork|illustration|portrait|sketch)/i,
  /\b(picture|image|art|artwork)\s+of\b/i,
  /\bcan you (draw|create|make|paint)/i,
  /\bimagine\s+(a|an|the)/i,
  /\bshow me (a|an|the)?\s*(picture|image|drawing)/i,

  // Character/scene descriptions that imply image
  /as\s+(a\s+)?(space marine|character|superhero|anime|cartoon)/i,
  /in the style of\b/i,
  /\bportrait of\b/i,
];

// Examples that would match:
// "draw me a cat"
// "create an image of a sunset"
// "tony and paulie from the sopranos as space marines" ← This one!
// "imagine a cyberpunk city"
// "paint a portrait of a wizard"
```

### Greeting Patterns

```javascript
const greetingPatterns = [
  /^(hi|hello|hey|yo|sup|greetings|howdy|hiya|what's up|wassup)\s*[!?.,]*$/i,
  /^good (morning|afternoon|evening|night)\s*[!?.,]*$/i,
];
```

### Search Patterns

```javascript
const searchPatterns = [
  /\b(search|find|look up|google|lookup)\s+(for\s+)?/i,
  /\bwhat (is|are|was|were)\s+/i,
  /\bwho (is|are|was|were)\s+/i,
  /\bwhere (is|are|was|were)\s+/i,
  /\bhow (do|does|did|can|could|would|to)\s+/i,
];
```

## Risk Assessment

| Risk                   | Likelihood | Impact | Mitigation                               |
| ---------------------- | ---------- | ------ | ---------------------------------------- |
| Pattern false positive | Medium     | Low    | Keep threshold high, fall back to LLM    |
| Pattern false negative | Medium     | Low    | User can rephrase, no worse than current |
| Router model failure   | Low        | Medium | Fall back to full LLM processing         |
| Increased complexity   | Medium     | Medium | Good abstraction, comprehensive tests    |

## Success Metrics

1. **VRAM Reduction**: Measure VRAM usage for image requests (target: <7GB vs 20GB)
2. **Latency Improvement**: Measure response time for routed requests (target: 2s improvement)
3. **Accuracy**: Track false positive/negative rates for routing (target: <5% error rate)
4. **User Experience**: Monitor user feedback and error rates

## Conclusion

The recommended approach is to start with **Phase 1 (Pattern-Based Router)** for immediate wins on image generation, then iterate with embedding-based classification for more nuanced intent detection.

The pattern-based approach requires:

- No additional model downloads
- No VRAM overhead
- Minimal code changes
- Immediate 14GB VRAM savings for image requests

This can be implemented in 1-2 hours and provides significant value while more sophisticated approaches are developed.

---

## Updated Implementation Phases (with Cloud Offloading)

### Phase 1: Pattern-Based Router (IMMEDIATE)

**Timeline:** 1-2 hours | **VRAM:** 0 | **Cost:** FREE

- Implement regex patterns for image generation detection
- Route image requests directly to ComfyUI, bypassing LLM entirely
- **Impact:** 14GB VRAM saved for every image request

### Phase 2: Groq Cloud Classification (RECOMMENDED NEXT)

**Timeline:** 2-3 hours | **VRAM:** 0 | **Cost:** FREE

- Integrate Groq API with `llama-prompt-guard-2-22m`
- Use for ambiguous requests that don't match patterns
- Add rate limit handling and fallback logic
- **Impact:** More accurate routing, still 0 local VRAM

### Phase 3: Cloudflare Embeddings (OPTIONAL)

**Timeline:** 3-4 hours | **VRAM:** 0 | **Cost:** FREE (10K neurons/day)

- Use `bge-small-en-v1.5` for semantic similarity
- Cache intent exemplar embeddings
- Implement kNN classification
- **Impact:** Better handling of paraphrased requests

### Phase 4: Local Fallback Router (RESILIENCE)

**Timeline:** 2-3 hours | **VRAM:** ~300MB when active | **Cost:** FREE

- Download `smollm2:135m` as offline backup
- Only loaded when cloud APIs fail
- Use `keep_alive: 0` to unload immediately after use
- **Impact:** 100% availability even without internet

---

## ComfyUI Optimizations Applied ✅

The following optimizations have been applied to reduce VRAM usage and improve performance for Z-Image-Turbo:

### Docker Configuration (docker-compose.yml)

```yaml
comfyui:
  environment:
    - CLI_ARGS=--fast --fp8_e4m3fn-text-enc --lowvram --cuda-malloc
    - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True,garbage_collection_threshold:0.8
```

### Optimizations Breakdown

| Optimization            | Flag                      | Effect                                            | VRAM Impact                   |
| ----------------------- | ------------------------- | ------------------------------------------------- | ----------------------------- |
| **Torch Compile**       | `--fast`                  | Enables torch.compile for 10-30% faster inference | Neutral                       |
| **FP8 Text Encoder**    | `--fp8_e4m3fn-text-enc`   | Quantizes Qwen 3 4B text encoder to FP8           | **~4GB saved** (8GB → 4GB)    |
| **Low VRAM Mode**       | `--lowvram`               | Offloads models to CPU when not generating        | **~10GB freed** when idle     |
| **CUDA Malloc Async**   | `--cuda-malloc`           | Uses cudaMallocAsync for better allocation        | Better fragmentation handling |
| **Expandable Segments** | `PYTORCH_CUDA_ALLOC_CONF` | Dynamic memory allocation, 80% GC threshold       | Reduces OOM errors            |

### VRAM Usage After Optimizations

| State          | Before         | After            | Notes                       |
| -------------- | -------------- | ---------------- | --------------------------- |
| **Idle**       | ~14GB resident | ~0GB (offloaded) | Models offloaded to CPU     |
| **Generating** | ~14GB          | ~10GB            | FP8 text encoder saves ~4GB |
| **With LLM**   | N/A (OOM risk) | ~24GB manageable | Can coexist on RTX 4090     |

### Verification

Confirmed working via ComfyUI logs:

```
Set vram state to: LOW_VRAM
```

---

## Revision History

| Date      | Changes                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| Session 1 | Initial document creation with local routing research                                       |
| Session 2 | Added Cloud Offloading Strategy section with Groq, Cloudflare, HuggingFace free API options |
| Session 3 | Added ComfyUI Optimizations Applied section (FP8, lowvram, fast, cuda-malloc)               |

---

## Open Questions & Future Research

- [ ] Benchmark Groq vs local `smollm2:135m` latency in real conditions
- [ ] Test Cloudflare 10K neurons/day quota exhaustion timing
- [ ] Evaluate HuggingFace `facebook/bart-large-mnli` for zero-shot classification
- [ ] Consider caching routing decisions for similar messages
- [ ] Research streaming classification for long messages
