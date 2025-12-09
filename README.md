# Discord Bot

> [!CAUTION]
> **⚠️ WORK IN PROGRESS - NOT READY FOR PRODUCTION**
>
> This project is under active development and is not yet stable. APIs may change without notice, features may be incomplete or broken, and there may be security issues that have not been addressed. Use at your own risk.

A feature-rich Discord bot built with **discordx** and **TypeScript**, featuring local LLM integration via Ollama, ChatGPT-style memory, tool calling, MCP integration, and Docker containerization.

## Features

- 🎯 **Slash Commands** - Modern Discord slash commands with decorators
- 🤖 **AI Integration** - Local LLM support via Ollama (optimized for RTX 4090)
- 🧠 **ChatGPT-Style Memory** - Three-tier memory system: Active context (Valkey), User profile (ChromaDB), Episodic memory (ChromaDB)
- 🔧 **Tool Calling** - AI agent with tool execution loop including:
  - 🔍 Web search (quick and deep search via SearXNG)
  - 🌐 URL fetching and content extraction
  - 📚 arXiv paper search
  - 🧮 Mathematical calculations
  - ⏰ Timezone conversions
  - 📖 Wikipedia summaries
  - 💭 Chain-of-thought reasoning
  - 💾 Memory storage and recall
- 🔌 **MCP Integration** - Model Context Protocol support for external tools (stdio and Docker gateway transports)
- 🛡️ **Security** - Impersonation detection, prompt injection protection, 4-tier tool permissions
- 🖼️ **Image Generation** - ComfyUI integration for AI image generation
- 🔒 **Moderation Tools** - Kick, ban, and message management
- 🧩 **Interactive UI** - Buttons, select menus, and modals
- 🔒 **Guards & Middleware** - Permission checks, rate limiting, bot filtering
- 🐳 **Docker Support** - Full containerized deployment with security hardening
- 📊 **GPU/VRAM Management** - Intelligent VRAM management for shared GPU workloads

## Architecture

### Memory System (Three-Tier)

1. **Active Context** - Current conversation in Valkey with auto-summarization (30 min TTL)
2. **User Profile** - Long-term facts and preferences via ChromaDB semantic memory
3. **Episodic Memory** - Relevant past conversations via ChromaDB vector search

### Tool Permissions (Four-Tier)

| Tier       | Access                    | Examples                             |
| ---------- | ------------------------- | ------------------------------------ |
| Owner-only | Bot owner exclusively     | filesystem\_\*, execute, shell, eval |
| Restricted | Hidden from non-owners    | code_interpreter, admin\_\*          |
| Elevated   | Visible but may be denied | database\_\*, memory_edit            |
| Public     | Available to all          | web_search, calculate, get_time      |

### Security Features

- **Impersonation Detection** - Pattern matching + name similarity + semantic analysis
- **Prompt Injection Protection** - Multi-layer detection for jailbreak attempts
- **Tool Abuse Prevention** - Validates tool requests for malicious patterns
- **LLM Output Validation** - Filters responses for security leaks

## Project Structure

```
src/
├── index.ts              # Main entry point
├── config.ts             # Configuration management
├── deploy-commands.ts    # Command deployment script
├── healthcheck.ts        # Docker health check
├── ai/
│   ├── service.ts        # Ollama LLM integration
│   ├── orchestrator.ts   # Main AI orchestration with tool loop
│   ├── conversation.ts   # Conversation management
│   ├── tools.ts          # Tool definitions
│   ├── image-service.ts  # ComfyUI image generation
│   └── memory/
│       ├── memory-manager.ts    # Three-tier memory coordinator
│       ├── conversation-store.ts # Valkey-backed active context
│       ├── chroma.ts            # ChromaDB vector store for long-term memory
│       └── session-summarizer.ts # Background summarization
├── mcp/
│   ├── client.ts         # MCP client wrapper
│   └── index.ts          # MCP exports
├── security/
│   ├── impersonation-detector.ts # Multi-layer threat detection
│   ├── tool-permissions.ts       # 4-tier permission system
│   └── index.ts                  # Security exports
├── commands/
│   ├── utility/          # General commands
│   ├── moderation/       # Mod commands
│   ├── ai/               # AI commands
│   └── admin/            # Admin commands
├── components/           # Discord UI components
├── events/               # Discord event handlers
├── guards/               # Permission guards
└── utils/
    ├── cache.ts          # Valkey client with fallback
    ├── security.ts       # Security utilities
    └── ...
tests/
├── unit/                 # Fast individual component tests
├── integration/          # Feature usage tests (DB, Cloudflare)
├── docker/               # Container infra tests
└── manual/               # Ad-hoc scripts
```

