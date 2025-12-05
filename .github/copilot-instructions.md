# GitHub Copilot Instructions for Discord Bot Project

## Project Context

This is a **TypeScript** Discord bot built with **discordx**, featuring local LLM integration (Ollama), **Model Context Protocol (MCP)** support, and a 3-tier memory system. It runs in **Docker** containers.

## Architecture & Core Components

- **Framework**: `discordx` (decorators for commands/events) + `discord.js`.
- **Entry Point**: `src/index.ts` initializes the client. `dotenv/config` MUST be the first import.
- **AI Orchestrator**: `src/ai/orchestrator.ts` manages the AI loop:
  - Uses **prompt-based tool calling** (JSON in system prompt), NOT native LLM tool calling.
  - Integrates **MCP** tools via `src/mcp/client.ts`.
  - Manages **Memory**: Active (Valkey), User Profile (Mem0), Episodic (SurrealDB).
- **Security**: `src/security/` handles impersonation detection and tool permissions.

## Development Workflow

- **Run Dev**: `npm run dev` (uses `tsx` watch).
- **Build**: `npm run build` (uses `tsc`).
- **Deploy Commands**: `npm run deploy` (updates slash commands in Discord).
- **Test**:
  - Integration: `npm run test:integration`
  - Manual Message: `npm run test:send`
- **Lint/Format**: `npm run lint:fix`, `npm run format`.

## Coding Conventions

- **Imports**: Use `.js` extension for local imports (ESM requirement).
- **Logging**: Use `createLogger("ModuleName")` from `src/utils/logger.ts`.
- **Config**: Access via `src/config.ts`. Validate env vars on startup.
- **Async/Await**: Always handle promises. Use global error handlers in `index.ts` as a safety net.

## AI & Tool Integration

- **Adding Tools**:
  - Define in `src/ai/tools.ts` (internal) or via MCP.
  - Tools must return a string result.
  - **Permissions**: Assign one of 4 tiers: `owner-only`, `restricted`, `elevated`, `public`.
- **MCP**:
  - Client manager in `src/mcp/client.ts`.
  - Supports `stdio` (local) and `docker-gateway` (SSE/stdio) transports.

## Common Patterns

- **Slash Commands**: Use `@Discord`, `@Slash` decorators.
- **Guards**: Use `@Guard` for permissions (e.g., `NotBot`, `Owner`).
- **Dependency Injection**: `discordx` handles DI.

## Key Files

- `src/ai/orchestrator.ts`: Core AI logic.
- `src/mcp/client.ts`: MCP implementation.
- `src/config.ts`: Configuration source of truth.
- `docker-compose.yml`: Infrastructure definition.
