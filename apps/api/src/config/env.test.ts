import { describe, expect, it } from "vitest";

import { EnvSchema, loadConfig } from "./env.js";

describe("API environment configuration", () => {
  it("provides safe local defaults", () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: "development",
      PORT: 3001,
      DATABASE_URL: "postgresql://localhost:5432/tally",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "gpt-5.6-terra",
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
    ).toMatchObject({ PORT: 4000, OPENAI_MODEL: "test-model" });

    expect(() => EnvSchema.parse({ PORT: "70000" })).toThrow();
    expect(() => EnvSchema.parse({ WEB_ORIGIN: "not-a-url" })).toThrow();
  });

  it("requires a usable reasoning key in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/OPENAI_API_KEY/);
    expect(loadConfig({ NODE_ENV: "production", OPENAI_API_KEY: "prod-key" }).NODE_ENV).toBe("production");
  });
});
