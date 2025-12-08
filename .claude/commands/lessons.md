---
description: Experience replay system - persistent lessons learned
---

# Lessons Learned

> **Purpose**: Persistent lessons learned across sessions.
> **Rules**: Add when you discover something important. Review when working in related areas.

---

## Project-Specific Lessons

### TypeScript / ESM

| Lesson | Discovered |
|--------|------------|
| Always use `.js` extension for local imports (ESM requirement) | 2025-01 |
| Use `node:` prefix for Node.js built-ins | 2025-01 |
| Use `Number.parseInt()` not global `parseInt()` | 2025-01 |
| `tsx` for dev, `tsc` for build - don't mix | |

### discord.js / discordx

| Lesson | Discovered |
|--------|------------|
| All commands need `@Guard(NotBot)` at minimum | |
| Use `interaction.editReply()` after `deferReply()`, not `reply()` | |
| `interaction.channel` can be null in DMs - always check | |
| Embed field values cannot be empty strings | |

### Docker / Infrastructure

| Lesson | Discovered |
|--------|------------|
| Distroless containers have no shell - use multi-stage builds | |
| Valkey keys expire silently - always handle null returns | |
| Health checks must use the correct internal port | |
| SearXNG in Docker: use `limiter: true` + Valkey + `pass_ip` for Docker networks, NOT `trusted_proxies` | 2025-12 |
| SearXNG `limiter: false` does NOT silence bot detection errors - need full limiter setup | 2025-12 |

### GitHub Actions / Security Scanning

| Lesson | Discovered |
|--------|------------|
| OpenSSF Token-Permissions: Use `permissions: {}` at workflow level, job-level permissions only where needed | 2025-12 |
| CodeQL inline suppression `// codeql[rule]` does NOT work - use `.github/codeql/codeql-config.yml` with `paths-ignore` | 2025-12 |
| CodeQL `js/clear-text-logging` triggers on ANY access to sensitive var, even `.length` - just log "SET/NOT SET" | 2025-12 |
| **ALL checks must pass, not just required ones** - user expects clean CI, no warnings | 2025-12 |
| Pin GitHub Actions to SHA, not just version tags (supply chain security) | 2025-12 |

### AI System

| Lesson | Discovered |
|--------|------------|
| Ollama context is limited - summarize long conversations | |
| Tool calls use JSON in prompt, not native function calling | |
| ChromaDB embeddings are async - await all operations | |

---

## Process Lessons

### Git Workflow (CRITICAL)

| Lesson | Discovered |
|--------|------------|
| **NEVER push directly to main/master** - always create PR for CI audit | 2025-12 |
| Branch → commit → push → PR → watch CI → fix failures → merge | 2025-12 |
| Watch automated checks (lint, test, security) before merge | 2025-12 |
| PRs allow workflows to catch issues before they hit main | 2025-12 |

### Research & Discovery

| Lesson | Discovered |
|--------|------------|
| Always check `package.json` before suggesting new packages | 2025-01 |
| Read 2-3 similar files before creating new ones | 2025-01 |
| Search for existing implementations before writing new code | 2025-01 |
| Fetch current docs for rapidly-changing libraries | 2025-01 |

### Memory Usage

| Lesson | Discovered |
|--------|------------|
| **USE MEMORY PROACTIVELY** - don't just use it once after being reminded | 2025-12 |
| After troubleshooting discovery → store in memory/lessons immediately | 2025-12 |
| After making and correcting mistakes → record what went wrong | 2025-12 |
| Update lessons file even if MCP memory unavailable | 2025-12 |

### Error Handling

| Lesson | Discovered |
|--------|------------|
| Stop after 3 failed attempts on same error - ask user | 2025-01 |
| Linter errors often indicate real bugs, not just style | |
| Read the FULL error message before guessing at fix | |

### Testing

| Lesson | Discovered |
|--------|------------|
| Bug is in code, not the test - don't modify tests to pass | 2025-01 |
| Run tests after every significant change | 2025-01 |
| Integration tests need Docker services running | |

---

## Common Mistakes to Avoid

### Code Generation

- [ ] Forgetting `.js` extension on imports
- [ ] Hardcoding values that should come from `.env`
- [ ] Not handling async/await properly
- [ ] Creating new utilities when one exists

### Tool Usage

- [ ] Not reading file before editing
- [ ] Making assumptions about file contents
- [ ] Running commands without checking current directory
- [ ] Parallel tool calls when order matters

### Communication

- [ ] Saying "done" before verifying
- [ ] Outputting code blocks instead of using edit tools
- [ ] Not asking for clarification when requirements are ambiguous

---

## Pattern Recognition

| When You See This... | Do This Instead |
|----------------------|-----------------|
| "I think the API works like..." | Fetch documentation first |
| "This should be a simple fix..." | Run full verification anyway |
| "I'll just add a new utility..." | Search for existing utilities first |
| "The test is probably wrong..." | Debug the code, not the test |
| About to edit without reading | Read the file first |
| Same error 3 times | Stop, reflect, ask user |

---

## Adding New Lessons

When adding a lesson:

```markdown
| [Concise lesson - actionable, specific] | YYYY-MM |
```

**Good**: "Use `interaction.editReply()` after `deferReply()`, not `reply()`"
**Bad**: "Discord interactions are tricky" (too vague)

---

## Maintenance

- Review quarterly and prune outdated lessons
- Remove lessons for deprecated APIs
- Merge duplicate entries

**Last pruned**: _Never_
**Next review**: 2025-Q2
