# Documentation

> Technical documentation for the Discord Bot project.

## Architecture

Core system designs and technical specifications.

| Document                                       | Description                                                 |
| ---------------------------------------------- | ----------------------------------------------------------- |
| [Memory System](architecture/memory-system.md) | 3-tier memory architecture (Valkey, ChromaDB, Graph Memory) |
| [Intent Router](architecture/intent-router.md) | Intelligent routing with cloud offloading strategy          |

## Operations

Runbooks and operational procedures.

| Document                                               | Description                              |
| ------------------------------------------------------ | ---------------------------------------- |
| [Recovery Playbooks](operations/recovery-playbooks.md) | Self-healing procedures for all services |

## Architecture Decision Records (ADRs)

Design decisions with context, options considered, and rationale.

| ADR                                       | Title               | Status   |
| ----------------------------------------- | ------------------- | -------- |
| [ADR-001](decisions/ADR-001-biome.md)     | Biome for Linting   | Accepted |
| [ADR-002](decisions/ADR-002-dashboard.md) | SvelteKit Dashboard | Proposed |

---

## Quick Links

- [Main README](../README.md) - Project overview
- [CLAUDE.md](../CLAUDE.md) - AI assistant instructions
- [.env.example](../.env.example) - Configuration reference