## Prerequisites

- Node.js 20+
- npm or pnpm
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- Docker & Docker Compose (for containerized deployment)

### Optional (for AI features)

- Ollama - [ollama.ai](https://ollama.ai) (or use Docker container)
- NVIDIA GPU with CUDA support (recommended: RTX 4090 with 24GB VRAM)
- ComfyUI (for image generation)

### Docker Services (included in docker-compose.yml)

| Service  | Purpose                           | Port  |
| -------- | --------------------------------- | ----- |
| Ollama   | LLM inference                     | 11434 |
| ChromaDB | Vector store for long-term memory | 8000  |
| Valkey   | Redis-compatible cache            | 6379  |
| ComfyUI  | AI image generation               | 8188  |
| SearXNG  | Privacy-respecting web search     | 8080  |

## Setup

### 1. Clone and Install

```bash
git clone <your-repo>
cd discord-bot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Discord (REQUIRED)
BOT_NAME=My Discord Bot
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id
DEV_GUILD_ID=your_development_guild_id
BOT_OWNER_IDS=your_discord_user_id

# Environment
NODE_ENV=development

# LLM Configuration
OLLAMA_HOST=http://ollama:11434
LLM_MODEL=hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1
LLM_USE_ORCHESTRATOR=true

# Memory System
VALKEY_URL=valkey://valkey:6379
CHROMA_URL=http://chromadb:8000
EMBEDDING_MODEL=qwen3-embedding:0.6b

# Web Search
SEARXNG_URL=http://searxng:8080

# Image Generation (optional)
COMFYUI_URL=http://comfyui:8188
```

See `.env.example` for all available configuration options.

### 3. Setup Ollama (for AI features)

```bash
# Install Ollama from https://ollama.ai
# Pull the recommended model
ollama pull hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1

# Or use a smaller model
ollama pull llama3.2
```

### 4. Deploy Commands

```bash
# Development (instant, guild-only)
npm run deploy

# Production (global, ~1hr propagation)
NODE_ENV=production npm run deploy
```

### 5. Run the Bot

```bash
# Development with hot reload
npm run dev

# Production
npm run build
npm start
```

## Dashboard

A SvelteKit web dashboard for monitoring and managing the bot.

### Features

- **Container Management** - View, start, stop, restart Docker containers
- **GPU Monitoring** - Real-time VRAM usage and loaded models
- **Metrics** - CPU/memory charts with 10-minute rolling history
- **Settings Viewer** - Read-only view of bot configuration (secrets masked)
- **Cloudflare Health** - Check Workers AI connectivity and latency

### Running the Dashboard

```bash
cd dashboard
npm install
npm run dev
```

The dashboard will be available at `http://localhost:5173`.

### Authentication

The dashboard uses Discord OAuth2. Configure these environment variables:

```env
DISCORD_CLIENT_ID=your_application_client_id
DISCORD_CLIENT_SECRET=your_application_client_secret
BOT_OWNER_IDS=123456789,987654321  # Discord user IDs allowed access
BOT_ADMIN_IDS=111111111            # Additional admin user IDs
```

Only users whose Discord ID is in `BOT_OWNER_IDS` or `BOT_ADMIN_IDS` can access the dashboard.

See [`dashboard/API.md`](dashboard/API.md) for API documentation.

---

## Cloudflare Worker (Optional)

An edge-deployed proxy for Workers AI that provides low-latency intent routing.

### Why?

The Cloudflare REST API is centralized. The Worker runs at the **edge datacenter closest to you**, reducing latency from ~200ms to ~50ms.

### Quick Deploy

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler secret put API_SECRET  # Generate with: openssl rand -hex 32
npx wrangler deploy
```

### Configure the Bot

Add to your `.env`:

```env
CLOUDFLARE_WORKER_URL=https://discord-bot-ai-proxy.<your-subdomain>.workers.dev
CLOUDFLARE_WORKER_SECRET=<the secret you set>
```

See [`cloudflare-worker/README.md`](cloudflare-worker/README.md) for full documentation.

---

## Docker Deployment

### Build and Run

```bash
# Build the image
docker-compose build

# Run the container
docker-compose up -d

# View logs
docker-compose logs -f
```

### Docker Security Features

- Read-only root filesystem
- Non-root user execution
- Dropped Linux capabilities
- Resource limits (1 CPU, 1GB RAM)
- No new privileges flag
- Isolated Docker network

### Full Stack Deployment

The `docker-compose.yml` includes all services:

```bash
# Start all services
docker-compose up -d

# View logs for specific service
docker-compose logs -f discord-bot
docker-compose logs -f ollama

# Stop all services
docker-compose down
```

### GPU Configuration

The stack is optimized for NVIDIA GPUs:

- **Ollama**: GPU passthrough with flash attention enabled
- **ComfyUI**: Dedicated GPU access for image generation
- **VRAM Management**: Automatic model unloading when VRAM is constrained

## Commands

### Utility

| Command          | Description                    |
| ---------------- | ------------------------------ |
| `/ping`          | Check bot latency              |
| `/info`          | Display bot information        |
| `/help`          | Show all commands and features |
| `/avatar [user]` | Get user's avatar              |
| `/server`        | Show server information        |
| `/ai-status`     | Check AI service status        |
| `/clear-context` | Clear conversation memory      |

### AI Chat

| Command                         | Description                            |
| ------------------------------- | -------------------------------------- |
| `/ask <question> [mode] [file]` | Ask the AI (creative/balanced/precise) |
| `/remember <fact>`              | Tell the AI something to remember      |
| `/forget`                       | Clear all memories about you           |
| `/summarize [count]`            | Summarize recent channel messages      |
| `/translate <text> <language>`  | Translate text                         |

### AI Agent & Research

| Command                     | Description                            |
| --------------------------- | -------------------------------------- |
| `/agent <task> [verbose]`   | Have the AI agent complete tasks       |
| `/research <topic> [depth]` | Research a topic (quick/standard/deep) |
| `/calculate <problem>`      | Solve math problems step by step       |

### Image Generation

| Command                    | Description                    |
| -------------------------- | ------------------------------ |
| `/imagine <prompt> [size]` | Generate an image with ComfyUI |

The AI can also respond to @mentions and DMs, using tools autonomously including:

- Web search and deep research (via SearXNG)
- URL content fetching
- Mathematical calculations
- Wikipedia lookups
- arXiv paper search
- Time/timezone queries
- Memory storage and recall
- Chain-of-thought reasoning

### Moderation

| Command                         | Description     | Permission      |
| ------------------------------- | --------------- | --------------- |
| `/kick <member> [reason]`       | Kick a member   | Kick Members    |
| `/ban <member> [reason] [days]` | Ban a member    | Ban Members     |
| `/clear <amount>`               | Delete messages | Manage Messages |

### Admin (Owner-only)

| Command     | Description                          |
| ----------- | ------------------------------------ |
| `/startai`  | Enable AI service and load model     |
| `/stopai`   | Disable AI and unload model from GPU |
| `/aistatus` | Detailed AI service status           |

### Context Menus

- **Analyze Message** - Right-click message → Apps → Analyze Message
- **AI User Greeting** - Right-click user → Apps → AI User Greeting

## Configuration

The bot uses environment variables and `src/config.ts` for configuration.

### Key Configuration Options

```typescript
const _env = envSchema.parse(process.env);

export const config = {
  bot: {
    name: _env.BOT_NAME,
  },
  discord: {
    token: _env.DISCORD_TOKEN,
    clientId: _env.DISCORD_CLIENT_ID,
    devGuildId: _env.DEV_GUILD_ID,
  },
  llm: {
    apiUrl: _env.OLLAMA_HOST,
    model: _env.LLM_MODEL,
    fallbackModel: _env.LLM_FALLBACK_MODEL,
    useOrchestrator: _env.LLM_USE_ORCHESTRATOR === "true",
  },
  valkey: {
    url: _env.VALKEY_URL,
    keyPrefix: "discord-bot:",
  },
  security: {
    ownerIds: _env.BOT_OWNER_IDS,
  },
};
```

### MCP Server Configuration

Configure MCP servers in `mcp-servers.json`:

```json
{
  "servers": [
    {
      "name": "context7",
      "command": "npx",
      "args": ["-y", "@context7/mcp-server"],
      "enabled": true
    }
  ]
}
```

### Docker MCP Gateway

For MCP servers running in Docker Desktop's MCP Toolkit:

```env
# Enable Docker MCP Gateway
DOCKER_MCP_ENABLED=true
DOCKER_MCP_TRANSPORT=stdio

# Or use HTTP transport (for external gateway)
DOCKER_MCP_TRANSPORT=http
DOCKER_MCP_GATEWAY_URL=http://host.docker.internal:8811
DOCKER_MCP_BEARER_TOKEN=your_token_here
```

### Environment Variables Reference

See `.env.example` for the complete list of configuration options, including:

- **Discord Configuration** - Bot name, token, client ID, guild IDs
- **LLM Settings** - Model selection, fallback model, temperature, context length, HERETIC-specific options
- **Memory System** - Valkey TTL, ChromaDB collection, summarization triggers, relevance thresholds
- **Security** - Owner/admin/moderator IDs, impersonation detection
- **GPU/VRAM** - VRAM limits, thresholds, auto-unload settings
- **Rate Limiting** - Request limits, window duration
- **Testing** - Test mode, webhook URLs, verbose logging

## Development

```bash
# Type check
npm run typecheck

# Build
npm run build

# Dev with hot reload
npm run dev

# Run tests
npm test
```

## Testing

The project uses a **Master Test Runner** for unified test execution.

```bash
# Run interactive test menu
npm run test:master

# Run all tests (Unit + Docker + Integration)
npm run test:master -- --all

# Run specific suites
npm run test:master -- --unit
npm run test:master -- --integration
npm run test:master -- --docker

# Run a specific integration script
npm run test:master -- --script send-message
```

### Test Coverage

**Integration Tests:**

- Tool permissions (4-tier system)
- Impersonation detection
- Security utilities
- Tool definitions
- Cache operations

**Security Tests:**

- Tool request validation (path traversal, command injection, SQL injection)
- URL safety checks (private IP blocking, protocol validation)
- Memory isolation (user ID validation)
- Input sanitization (PII detection, prompt injection)
- LLM output validation (token leak detection, webhook URL blocking)
- Tool call parsing security (malformed JSON handling, DoS prevention)

## Scripts

| Script                | Description                       |
| --------------------- | --------------------------------- |
| `npm run dev`         | Start with hot reload (tsx watch) |
| `npm run build`       | Compile TypeScript                |
| `npm start`           | Run compiled JS                   |
| `npm run deploy`      | Deploy slash commands             |
| `npm run typecheck`   | Type check without emit           |
| `npm run test:master` | **Run Master Test Runner**        |
| `npm run lint`        | Run ESLint                        |
| `npm run lint:fix`    | Fix linting issues                |
| `npm run format`      | Format code with Prettier         |
| `npm run clean`       | Delete dist folder                |

## Troubleshooting

### Common Issues

**"Failed to connect to OAuth notifications" errors:**

```bash
docker mcp feature disable mcp-oauth-dcr
```

This is a known issue with Docker MCP Gateway (GitHub: docker/mcp-gateway#245).

**Bot not responding:**

1. Check that `DISCORD_TOKEN` is valid
2. Ensure `BOT_OWNER_IDS` includes your Discord user ID
3. Verify Ollama is running: `curl http://localhost:11434/api/tags`
4. Check Docker logs: `docker-compose logs -f discord-bot`

**VRAM issues:**

- Reduce `LLM_CONTEXT_LENGTH` (default: 8192)
- Use a smaller model via `LLM_FALLBACK_MODEL`
- Enable auto-unload: `GPU_AUTO_UNLOAD_FOR_IMAGES=true`

## License

MIT
