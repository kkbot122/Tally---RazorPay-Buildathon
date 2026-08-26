import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { ZodError } from "zod";

import { AgentProposalForModelSchema, type AgentProposal } from "./proposal-schema.js";
import {
  ReasoningAdapterError,
  type ReasoningModelAdapter,
  type ReasoningModelInput,
} from "./types.js";

export const DEFAULT_REASONING_MODEL = "gpt-5.6-terra";

type ResponsesParseClient = Pick<OpenAI["responses"], "parse">;

export type OpenAIResponsesAdapterOptions = {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  client?: ResponsesParseClient;
};

export class OpenAIResponsesAdapter implements ReasoningModelAdapter {
  private readonly model: string;
  private readonly client: ResponsesParseClient;

  constructor(options: OpenAIResponsesAdapterOptions = {}) {
    this.model = options.model ?? DEFAULT_REASONING_MODEL;
    this.client = options.client ?? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, timeout: options.timeout, maxRetries: options.maxRetries }).responses;
  }

  async generateProposal(input: ReasoningModelInput): Promise<AgentProposal> {
    let response: Awaited<ReturnType<ResponsesParseClient["parse"]>>;
    try {
      response = await this.client.parse({
        model: this.model,
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
}
