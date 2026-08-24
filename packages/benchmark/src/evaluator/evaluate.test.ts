import {
  createRecordLookup,
  parseBankCsv,
  parseLedgerCsv,
  runDeterministicReconciliation,
  type FinalReconciliationResult,
} from "@tally/reconciliation";
import { describe, expect, it } from "vitest";

import { buildBenchmarkFixture } from "../benchmark/index.js";
import { finalizeRuntimeCaseResults } from "./finalize-runtime-results.js";
import { evaluateBenchmarkRun } from "./evaluate.js";
import { parseGroundTruthCsv } from "./ground-truth.js";
import type { GroundTruthRow } from "./types.js";
import type { RuntimePrimaryResult } from "./types.js";

function result(
  truth: GroundTruthRow,
  overrides: Partial<FinalReconciliationResult> = {},
): FinalReconciliationResult {
  const primary = truth.bankRecordIds[0] === undefined
    ? `LEDGER:${truth.ledgerRecordIds[0]}`
    : `BANK:${truth.bankRecordIds[0]}`;
  return {
    caseId: primary,
    outcome: truth.expectedOutcome,
    bankRecordIds: [...truth.bankRecordIds],
    ledgerRecordIds: [...truth.ledgerRecordIds],
    reasonCode: truth.reasonCode,
    source: "DETERMINISTIC",
    ...overrides,
  };
}

function truthRow(
  caseId: string,
  bankRecordIds: string[],
  ledgerRecordIds: string[],
  expectedOutcome: GroundTruthRow["expectedOutcome"],
  reasonCode: GroundTruthRow["reasonCode"],
): GroundTruthRow {
  return { caseId, bankRecordIds, ledgerRecordIds, expectedOutcome, reasonCode, notes: "" };
}

function runtimeResult(truth: GroundTruthRow, finalizationOrder: number, overrides: Partial<FinalReconciliationResult> = {}): RuntimePrimaryResult {
  return { ...result(truth, overrides), finalizationOrder };
}

