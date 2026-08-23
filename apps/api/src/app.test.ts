import { describe, expect, it } from "vitest";

import { buildApp, type DatabaseHandle } from "./app.js";

const config = {
  PORT: 3001,
  DATABASE_URL: "postgresql://localhost:5432/tally",
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-5.6-terra",
  WEB_ORIGIN: "http://localhost:3000",
};

function createTestDatabase(overrides: Partial<DatabaseHandle> = {}): DatabaseHandle {
  return {
    check: async () => {},
    close: async () => {},
    ...overrides,
  };
}

describe("GET /health", () => {
  it("returns an OK status", async () => {
    const app = buildApp(config, createTestDatabase());
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("GET /health/db", () => {
  it("returns database health when the connection check succeeds", async () => {
    const app = buildApp(config, createTestDatabase());
    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ db: "ok" });
    await app.close();
  });

  it("returns service unavailable when the connection check fails", async () => {
    const app = buildApp(
      config,
      createTestDatabase({ check: async () => Promise.reject(new Error("connection refused")) }),
    );
    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ db: "error" });
    await app.close();
  });
});
