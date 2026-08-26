import { GoogleGenAI, ThinkingLevel } from "@google/genai";

import { AgentProposalForModelSchema, type AgentProposal } from "./proposal-schema.js";
import { ReasoningAdapterError, type ReasoningAdapterDiagnostics, type ReasoningModelAdapter, type ReasoningModelInput } from "./types.js";

export const DEFAULT_GEMINI_REASONING_MODEL = "gemini-3.6-flash";

type GeminiModelsClient = Pick<GoogleGenAI["models"], "generateContent">;

const GEMINI_PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    proposedOutcome: { type: "string", enum: ["MATCH", "TIMING_DIFFERENCE", "DISCREPANCY", "INSUFFICIENT_EVIDENCE"] },
    bankRecordIds: { type: "array", items: { type: "string" } },
    ledgerRecordIds: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    evidence: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, source: { type: "string", enum: ["BANK_RECORD", "LEDGER_RECORD", "CROSS_RECORD", "DETERMINISTIC"] }, kind: { type: "string", enum: ["REFERENCE", "COUNTERPARTY", "DESCRIPTION", "BATCH", "AMOUNT", "DATE", "GROUPING", "SEMANTIC", "DETERMINISTIC"] }, recordIds: { type: "array", items: { type: "string" } } }, required: ["statement", "source", "kind", "recordIds"], additionalProperties: false } },
    conflictingEvidence: { type: "array", items: { type: "object", properties: { statement: { type: "string" }, source: { type: "string", enum: ["BANK_RECORD", "LEDGER_RECORD", "CROSS_RECORD", "DETERMINISTIC"] }, kind: { type: "string", enum: ["REFERENCE", "COUNTERPARTY", "DESCRIPTION", "BATCH", "AMOUNT", "DATE", "GROUPING", "SEMANTIC", "DETERMINISTIC"] }, recordIds: { type: "array", items: { type: "string" } } }, required: ["statement", "source", "kind", "recordIds"], additionalProperties: false } },
    reason: { type: "string" },
  },
  required: ["proposedOutcome", "bankRecordIds", "ledgerRecordIds", "confidence", "evidence", "conflictingEvidence", "reason"],
  additionalProperties: false,
} as const;

export type GeminiAdapterOptions = {
  model?: string;
  apiKey?: string;
  timeout?: number;
  client?: GeminiModelsClient;
};

export class GeminiAdapter implements ReasoningModelAdapter {
  private readonly model: string;
  private readonly client: GeminiModelsClient;

  constructor(options: GeminiAdapterOptions = {}) {
    this.model = options.model ?? DEFAULT_GEMINI_REASONING_MODEL;
    this.client = options.client ?? new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { timeout: options.timeout, retryOptions: { attempts: 1 } } }).models;
  }

  async generateProposal(input: ReasoningModelInput): Promise<AgentProposal> {
    const startedAt = Date.now();
    let response: Awaited<ReturnType<GeminiModelsClient["generateContent"]>>;
    try {
      response = await this.client.generateContent({
        model: this.model,
        contents: input.retryFeedback === undefined ? input.input : `${input.input}\n\nVERIFIER FEEDBACK FOR THIS REPAIR ATTEMPT:\n${input.retryFeedback}`,
        config: {
          abortSignal: input.signal,
          temperature: 0,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseJsonSchema: GEMINI_PROPOSAL_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      });
    } catch (error) {
      throw new ReasoningAdapterError("AI_REQUEST_ERROR", "The Gemini reasoning request failed.", { cause: error, diagnostics: { provider: "gemini", model: this.model, durationMs: Date.now() - startedAt, ...classifyProviderError(error) } });
    }

    const content = response.text;
    if (typeof content !== "string" || content.trim().length === 0) throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The Gemini response did not contain a JSON proposal.");
    let candidate: unknown;
    try {
      candidate = JSON.parse(content);
    } catch (error) {
      throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The Gemini response was not valid JSON.", { cause: error });
    }
    const parsed = AgentProposalForModelSchema.safeParse(candidate);
    if (!parsed.success) throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The Gemini response did not contain a valid agent proposal.", { cause: parsed.error });
    return parsed.data;
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
