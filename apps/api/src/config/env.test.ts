import { describe, expect, it } from "vitest";

import { EnvSchema, loadConfig, useE2EDeterministicAdapter, workerConfiguration } from "./env.js";

describe("API environment configuration", () => {
  it("provides safe local defaults", () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      DATABASE_URL: "postgresql://localhost:5432/tally",
      GROQ_API_KEY: "",
      GROQ_MODEL: "openai/gpt-oss-120b",
      AI_REQUEST_TIMEOUT_MS: 12000,
      AI_MAX_RETRIES: 0,
      AI_REASONING_CONCURRENCY: 2,
      AI_MAX_REASONING_CALLS_PER_RUN: 3,
      AI_GROQ_REQUESTS_PER_MINUTE: 30,
      AI_GROQ_TOKENS_PER_MINUTE: 8000,
      AI_GROQ_QUOTA_SCOPE: "groq:organization",
      AI_RUN_DEADLINE_MS: 90000,
      WEB_ORIGIN: "http://localhost:3000",
    });
  });

  it("coerces and validates configured values", () => {
    expect(
      loadConfig({
        PORT: "4000",
        DATABASE_URL: "postgresql://db.example/tally",
        GROQ_API_KEY: "test-key",
        GROQ_MODEL: "test-model",
        WEB_ORIGIN: "https://web.example",
      }),
    ).toMatchObject({ PORT: 4000, GROQ_MODEL: "test-model", AI_REASONING_CONCURRENCY: 2, AI_MAX_REASONING_CALLS_PER_RUN: 3, AI_GROQ_TOKENS_PER_MINUTE: 8000, AI_RUN_DEADLINE_MS: 90000 });

    expect(() => EnvSchema.parse({ PORT: "70000" })).toThrow();
    expect(() => EnvSchema.parse({ WEB_ORIGIN: "not-a-url" })).toThrow();
  });

  it("selects the Groq default model and validates its production key", () => {
    expect(loadConfig({}).GROQ_MODEL).toBe("openai/gpt-oss-120b");
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgresql://db.example/tally", WEB_ORIGIN: "https://web.example" })).toThrow(/GROQ_API_KEY/);
    expect(loadConfig({ NODE_ENV: "production", GROQ_API_KEY: "groq-key", DATABASE_URL: "postgresql://db.example/tally", WEB_ORIGIN: "https://web.example" }).GROQ_MODEL).toBe("openai/gpt-oss-120b");
  });

  it("requires a usable reasoning key in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/GROQ_API_KEY/);
    expect(() => loadConfig({ NODE_ENV: "production", GROQ_API_KEY: "prod-key" })).toThrow(/DATABASE_URL/);
    expect(loadConfig({ NODE_ENV: "production", GROQ_API_KEY: "prod-key", DATABASE_URL: "postgresql://db.example/tally", WEB_ORIGIN: "https://web.example" }).NODE_ENV).toBe("production");
  });

  it("parses the E2E adapter flag exactly and only enables it in test", () => {
    expect(loadConfig({ NODE_ENV: "test", TALLY_E2E_DETERMINISTIC_ADAPTER: "true" }).TALLY_E2E_DETERMINISTIC_ADAPTER).toBe("true");
    expect(loadConfig({ NODE_ENV: "test", TALLY_E2E_DETERMINISTIC_ADAPTER: "false" }).TALLY_E2E_DETERMINISTIC_ADAPTER).toBe("false");
    expect(() => EnvSchema.parse({ TALLY_E2E_DETERMINISTIC_ADAPTER: "yes" })).toThrow();
    expect(useE2EDeterministicAdapter({ NODE_ENV: "test", TALLY_E2E_DETERMINISTIC_ADAPTER: "true" })).toBe(true);
    expect(useE2EDeterministicAdapter({ NODE_ENV: "production", TALLY_E2E_DETERMINISTIC_ADAPTER: "true" })).toBe(false);
  });

  it("serializes free-tier Groq worker requests across a full quota minute", () => {
    expect(workerConfiguration(loadConfig({ AI_WORKER_CONCURRENCY: "4", AI_WORKER_SLICE_MS: "60000" }))).toMatchObject({ concurrency: 1, sliceMs: 75_000, maxReasoningItemsPerRequest: 1 });
  });
});
