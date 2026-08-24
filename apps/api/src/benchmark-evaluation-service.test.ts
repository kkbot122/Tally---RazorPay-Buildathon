import { describe, expect, it, vi } from "vitest";

import { buildBenchmarkFixture, loadFrozenGroundTruth, type GroundTruthRow, type RuntimePrimaryAlignment } from "@tally/benchmark";

import {
  BenchmarkEvaluationError,
  createBenchmarkEvaluationService,
} from "./benchmark-evaluation-service.js";
import type { ReconciliationRunRepository } from "./db/reconciliation-run-repository.js";

const truth: GroundTruthRow[] = [{
  caseId: "C001",
  bankRecordIds: ["B1"],
  ledgerRecordIds: ["L1"],
  expectedOutcome: "RECONCILED",
  reasonCode: "EXACT_MATCH",
  notes: "",
}];

function persistedResult(overrides: Record<string, unknown> = {}) {
  return {
    caseId: "BANK:B1",
    finalOutcome: "RECONCILED",
    bankTxnIds: ["B1"],
    ledgerTxnIds: ["L1"],
    reasonCode: "EXACT_MATCH",
    source: "DETERMINISTIC",
    rule: "R1_EXACT_REFERENCE",
    confidence: null,
    evidence: [],
    conflictingEvidence: [],
    reason: null,
    amountDeltaPaise: null,
    finalizationOrder: 1,
    ...overrides,
  };
}

function repository(overrides: Partial<ReconciliationRunRepository> = {}): ReconciliationRunRepository {
  return {
    saveCompletedRun: vi.fn(async () => {}),
    getRunById: vi.fn(async () => ({ status: "COMPLETED" } as never)),
    getResultsForRun: vi.fn(async () => [persistedResult()] as never),
    getTraceForRun: vi.fn(async () => []),
    ...overrides,
  };
}

function alignment(): RuntimePrimaryAlignment[] {
  return [
    { side: "BANK", recordId: "B1", caseId: "C001" },
    { side: "LEDGER", recordId: "L1", caseId: "C001" },
  ];
}

