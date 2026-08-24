import OpenAI from "openai";
import { AgentProposalSchema } from "./proposal-schema.js";
import { ReasoningAdapterError, type ReasoningModelAdapter, type ReasoningModelInput } from "./types.js";
import type { AgentProposal } from "./proposal-schema.js";

export const DEFAULT_NVIDIA_REASONING_MODEL = "meta/llama-3.1-70b-instruct";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_PROPOSAL_FORMAT = `
Return exactly one JSON object with these keys and no wrapper object:
{
  "proposedOutcome": "MATCH" | "TIMING_DIFFERENCE" | "DISCREPANCY" | "INSUFFICIENT_EVIDENCE",
  "bankRecordIds": string[],
  "ledgerRecordIds": string[],
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "evidence": [{ "statement": string, "source": "BANK_RECORD" | "LEDGER_RECORD" | "CROSS_RECORD" | "DETERMINISTIC", "kind": "REFERENCE" | "COUNTERPARTY" | "DESCRIPTION" | "BATCH" | "AMOUNT" | "DATE" | "GROUPING" | "SEMANTIC" | "DETERMINISTIC", "recordIds": string[] }],
  "conflictingEvidence": [{ "statement": string, "source": "BANK_RECORD" | "LEDGER_RECORD" | "CROSS_RECORD" | "DETERMINISTIC", "kind": "REFERENCE" | "COUNTERPARTY" | "DESCRIPTION" | "BATCH" | "AMOUNT" | "DATE" | "GROUPING" | "SEMANTIC" | "DETERMINISTIC", "recordIds": string[] }],
  "reason": string
}
Do not use snake_case keys. Do not put the proposal under another key. Evidence must be an array of objects, not strings.
`;

type ChatCompletionsClient = Pick<OpenAI["chat"]["completions"], "create">;

export type NvidiaChatCompletionsAdapterOptions = {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  reasoningEffort?: "none" | "high" | "max";
  client?: ChatCompletionsClient;
};

export class NvidiaChatCompletionsAdapter implements ReasoningModelAdapter {
  private readonly model: string;
  private readonly reasoningEffort: "none" | "high" | "max";
  private readonly client: ChatCompletionsClient;

  constructor(options: NvidiaChatCompletionsAdapterOptions = {}) {
    this.model = options.model ?? DEFAULT_NVIDIA_REASONING_MODEL;
    this.reasoningEffort = options.reasoningEffort ?? "none";
    this.client = options.client ?? new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL ?? NVIDIA_BASE_URL,
    }).chat.completions;
  }

  async generateProposal(input: ReasoningModelInput): Promise<AgentProposal> {
    let response: Awaited<ReturnType<ChatCompletionsClient["create"]>>;
    try {
      response = await this.client.create({
        model: this.model,
        messages: [{ role: "user", content: `${input.input}\n${NVIDIA_PROPOSAL_FORMAT}` }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 16384,
        reasoning_effort: this.reasoningEffort,
      });
    } catch (error) {
      throw new ReasoningAdapterError("AI_REQUEST_ERROR", "The NVIDIA reasoning request failed.", { cause: error });
    }

    if ("choices" in response === false || response.choices.length === 0) {
      throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The NVIDIA response did not contain a model choice.");
    }
    const content = response.choices[0]?.message?.content;
    if (typeof content !== "string") {
      throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The NVIDIA response did not contain a JSON proposal.");
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(content);
    } catch (error) {
      throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The NVIDIA response was not valid JSON.", { cause: error });
    }
    const parsed = AgentProposalSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The NVIDIA response did not contain a valid agent proposal.", { cause: parsed.error });
    }
    return parsed.data;
  }
}
