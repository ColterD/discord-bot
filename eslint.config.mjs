// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules (not strict, to allow gradual adoption)
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,

  // TypeScript parser configuration
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Disable type-checked rules for JS config files and tests
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "tests/**/*.ts"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier compatibility (must be last to override other formatting rules)
  eslintConfigPrettier,

  // Project-specific rules
  {
    rules: {
      // Allow unused variables that start with underscore
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Allow explicit any for now (can tighten later)
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow empty functions (useful for no-op callbacks)
      "@typescript-eslint/no-empty-function": "off",

      // Allow require imports for compatibility
      "@typescript-eslint/no-require-imports": "off",

      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Allow control characters in regex (used for security scanning)
      "no-control-regex": "off",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "*.config.js",
      "*.config.mjs",
      "eslint.config.mjs",
    ],
  }
);
