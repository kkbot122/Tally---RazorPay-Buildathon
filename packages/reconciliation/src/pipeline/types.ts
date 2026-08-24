import type {
  AgentConfidence,
  AgentEvidence,
  FinalOutcome,
  ReasonCode,
} from "@tally/contracts";

import type { UsedRecordState } from "../compatibility/index.js";
import type { ReasoningModelAdapter } from "../agent/index.js";
import type { DeterministicRuleId } from "../deterministic/index.js";
import type { RecordedTraceEvent } from "../trace/index.js";

export type RunReconciliationInput = {
  runId: string;
  asOfDate: string;
  bankCsv: string;
  ledgerCsv: string;
  usedRecords?: UsedRecordState;
  modelAdapter: ReasoningModelAdapter;
  reasoningConcurrency?: number;
  /** Test hook only; production runs use the recorder's default clock. */
  clock?: () => Date;
};

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
