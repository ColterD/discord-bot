import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      $lib: "/src/lib",
      "$lib/server": "/src/lib/server",
      "$app/environment": "/tests/mocks/app-environment.ts",
    },
  },
});
