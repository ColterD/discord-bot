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

## Additional Notes

- Never be lazy about error handling—always ensure robust error management.
- Follow best practices for security, especially when dealing with user data and tool permissions.
- Keep documentation up to date as the project evolves.
- When adding new features, consider their impact on the existing architecture and memory systems.
- Use TypeScript features effectively for type safety and code clarity.
- Regularly review and refactor code to maintain quality and performance.
- Stay informed about updates in dependencies like `discordx`, `discord.js`, and any LLM-related libraries used.
- Always fix any and all issues, problems, or bugs you find in the code and that are found by SonarQube and other code analysis tools. Do not provide lazy solutions, only ever do full complete fixes based on documented best practices.
- When writing tests, ensure they cover edge cases and potential failure points.
- Collaborate with team members to review code changes and share knowledge about the system.
- Maintain a clean and organized codebase for ease of navigation and future development.
- Prioritize user experience in bot interactions, ensuring responses are timely and relevant.
- When working with Docker, ensure that container configurations are optimized for performance and security.
- Always document new code and changes thoroughly to aid future maintenance and onboarding of new developers.
- Keep performance in mind, especially when dealing with AI responses and database interactions.
- Regularly back up important data, especially user profiles and episodic memory stored in SurrealDB.
- Stay compliant with Discord's API terms and guidelines to avoid any disruptions in service.
- Perform regular code reviews to ensure adherence to coding standards and project guidelines.
- Continuously monitor the bot's performance and user feedback to identify areas for improvement.
- Stay updated with the latest advancements in AI and LLM technologies to enhance the bot's capabilities.
- Prioritize security in all aspects of development, especially when handling sensitive user data.
- Prioritize code readability and maintainability to facilitate collaboration and future development.
- Prioritize scalability in the architecture to accommodate future growth and feature additions.
- Always test new features in a staging environment before deploying to production.
- Use version control effectively, with clear commit messages and branching strategies.
- Utilize continuous integration and deployment (CI/CD) pipelines for efficient development workflows.
- Use monitoring tools to track the bot's health and performance in real-time.
- Utilize caching strategies to improve response times for frequently accessed data.
- Memory management should be efficient to prevent performance degradation over time.
- Regularly update dependencies to benefit from security patches and new features.
- Clean up unused code and dependencies to maintain a lean codebase.
- Clean up and close any resources (like database connections or file handles) after use to prevent leaks.
- When handling user input, always sanitize and validate to prevent injection attacks.
- Clean code is more important than clever code; prioritize clarity over complexity.
- When in doubt, refer to official documentation and best practices for libraries and frameworks used.
