import type {
  AgentConfidence,
  AgentEvidence,
  FinalOutcome,
  ReasonCode,
} from "@tally/contracts";

import type { UsedRecordState } from "../compatibility/index.js";
import type { ReasoningAdapterDiagnostics, ReasoningModelAdapter } from "../agent/index.js";
import type { DeterministicRuleId } from "../deterministic/index.js";
import type { RecordedTraceEvent } from "../trace/index.js";
import type { CandidateSet, CandidatePrimary } from "../candidates/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/index.js";

export type RunReconciliationInput = {
  runId: string;
  asOfDate: string;
  bankCsv: string;
  ledgerCsv: string;
  usedRecords?: UsedRecordState;
  modelAdapter: ReasoningModelAdapter;
  reasoningConcurrency?: number;
  /** Hard ceiling for all provider calls in this run, including repair calls. */
  maxReasoningCalls?: number;
  /** Aborts provider work and terminates the run when the operational budget is exhausted. */
  signal?: AbortSignal;
  /** Test hook only; production runs use the recorder's default clock. */
  clock?: () => Date;
  onVerificationFailure?: (event: {
    runId: string;
    caseId: string;
    proposedBankRecordIds: string[];
    proposedLedgerRecordIds: string[];
    failureCodes: string[];
  }) => void;
  onModelFailure?: (event: { runId: string; caseId: string; failureCode: string; diagnostics?: ReasoningAdapterDiagnostics }) => void;
};

export type ReconciliationOperationalErrorCode = "AI_SCHEMA_ERROR";

export type ReconciliationRunAbortCode = "RUN_CANCELLED" | "RUN_DEADLINE_EXCEEDED";

export class ReconciliationRunAbortedError extends Error {
  readonly code: ReconciliationRunAbortCode;

  constructor(code: ReconciliationRunAbortCode) {
    super(code === "RUN_CANCELLED" ? "The reconciliation run was cancelled." : "The reconciliation run exceeded its inference deadline.");
    this.name = "ReconciliationRunAbortedError";
    this.code = code;
  }
}

/** A model proposal violated the runtime relationship contract. */
export class ReconciliationOperationalError extends Error {
  readonly code: ReconciliationOperationalErrorCode;

  constructor(code: ReconciliationOperationalErrorCode, message: string) {
    super(message);
    this.name = "ReconciliationOperationalError";
    this.code = code;
  }
}

export type FinalReconciliationResult = {
  caseId: string;
  outcome: FinalOutcome;
  bankRecordIds: string[];
  ledgerRecordIds: string[];
  reasonCode: ReasonCode;
  source: "DETERMINISTIC" | "AGENT_VERIFIED";
  rule?: DeterministicRuleId;
  confidence?: AgentConfidence;
  evidence?: AgentEvidence[];
  conflictingEvidence?: AgentEvidence[];
  reason?: string;
  amountDeltaPaise?: string;
  /** Monotonic runtime finalization order; used by evaluator adapters only. */
  finalizationOrder?: number;
};

export type ReconciliationRunResult = {
  runId: string;
  results: FinalReconciliationResult[];
  usedRecords: UsedRecordState;
  trace: readonly RecordedTraceEvent[];
};

export type PlannedReasoningComponent = {
  componentId: string;
  caseId: string;
  primary: CandidatePrimary;
  candidateSet: CandidateSet;
  decision: Extract<import("../deterministic/index.js").DeterministicDecision, { status: "NEEDS_REASONING" }>;
  promptInput: { input: string };
  unresolvedBankRecordIds: string[];
  unresolvedLedgerRecordIds: string[];
  bankRecords: ParsedBankTransaction[];
  ledgerRecords: ParsedLedgerTransaction[];
};

export type ReconciliationPlan = {
  runId: string;
  asOfDate: string;
  bankRecords: ParsedBankTransaction[];
  ledgerRecords: ParsedLedgerTransaction[];
  deterministicResults: FinalReconciliationResult[];
  deterministicUsedBankRecordIds: string[];
  deterministicUsedLedgerRecordIds: string[];
  components: PlannedReasoningComponent[];
  trace: readonly RecordedTraceEvent[];
};
