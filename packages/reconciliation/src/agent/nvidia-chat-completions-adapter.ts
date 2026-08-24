import OpenAI from "openai";
import { AgentProposalForModelSchema } from "./proposal-schema.js";
import { ReasoningAdapterError, type ReasoningModelAdapter, type ReasoningModelInput } from "./types.js";
import type { AgentProposal } from "./proposal-schema.js";

export const DEFAULT_NVIDIA_REASONING_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const NVIDIA_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposedOutcome", "bankRecordIds", "ledgerRecordIds", "confidence", "evidence", "conflictingEvidence", "reason"],
  properties: {
    proposedOutcome: { type: "string", enum: ["MATCH", "TIMING_DIFFERENCE", "DISCREPANCY", "INSUFFICIENT_EVIDENCE"] },
    bankRecordIds: { type: "array", items: { type: "string", minLength: 1 } },
    ledgerRecordIds: { type: "array", items: { type: "string", minLength: 1 } },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    evidence: { type: "array", minItems: 1, items: { "$ref": "#/$defs/evidence" } },
    conflictingEvidence: { type: "array", items: { "$ref": "#/$defs/evidence" } },
    reason: { type: "string", minLength: 1 },
  },
  $defs: {
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["statement", "source", "kind", "recordIds"],
      properties: {
        statement: { type: "string", minLength: 1 },
        source: { type: "string", enum: ["BANK_RECORD", "LEDGER_RECORD", "CROSS_RECORD", "DETERMINISTIC"] },
        kind: { type: "string", enum: ["AMOUNT", "REFERENCE", "COUNTERPARTY", "DESCRIPTION", "BATCH", "DATE", "GROUPING", "SEMANTIC", "DETERMINISTIC"] },
        recordIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
      },
    },
  },
} as const;
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
Evidence must contain at least one item, even for INSUFFICIENT_EVIDENCE. When there is no reliable support, use one explicit insufficiency item with source DETERMINISTIC, kind DETERMINISTIC, and the relevant supplied record IDs; do not return an empty evidence array.
Every evidence and conflictingEvidence object must include a non-empty recordIds array containing the exact record IDs that support that specific statement. Never omit recordIds, and never put record IDs only in the top-level bankRecordIds or ledgerRecordIds fields.
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
    const requestProposal = async (instruction: string) => {
      try {
        const request = {
          model: this.model,
          messages: [
            { role: "system", content: NVIDIA_PROPOSAL_FORMAT },
            { role: "user", content: input.retryFeedback === undefined ? instruction : `${instruction}\n\nVERIFIER FEEDBACK FOR THIS REPAIR ATTEMPT:\n${input.retryFeedback}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "agent_proposal", strict: true, schema: NVIDIA_PROPOSAL_JSON_SCHEMA },
          },
          temperature: 0,
          max_tokens: 16384,
          ...(this.model.startsWith("nvidia/nemotron-3.5-lightning")
            ? { chat_template_kwargs: { enable_thinking: this.reasoningEffort !== "none" } }
            : {}),
        };
        // NVIDIA's provider-specific chat_template_kwargs is intentionally outside
        // the OpenAI SDK request type, but is part of NVIDIA's documented API.
        try {
          return await this.client.create(request as never);
        } catch (error) {
          // Hosted endpoints may expose JSON mode without exposing guided JSON
          // schema decoding. Fall back only for that provider capability error;
          // all other request failures remain fatal.
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("json_schema") && !message.includes("guided_json") && !message.includes("response_format")) throw error;
          return await this.client.create({ ...request, response_format: { type: "json_object" } } as never);
        }
      } catch (error) {
        throw new ReasoningAdapterError("AI_REQUEST_ERROR", "The NVIDIA reasoning request failed.", { cause: error });
      }
    };

    const parseProposal = (response: Awaited<ReturnType<ChatCompletionsClient["create"]>>) => {
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
      const parsed = AgentProposalForModelSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The NVIDIA response did not contain a valid agent proposal.", { cause: parsed.error });
      }
      return parsed.data;
    };

    const instruction = input.input;
    try {
      return parseProposal(await requestProposal(instruction));
    } catch (error) {
      if (!(error instanceof ReasoningAdapterError) || error.code !== "AI_SCHEMA_ERROR") throw error;
      const cause = error.cause instanceof Error ? error.cause.message : "The response did not match the required schema.";
      return parseProposal(await requestProposal(
        `${instruction}\n\nYour previous JSON was rejected. Return a corrected JSON object only. Fix these schema errors exactly: ${cause}`,
      ));
    }
  }
}
