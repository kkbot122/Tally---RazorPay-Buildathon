import { describe, expect, it } from "vitest";

import { GroqRateLimiter, InMemoryGroqQuotaStateStore } from "./groq-rate-limiter.js";

describe("GroqRateLimiter", () => {
  it("atomically shares token reservations made concurrently by separate limiter instances", async () => {
    const store = new InMemoryGroqQuotaStateStore();
    const waits: number[] = [];
    const options = {
      requestsPerMinute: 10,
      tokensPerMinute: 8,
    };
    const wait = async (ms: number) => { waits.push(ms); throw new Error("quota wait"); };
    const firstReplica = new GroqRateLimiter(store, options, "organization", () => 1_000, wait);
    const secondReplica = new GroqRateLimiter(store, options, "organization", () => 1_000, wait);

    await expect(Promise.all([firstReplica.reserve(4), secondReplica.reserve(4)])).resolves.toHaveLength(2);
    await expect(firstReplica.reserve(1)).rejects.toThrow("quota wait");
    expect(waits).toEqual([60_000]);
  });

  it("does not send a waiting request after cancellation", async () => {
    const store = new InMemoryGroqQuotaStateStore();
    const limiter = new GroqRateLimiter(store, { requestsPerMinute: 1, tokensPerMinute: 8 }, "organization", () => 1_000);
    await limiter.reserve(1);
    const controller = new AbortController();
    controller.abort("RUN_CANCELLED");

    await expect(limiter.reserve(1, controller.signal)).rejects.toBe("RUN_CANCELLED");
  });
});
