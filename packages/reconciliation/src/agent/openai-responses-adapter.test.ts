import { describe, expect, it, vi } from "vitest";

import { AgentProposalSchema } from "./proposal-schema.js";
import { DEFAULT_REASONING_MODEL, OpenAIResponsesAdapter } from "./openai-responses-adapter.js";
import { ReasoningAdapterError } from "./types.js";
import { DEFAULT_GROQ_REASONING_MODEL, DEFAULT_NVIDIA_REASONING_MODEL, OpenAICompatibleChatCompletionsAdapter } from "./openai-compatible-chat-completions-adapter.js";
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

function fakeClient(outputParsed: unknown, parseImplementation?: ReturnType<typeof vi.fn>) {
  const parse = parseImplementation ?? vi.fn().mockResolvedValue({ output_parsed: outputParsed });
  return { client: { parse } as never, parse };
}

describe("OpenAIResponsesAdapter", () => {
  it("returns valid structured output and forwards configured model/input/format", async () => {
    const { client, parse } = fakeClient(proposal);
    const adapter = new OpenAIResponsesAdapter({ model: "custom-model", client });

    await expect(adapter.generateProposal({ input: "PREBUILT T019 INPUT" })).resolves.toEqual(proposal);
    expect(parse).toHaveBeenCalledOnce();
    const request = parse.mock.calls[0]![0] as { model: string; input: string; text: { format: unknown } };
    expect(request.model).toBe("custom-model");
    expect(request.input).toBe("PREBUILT T019 INPUT");
    expect(request.text.format).toBeDefined();
  });

  it("uses the frozen default model", async () => {
    const { client, parse } = fakeClient(proposal);
    await new OpenAIResponsesAdapter({ client }).generateProposal({ input: "input" });
    expect((parse.mock.calls[0]![0] as { model: string }).model).toBe("gpt-5.6-terra");
    expect(DEFAULT_REASONING_MODEL).toBe("gpt-5.6-terra");
  });

  it("rejects missing or malformed structured output", async () => {
    const missing = new OpenAIResponsesAdapter({ client: fakeClient(null).client });
    await expect(missing.generateProposal({ input: "input" })).rejects.toMatchObject({ code: "AI_SCHEMA_ERROR" });

    const malformed = new OpenAIResponsesAdapter({ client: fakeClient({ ...proposal, bankRecordIds: "B001" }).client });
    await expect(malformed.generateProposal({ input: "input" })).rejects.toMatchObject({ code: "AI_SCHEMA_ERROR" });
    expect(() => AgentProposalSchema.parse({ ...proposal, confidence: "87%" })).toThrow();
    const { bankRecordIds: _, ledgerRecordIds: __, evidence: ___, ...rest } = proposal;
    expect(() => AgentProposalSchema.parse({
      ...rest,
      bankTxnIds: ["B001"],
      ledgerTxnIds: ["L001"],
      supportingEvidence: proposal.evidence,
    })).toThrow();
  });

  it("normalizes SDK failures without fabricating a proposal", async () => {
    const cause = new Error("transport failure");
    const parse = vi.fn().mockRejectedValue(cause);
    const adapter = new OpenAIResponsesAdapter({ client: fakeClient(null, parse).client });

    const error = await adapter.generateProposal({ input: "input" }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ReasoningAdapterError);
    expect(error).toMatchObject({ code: "AI_REQUEST_ERROR" });
    expect((error as ReasoningAdapterError).cause).toBe(cause);
  });

  it("passes cancellation to the SDK request options instead of the provider JSON body", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: proposal });
    const signal = new AbortController().signal;
    const adapter = new OpenAIResponsesAdapter({ client: { parse } as never });

    await expect(adapter.generateProposal({ input: "input", signal })).resolves.toEqual(proposal);

    const request = parse.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.signal).toBeUndefined();
    expect(parse.mock.calls[0]![1]).toEqual({ signal });
  });
});

