# ADR-001: Biome for Linting

**Status**: Accepted
**Date**: December 2025

## Context

The project was using:

- **ESLint v9** with flat config (`eslint.config.mjs`)
- **Prettier v3** for formatting
- **eslint-plugin-import** (partially disabled due to flat config compatibility issues)
- **typescript-eslint** for TypeScript rules

### Problems

- `eslint-plugin-import` rules were disabled in flat config due to resolver errors
- Import ordering, duplicate detection, and unused module detection were all OFF
- This created a gap in code quality enforcement
- Slow linting (~3-5s)

## Decision

**Option A: Biome Linting + Prettier Formatting** was chosen.

Keep Prettier for formatting (better ecosystem compatibility) and use Biome only for linting.

## Rationale

### Why Biome?

[Biome](https://biomejs.dev/) is a unified toolchain that provides:

- **Linting** (300+ rules, many from ESLint)
- **Formatting** (Prettier-compatible)
- **10-100x faster** than ESLint + Prettier combined
- Written in Rust with excellent TypeScript support
- Native flat config support

### Why Keep Prettier?

- Better VSCode integration
- Team familiarity
- Some edge cases in formatting that Biome handles differently

## Configuration

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/2.1.1/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "organizeImports": {
    "enabled": true
  },
  "formatter": {
    "enabled": false // Use Prettier instead
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noExcessiveCognitiveComplexity": "warn"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      },
      "style": {
        "useImportType": "error",
        "useNodejsImportProtocol": "error"
      },
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "warn"
      }
    }
  },
  "javascript": {
    "parser": {
      "unsafeParameterDecoratorsEnabled": true // For discordx decorators
    }
  },
  "files": {
    "ignore": ["dist/**", "node_modules/**", "coverage/**", "reports/**"]
  }
}
```

## Package.json Scripts

```json
{
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "check": "biome check . && prettier --check ."
  }
}
```

## VSCode Settings

```json
{
  "editor.codeActionsOnSave": {
    "quickfix.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

## Performance Comparison

| Operation | ESLint + Prettier | Biome + Prettier |
| --------- | ----------------- | ---------------- |
| Lint      | ~3-5s             | ~0.2-0.5s        |
| Format    | ~1-2s             | ~1-2s (Prettier) |
| CI Check  | ~5-7s             | ~2-3s            |

## Alternatives Considered

### Option B: Full Biome (Replace Both)

Use Biome for both linting AND formatting.

**Pros:**

- Single tool, simpler configuration
- Even faster

**Cons:**

- Formatting output differs slightly from Prettier
- May cause diff noise in PRs during transition
- Less ecosystem support

### Option C: Keep ESLint + Prettier

Continue with current setup, fix import plugin issues manually.

**Pros:**

- No migration effort
- Familiar tooling

**Cons:**

- Slower linting
- Import rules still broken
- No performance improvement

## Consequences

### Positive

- 10x faster linting
- Import analysis working again (native TypeScript support)
- Unused imports/variables now detected
- Cognitive complexity warnings
- Maintains Prettier compatibility

### Negative

- Two tools instead of one
- Team needs to learn Biome error messages
- Import ordering may differ from previous style

## Migration Steps Completed

1. Installed `@biomejs/biome`
2. Created `biome.json` with linter-only configuration
3. Updated package.json scripts
4. Removed ESLint dependencies
5. Ran full codebase check and fixed issues
