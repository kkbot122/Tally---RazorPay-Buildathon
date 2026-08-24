import { FinalOutcomeSchema, ReasonCodeSchema, type FinalOutcome, type ReasonCode } from "@tally/contracts";

import type {
  BenchmarkCaseTypeMetrics,
  BenchmarkEvaluationReport,
  CaseEvaluation,
  EvaluateBenchmarkInput,
  GroundTruthRow,
  RuntimePrimaryAlignment,
} from "./types.js";

export function evaluateBenchmarkRun(input: EvaluateBenchmarkInput): BenchmarkEvaluationReport {
  const truth = validateGroundTruth(input.groundTruth);
  const recordToCase = buildRecordAlignment(truth);
  const primaryToCase = buildPrimaryAlignment(input.primaryCaseAlignment, truth, recordToCase);
  const aligned = new Map<string, (typeof input.results)[number]>();

  for (const result of input.results) {
    const caseId = alignResult(result.caseId, result.bankRecordIds, result.ledgerRecordIds, recordToCase, primaryToCase);
    if (aligned.has(caseId)) throw new Error(`Duplicate runtime result for ground-truth case ${caseId}; provide one finalized case result`);
    aligned.set(caseId, result);
  }

  if (aligned.size !== truth.length) {
    const missing = truth.filter((row) => !aligned.has(row.caseId)).map((row) => row.caseId);
    throw new Error(`Benchmark result alignment is incomplete; missing cases: ${missing.join(", ")}`);
  }

  const cases = truth
    .map((row) => evaluateCase(row, aligned.get(row.caseId)!))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  return {
    metrics: calculateMetrics(cases),
    caseTypeBreakdown: {
      byExpectedOutcome: buildBreakdown(cases, (evaluation) => evaluation.expectedOutcome),
      byReasonCode: buildBreakdown(cases, (evaluation) => evaluation.expectedReasonCode),
    },
    cases,
  };
}

function validateGroundTruth(rows: readonly GroundTruthRow[]): GroundTruthRow[] {
  if (rows.length === 0) throw new Error("Ground truth must contain at least one case");
  const caseIds = new Set<string>();
  for (const row of rows) {
    if (row.caseId.trim() === "") throw new Error("Ground-truth case IDs must be non-empty");
    if (caseIds.has(row.caseId)) throw new Error(`Duplicate ground-truth case ID: ${row.caseId}`);
    caseIds.add(row.caseId);
    if (!FinalOutcomeSchema.safeParse(row.expectedOutcome).success) throw new Error(`Invalid expected outcome for ${row.caseId}`);
    if (!ReasonCodeSchema.safeParse(row.reasonCode).success) throw new Error(`Invalid reason code for ${row.caseId}`);
    if ([...row.bankRecordIds, ...row.ledgerRecordIds].some((recordId) => recordId.trim() === "")) throw new Error(`Ground-truth record IDs must be non-empty for ${row.caseId}`);
    if (new Set(row.bankRecordIds).size !== row.bankRecordIds.length) throw new Error(`Duplicate bank truth ID in ${row.caseId}`);
    if (new Set(row.ledgerRecordIds).size !== row.ledgerRecordIds.length) throw new Error(`Duplicate ledger truth ID in ${row.caseId}`);
    if (row.bankRecordIds.length === 0 && row.ledgerRecordIds.length === 0) throw new Error(`Ground-truth case ${row.caseId} has no records`);
  }
  return rows.map((row) => ({ ...row, bankRecordIds: [...row.bankRecordIds], ledgerRecordIds: [...row.ledgerRecordIds] }));
}

function buildRecordAlignment(rows: readonly GroundTruthRow[]): Map<string, string> {
  const recordToCase = new Map<string, string>();
  for (const row of rows) {
    for (const recordId of [...row.bankRecordIds, ...row.ledgerRecordIds]) {
      const existing = recordToCase.get(recordId);
      if (existing !== undefined && existing !== row.caseId) throw new Error(`Record ${recordId} belongs to multiple ground-truth cases`);
      recordToCase.set(recordId, row.caseId);
    }
  }
  return recordToCase;
}

function buildPrimaryAlignment(
  alignments: readonly RuntimePrimaryAlignment[] | undefined,
  truth: readonly GroundTruthRow[],
  recordToCase: Map<string, string>,
): Map<string, string> {
  const knownCases = new Set(truth.map((row) => row.caseId));
  const primaryToCase = new Map<string, string>();
  for (const alignment of alignments ?? []) {
    const key = `${alignment.side}:${alignment.recordId}`;
    if (!knownCases.has(alignment.caseId)) throw new Error(`Primary alignment references unknown case ${alignment.caseId}`);
    const existing = primaryToCase.get(key);
    if (existing !== undefined && existing !== alignment.caseId) throw new Error(`Primary ${key} maps to multiple cases`);
    primaryToCase.set(key, alignment.caseId);
    const selectedCase = recordToCase.get(alignment.recordId);
    if (selectedCase !== undefined && selectedCase !== alignment.caseId) throw new Error(`Primary ${key} conflicts with truth relationship alignment`);
  }
  return primaryToCase;
}