describe("OpenAICompatibleChatCompletionsAdapter", () => {
  it("uses the NVIDIA chat endpoint contract and validates JSON proposals", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ provider: "nvidia", client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).resolves.toEqual(proposal);
    expect(create.mock.calls[0]![0]).toEqual(expect.objectContaining({
      model: DEFAULT_NVIDIA_REASONING_MODEL,
      messages: [
        { role: "system", content: expect.stringContaining("recordIds") },
        { role: "user", content: "input" },
      ],
      response_format: { type: "json_object" },
      max_tokens: 16384,
    }));
  });

  it("rejects invalid NVIDIA JSON output", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "not-json" } }] });
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ provider: "nvidia", client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({ code: "AI_SCHEMA_ERROR" });
  });

  it("retries once with schema feedback when NVIDIA omits evidence record IDs", async () => {
    const incomplete = { ...proposal, evidence: [{ ...proposal.evidence[0], recordIds: undefined }] };
    const create = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(incomplete) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ provider: "nvidia", client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).resolves.toEqual(proposal);
    expect(create).toHaveBeenCalledTimes(2);
    expect((create.mock.calls[1]![0] as { messages: [{ content: string }, { content: string }] }).messages[0].content).toContain("recordIds");
  });

  it("uses Nemotron's chat-template thinking switch instead of DeepSeek reasoning_effort", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const adapter = new OpenAICompatibleChatCompletionsAdapter({
      provider: "nvidia",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      client: { create } as never,
    });

    await adapter.generateProposal({ input: "input" });
    const request = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.reasoning_effort).toBeUndefined();
    expect(request.extra_body).toBeUndefined();
    expect(request.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("passes cancellation to the SDK request options instead of the provider JSON body", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const signal = new AbortController().signal;
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ provider: "nvidia", client: { create } as never });

    await expect(adapter.generateProposal({ input: "input", signal })).resolves.toEqual(proposal);

    const request = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.signal).toBeUndefined();
    expect(create.mock.calls[0]![1]).toEqual({ signal });
  });
  it("uses the Groq defaults and reports provider diagnostics", async () => {
    const providerError = Object.assign(new Error("quota exceeded"), { status: 429 });
    const create = vi.fn().mockRejectedValue(providerError);
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ client: { create } as never });

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
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ client: { create: vi.fn().mockRejectedValue(providerError) } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({
      diagnostics: {
        category: "UNKNOWN",
        errorName: "Error",
        errorCode: "ENOTFOUND",
        errorMessage: "request failed with api_key=<REDACTED>; cause: getaddrinfo ENOTFOUND api.groq.com",
      },
    });
  });

  it("uses Groq token-reset headers for a shared retry cooldown without a 30-second cap", async () => {
    const headers = new Headers({ "retry-after": "60", "x-ratelimit-reset-tokens": "90s", "x-ratelimit-remaining-tokens": "0" });
    const providerError = Object.assign(new Error("token quota exceeded"), { status: 429, headers });
    const create = vi.fn()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const waits: number[] = [];
    let now = 1_000;
    const limiter = new GroqRateLimiter(
      new InMemoryGroqQuotaStateStore(),
      { requestsPerMinute: 30, tokensPerMinute: 8_000 },
      "test",
      () => now,
      async (ms) => { waits.push(ms); now += ms; },
    );
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ provider: "groq", client: { create } as never, groqRateLimiter: limiter });

    await expect(adapter.generateProposal({ input: "input" })).resolves.toEqual(proposal);
    expect(create).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([90_000]);
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
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ client: { create } as never, groqRateLimiter: limiter });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({ diagnostics: { category: "RATE_LIMIT", rateLimitDimension: "TPM" } });
  });

  it("sends Groq-compatible JSON requests with the configured model and cancellation", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }], usage: { total_tokens: 700 } });
    const signal = new AbortController().signal;
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ provider: "groq", model: "groq-test", client: { create } as never });

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
    const adapter = new OpenAICompatibleChatCompletionsAdapter({ provider: "groq", client: { create } as never, groqRateLimiter: limiter });

    await expect(adapter.generateProposal({ input: "input" })).resolves.toEqual(proposal);
    await expect(limiter.reserve(1_500)).resolves.toMatchObject({ tokens: 1_500 });
  });

  it("starts the provider execution slice only after Groq quota is reserved", async () => {
    const reserve = vi.fn(async () => ({ reservationId: "reservation", requests: 1, tokens: 100 }));
    const settle = vi.fn(async () => undefined);
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const onProviderRequestStart = vi.fn();
    const adapter = new OpenAICompatibleChatCompletionsAdapter({
      provider: "groq",
      client: { create } as never,
      groqRateLimiter: { reserve, settle, blockFor: vi.fn() } as never,
    });

    await adapter.generateProposal({ input: "input", onProviderRequestStart });

    expect(onProviderRequestStart).toHaveBeenCalledOnce();
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(onProviderRequestStart.mock.invocationCallOrder[0]!);
    expect(onProviderRequestStart.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]!);
  });
});
