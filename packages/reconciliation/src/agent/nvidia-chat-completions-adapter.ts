import OpenAI from "openai";
import { AgentProposalSchema } from "./proposal-schema.js";
import { ReasoningAdapterError, type ReasoningModelAdapter, type ReasoningModelInput } from "./types.js";
import type { AgentProposal } from "./proposal-schema.js";

export const DEFAULT_NVIDIA_REASONING_MODEL = "meta/llama-3.1-70b-instruct";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

type ChatCompletionsClient = Pick<OpenAI["chat"]["completions"], "create">;

export type NvidiaChatCompletionsAdapterOptions = {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  client?: ChatCompletionsClient;
};

export class NvidiaChatCompletionsAdapter implements ReasoningModelAdapter {
  private readonly model: string;
  private readonly client: ChatCompletionsClient;

  constructor(options: NvidiaChatCompletionsAdapterOptions = {}) {
    this.model = options.model ?? DEFAULT_NVIDIA_REASONING_MODEL;
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
        messages: [{ role: "user", content: input.input }],
        response_format: { type: "json_object" },
        temperature: 0,
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
