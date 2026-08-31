import type { AgentProposal } from "@tally/contracts";

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
  provider: "openai" | "nvidia" | "groq";
  model?: string;
  category?: "TIMEOUT" | "RATE_LIMIT" | "AUTHENTICATION" | "VALIDATION" | "SERVER" | "UNKNOWN";
  status?: number;
  durationMs?: number;
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
