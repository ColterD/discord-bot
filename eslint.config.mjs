// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";

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

  // Import plugin configuration for TypeScript
  {
    plugins: {
      import: importPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },
    },
    rules: {
      // Detect unused imports
      // Disabled due to resolver errors with flat config - typescript resolver has issues
      // "import/no-unused-modules": [
      //   "warn",
      //   {
      //     unusedExports: true,
      //     missingExports: false,
      //     ignoreExports: [
      //       "src/index.ts",
      //       "src/deploy-commands.ts",
      //       "src/healthcheck.ts",
      //       "src/**/index.ts",
      //       "tests/**/*.ts",
      //     ],
      //   },
      // ],
      "import/no-unused-modules": "off",
      // Ensure imports are sorted and organized
      // Disabled due to resolver errors with flat config - typescript resolver has issues
      // "import/order": [
      //   "warn",
      //   {
      //     groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
      //     "newlines-between": "never",
      //     alphabetize: {
      //       order: "asc",
      //       caseInsensitive: true,
      //     },
      //   },
      // ],
      "import/order": "off",
      // No duplicate imports
      // Disabled due to resolver errors with flat config - typescript resolver has issues
      // "import/no-duplicates": "error",
      "import/no-duplicates": "off",
    },
  },

  // Disable type-checked rules for JS config files and tests
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "tests/**/*.ts"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Add Node.js globals for JS test files (Node 18+ includes fetch, setTimeout globally)
  {
    files: ["**/*.js", "test-*.js"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
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

      // Disallow explicit any
      "@typescript-eslint/no-explicit-any": "error",

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

  // Test files - disable import resolution rules that have issues with flat config
  {
    files: ["tests/**/*.ts"],
    rules: {
      "import/no-duplicates": "off",
      "import/no-unused-modules": "off",
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
