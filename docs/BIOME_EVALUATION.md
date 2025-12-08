# Biome Hybrid Setup Evaluation

## Current State

The project currently uses:

- **ESLint v9.39.1** with flat config (`eslint.config.mjs`)
- **Prettier v3.7.4** for formatting
- **eslint-plugin-import v2.32.0** (partially disabled due to flat config compatibility issues)
- **typescript-eslint v8.48.1** for TypeScript rules

### Known Issues

- `eslint-plugin-import` rules are disabled in flat config due to resolver errors
- Import ordering, duplicate detection, and unused module detection are all OFF
- This creates a gap in code quality enforcement

## Biome Overview

[Biome](https://biomejs.dev/) is a unified toolchain that provides:

- **Linting** (300+ rules, many from ESLint)
- **Formatting** (Prettier-compatible)
- **10-100x faster** than ESLint + Prettier combined
- Written in Rust with excellent TypeScript support
- Native flat config support

## Hybrid Setup Options

### Option A: Biome Linting + Prettier Formatting (Recommended)

Keep Prettier for formatting (better ecosystem compatibility with VSCode, CI, etc.) and use Biome only for linting.

**Pros:**

- Faster linting (~10x ESLint)
- Better import analysis (native TypeScript support)
- Maintains Prettier compatibility for formatting
- Prettier has better VSCode integration and team familiarity

**Cons:**

- Two tools instead of one
- Need to disable Biome's formatter

**Configuration:**

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

### Option B: Full Biome (Replace Both)

Use Biome for both linting AND formatting.

**Pros:**

- Single tool, simpler configuration
- Even faster (no tool switching)
- Consistent style enforcement

**Cons:**

- Formatting output differs slightly from Prettier
- May cause diff noise in PRs during transition
- Less ecosystem support (some tools expect Prettier)

### Option C: Keep ESLint + Prettier (Status Quo)

Continue with current setup, fix import plugin issues manually.

**Pros:**

- No migration effort
- Familiar tooling

**Cons:**

- Slower linting
- Import rules still broken
- No performance improvement

## Recommendation: Option A (Biome + Prettier)

### Migration Steps

1. **Install Biome**

   ```bash
   npm install --save-dev @biomejs/biome
   ```

2. **Create biome.json** with linter-only configuration (see above)

3. **Update package.json scripts**

   ```json
   {
     "scripts": {
       "lint": "biome check . && biome lint .",
       "lint:fix": "biome check --write . && biome lint --write .",
       "format": "prettier --write .",
       "format:check": "prettier --check .",
       "check": "biome check . && prettier --check ."
     }
   }
   ```

4. **Remove ESLint dependencies** (after verification)
   - eslint
   - @eslint/js
   - typescript-eslint
   - eslint-config-prettier
   - eslint-plugin-import

5. **Update VSCode settings** (`.vscode/settings.json`)

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

6. **Run full check and fix any issues**
   ```bash
   npx @biomejs/biome check --write .
   npx prettier --write .
   ```

## Performance Comparison (Estimated)

| Operation | ESLint + Prettier | Biome + Prettier |
| --------- | ----------------- | ---------------- |
| Lint      | ~3-5s             | ~0.2-0.5s        |
| Format    | ~1-2s             | ~1-2s (Prettier) |
| CI Check  | ~5-7s             | ~2-3s            |

## Breaking Changes to Consider

1. **Import ordering** - Biome's organizeImports may order differently than current code
2. **Some ESLint-specific rules** - May need manual equivalents
3. **Decorator support** - Biome needs `unsafeParameterDecoratorsEnabled` for discordx

## Decision Needed

Before proceeding with migration:

1. ✅ Confirm Option A (Biome linting + Prettier formatting) is acceptable
2. ⏳ Choose when to perform migration (now vs. later sprint)
3. ⏳ Decide if import reordering diff noise is acceptable

---

_Generated as part of frontier-aligned modernization plan_
