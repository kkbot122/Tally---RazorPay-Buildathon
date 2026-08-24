import { describe, expect, it, vi } from "vitest";

import { AgentProposalSchema } from "./proposal-schema.js";
import { DEFAULT_REASONING_MODEL, OpenAIResponsesAdapter } from "./openai-responses-adapter.js";
import { ReasoningAdapterError } from "./types.js";
import { DEFAULT_NVIDIA_REASONING_MODEL, NvidiaChatCompletionsAdapter } from "./nvidia-chat-completions-adapter.js";

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
});

describe("NvidiaChatCompletionsAdapter", () => {
  it("uses the NVIDIA chat endpoint contract and validates JSON proposals", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(proposal) } }] });
    const adapter = new NvidiaChatCompletionsAdapter({ client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).resolves.toEqual(proposal);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_NVIDIA_REASONING_MODEL,
      messages: [{ role: "user", content: expect.stringContaining("input") }],
      response_format: { type: "json_object" },
      max_tokens: 16384,
      reasoning_effort: "none",
    }));
  });

  it("rejects invalid NVIDIA JSON output", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: "not-json" } }] });
    const adapter = new NvidiaChatCompletionsAdapter({ client: { create } as never });

    await expect(adapter.generateProposal({ input: "input" })).rejects.toMatchObject({ code: "AI_SCHEMA_ERROR" });
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
    expect(request.extra_body).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });
});
