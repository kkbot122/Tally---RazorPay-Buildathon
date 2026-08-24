import type { FinalOutcome, ReasonCode } from "@tally/contracts";
import type { FinalReconciliationResult } from "@tally/reconciliation";

export type GroundTruthRow = {
  caseId: string;
  bankRecordIds: string[];
  ledgerRecordIds: string[];
  expectedOutcome: FinalOutcome;
  reasonCode: ReasonCode;
  notes: string;
};

export type RuntimePrimaryAlignment = {
  side: "BANK" | "LEDGER";
  recordId: string;
  caseId: string;
};

export type RuntimePrimaryResult = FinalReconciliationResult & {
  finalizationOrder: number;
};

export type CaseEvaluation = {
  caseId: string;
  expectedOutcome: FinalOutcome;
  actualOutcome: FinalOutcome;
  expectedReasonCode: ReasonCode;
  actualReasonCode: ReasonCode;
  expectedBankRecordIds: string[];
  actualBankRecordIds: string[];
  expectedLedgerRecordIds: string[];
  actualLedgerRecordIds: string[];
  relationshipCorrect: boolean;
  outcomeCorrect: boolean;
  reasonCodeCorrect: boolean;
  exactCaseCorrect: boolean;
  falseReconciliation: boolean;
};

export type BenchmarkEvaluationMetrics = {
  totalCases: number;
  reconciledCount: number;
  matchRate: number;
  resolvedCount: number;
  resolutionRate: number;
  correctReconciliationCount: number;
  matchPrecision: number;
  falseReconciliationCount: number;
  falseReconciliationRate: number;
  exceptionCount: number;
  correctExceptionCount: number;
  exceptionAccuracy: number;
  unresolvedCount: number;
  abstentionRate: number;
};

export type BenchmarkCaseTypeMetrics = {
  totalCases: number;
  exactCaseCorrect: number;
  relationshipCorrect: number;
  outcomeCorrect: number;
  reasonCodeCorrect: number;
  falseReconciliationCount: number;
};

export type BenchmarkEvaluationReport = {
  metrics: BenchmarkEvaluationMetrics;
  caseTypeBreakdown: {
    byExpectedOutcome: Partial<Record<FinalOutcome, BenchmarkCaseTypeMetrics>>;
    byReasonCode: Partial<Record<ReasonCode, BenchmarkCaseTypeMetrics>>;
  };
  cases: CaseEvaluation[];
};

export type EvaluateBenchmarkInput = {
  results: readonly FinalReconciliationResult[];
  groundTruth: readonly GroundTruthRow[];
  /** Evaluator-only mapping for runtime primaries omitted from truth-selected relationships. */
  primaryCaseAlignment?: readonly RuntimePrimaryAlignment[];
};
