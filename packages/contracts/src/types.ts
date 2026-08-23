import type { z } from "zod";
import type {
  AgentConfidenceSchema,
  AgentEvidenceSchema,
  AgentProposalSchema,
  AgentProposedOutcomeSchema,
  BankTransactionSchema,
  FinalOutcomeSchema,
  LedgerTransactionSchema,
  ReasonCodeSchema,
  ReconciliationResultSchema,
  TraceEventSchema,
  TraceEventTypeSchema,
  VerificationResultSchema,
} from "./schemas.js";

export type BankTransaction = z.infer<typeof BankTransactionSchema>;
export type LedgerTransaction = z.infer<typeof LedgerTransactionSchema>;
export type FinalOutcome = z.infer<typeof FinalOutcomeSchema>;
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type AgentProposedOutcome = z.infer<typeof AgentProposedOutcomeSchema>;
export type AgentConfidence = z.infer<typeof AgentConfidenceSchema>;
export type AgentEvidence = z.infer<typeof AgentEvidenceSchema>;
export type AgentProposal = z.infer<typeof AgentProposalSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;
export type TraceEventType = z.infer<typeof TraceEventTypeSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
