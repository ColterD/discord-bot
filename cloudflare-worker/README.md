# Cloudflare Worker - AI Proxy

Edge-deployed proxy for Workers AI that provides low-latency AI inference.

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

Generate embeddings. Requires `Authorization: Bearer <secret>`.

```json
{
  "model": "@cf/qwen/qwen3-embedding-0.6b",
  "text": "Hello world"
}
```

## Local Development

```bash
npx wrangler dev
```

This starts a local server with the Workers AI binding available.

## Costs

- **Free tier**: 100,000 requests/day
- **Workers AI**: Separate free tier (10,000 neurons/day)
- You're nowhere near these limits
