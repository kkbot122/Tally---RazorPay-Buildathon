import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";
import { z } from "zod";

import { AgentProposalForModelSchema, type AgentProposal } from "./proposal-schema.js";
import {
  ReasoningAdapterError,
  type ReasoningModelAdapter,
  type ReasoningModelInput,
} from "./types.js";

export const DEFAULT_REASONING_MODEL = "gpt-5.6-terra";

type ResponsesParseClient = Pick<OpenAI["responses"], "parse">;
const ReasoningBatchResponseSchema = z.object({
  proposals: z.array(z.object({ componentId: z.string(), proposal: AgentProposalForModelSchema })),
});

export type OpenAIResponsesAdapterOptions = {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  maxCompletionTokens?: number;
  client?: ResponsesParseClient;
};

export class OpenAIResponsesAdapter implements ReasoningModelAdapter {
  private readonly model: string;
  private readonly client: ResponsesParseClient;
  private readonly maxCompletionTokens: number | undefined;

  constructor(options: OpenAIResponsesAdapterOptions = {}) {
    this.model = options.model ?? DEFAULT_REASONING_MODEL;
    this.maxCompletionTokens = options.maxCompletionTokens;
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, timeout: options.timeout, maxRetries: options.maxRetries }).responses;
  }

  async generateProposal(input: ReasoningModelInput): Promise<AgentProposal> {
    let response: Awaited<ReturnType<ResponsesParseClient["parse"]>>;
    try {
      input.onProviderRequestStart?.();
      response = await this.client.parse({
        model: this.model,
        ...(this.maxCompletionTokens === undefined ? {} : { max_output_tokens: this.maxCompletionTokens }),
        input: input.retryFeedback === undefined ? input.input : `${input.input}\n\nVERIFIER FEEDBACK FOR THIS REPAIR ATTEMPT:\n${input.retryFeedback}`,
        text: {
          format: zodTextFormat(AgentProposalForModelSchema, "agent_proposal"),
        },
      }, { signal: input.signal });
    } catch (error) {
      const code = error instanceof ZodError ? "AI_SCHEMA_ERROR" : "AI_REQUEST_ERROR";
      throw new ReasoningAdapterError(code, code === "AI_SCHEMA_ERROR" ? "The model response failed schema validation." : "The OpenAI reasoning request failed.", { cause: error });
    }

    const parsed = AgentProposalForModelSchema.safeParse(response.output_parsed);
    if (!parsed.success) {
      throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The OpenAI response did not contain a valid agent proposal.", { cause: parsed.error });
    }

    return parsed.data;
  }

  async generateBatchProposal(input: { items: readonly (ReasoningModelInput & { componentId: string })[]; signal?: AbortSignal; onProviderRequestStart?: () => void }): Promise<unknown> {
    if (input.items.length < 1 || input.items.length > 5) throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The reasoning batch must contain between one and five components.");
    const prompt = `Analyze each independent component separately. Return exactly one proposal for every componentId in a proposals array. Never use records from another component.\n\n${input.items.map((item) => `COMPONENT ${item.componentId}:\n${item.input}`).join("\n\n")}`;
    try {
      input.onProviderRequestStart?.();
      const response = await this.client.parse({
        model: this.model,
        ...(this.maxCompletionTokens === undefined ? {} : { max_output_tokens: this.maxCompletionTokens }),
        input: prompt,
        text: { format: zodTextFormat(ReasoningBatchResponseSchema, "reasoning_batch") },
      }, { signal: input.signal });
      const parsed = ReasoningBatchResponseSchema.safeParse(response.output_parsed);
      if (!parsed.success) throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "The OpenAI batch response did not contain valid proposals.", { cause: parsed.error });
      return parsed.data.proposals;
    } catch (error) {
      if (error instanceof ReasoningAdapterError) throw error;
      throw new ReasoningAdapterError("AI_REQUEST_ERROR", "The OpenAI reasoning batch failed.", { cause: error });
    }
  }
}
