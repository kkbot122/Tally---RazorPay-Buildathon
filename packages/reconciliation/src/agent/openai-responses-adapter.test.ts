import { describe, expect, it, vi } from "vitest";

import { AgentProposalSchema } from "./proposal-schema.js";
import { DEFAULT_REASONING_MODEL, OpenAIResponsesAdapter } from "./openai-responses-adapter.js";
import { ReasoningAdapterError } from "./types.js";
import { DEFAULT_NVIDIA_REASONING_MODEL, NvidiaChatCompletionsAdapter } from "./nvidia-chat-completions-adapter.js";
import { DEFAULT_GEMINI_REASONING_MODEL, GeminiAdapter } from "./gemini-adapter.js";

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

describe("NvidiaChatCompletionsAdapter", () => {
  it("uses the NVIDIA chat endpoint contract and validates JSON proposals", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const adapter = new NvidiaChatCompletionsAdapter({ client: { create } as never });

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
    const adapter = new NvidiaChatCompletionsAdapter({ client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({ code: "AI_SCHEMA_ERROR" });
  });

  it("retries once with schema feedback when NVIDIA omits evidence record IDs", async () => {
    const incomplete = { ...proposal, evidence: [{ ...proposal.evidence[0], recordIds: undefined }] };
    const create = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(incomplete) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const adapter = new NvidiaChatCompletionsAdapter({ client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).resolves.toEqual(proposal);
    expect(create).toHaveBeenCalledTimes(2);
    expect((create.mock.calls[1]![0] as { messages: [{ content: string }, { content: string }] }).messages[0].content).toContain("recordIds");
  });

  it("uses Nemotron's chat-template thinking switch instead of DeepSeek reasoning_effort", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const adapter = new NvidiaChatCompletionsAdapter({
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
    const adapter = new NvidiaChatCompletionsAdapter({ client: { create } as never });

    await expect(adapter.generateProposal({ input: "input", signal })).resolves.toEqual(proposal);

    const request = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(request.signal).toBeUndefined();
    expect(create.mock.calls[0]![1]).toEqual({ signal });
  });
});

describe("GeminiAdapter", () => {
  it("requests schema-constrained JSON with thinking disabled and forwards cancellation", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify(proposal) });
    const signal = new AbortController().signal;
    const adapter = new GeminiAdapter({ client: { generateContent } as never });

    await expect(adapter.generateProposal({ input: "input", signal })).resolves.toEqual(proposal);

    const request = generateContent.mock.calls[0]![0] as { model: string; contents: string; config: Record<string, unknown> };
    expect(request.model).toBe(DEFAULT_GEMINI_REASONING_MODEL);
    expect(request.contents).toBe("input");
    expect(request.config).toMatchObject({
      abortSignal: signal,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
      responseJsonSchema: expect.objectContaining({ type: "object", additionalProperties: false }),
    });
  });

  it("rejects malformed Gemini output without fabricating a proposal", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "not-json" });
    const adapter = new GeminiAdapter({ client: { generateContent } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({ code: "AI_SCHEMA_ERROR" });
  });

  it("normalizes Gemini provider failures with sanitized diagnostics", async () => {
    const providerError = Object.assign(new Error("quota exceeded"), { status: 429 });
    const generateContent = vi.fn().mockRejectedValue(providerError);
    const adapter = new GeminiAdapter({ model: "gemini-test", client: { generateContent } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({
      code: "AI_REQUEST_ERROR",
      diagnostics: { provider: "gemini", model: "gemini-test", category: "RATE_LIMIT", status: 429 },
    });
  });
});
