<p align="center">
  <img src="https://img.shields.io/badge/Node.js-24-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Discord.js-14-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord.js">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT License">
</p>

<h1 align="center">Discord Bot</h1>

<p align="center">
  A feature-rich Discord bot with local LLM integration, ChatGPT-style memory, autonomous tool calling, and Docker containerization.
  <br />
  <a href="docs/"><strong>Explore the docs »</strong></a>
  <br />
  <br />
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="https://github.com/ColterD/discord-bot/issues/new?labels=bug">Report Bug</a>
  ·
  <a href="https://github.com/ColterD/discord-bot/issues/new?labels=enhancement">Request Feature</a>
</p>

> [!CAUTION]
> **Work in Progress** — APIs may change, features may be incomplete. Use at your own risk.

---

<details>
<summary><strong>Table of Contents</strong></summary>

- [Quick Start](#quick-start)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [Commands](#commands)
- [Docker Deployment](#docker-deployment)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

</details>

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/ColterD/discord-bot.git
cd discord-bot && npm install

# 2. Configure (add DISCORD_TOKEN at minimum)
cp .env.example .env

# 3. Start services and run
docker compose up -d        # Ollama, Valkey, ChromaDB, SearXNG
npm run deploy              # Register slash commands
npm run dev                 # Start bot with hot reload
```

## Features

| Category | Capabilities |
|----------|-------------|
| **AI Chat** | Local LLM via Ollama, streaming responses, multiple personalities |
| **Memory** | 3-tier system: conversation context (Valkey), user profiles (ChromaDB), episodic memory |
| **Tools** | Web search, URL fetching, arXiv papers, calculations, Wikipedia, chain-of-thought |
| **Images** | ComfyUI integration for AI image generation |
| **Security** | Impersonation detection, prompt injection protection, 4-tier tool permissions |
| **Infrastructure** | Docker containerized, GPU/VRAM management, self-healing services |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Discord Bot                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Commands    │  │ AI          │  │ Memory              │  │
│  │ (discordx)  │→ │ Orchestrator│→ │ Valkey + ChromaDB   │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────────┘  │
│                          │                                  │
│                    ┌─────▼─────┐                            │
│                    │ Tool Loop │                            │
│                    └─────┬─────┘                            │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│    ┌─────────┐    ┌───────────┐    ┌───────────┐           │
│    │ Ollama  │    │  SearXNG  │    │  ComfyUI  │           │
│    │ (LLM)   │    │ (Search)  │    │ (Images)  │           │
│    └─────────┘    └───────────┘    └───────────┘           │
└─────────────────────────────────────────────────────────────┘
```

**Deep dives:** [Memory System](docs/architecture/memory-system.md) · [Intent Router](docs/architecture/intent-router.md)

## Installation

### Prerequisites

- **Node.js 20+** and npm
- **Docker & Docker Compose** (for services)
- **Discord Bot Token** ([Developer Portal](https://discord.com/developers/applications))
- **NVIDIA GPU** (optional, for local LLM inference)

### Services (via docker-compose.yml)

| Service | Purpose | Port |
|---------|---------|------|
| Ollama | LLM inference | 11434 |
| Valkey | Cache (Redis-compatible) | 6379 |
| ChromaDB | Vector store for memory | 8000 |
| SearXNG | Privacy-respecting search | 8080 |
| ComfyUI | Image generation | 8188 |

### Setup

```bash
# Install dependencies
npm install

# Copy and edit environment
cp .env.example .env
# Edit .env with your DISCORD_TOKEN, BOT_OWNER_IDS, etc.

# Start infrastructure
docker compose up -d

# Pull an LLM model
docker exec ollama ollama pull qwen3:14b

# Deploy commands and run
npm run deploy
npm run dev
```

## Configuration

All configuration is via environment variables. See [`.env.example`](.env.example) for the complete reference.

**Required:**
```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
BOT_OWNER_IDS=your_discord_user_id
```

**AI/LLM:**
```env
OLLAMA_HOST=http://ollama:11434
LLM_MODEL=qwen3:14b
LLM_USE_ORCHESTRATOR=true
```

**Memory:**
```env
VALKEY_URL=valkey://valkey:6379
CHROMA_URL=http://chromadb:8000
```

## Commands

### AI & Chat
| Command | Description |
|---------|-------------|
| `/ask <question>` | Ask the AI (supports file attachments) |
| `/agent <task>` | Autonomous task completion with tools |
| `/research <topic>` | Deep research with web search |
| `/imagine <prompt>` | Generate images via ComfyUI |
| `/remember <fact>` | Store information in memory |

### Utility
| Command | Description |
|---------|-------------|
| `/ping` | Check latency |
| `/help` | Show all commands |
| `/ai-status` | AI service health |
| `/clear-context` | Reset conversation |

### Moderation
| Command | Permission |
|---------|------------|
| `/kick <member>` | Kick Members |
| `/ban <member>` | Ban Members |
| `/clear <amount>` | Manage Messages |

The bot also responds to **@mentions** and **DMs**.

## Docker Deployment

```bash
# Build and run everything
docker compose up -d --build

# View logs
docker compose logs -f discord-bot

# Stop
docker compose down
```

### Security Hardening

The container runs with:
- Read-only root filesystem
- Non-root user (node:node)
- Dropped Linux capabilities
- Resource limits (1 CPU, 1GB RAM)
- No new privileges

## Documentation

| Document | Description |
|----------|-------------|
| [docs/](docs/) | Documentation index |
| [Architecture: Memory](docs/architecture/memory-system.md) | 3-tier memory system design |
| [Architecture: Router](docs/architecture/intent-router.md) | Intent classification & cloud offloading |
| [Operations: Recovery](docs/operations/recovery-playbooks.md) | Self-healing playbooks |
| [ADR-001: Biome](docs/decisions/ADR-001-biome.md) | Linting toolchain decision |

## Development

```bash
npm run dev          # Hot reload development
npm run build        # Compile TypeScript
npm run deploy       # Deploy slash commands
npm run lint         # Biome linter
npm run typecheck    # Type checking
npm run test         # Run test suite
```

### Project Structure

```
src/
├── ai/              # Orchestrator, tools, memory
├── commands/        # Slash commands (admin/, ai/, moderation/, utility/)
├── components/      # Buttons, modals, select menus
├── events/          # Discord event handlers
├── guards/          # Permission middleware
├── mcp/             # Model Context Protocol client
├── security/        # Threat detection, permissions
├── services/        # Health monitor, scheduler
└── utils/           # Logger, cache, helpers
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  <sub>Built with <a href="https://discordx.js.org/">discordx</a> · Powered by <a href="https://ollama.ai/">Ollama</a></sub>
</p>
