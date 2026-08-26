import { describe, expect, it } from "vitest";

import { EnvSchema, loadConfig, useE2EDeterministicAdapter } from "./env.js";

describe("API environment configuration", () => {
  it("provides safe local defaults", () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      DATABASE_URL: "postgresql://localhost:5432/tally",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "gpt-5.6-terra",
      AI_PROVIDER: "openai",
      AI_REASONING_EFFORT: "none",
      AI_REQUEST_TIMEOUT_MS: 12000,
      AI_MAX_RETRIES: 0,
      AI_REASONING_CONCURRENCY: 8,
      AI_RUN_DEADLINE_MS: 90000,
      WEB_ORIGIN: "http://localhost:3000",
    });
  });

  it("coerces and validates configured values", () => {
    expect(
      loadConfig({
        PORT: "4000",
        DATABASE_URL: "postgresql://db.example/tally",
        OPENAI_API_KEY: "test-key",
        OPENAI_MODEL: "test-model",
        WEB_ORIGIN: "https://web.example",
      }),
    ).toMatchObject({ PORT: 4000, OPENAI_MODEL: "test-model", AI_PROVIDER: "openai", AI_REASONING_EFFORT: "none", AI_REASONING_CONCURRENCY: 8, AI_RUN_DEADLINE_MS: 90000 });

    expect(() => EnvSchema.parse({ PORT: "70000" })).toThrow();
    expect(() => EnvSchema.parse({ WEB_ORIGIN: "not-a-url" })).toThrow();
  });

  it("selects a valid NVIDIA model when the OpenAI default is left unchanged", () => {
    expect(loadConfig({ AI_PROVIDER: "nvidia" }).OPENAI_MODEL).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(loadConfig({ AI_PROVIDER: "nvidia", OPENAI_MODEL: "nvidia/custom-model" }).OPENAI_MODEL).toBe("nvidia/custom-model");
  });

  it("requires a usable reasoning key in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadConfig({ NODE_ENV: "production", OPENAI_API_KEY: "prod-key" })).toThrow(/DATABASE_URL/);
    expect(loadConfig({ NODE_ENV: "production", OPENAI_API_KEY: "prod-key", DATABASE_URL: "postgresql://db.example/tally", WEB_ORIGIN: "https://web.example" }).NODE_ENV).toBe("production");
  });

  it("parses the E2E adapter flag exactly and only enables it in test", () => {
    expect(loadConfig({ NODE_ENV: "test", TALLY_E2E_DETERMINISTIC_ADAPTER: "true" }).TALLY_E2E_DETERMINISTIC_ADAPTER).toBe("true");
    expect(loadConfig({ NODE_ENV: "test", TALLY_E2E_DETERMINISTIC_ADAPTER: "false" }).TALLY_E2E_DETERMINISTIC_ADAPTER).toBe("false");
    expect(() => EnvSchema.parse({ TALLY_E2E_DETERMINISTIC_ADAPTER: "yes" })).toThrow();
    expect(useE2EDeterministicAdapter({ NODE_ENV: "test", TALLY_E2E_DETERMINISTIC_ADAPTER: "true" })).toBe(true);
    expect(useE2EDeterministicAdapter({ NODE_ENV: "production", TALLY_E2E_DETERMINISTIC_ADAPTER: "true" })).toBe(false);
  });
});
