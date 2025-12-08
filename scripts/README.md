# Discord Bot Development Scripts

Scripts for managing the Discord bot development environment.

## Quick Start

```powershell
# Windows (PowerShell 7+)
.\scripts\devctl.ps1

# Or double-click
scripts\dev.bat
```

## devctl.ps1 - Development Controller

The main script for all development operations. Run without arguments for an interactive menu.

### Docker Compose Profiles

The stack supports profiles for different use cases:

| Profile   | Services                                     | Use Case                       |
| --------- | -------------------------------------------- | ------------------------------ |
| (default) | All services                                 | Full production stack          |
| `dev`     | Ollama, ChromaDB, Valkey, ComfyUI, SearXNG   | Development (bot runs locally) |
| `prod`    | All services including discord-bot container | Production deployment          |
| `minimal` | Ollama, Valkey only                          | Testing LLM features only      |

```powershell
# Start with a specific profile
docker compose --profile dev up -d      # Dev: no bot container
docker compose --profile minimal up -d  # Minimal: just Ollama + Valkey
docker compose --profile prod up -d     # Production: everything
docker compose up -d                    # Default: same as prod
```

### Command Reference

#### Docker Stack

| Command       | Description                       |
| ------------- | --------------------------------- |
| `start`       | Start all Docker containers       |
| `stop`        | Stop all Docker containers        |
| `restart`     | Restart all Docker containers     |
| `status`      | Show full system status           |
| `rebuild`     | Rebuild discord-bot container     |
| `rebuild-all` | Rebuild all containers (no cache) |

#### Development

| Command                   | Description                                        |
| ------------------------- | -------------------------------------------------- |
| `dev`                     | Start development mode (npm run dev)               |
| `dev-kill`                | Kill orphaned dev processes                        |
| `build`                   | Build TypeScript project                           |
| `lint`                    | Run ESLint                                         |
| `lint-fix`                | Run ESLint with auto-fix                           |
| `format`                  | Format code with Prettier                          |
| `test`                    | Run unit tests                                     |
| `test-integration`        | Run integration tests                              |
| `test-docker`             | Run Docker integration tests (requires stack)      |
| `test-docker-destructive` | Run tests that restart containers                  |
| `test-full`               | Run all tests (unit + Docker, checks health first) |

#### Services

| Command           | Description                     |
| ----------------- | ------------------------------- |
| `logs`            | Show container logs             |
| `dashboard`       | Start web dashboard (port 3030) |
| `deploy-commands` | Deploy Discord slash commands   |

#### Utilities

| Command   | Description                           |
| --------- | ------------------------------------- |
| `health`  | Check service health                  |
| `gpu`     | Show GPU status                       |
| `vram`    | Show VRAM usage details               |
| `ollama`  | Ollama model management submenu       |
| `mcp`     | MCP server management submenu         |
| `comfyui` | Show ComfyUI status                   |
| `models`  | Download Z-Image models               |
| `clean`   | Clean up dev processes and caches     |
| `setup`   | Interactive .env configuration wizard |

### Submenus

#### Ollama Menu (`.\devctl.ps1 ollama` or press `O` in menu)

- **List Models** - Show installed models with sizes
- **Pull Model** - Download new model from Ollama registry
- **Delete Model** - Remove installed model
- **Unload All** - Free VRAM by unloading active models
- **Running Models** - Show currently loaded models
- **Model Info** - Display detailed model information

#### MCP Menu (`.\devctl.ps1 mcp` or press `P` in menu)

- **View Config** - Display mcp-servers.json contents
- **Edit Config** - Open config in default editor
- **Create Template** - Generate starter mcp-servers.json
- **Test Gateway** - Check Docker MCP Gateway connectivity
- **Restart Bot** - Apply MCP config changes

#### Test Menu (`.\devctl.ps1 test-docker` or press `8` in menu)

- **Unit Tests** - Run fast unit tests (no Docker required)
- **Integration Tests** - Run integration tests (mocked services)
- **Security Tests** - Run security-focused tests
- **Docker Tests** - Test with real Ollama, Valkey, ChromaDB
- **Docker Destructive** - Tests that restart containers
- **Full Test Suite** - All tests: unit + Docker (checks health first)
- **Check Docker Health** - Verify all services are running

### Examples

```powershell
# Interactive menu
.\devctl.ps1

# Start the full stack
.\devctl.ps1 start

# View logs with follow
.\devctl.ps1 logs -Container ollama -Follow

# View last 100 lines of bot logs
.\devctl.ps1 logs -Container discord-bot -Lines 100

# Download image models with GGUF text encoder (lower VRAM)
.\devctl.ps1 models -UseGGUF -TextEncoderQuality IQ4_XS

# Run in dev mode (bot runs locally, not in container)
.\devctl.ps1 dev
```

### Parameters

| Parameter             | Description                        | Default     |
| --------------------- | ---------------------------------- | ----------- |
| `-Container`          | Target container for logs/restart  | discord-bot |
| `-Lines`              | Number of log lines to show        | 50          |
| `-Follow`             | Follow log output in real-time     | false       |
| `-UseGGUF`            | Use GGUF text encoder (lower VRAM) | false       |
| `-TextEncoderQuality` | GGUF quality: IQ4_XS, Q3, Q6, Q8   | IQ4_XS      |

## Requirements

- **PowerShell 7+** - `winget install Microsoft.PowerShell`
- **Docker Desktop** - With WSL2 backend
- **Node.js 20+** - For development
- **NVIDIA GPU** - With CUDA support for Ollama/ComfyUI

## Troubleshooting

### Docker Desktop not running

```powershell
# Check if Docker is running
Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
```

### Orphaned dev processes

```powershell
# Kill any stuck node processes from previous dev runs
.\devctl.ps1 dev-kill
```

### Port conflicts

```powershell
# Check what's using a port
Get-NetTCPConnection -LocalPort 11434 | Select-Object OwningProcess
```

### VRAM issues

```powershell
# Check VRAM usage
.\devctl.ps1 vram

# Unload ComfyUI models
Invoke-RestMethod -Uri "http://localhost:8188/free" -Method POST -Body '{"unload_models":true}' -ContentType "application/json"
```
