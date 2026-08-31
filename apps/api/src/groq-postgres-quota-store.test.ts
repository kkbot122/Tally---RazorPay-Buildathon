import { describe, expect, it } from "vitest";

import { PostgresGroqQuotaStateStore } from "./groq-postgres-quota-store.js";

it("serializes quota timestamps as ISO strings for postgres parameters", async () => {
  const values: unknown[][] = [];
  const transaction = (strings: TemplateStringsArray, ...parameters: unknown[]) => {
    values.push(parameters);
    if (strings.join("").includes("from groq_quota_state")) return Promise.resolve([]);
    return Promise.resolve([]);
  };
  const sql = Object.assign(transaction, {
    begin: async <T>(operation: (tx: typeof transaction) => Promise<T>) => operation(transaction),
  });
  const store = new PostgresGroqQuotaStateStore(sql as never);

  await store.update("groq:organization", () => ({
    state: {
      minuteStartedAt: 1_788_202_095_000,
      requestsInMinute: 1,
      tokensInMinute: 2_048,
      blockedUntil: 1_788_202_155_000,
    },
    result: undefined,
  }));

  expect(values.at(-1)).toEqual([
    "groq:organization",
    "2026-08-31T18:48:15.000Z",
    1,
    2_048,
    "2026-08-31T18:49:15.000Z",
  ]);
});

it("normalizes timestamps returned as strings by postgres", async () => {
  const transaction = (strings: TemplateStringsArray) => {
    if (strings.join("").includes("from groq_quota_state")) {
      return Promise.resolve([{
        minuteStartedAt: "2026-08-31T18:48:15.000Z",
        requestsInMinute: 1,
        tokensInMinute: 2_048,
        blockedUntil: "2026-08-31T18:49:15.000Z",
      }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(transaction, {
    begin: async <T>(operation: (tx: typeof transaction) => Promise<T>) => operation(transaction),
  });
  const store = new PostgresGroqQuotaStateStore(sql as never);

  const value = await store.update("groq:organization", (state) => ({ state, result: state }));

  expect(value).toEqual({
    minuteStartedAt: 1_788_202_095_000,
    requestsInMinute: 1,
    tokensInMinute: 2_048,
    blockedUntil: 1_788_202_155_000,
  });
});
