import type { AgentProposal } from "@tally/contracts";

export type ReasoningModelInput = {
  input: string;
  /** Feedback from the authoritative verifier for a bounded repair attempt. */
  retryFeedback?: string;
};

export interface ReasoningModelAdapter {
  generateProposal(input: ReasoningModelInput): Promise<AgentProposal>;
}

export type ReasoningAdapterErrorCode = "AI_REQUEST_ERROR" | "AI_SCHEMA_ERROR";

export class ReasoningAdapterError extends Error {
  readonly code: ReasoningAdapterErrorCode;

  constructor(code: ReasoningAdapterErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReasoningAdapterError";
    this.code = code;
  }
}
