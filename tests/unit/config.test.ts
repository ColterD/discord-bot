import { describe, expect, it } from "vitest";
import { envSchema } from "../../src/config";

// We will mock process.env, so we need to reset modules to ensure config is re-evaluated
// equivalent to 'jest.resetModules()' in Vitest is usually done by properly isolating tests
// or by moving the config loading into a function or ensuring we test the schema directly.
// Since `config` export is a singleton evaluate-on-import object in the original design,
// refactoring to export the Schema allows testing the content without re-importing the whole module repeatedly.

// We will assume the refactored code exports 'envSchema' and 'validateConfig' or simply 'config'.
// For this test, we will draft what the test *should* look like for the refactored Code.

describe("Configuration", () => {
  // NOSONAR - Test data, not actual service URLs
  const validEnv = {
    DISCORD_TOKEN: "mock_token",
    DISCORD_CLIENT_ID: "mock_client_id",
    OLLAMA_HOST: "http://ollama:11434", // NOSONAR - test data
    VALKEY_URL: "valkey://valkey:6379",
    // Add other required fields if strict
  };

  it("should validate valid configuration", () => {
    const result = envSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DISCORD_TOKEN).toBe("mock_token");
      expect(result.data.OLLAMA_HOST).toBe("http://ollama:11434");
    }
  });

  it("should set default values for optional fields", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      // Missing optional fields like LLM_MODEL
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.LLM_MODEL).toBeDefined();
      // Check a known default
      expect(result.data.LLM_TEMPERATURE).toBe(0.7);
    }
  });

  it("should fail validation for invalid URLs", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      OLLAMA_HOST: "not_a_url",
    });
    expect(result.success).toBe(false);
  });

  it("should fail validation for invalid numbers", () => {
    const result = envSchema.safeParse({
      ...validEnv,
      LLM_MAX_TOKENS: "not_a_number",
    });
    expect(result.success).toBe(false);
  });

  it("should fail if required fields are missing", () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
