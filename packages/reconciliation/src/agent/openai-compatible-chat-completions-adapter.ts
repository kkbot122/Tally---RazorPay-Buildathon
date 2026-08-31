import OpenAI from "openai";

import { AgentProposalForModelSchema, type AgentProposal } from "./proposal-schema.js";
import {
  ReasoningAdapterError,
  type ReasoningAdapterDiagnostics,
  type ReasoningModelAdapter,
  type ReasoningModelInput,
} from "./types.js";

export const DEFAULT_NVIDIA_REASONING_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const DEFAULT_GROQ_REASONING_MODEL = "llama-3.3-70b-versatile";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const PROPOSAL_FORMAT = `
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
Evidence must contain at least one item, even for INSUFFICIENT_EVIDENCE. When there is no reliable support, use one explicit insufficiency item with source DETERMINISTIC, kind DETERMINISTIC, and the relevant supplied record IDs; do not return an empty evidence array.
Every evidence and conflictingEvidence object must include a non-empty recordIds array containing the exact record IDs that support that specific statement. Never omit recordIds, and never put record IDs only in the top-level bankRecordIds or ledgerRecordIds fields.
`;

type ChatCompletionsClient = Pick<OpenAI["chat"]["completions"], "create">;

export type OpenAICompatibleChatCompletionsAdapterOptions = {
  provider?: "nvidia" | "groq";
  model?: string;
  apiKey?: string;
  baseURL?: string;
  reasoningEffort?: "none" | "high" | "max";
  timeout?: number;
  maxRetries?: number;
  client?: ChatCompletionsClient;
};

export class OpenAICompatibleChatCompletionsAdapter implements ReasoningModelAdapter {
  private readonly provider: "nvidia" | "groq";
  private readonly model: string;
  private readonly reasoningEffort: "none" | "high" | "max";
  private readonly client: ChatCompletionsClient;

  constructor(options: OpenAICompatibleChatCompletionsAdapterOptions = {}) {
    this.provider = options.provider ?? "groq";
    this.model = options.model ?? (this.provider === "nvidia" ? DEFAULT_NVIDIA_REASONING_MODEL : DEFAULT_GROQ_REASONING_MODEL);
    this.reasoningEffort = options.reasoningEffort ?? "none";
    this.client = options.client ?? new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL ?? (this.provider === "nvidia" ? NVIDIA_BASE_URL : GROQ_BASE_URL),
      timeout: options.timeout,
      maxRetries: options.maxRetries,
    }).chat.completions;
  }

  async generateProposal(input: ReasoningModelInput): Promise<AgentProposal> {
    const requestProposal = async (instruction: string) => {
      const startedAt = Date.now();
      try {
        const request = {
          model: this.model,
          messages: [
            { role: "system", content: PROPOSAL_FORMAT },
            { role: "user", content: input.retryFeedback === undefined ? instruction : `${instruction}\n\nVERIFIER FEEDBACK FOR THIS REPAIR ATTEMPT:\n${input.retryFeedback}` },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 16384,
          ...(this.provider === "nvidia" && this.model.startsWith("nvidia/nemotron-3.5-lightning")
            ? { chat_template_kwargs: { enable_thinking: this.reasoningEffort !== "none" } }
            : {}),
        };
        return await this.client.create(request as never, { signal: input.signal });
      } catch (error) {
        throw new ReasoningAdapterError("AI_REQUEST_ERROR", `The ${this.provider} reasoning request failed.`, {
          cause: error,
          diagnostics: { provider: this.provider, model: this.model, durationMs: Date.now() - startedAt, ...classifyProviderError(error) },
        });
      }
    };

    const parseProposal = (response: Awaited<ReturnType<ChatCompletionsClient["create"]>>) => {
      if ("choices" in response === false || response.choices.length === 0) {
        throw new ReasoningAdapterError("AI_SCHEMA_ERROR", `The ${this.provider} response did not contain a model choice.`);
      }
      const content = response.choices[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ReasoningAdapterError("AI_SCHEMA_ERROR", `The ${this.provider} response did not contain a JSON proposal.`);
      }

      let candidate: unknown;
      try {
        candidate = JSON.parse(content);
      } catch (error) {
        throw new ReasoningAdapterError("AI_SCHEMA_ERROR", `The ${this.provider} response was not valid JSON.`, { cause: error });
      }
      const parsed = AgentProposalForModelSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new ReasoningAdapterError("AI_SCHEMA_ERROR", `The ${this.provider} response did not contain a valid agent proposal.`, { cause: parsed.error });
      }
      return parsed.data;
    };

    try {
      return parseProposal(await requestProposal(input.input));
    } catch (error) {
      if (!(error instanceof ReasoningAdapterError) || error.code !== "AI_SCHEMA_ERROR") throw error;
      const cause = error.cause instanceof Error ? error.cause.message : "The response did not match the required schema.";
      return parseProposal(await requestProposal(`${input.input}\n\nYour previous JSON was rejected. Return a corrected JSON object only. Fix these schema errors exactly: ${cause}`));
    }
  }
}

function classifyProviderError(error: unknown): Pick<ReasoningAdapterDiagnostics, "category" | "status"> {
  const status = error !== null && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (status === 401 || status === 403) return { status, category: "AUTHENTICATION" };
  if (status === 429) return { status, category: "RATE_LIMIT" };
  if (status !== undefined && status >= 400 && status < 500) return { status, category: "VALIDATION" };
  if (status !== undefined && status >= 500) return { status, category: "SERVER" };
  if (error instanceof Error && (error.name === "AbortError" || /timed out|timeout/i.test(error.message))) return { category: "TIMEOUT" };
  return { category: "UNKNOWN" };
}