describe("benchmark evaluation service", () => {
  it("evaluates persisted results through T028 without writes or pipeline calls", async () => {
    const repo = repository();
    const loadGroundTruth = vi.fn(async () => truth);
    const service = createBenchmarkEvaluationService(repo, loadGroundTruth, alignment);

    const report = await service.evaluate("run-eval-001");

    expect(report.runId).toBe("run-eval-001");
    expect(report.metrics).toMatchObject({ totalCases: 1, reconciledCount: 1, matchPrecision: 1, falseReconciliationCount: 0 });
    expect(report.cases[0]).toMatchObject({ caseId: "C001", exactCaseCorrect: true });
    expect(loadGroundTruth).toHaveBeenCalledOnce();
    expect(repo.saveCompletedRun).not.toHaveBeenCalled();
    expect(repo.getTraceForRun).not.toHaveBeenCalled();
  });

  it("exposes a valid distractor as a false reconciliation", async () => {
    const service = createBenchmarkEvaluationService(
      repository({ getResultsForRun: vi.fn(async () => [persistedResult({ ledgerTxnIds: ["L999"] })] as never) }),
      async () => truth,
      alignment,
    );

    const report = await service.evaluate("run-eval-002");

    expect(report.metrics.falseReconciliationCount).toBe(1);
    expect(report.cases[0]).toMatchObject({ relationshipCorrect: false, falseReconciliation: true });
  });

  it("maps unknown, incomplete, and incompatible runs without evaluating them", async () => {
    const loader = vi.fn(async () => truth);
    const unknown = createBenchmarkEvaluationService(repository({ getRunById: vi.fn(async () => undefined) }), loader, alignment);
    await expect(unknown.evaluate("missing")).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
    expect(loader).not.toHaveBeenCalled();

    const incomplete = createBenchmarkEvaluationService(repository({ getRunById: vi.fn(async () => ({ status: "PROCESSING" } as never)) }), loader, alignment);
    await expect(incomplete.evaluate("processing")).rejects.toMatchObject({ code: "RUN_NOT_COMPLETED" });

    const incompatible = createBenchmarkEvaluationService(repository({ getResultsForRun: vi.fn(async () => [] as never) }), loader, alignment);
    await expect(incompatible.evaluate("incompatible")).rejects.toMatchObject({ code: "RUN_NOT_BENCHMARK_COMPATIBLE" });
  });

  it("maps loader failures to a sanitized evaluation failure", async () => {
    const service = createBenchmarkEvaluationService(repository(), async () => { throw new Error("private loader detail"); }, alignment);
    await expect(service.evaluate("run-eval-003")).rejects.toEqual(expect.objectContaining<Partial<BenchmarkEvaluationError>>({ code: "EVALUATION_FAILED" }));
  });

  it("does not classify plain alignment errors or malformed alignment data as run incompatibility", async () => {
    const plainError = createBenchmarkEvaluationService(repository(), async () => truth, async () => { throw new Error("alignment implementation failure"); });
    await expect(plainError.evaluate("run-eval-004")).rejects.toMatchObject({ code: "EVALUATION_FAILED" });

    const duplicateAlignment = createBenchmarkEvaluationService(
      repository(),
      async () => truth,
      async () => [
        { side: "BANK", recordId: "B1", caseId: "C001" },
        { side: "BANK", recordId: "B1", caseId: "C001" },
      ],
    );
    await expect(duplicateAlignment.evaluate("run-eval-005")).rejects.toMatchObject({ code: "EVALUATION_FAILED" });
  });

  it("finalizes a frozen 100-case persisted-result shape before evaluation", async () => {
    const fixture = buildBenchmarkFixture();
    const frozenTruth = loadFrozenGroundTruth();
    let finalizationOrder = 0;
    const results = fixture.cases.flatMap((benchmarkCase) => {
      const truthRow = frozenTruth.find((row) => row.caseId === benchmarkCase.caseId)!;
      const primaryBank = benchmarkCase.bankTransactions[0]?.bankTxnId;
      const primaryLedger = benchmarkCase.ledgerTransactions[0]?.ledgerTxnId;
      const primary = primaryBank === undefined ? `LEDGER:${primaryLedger}` : `BANK:${primaryBank}`;
      const base = {
        finalOutcome: truthRow.expectedOutcome,
        bankTxnIds: truthRow.bankRecordIds,
        ledgerTxnIds: truthRow.ledgerRecordIds,
        reasonCode: truthRow.reasonCode,
        source: "DETERMINISTIC",
        rule: null,
        confidence: null,
        evidence: [],
        conflictingEvidence: [],
        reason: null,
        amountDeltaPaise: null,
      };
      if (truthRow.reasonCode !== "DUPLICATE_USAGE") {
        return [{ ...base, caseId: primary, finalizationOrder: ++finalizationOrder }];
      }
      const firstBankId = benchmarkCase.bankTransactions[0]!.bankTxnId;
      const secondBankId = benchmarkCase.bankTransactions[1]!.bankTxnId;
      return [
        { ...base, caseId: `BANK:${firstBankId}`, bankTxnIds: [firstBankId], finalOutcome: "RECONCILED", reasonCode: "EXACT_MATCH", finalizationOrder: ++finalizationOrder },
        { ...base, caseId: `BANK:${secondBankId}`, bankTxnIds: [secondBankId], finalizationOrder: ++finalizationOrder },
      ];
    });
    const primaryCaseAlignment = fixture.cases.flatMap((benchmarkCase) => [
      ...benchmarkCase.bankTransactions.map((record) => ({ side: "BANK" as const, recordId: record.bankTxnId, caseId: benchmarkCase.caseId })),
      ...benchmarkCase.ledgerTransactions.map((record) => ({ side: "LEDGER" as const, recordId: record.ledgerTxnId, caseId: benchmarkCase.caseId })),
    ]);
    const service = createBenchmarkEvaluationService(
      repository({ getResultsForRun: vi.fn(async () => results as never) }),
      () => frozenTruth,
      () => primaryCaseAlignment,
    );

    const report = await service.evaluate("run-frozen-100");

    expect(report.metrics.totalCases).toBe(100);
    expect(report.metrics.correctExceptionCount).toBeGreaterThan(0);
    expect(report.cases).toHaveLength(100);
  });

  it("rejects an arbitrary 101st persisted result instead of collapsing it", async () => {
    const extra = persistedResult({ caseId: "BANK:B1", finalizationOrder: 2 });
    const service = createBenchmarkEvaluationService(
      repository({ getResultsForRun: vi.fn(async () => [persistedResult(), extra] as never) }),
      async () => truth,
      alignment,
    );

    await expect(service.evaluate("run-101-results")).rejects.toMatchObject({ code: "RUN_NOT_BENCHMARK_COMPATIBLE" });
  });
});
