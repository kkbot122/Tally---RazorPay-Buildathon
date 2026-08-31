import type { AgentProposal } from "@tally/contracts";
import type { GroqQuotaDimension } from "./groq-rate-limiter.js";

export type ReasoningModelInput = {
  input: string;
  /** Feedback from the authoritative verifier for a bounded repair attempt. */
  retryFeedback?: string;
  /** Cancels provider work when the run deadline or user cancellation fires. */
  signal?: AbortSignal;
};

export interface ReasoningModelAdapter {
  generateProposal(input: ReasoningModelInput): Promise<AgentProposal>;
}

export type ReasoningAdapterErrorCode = "AI_REQUEST_ERROR" | "AI_SCHEMA_ERROR";

export type ReasoningAdapterDiagnostics = {
  provider?: "openai" | "nvidia" | "groq";
  model?: string;
  category?: "TIMEOUT" | "RATE_LIMIT" | "CALL_BUDGET" | "AUTHENTICATION" | "VALIDATION" | "SERVER" | "UNKNOWN";
  /** The provider quota which rejected this request, when its headers identify one. */
  rateLimitDimension?: GroqQuotaDimension;
  status?: number;
  durationMs?: number;
  /** Safe summary of a provider or transport failure; never includes credentials. */
  errorName?: string;
  errorMessage?: string;
  errorCode?: string;
};

export class ReasoningAdapterError extends Error {
  readonly code: ReasoningAdapterErrorCode;

  readonly diagnostics?: ReasoningAdapterDiagnostics;

  constructor(code: ReasoningAdapterErrorCode, message: string, options?: { cause?: unknown; diagnostics?: ReasoningAdapterDiagnostics }) {
    super(message, options);
    this.name = "ReasoningAdapterError";
    this.code = code;
    this.diagnostics = options?.diagnostics;
  }
}
