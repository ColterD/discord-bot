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
- 🔧 **Tool Calling** - AI agent with tool execution loop (web search, calculations, image generation)
- 🔌 **MCP Integration** - Model Context Protocol support for external tools
- 🛡️ **Security** - Impersonation detection, prompt injection protection, 4-tier tool permissions
- 🖼️ **Image Generation** - ComfyUI integration for AI image generation
- 🔒 **Moderation Tools** - Kick, ban, and message management
- 🧩 **Interactive UI** - Buttons, select menus, and modals
- 🔒 **Guards & Middleware** - Permission checks, rate limiting, bot filtering
- 🐳 **Docker Support** - Containerized deployment with security hardening

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
```

## Prerequisites

- Node.js 20+
- npm or pnpm
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- Ollama (for AI features) - [ollama.ai](https://ollama.ai)
- Docker & Docker Compose (for containerized deployment)
- Valkey (Redis-compatible cache, included in Docker Compose)

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
# Discord
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id
DEV_GUILD_ID=your_development_guild_id
BOT_OWNER_IDS=your_discord_user_id

# Environment
NODE_ENV=development

# Ollama/LLM
OLLAMA_HOST=http://ollama:11434
LLM_MODEL=hf.co/DavidAU/OpenAi-GPT-oss-20b-HERETIC-uncensored-NEO-Imatrix-gguf:Q5_1

# Valkey (Redis-compatible)
VALKEY_URL=valkey://valkey:6379

# Orchestrator
LLM_USE_ORCHESTRATOR=true

# ComfyUI (optional, for image generation)
COMFYUI_URL=http://comfyui:8188
```

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
- Resource limits (1 CPU, 512MB RAM)
- No new privileges flag

### Accessing Local Ollama from Docker

The container uses `host.docker.internal:11434` to reach Ollama running on your host machine. Ensure Ollama is running before starting the container.

## Commands

### Utility

| Command          | Description             |
| ---------------- | ----------------------- |
| `/ping`          | Check bot latency       |
| `/info`          | Display bot information |
| `/avatar [user]` | Get user's avatar       |
| `/server`        | Show server information |

### Moderation

| Command                         | Description     | Permission      |
| ------------------------------- | --------------- | --------------- |
| `/kick <member> [reason]`       | Kick a member   | Kick Members    |
| `/ban <member> [reason] [days]` | Ban a member    | Ban Members     |
| `/clear <amount>`               | Delete messages | Manage Messages |

### AI

| Command                        | Description                            |
| ------------------------------ | -------------------------------------- |
| `/ask <question> [mode]`       | Ask the AI (creative/balanced/precise) |
| `/summarize [count]`           | Summarize recent messages              |
| `/translate <text> <language>` | Translate text                         |
| `/imagine <prompt> [style]`    | Generate an image with AI              |

### Admin (Owner-only)

| Command               | Description           |
| --------------------- | --------------------- |
| `/ai-control status`  | View AI system status |
| `/ai-control enable`  | Enable AI features    |
| `/ai-control disable` | Disable AI features   |
| `/persona set`        | Set bot personality   |

### Context Menus

- **Analyze Message** - Right-click message → Apps → Analyze Message
- **AI User Greeting** - Right-click user → Apps → AI User Greeting

## Configuration

The bot uses environment variables and `src/config.ts` for configuration.

### Key Configuration Options

```typescript
export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN ?? "",
    clientId: process.env.DISCORD_CLIENT_ID ?? "",
    devGuildId: process.env.DEV_GUILD_ID ?? "",
  },
  llm: {
    apiUrl: process.env.OLLAMA_HOST ?? "http://ollama:11434",
    model: process.env.LLM_MODEL ?? "...",
    useOrchestrator: process.env.LLM_USE_ORCHESTRATOR !== "false",
    maxTokens: 4096,
    temperature: 0.7,
  },
  valkey: {
    url: process.env.VALKEY_URL ?? "valkey://valkey:6379",
    keyPrefix: "discord-bot:",
  },
  security: {
    ownerIds: (process.env.BOT_OWNER_IDS ?? "").split(",").filter(Boolean),
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

```bash
# Run integration tests
npm run test:integration

# Run security tests
npm run test:security

# Run all tests
npm run test:all
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

| Script                     | Description                       |
| -------------------------- | --------------------------------- |
| `npm run dev`              | Start with hot reload (tsx watch) |
| `npm run build`            | Compile TypeScript                |
| `npm start`                | Run compiled JS                   |
| `npm run deploy`           | Deploy slash commands             |
| `npm run typecheck`        | Type check without emit           |
| `npm test`                 | Run integration tests             |
| `npm run test:integration` | Run integration tests             |
| `npm run clean`            | Delete dist folder                |

## License

MIT
