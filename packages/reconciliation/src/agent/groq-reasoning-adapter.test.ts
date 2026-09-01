import { describe, expect, it, vi } from "vitest";

import { DEFAULT_GROQ_REASONING_MODEL, GroqReasoningAdapter } from "./groq-reasoning-adapter.js";
import { GroqRateLimiter, InMemoryGroqQuotaStateStore } from "./groq-rate-limiter.js";

const proposal = {
  proposedOutcome: "MATCH",
  bankRecordIds: ["B001"],
  ledgerRecordIds: ["L001"],
  confidence: "HIGH",
  evidence: [{ statement: "The references agree.", source: "CROSS_RECORD", kind: "REFERENCE", recordIds: ["B001", "L001"] }],
  conflictingEvidence: [],
  reason: "The supplied records describe the same event.",
} as const;

describe("GroqReasoningAdapter", () => {
  it("uses the Groq defaults and reports provider diagnostics", async () => {
    const providerError = Object.assign(new Error("quota exceeded"), { status: 429 });
    const create = vi.fn().mockRejectedValue(providerError);
    const adapter = new GroqReasoningAdapter({ client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({
      code: "AI_REQUEST_ERROR",
      diagnostics: { provider: "groq", model: DEFAULT_GROQ_REASONING_MODEL, category: "RATE_LIMIT", status: 429 },
    });
  });

  it("includes a redacted transport failure summary in Groq diagnostics", async () => {
    const providerError = Object.assign(new Error("request failed with api_key=gsk_live-secret"), {
      code: "ENOTFOUND",
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.groq.com"), { code: "ENOTFOUND" }),
    });
    const adapter = new GroqReasoningAdapter({ client: { create: vi.fn().mockRejectedValue(providerError) } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({
      diagnostics: {
        category: "UNKNOWN",
        errorName: "Error",
        errorCode: "ENOTFOUND",
        errorMessage: "request failed with api_key=<REDACTED>; cause: getaddrinfo ENOTFOUND api.groq.com",
      },
    });
  });

  it("does not hide a second physical provider request behind one investigation", async () => {
    const headers = new Headers({ "retry-after": "60", "x-ratelimit-reset-tokens": "90s", "x-ratelimit-remaining-tokens": "0" });
    const providerError = Object.assign(new Error("token quota exceeded"), { status: 429, headers });
    const create = vi.fn()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const limiter = new GroqRateLimiter(
      new InMemoryGroqQuotaStateStore(),
      { requestsPerMinute: 30, tokensPerMinute: 8_000 },
      "test",
    );
    const adapter = new GroqReasoningAdapter({ client: { create } as never, groqRateLimiter: limiter });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({ diagnostics: { category: "RATE_LIMIT" } });
    expect(create).toHaveBeenCalledOnce();
  });

  it("identifies a token-per-minute rejection in diagnostics", async () => {
    const providerError = Object.assign(new Error("quota exceeded"), {
      status: 429,
      headers: new Headers({ "x-ratelimit-remaining-tokens": "0" }),
    });
    let now = 1_000;
    const limiter = new GroqRateLimiter(
      new InMemoryGroqQuotaStateStore(),
      { requestsPerMinute: 30, tokensPerMinute: 8_000 },
      "test",
      () => now,
      async (ms) => { now += ms; },
    );
    const create = vi.fn().mockRejectedValue(providerError);
    const adapter = new GroqReasoningAdapter({ client: { create } as never, groqRateLimiter: limiter });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({ diagnostics: { category: "RATE_LIMIT", rateLimitDimension: "TPM" } });
  });

  it("sends Groq-compatible JSON requests with the configured model and cancellation", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }], usage: { total_tokens: 700 } });
    const signal = new AbortController().signal;
    const adapter = new GroqReasoningAdapter({ model: "groq-test", client: { create } as never });

    await expect(adapter.generateProposal({ input: "input", signal })).resolves.toEqual(proposal);
    expect(create.mock.calls[0]![0]).toEqual(expect.objectContaining({ model: "groq-test", response_format: { type: "json_object" }, temperature: 0, max_completion_tokens: 1536 }));
    expect((create.mock.calls[0]![0] as Record<string, unknown>).chat_template_kwargs).toBeUndefined();
    expect(create.mock.calls[0]![1]).toEqual({ signal });
  });

  it("settles Groq's conservative reservation with the response's actual token usage", async () => {
    const limiter = new GroqRateLimiter(new InMemoryGroqQuotaStateStore(), { requestsPerMinute: 10, tokensPerMinute: 2_000 }, "test");
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(proposal) } }],
      usage: { total_tokens: 400 },
    });
    const adapter = new GroqReasoningAdapter({ client: { create } as never, groqRateLimiter: limiter });

    await expect(adapter.generateProposal({ input: "input" })).resolves.toEqual(proposal);
    await expect(limiter.reserve(1_500)).resolves.toMatchObject({ tokens: 1_500 });
  });

  it("starts the provider execution slice only after Groq quota is reserved", async () => {
    const reserve = vi.fn(async () => ({ reservationId: "reservation", requests: 1, tokens: 100 }));
    const settle = vi.fn(async () => undefined);
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const onProviderRequestStart = vi.fn();
    const adapter = new GroqReasoningAdapter({
      client: { create } as never,
      groqRateLimiter: { reserve, settle, blockFor: vi.fn() } as never,
    });

    await adapter.generateProposal({ input: "input", onProviderRequestStart });

    expect(onProviderRequestStart).toHaveBeenCalledOnce();
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(onProviderRequestStart.mock.invocationCallOrder[0]!);
    expect(onProviderRequestStart.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
  });

  it("emits quota and provider boundaries in order without reasoning content", async () => {
    const events: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
    const adapter = new GroqReasoningAdapter({
      client: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] }) } as never,
      groqRateLimiter: { reserve: vi.fn(async () => ({ reservationId: "r", requests: 1, tokens: 100 })), settle: vi.fn(), blockFor: vi.fn() } as never,
    });

    await adapter.generateProposal({ input: "private prompt", onOperationalEvent: (type, metadata) => { events.push({ type, metadata }); } });

    expect(events.map((event) => event.type)).toEqual([
      "GROQ_QUOTA_WAIT_STARTED",
      "GROQ_QUOTA_RESERVED",
      "PROVIDER_REQUEST_STARTED",
      "PROVIDER_REQUEST_COMPLETED",
    ]);
    expect(JSON.stringify(events)).not.toContain("private prompt");
  });
});