function alignResult(
  caseId: string,
  bankRecordIds: readonly string[],
  ledgerRecordIds: readonly string[],
  recordToCase: Map<string, string>,
  primaryToCase: Map<string, string>,
): string {
  const candidates = new Set<string>();
  const primary = caseId.match(/^(BANK|LEDGER):(.+)$/);
  if (primary !== null) {
    const primaryKey = `${primary[1]}:${primary[2]}`;
    const primaryCase = primaryToCase.get(primaryKey) ?? recordToCase.get(primary[2]!);
    if (primaryCase === undefined) throw new Error(`Runtime result has unknown primary record: ${caseId}`);
    // The runtime primary is the authoritative work-item identity. A wrong
    // counterpart must remain scoreable as a false reconciliation rather than
    // becoming an alignment error.
    return primaryCase;
  }
  for (const recordId of [...bankRecordIds, ...ledgerRecordIds]) {
    const truthCase = recordToCase.get(recordId);
    if (truthCase !== undefined) candidates.add(truthCase);
  }
  if (candidates.size !== 1) throw new Error(`Runtime result ${caseId} cannot be aligned uniquely to ground truth`);
  return [...candidates][0]!;
}

function evaluateCase(truth: GroundTruthRow, result: EvaluateBenchmarkInput["results"][number]): CaseEvaluation {
  const relationshipCorrect = sameIds(truth.bankRecordIds, result.bankRecordIds) && sameIds(truth.ledgerRecordIds, result.ledgerRecordIds);
  const outcomeCorrect = result.outcome === truth.expectedOutcome;
  const reasonCodeCorrect = result.reasonCode === truth.reasonCode;
  const exactCaseCorrect = relationshipCorrect && outcomeCorrect && reasonCodeCorrect;
  const falseReconciliation = result.outcome === "RECONCILED" && !(truth.expectedOutcome === "RECONCILED" && relationshipCorrect);
  return {
    caseId: truth.caseId,
    expectedOutcome: truth.expectedOutcome,
    actualOutcome: result.outcome,
    expectedReasonCode: truth.reasonCode,
    actualReasonCode: result.reasonCode,
    expectedBankRecordIds: [...truth.bankRecordIds],
    actualBankRecordIds: [...result.bankRecordIds],
    expectedLedgerRecordIds: [...truth.ledgerRecordIds],
    actualLedgerRecordIds: [...result.ledgerRecordIds],
    relationshipCorrect,
    outcomeCorrect,
    reasonCodeCorrect,
    exactCaseCorrect,
    falseReconciliation,
  };
}

function calculateMetrics(cases: readonly CaseEvaluation[]) {
  const totalCases = cases.length;
  const reconciledCount = cases.filter((evaluation) => evaluation.actualOutcome === "RECONCILED").length;
  const resolvedCount = cases.filter((evaluation) => evaluation.actualOutcome !== "UNRESOLVED").length;
  const correctReconciliationCount = cases.filter((evaluation) => evaluation.actualOutcome === "RECONCILED" && evaluation.expectedOutcome === "RECONCILED" && evaluation.relationshipCorrect).length;
  const falseReconciliationCount = cases.filter((evaluation) => evaluation.falseReconciliation).length;
  const exceptionCount = totalCases - reconciledCount;
  const correctExceptionCount = cases.filter((evaluation) => evaluation.actualOutcome !== "RECONCILED" && evaluation.expectedOutcome !== "RECONCILED" && evaluation.exactCaseCorrect).length;
  const unresolvedCount = cases.filter((evaluation) => evaluation.actualOutcome === "UNRESOLVED").length;
  if (falseReconciliationCount !== reconciledCount - correctReconciliationCount) throw new Error("False-reconciliation metric invariant failed");
  return {
    totalCases,
    reconciledCount,
    matchRate: safeRate(reconciledCount, totalCases),
    resolvedCount,
    resolutionRate: safeRate(resolvedCount, totalCases),
    correctReconciliationCount,
    matchPrecision: safeRate(correctReconciliationCount, reconciledCount),
    falseReconciliationCount,
    falseReconciliationRate: safeRate(falseReconciliationCount, reconciledCount),
    exceptionCount,
    correctExceptionCount,
    exceptionAccuracy: safeRate(correctExceptionCount, exceptionCount),
    unresolvedCount,
    abstentionRate: safeRate(unresolvedCount, totalCases),
  };
}

function buildBreakdown<T extends string>(cases: readonly CaseEvaluation[], key: (evaluation: CaseEvaluation) => T): Partial<Record<T, BenchmarkCaseTypeMetrics>> {
  const result: Partial<Record<T, BenchmarkCaseTypeMetrics>> = {};
  for (const evaluation of cases) {
    const name = key(evaluation);
    const current = result[name] ?? {
      totalCases: 0,
      exactCaseCorrect: 0,
      relationshipCorrect: 0,
      outcomeCorrect: 0,
      reasonCodeCorrect: 0,
      falseReconciliationCount: 0,
    };
    current.totalCases += 1;
    if (evaluation.exactCaseCorrect) current.exactCaseCorrect += 1;
    if (evaluation.relationshipCorrect) current.relationshipCorrect += 1;
    if (evaluation.outcomeCorrect) current.outcomeCorrect += 1;
    if (evaluation.reasonCodeCorrect) current.reasonCodeCorrect += 1;
    if (evaluation.falseReconciliation) current.falseReconciliationCount += 1;
    result[name] = current;
  }
  return result;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === right.length && right.every((id) => leftSet.has(id));
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}
