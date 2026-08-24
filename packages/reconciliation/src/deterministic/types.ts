import type { ReasonCode } from "@tally/contracts";

import type { RecordLookup, UsedRecordState } from "../compatibility/index.js";

export type DeterministicRuleId =
  | "R1_EXACT_REFERENCE"
  | "R2_NORMALIZED_REFERENCE"
  | "R3_STRONG_CONTEXT"
  | "R4_ONE_TO_MANY_GROUPED"
  | "R5_MANY_TO_ONE_GROUPED";

export type DeterministicReason = "NO_RULE_MATCH" | "MULTIPLE_CANDIDATES" | "GROUPING_AMBIGUITY";

export type AutoReconciledDecision = {
  status: "AUTO_RECONCILED";
  rule: DeterministicRuleId;
  bankRecordIds: string[];
  ledgerRecordIds: string[];
  reasonCode: Extract<ReasonCode, "EXACT_MATCH" | "NORMALIZED_REFERENCE_MATCH" | "COUNTERPARTY_MATCH" | "GROUPED_MATCH">;
};

export type NeedsReasoningDecision = {
  status: "NEEDS_REASONING";
  reason: DeterministicReason;
  bankRecordIds: string[];
  ledgerRecordIds: string[];
  sourceRule?: DeterministicRuleId;
};

export type DeterministicDecision = AutoReconciledDecision | NeedsReasoningDecision;

export type DeterministicRuleEventType = "RULE_EVALUATED" | "RULE_PASSED" | "RULE_FAILED" | "AUTO_RECONCILED";

export type DeterministicRuleEvent = {
  type: DeterministicRuleEventType;
  rule: DeterministicRuleId;
  anchorId: string;
  bankRecordIds?: string[];
  ledgerRecordIds?: string[];
  reason?: DeterministicReason;
};

export type DeterministicObserver = {
  onRuleEvaluated?: (event: {
    rule: DeterministicRuleId;
    anchorSide: "BANK" | "LEDGER";
    anchorId: string;
  }) => void;
  onRuleResult?: (
    event:
      | {
          type: "RULE_PASSED";
          rule: DeterministicRuleId;
          anchorSide: "BANK" | "LEDGER";
          anchorId: string;
          bankRecordIds: string[];
          ledgerRecordIds: string[];
          reasonCode: AutoReconciledDecision["reasonCode"];
        }
      | {
          type: "RULE_FAILED";
          rule: DeterministicRuleId;
          anchorSide: "BANK" | "LEDGER";
          anchorId: string;
          reason: DeterministicReason;
          candidateIds?: string[];
        },
  ) => void;
  onDecisionCommitted?: (event: {
    rule: DeterministicRuleId;
    anchorSide: "BANK" | "LEDGER";
    anchorId: string;
    bankRecordIds: string[];
    ledgerRecordIds: string[];
    reasonCode: AutoReconciledDecision["reasonCode"];
  }) => void;
};

export type DeterministicReconciliationInput = {
  records: RecordLookup;
  usedRecords?: UsedRecordState;
  observer?: DeterministicObserver;
};

export type DeterministicReconciliationResult = {
  decisions: DeterministicDecision[];
  usedRecords: UsedRecordState;
  events: DeterministicRuleEvent[];
};
