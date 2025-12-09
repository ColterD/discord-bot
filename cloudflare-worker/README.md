# Cloudflare Worker - AI Proxy

Edge-deployed proxy for Workers AI that provides low-latency AI inference.

## Endpoints Overview

| Endpoint         | Method | Auth | Description                     |
| ---------------- | ------ | ---- | ------------------------------- |
| `/health`        | GET    | No   | Health check with edge location |
| `/chat`          | POST   | Yes  | Chat completion (Workers AI)    |
| `/embed`         | POST   | Yes  | Embeddings (native format)      |
| `/v1`            | GET    | No   | OpenAI API info                 |
| `/v1/models`     | GET    | No   | List available models           |
| `/v1/embeddings` | POST   | Yes  | Embeddings (OpenAI-compatible)  |

## Why Use This?

The Cloudflare REST API (`api.cloudflare.com`) is centralized (likely in SF). This Worker runs at the **edge** - the Cloudflare datacenter closest to you - for much lower latency.

## Setup

### 1. Install Dependencies

```bash
cd cloudflare-worker
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Set the API Secret

This authenticates requests from your bot:

```bash
npx wrangler secret put API_SECRET
# Enter a strong random string (e.g., generate with: openssl rand -hex 32)
```

### 4. Deploy

```bash
npx wrangler deploy
```

You'll get a URL like: `https://discord-bot-ai-proxy.<your-subdomain>.workers.dev`

### 5. Configure the Bot

Add to your `.env`:

```env
CLOUDFLARE_WORKER_URL=https://discord-bot-ai-proxy.<your-subdomain>.workers.dev
CLOUDFLARE_WORKER_SECRET=<the secret you set above>
```

## Endpoints

### `GET /health`

Health check with edge location info. No authentication required.

```json
{
  "status": "ok",
  "edge": true,
  "datacenter": "SEA",
  "timestamp": "2024-12-06T..."
}
```

### `POST /chat`

Chat completion. Requires `Authorization: Bearer <secret>`.

```json
{
  "model": "@cf/ibm-granite/granite-4.0-h-micro",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 100
}
```

### `POST /embed`

Generate embeddings (native format). Requires `Authorization: Bearer <secret>`.

```json
{
  "model": "@cf/qwen/qwen3-embedding-0.6b",
  "text": "Hello world"
}
```

### `GET /v1`

OpenAI-compatible API info endpoint. No authentication required. Useful for health checks from OpenAI-compatible clients.

```json
{
  "object": "api",
  "version": "v1",
  "endpoints": ["/v1/models", "/v1/embeddings"]
}
```

### `GET /v1/models`

List available models (OpenAI-compatible format). No authentication required.

```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen3-embedding",
      "object": "model",
      "owned_by": "cloudflare",
      "root": "@cf/qwen/qwen3-embedding-0.6b"
    }
  ]
}
```

### `POST /v1/embeddings`

Generate embeddings (OpenAI-compatible format). Works with LangChain, LlamaIndex, ChromaDB, and other OpenAI-compatible clients. Requires `Authorization: Bearer <secret>`.

**Request:**

```json
{
  "model": "qwen3-embedding",
  "input": "Hello world"
}
```

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.1, 0.2, ...],
      "index": 0
    }
  ],
  "model": "@cf/qwen/qwen3-embedding-0.6b",
  "usage": {
    "prompt_tokens": 3,
    "total_tokens": 3
  }
}
```

The `input` field can be a single string or an array of strings for batch embedding.

## Local Development

```bash
npx wrangler dev
```

This starts a local server with the Workers AI binding available.

## Costs

- **Free tier**: 100,000 requests/day
- **Workers AI**: Separate free tier (10,000 neurons/day)
- You're nowhere near these limits
