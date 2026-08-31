import OpenAI from "openai";

import { AgentProposalForModelSchema, type AgentProposal } from "./proposal-schema.js";
import {
  ReasoningAdapterError,
  type ReasoningAdapterDiagnostics,
  type ReasoningModelAdapter,
  type ReasoningModelInput,
} from "./types.js";
import { DEFAULT_GROQ_RATE_LIMIT, GroqRateLimiter, InMemoryGroqQuotaStateStore } from "./groq-rate-limiter.js";

export const DEFAULT_NVIDIA_REASONING_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const DEFAULT_GROQ_REASONING_MODEL = "openai/gpt-oss-120b";
export const MAX_GROQ_REASONING_COMPLETION_TOKENS = 1536;
export const MAX_NVIDIA_REASONING_COMPLETION_TOKENS = 16384;

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const PROPOSAL_FORMAT = `
Return one JSON object only (no wrapper, no snake_case):
{ proposedOutcome, bankRecordIds, ledgerRecordIds, confidence, evidence, conflictingEvidence, reason }.
proposedOutcome is MATCH, TIMING_DIFFERENCE, DISCREPANCY, or INSUFFICIENT_EVIDENCE; confidence is HIGH, MEDIUM, or LOW.
bankRecordIds and ledgerRecordIds are exact supplied IDs. evidence and conflictingEvidence are arrays of { statement, source, kind, recordIds }; source is BANK_RECORD, LEDGER_RECORD, CROSS_RECORD, or DETERMINISTIC; kind is REFERENCE, COUNTERPARTY, DESCRIPTION, BATCH, AMOUNT, DATE, GROUPING, SEMANTIC, or DETERMINISTIC.
Every evidence item must have non-empty exact supporting recordIds. evidence is never empty: for insufficient evidence, include a DETERMINISTIC insufficiency item with the relevant IDs.
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
  /** Required in production: its state store coordinates all API replicas. */
  groqRateLimiter?: GroqRateLimiter;
};

export class OpenAICompatibleChatCompletionsAdapter implements ReasoningModelAdapter {
  private readonly provider: "nvidia" | "groq";
  private readonly model: string;
  private readonly reasoningEffort: "none" | "high" | "max";
  private readonly client: ChatCompletionsClient;
  private readonly groqRateLimiter: GroqRateLimiter | undefined;

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
    if (this.provider === "groq" && options.groqRateLimiter === undefined && process.env.NODE_ENV === "production") {
      throw new Error("A shared Groq rate limiter is required in production.");
    }
    this.groqRateLimiter = this.provider === "groq"
      ? options.groqRateLimiter ?? new GroqRateLimiter(new InMemoryGroqQuotaStateStore(), DEFAULT_GROQ_RATE_LIMIT)
      : undefined;
  }

  async generateProposal(input: ReasoningModelInput): Promise<AgentProposal> {
    const requestProposal = async (instruction: string) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const startedAt = Date.now();
        try {
          const reservation = this.provider === "groq"
            ? await this.groqRateLimiter!.reserve(estimateRequestTokens(instruction, input.retryFeedback), input.signal)
            : undefined;
          const request = {
          model: this.model,
          messages: [
            { role: "system", content: PROPOSAL_FORMAT },
            { role: "user", content: input.retryFeedback === undefined ? instruction : `${instruction}\n\nVERIFIER FEEDBACK FOR THIS REPAIR ATTEMPT:\n${input.retryFeedback}` },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
          // Groq uses a deliberately bounded output reservation. NVIDIA retains
          // its established budget because it is not part of Groq's quota.
          ...(this.provider === "groq"
            ? { max_completion_tokens: MAX_GROQ_REASONING_COMPLETION_TOKENS }
            : { max_tokens: MAX_NVIDIA_REASONING_COMPLETION_TOKENS }),
          ...(this.provider === "nvidia" && this.model.startsWith("nvidia/nemotron-3.5-lightning")
            ? { chat_template_kwargs: { enable_thinking: this.reasoningEffort !== "none" } }
            : {}),
        };
          const response = await this.client.create(request as never, { signal: input.signal });
          if (reservation !== undefined) await this.groqRateLimiter!.settle(reservation, actualTokenUsage(response));
          return response;
        } catch (error) {
          const classified = classifyProviderError(error);
          if (this.provider === "groq" && classified.status === 429 && attempt === 0) {
            await this.groqRateLimiter!.blockFor(retryAfterMs(error));
            continue;
          }
          throw new ReasoningAdapterError("AI_REQUEST_ERROR", `The ${this.provider} reasoning request failed.`, {
            cause: error,
            diagnostics: {
              provider: this.provider,
              model: this.model,
              durationMs: Date.now() - startedAt,
              ...classified,
              ...safeProviderErrorDetails(error),
            },
          });
        }
      }
      throw new Error("unreachable");
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

function retryAfterMs(error: unknown): number {
  const retryAfter = header(error, "retry-after");
  const retryAfterMs = parseRetryAfter(retryAfter);
  const tokenResetMs = parseDuration(header(error, "x-ratelimit-reset-tokens"));
  const requestResetMs = parseDuration(header(error, "x-ratelimit-reset-requests"));
  return Math.max(retryAfterMs ?? 0, tokenResetMs ?? 0, requestResetMs ?? 0, 1_000);
}

function classifyProviderError(error: unknown): Pick<ReasoningAdapterDiagnostics, "category" | "status" | "rateLimitDimension"> {
  const status = error !== null && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (status === 401 || status === 403) return { status, category: "AUTHENTICATION" };
  if (status === 429) return { status, category: "RATE_LIMIT", rateLimitDimension: quotaDimension(error) };
  if (status !== undefined && status >= 400 && status < 500) return { status, category: "VALIDATION" };
  if (status !== undefined && status >= 500) return { status, category: "SERVER" };
  if (error instanceof Error && (error.name === "AbortError" || /timed out|timeout/i.test(error.message))) return { category: "TIMEOUT" };
  return { category: "UNKNOWN" };
}

function safeProviderErrorDetails(error: unknown): Pick<ReasoningAdapterDiagnostics, "errorName" | "errorMessage" | "errorCode"> {
  if (error === null || typeof error !== "object") return {};
  const candidate = error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const cause = candidate.cause !== null && typeof candidate.cause === "object"
    ? candidate.cause as { message?: unknown; code?: unknown }
    : undefined;
  const primaryMessage = typeof candidate.message === "string" ? candidate.message : undefined;
  const causeMessage = typeof cause?.message === "string" ? cause.message : undefined;
  const message = primaryMessage === undefined
    ? causeMessage
    : causeMessage === undefined || causeMessage === primaryMessage
      ? primaryMessage
      : `${primaryMessage}; cause: ${causeMessage}`;
  const code = typeof candidate.code === "string"
    ? candidate.code
    : typeof cause?.code === "string"
      ? cause.code
      : undefined;
  return {
    ...(typeof candidate.name === "string" ? { errorName: candidate.name } : {}),
    ...(message === undefined ? {} : { errorMessage: redactSecrets(message).slice(0, 500) }),
    ...(code === undefined ? {} : { errorCode: redactSecrets(code).slice(0, 120) }),
  };
}

function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1<REDACTED>")
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1<REDACTED>")
    .replace(/\b(?:gsk|sk)-[A-Za-z0-9_-]+\b/g, "<REDACTED>");
}

function quotaDimension(error: unknown): "RPM" | "TPM" | "RPD" | "TPD" | undefined {
  const message = error instanceof Error ? error.message : "";
  if (/tokens? per day|daily token/i.test(message)) return "TPD";
  if (/requests? per day|daily request/i.test(message)) return "RPD";
  if (header(error, "x-ratelimit-remaining-tokens") === "0") return "TPM";
  if (header(error, "x-ratelimit-remaining-requests") === "0") return "RPM";
  if (header(error, "x-ratelimit-remaining-tokens-day") === "0") return "TPD";
  if (header(error, "x-ratelimit-remaining-requests-day") === "0") return "RPD";
  return undefined;
}

function estimateRequestTokens(instruction: string, retryFeedback: string | undefined): number {
  // Conservative character estimate: the configured completion ceiling is also
  // reserved because Groq enforces the combined prompt + completion budget.
  return Math.ceil((PROPOSAL_FORMAT.length + instruction.length + (retryFeedback?.length ?? 0)) / 3.5) + MAX_GROQ_REASONING_COMPLETION_TOKENS;
}

function actualTokenUsage(response: unknown): number {
  if (response === null || typeof response !== "object" || !("usage" in response)) return 0;
  const usage = response.usage;
  if (usage === null || typeof usage !== "object" || !("total_tokens" in usage)) return 0;
  const totalTokens = usage.total_tokens;
  return typeof totalTokens === "number" && Number.isSafeInteger(totalTokens) && totalTokens > 0 ? totalTokens : 0;
}

function header(error: unknown, name: string): string | null {
  const headers = error !== null && typeof error === "object" && "headers" in error ? error.headers : undefined;
  return headers !== null && typeof headers === "object" && "get" in headers && typeof headers.get === "function"
    ? (headers.get(name) as string | null)
    : null;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function parseDuration(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = /^([0-9]+(?:\.[0-9]+)?)s$/i.exec(value.trim());
  if (seconds !== null) return Number(seconds[1]) * 1_000;
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}