describe("T028 benchmark evaluator", () => {
  it("parses and perfectly evaluates the frozen 100-case benchmark", () => {
    const fixture = buildBenchmarkFixture();
    const groundTruth = parseGroundTruthCsv(fixture.groundTruthCsv);
    const primaryCaseAlignment = fixture.cases.flatMap((benchmarkCase) => [
      ...benchmarkCase.bankTransactions.map((record) => ({ side: "BANK" as const, recordId: record.bankTxnId, caseId: benchmarkCase.caseId })),
      ...benchmarkCase.ledgerTransactions.map((record) => ({ side: "LEDGER" as const, recordId: record.ledgerTxnId, caseId: benchmarkCase.caseId })),
    ]);
    const report = evaluateBenchmarkRun({
      groundTruth,
      results: groundTruth.map((row) => result(row)).reverse(),
      primaryCaseAlignment,
    });

    expect(report.cases).toHaveLength(100);
    expect(report.cases.map((evaluation) => evaluation.caseId)).toEqual([...report.cases].sort((left, right) => left.caseId.localeCompare(right.caseId)).map((evaluation) => evaluation.caseId));
    expect(report.cases.every((evaluation) => evaluation.exactCaseCorrect)).toBe(true);
    expect(report.metrics).toEqual({
      totalCases: 100,
      reconciledCount: 70,
      matchRate: 0.7,
      resolvedCount: 90,
      resolutionRate: 0.9,
      correctReconciliationCount: 70,
      matchPrecision: 1,
      falseReconciliationCount: 0,
      falseReconciliationRate: 0,
      exceptionCount: 30,
      correctExceptionCount: 30,
      exceptionAccuracy: 1,
      unresolvedCount: 10,
      abstentionRate: 0.1,
    });
    expect(report.caseTypeBreakdown.byExpectedOutcome.RECONCILED?.totalCases).toBe(70);
    expect(report.caseTypeBreakdown.byReasonCode.DUPLICATE_USAGE?.totalCases).toBe(2);
  });

  it("evaluates the T016-only frozen baseline without penalizing abstention", () => {
    const fixture = buildBenchmarkFixture();
    const groundTruth = parseGroundTruthCsv(fixture.groundTruthCsv);
    const deterministic = runDeterministicReconciliation({
      records: createRecordLookup(parseBankCsv(fixture.bankCsv), parseLedgerCsv(fixture.ledgerCsv)),
    });
    const automatic = deterministic.decisions.filter((decision) => decision.status === "AUTO_RECONCILED");
    expect(automatic).toHaveLength(55);
    const results: FinalReconciliationResult[] = automatic.map((decision) => ({
      caseId: decision.bankRecordIds[0] === undefined ? `LEDGER:${decision.ledgerRecordIds[0]}` : `BANK:${decision.bankRecordIds[0]}`,
      outcome: "RECONCILED",
      bankRecordIds: [...decision.bankRecordIds],
      ledgerRecordIds: [...decision.ledgerRecordIds],
      reasonCode: decision.reasonCode,
      source: "DETERMINISTIC",
    }));
    const representedCases = new Set(results.map((item) => item.caseId.split(":")[1]));
    for (const truth of groundTruth) {
      if (truth.bankRecordIds.some((id) => representedCases.has(id)) || truth.ledgerRecordIds.some((id) => representedCases.has(id))) continue;
      const primary = truth.bankRecordIds[0] === undefined ? `LEDGER:${truth.ledgerRecordIds[0]}` : `BANK:${truth.bankRecordIds[0]}`;
      results.push({
        caseId: primary,
        outcome: "UNRESOLVED",
        bankRecordIds: [],
        ledgerRecordIds: [],
        reasonCode: "INSUFFICIENT_EVIDENCE",
        source: "AGENT_VERIFIED",
      });
    }
    const report = evaluateBenchmarkRun({ results, groundTruth });
    expect(report.metrics.reconciledCount).toBe(55);
    expect(report.metrics.matchRate).toBe(0.55);
    expect(report.metrics.correctReconciliationCount).toBe(55);
    expect(report.metrics.matchPrecision).toBe(1);
    expect(report.metrics.falseReconciliationCount).toBe(0);
  });

  it("aligns a duplicate-usage case through its second runtime primary", () => {
    const fixture = buildBenchmarkFixture();
    const groundTruth = parseGroundTruthCsv(fixture.groundTruthCsv);
    const primaryCaseAlignment = fixture.cases.flatMap((benchmarkCase) => [
      ...benchmarkCase.bankTransactions.map((record) => ({ side: "BANK" as const, recordId: record.bankTxnId, caseId: benchmarkCase.caseId })),
      ...benchmarkCase.ledgerTransactions.map((record) => ({ side: "LEDGER" as const, recordId: record.ledgerTxnId, caseId: benchmarkCase.caseId })),
    ]);
    const duplicateCase = fixture.cases.find((benchmarkCase) => benchmarkCase.reasonCode === "DUPLICATE_USAGE")!;
    const duplicateTruth = groundTruth.find((row) => row.caseId === duplicateCase.caseId)!;
    const rawResults: RuntimePrimaryResult[] = groundTruth.flatMap((row) => row.caseId === duplicateTruth.caseId
      ? [
          runtimeResult(row, 1, {
            caseId: `BANK:${duplicateCase.bankTransactions[0]!.bankTxnId}`,
            outcome: "RECONCILED",
            bankRecordIds: [duplicateCase.bankTransactions[0]!.bankTxnId],
            ledgerRecordIds: [duplicateTruth.ledgerRecordIds[0]!],
            reasonCode: "MULTI_EVIDENCE_MATCH",
          }),
          runtimeResult(row, 2, {
            caseId: `BANK:${duplicateCase.bankTransactions[1]!.bankTxnId}`,
            outcome: "DISCREPANCY",
            bankRecordIds: [duplicateCase.bankTransactions[1]!.bankTxnId],
            ledgerRecordIds: [duplicateTruth.ledgerRecordIds[0]!],
            reasonCode: "DUPLICATE_USAGE",
          }),
        ]
      : [runtimeResult(row, 1)]);
    expect(() => evaluateBenchmarkRun({ groundTruth, results: rawResults, primaryCaseAlignment })).toThrow(/Duplicate runtime result/);
    const finalizedResults = finalizeRuntimeCaseResults({
      results: rawResults,
      primaryCaseAlignment,
    });
    expect(finalizedResults).toHaveLength(100);
    const finalizedDuplicate = finalizedResults.find((item) => item.caseId === `BANK:${duplicateCase.bankTransactions[1]!.bankTxnId}`)!;
    expect(finalizedDuplicate.bankRecordIds).toContain(duplicateCase.bankTransactions[1]!.bankTxnId);
    const report = evaluateBenchmarkRun({
      groundTruth,
      results: finalizedResults,
      primaryCaseAlignment,
    });
    expect(report.cases.find((evaluation) => evaluation.caseId === duplicateTruth.caseId)).toMatchObject({ actualOutcome: "DISCREPANCY", exactCaseCorrect: true });
  });

  it("scores false matches, wrong counterparts, set ordering, and partial groups strictly", () => {
    const groundTruth = [
      truthRow("C001", ["B1", "B2"], ["L1"], "RECONCILED", "GROUPED_MATCH"),
      truthRow("C002", ["B3"], ["L2", "L3", "L4"], "RECONCILED", "GROUPED_MATCH"),
      truthRow("C003", ["B4"], ["L5"], "DISCREPANCY", "AMOUNT_DISCREPANCY"),
      truthRow("C004", ["B5"], ["L6"], "UNRESOLVED", "NO_CANDIDATE"),
    ];
    const report = evaluateBenchmarkRun({
      groundTruth,
      results: [
        result(groundTruth[0]!, { bankRecordIds: ["B2", "B1"] }),
        result(groundTruth[1]!, { ledgerRecordIds: ["L3", "L2"] }),
        result(groundTruth[2]!, { outcome: "RECONCILED" }),
        result(groundTruth[3]!),
      ],
    });

    expect(report.cases.find((evaluation) => evaluation.caseId === "C001")).toMatchObject({ relationshipCorrect: true, exactCaseCorrect: true });
    expect(report.cases.find((evaluation) => evaluation.caseId === "C002")).toMatchObject({ relationshipCorrect: false, exactCaseCorrect: false });
    expect(report.cases.find((evaluation) => evaluation.caseId === "C003")).toMatchObject({ relationshipCorrect: true, outcomeCorrect: false, falseReconciliation: true });
    expect(report.metrics.correctReconciliationCount).toBe(1);
    expect(report.metrics.reconciledCount).toBe(3);
    expect(report.metrics.falseReconciliationCount).toBe(2);
    expect(report.metrics.matchPrecision).toBe(1 / 3);
    expect(report.metrics.falseReconciliationRate).toBe(2 / 3);
    expect(report.metrics.exceptionAccuracy).toBe(1);
  });

  it("keeps wrong-counterpart precision failures separate from reason-code errors", () => {
    const truth = [
      truthRow("C001", ["B1"], ["L1"], "RECONCILED", "EXACT_MATCH"),
      truthRow("C002", ["B2"], ["L2"], "RECONCILED", "EXACT_MATCH"),
    ];
    const wrongCounterpart = evaluateBenchmarkRun({
      groundTruth: truth,
      results: [
        result(truth[0]!, { ledgerRecordIds: ["L9"] }),
        result(truth[1]!),
      ],
    });
    expect(wrongCounterpart.cases[0]).toMatchObject({ relationshipCorrect: false, outcomeCorrect: true, falseReconciliation: true });
    expect(wrongCounterpart.metrics.matchPrecision).toBe(0.5);

    const wrongReason = evaluateBenchmarkRun({
      groundTruth: [truth[0]!],
      results: [result(truth[0]!, { reasonCode: "MULTI_EVIDENCE_MATCH" })],
    });
    expect(wrongReason.cases[0]).toMatchObject({ relationshipCorrect: true, outcomeCorrect: true, reasonCodeCorrect: false, exactCaseCorrect: false, falseReconciliation: false });
    expect(wrongReason.metrics.matchPrecision).toBe(1);
  });

  it("does not call a misclassified exception correct", () => {
    const truth = [truthRow("C001", ["B1"], ["L1"], "DISCREPANCY", "AMOUNT_DISCREPANCY")];
    const report = evaluateBenchmarkRun({
      groundTruth: truth,
      results: [result(truth[0]!, {
        outcome: "UNRESOLVED",
        bankRecordIds: [],
        ledgerRecordIds: [],
        reasonCode: "INSUFFICIENT_EVIDENCE",
      })],
    });
    expect(report.metrics.exceptionCount).toBe(1);
    expect(report.metrics.correctExceptionCount).toBe(0);
    expect(report.metrics.exceptionAccuracy).toBe(0);
  });

  it("rejects missing, duplicate, unknown, and ambiguous alignments", () => {
    const truth = [
      truthRow("C001", ["B1"], ["L1"], "RECONCILED", "EXACT_MATCH"),
      truthRow("C002", ["B2"], ["L2"], "UNRESOLVED", "NO_CANDIDATE"),
    ];
    expect(() => evaluateBenchmarkRun({ groundTruth: truth, results: [result(truth[0]!)] })).toThrow(/missing cases/);
    expect(() => evaluateBenchmarkRun({ groundTruth: truth, results: [result(truth[0]!), result(truth[0]!), result(truth[1]!)] })).toThrow(/Duplicate runtime result/);
    expect(() => evaluateBenchmarkRun({ groundTruth: truth, results: [{ ...result(truth[0]!), caseId: "BANK:B404" }, result(truth[1]!)] })).toThrow(/unknown primary record/);
    expect(() => evaluateBenchmarkRun({ groundTruth: truth, results: [{ ...result(truth[0]!), caseId: "unknown", ledgerRecordIds: ["L2"] }, result(truth[1]!)] })).toThrow(/cannot be aligned uniquely/);
  });

  it("rejects malformed pipe-delimited truth ID lists", () => {
    const header = "case_id,bank_record_ids,ledger_record_ids,expected_outcome,reason_code,notes\n";
    expect(() => parseGroundTruthCsv(`${header}C001,B1||B2,L1,RECONCILED,EXACT_MATCH,\n`)).toThrow(/empty ID segment/);
    expect(() => parseGroundTruthCsv(`${header}C001,B1|,L1,RECONCILED,EXACT_MATCH,\n`)).toThrow(/empty ID segment/);
  });

  it("uses safe numeric rates when reconciliations or exceptions have zero denominators", () => {
    const unresolved = [truthRow("C001", ["B1"], [], "UNRESOLVED", "NO_CANDIDATE")];
    const abstained = evaluateBenchmarkRun({ groundTruth: unresolved, results: [result(unresolved[0]!)] });
    expect(abstained.metrics.matchPrecision).toBe(0);
    expect(abstained.metrics.falseReconciliationRate).toBe(0);

    const reconciled = [truthRow("C001", ["B1"], ["L1"], "RECONCILED", "EXACT_MATCH")];
    const allMatched = evaluateBenchmarkRun({ groundTruth: reconciled, results: [result(reconciled[0]!)] });
    expect(allMatched.metrics.exceptionAccuracy).toBe(0);
    expect(Object.values(allMatched.metrics).every((value) => typeof value === "number" && Number.isFinite(value))).toBe(true);
  });

  it("does not mutate input arrays and is deterministic", () => {
    const groundTruth = [truthRow("C001", ["B1", "B2"], ["L1"], "RECONCILED", "GROUPED_MATCH")];
    const results = [result(groundTruth[0]!, { bankRecordIds: ["B2", "B1"] })];
    const truthBefore = structuredClone(groundTruth);
    const resultsBefore = structuredClone(results);
    const first = evaluateBenchmarkRun({ groundTruth, results });
    const second = evaluateBenchmarkRun({ groundTruth, results });
    expect(first).toEqual(second);
    expect(groundTruth).toEqual(truthBefore);
    expect(results).toEqual(resultsBefore);
  });
});
