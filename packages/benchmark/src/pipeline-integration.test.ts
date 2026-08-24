import {
  runReconciliation,
  type AgentProposal,
  type ReasoningModelAdapter,
} from "@tally/reconciliation";
import { describe, expect, it } from "vitest";

import { buildDevFixture } from "./dev-fixture/index.js";
import type { BenchmarkCase } from "./generator/index.js";

function proposalFor(benchmarkCase: BenchmarkCase): AgentProposal {
  const bankRecordIds = benchmarkCase.truth.bankRecordIds;
  const ledgerRecordIds = benchmarkCase.truth.ledgerRecordIds;
  const evidence = [{
    statement: "The supplied records provide the configured fixture evidence.",
    source: "CROSS_RECORD" as const,
    recordIds: [...bankRecordIds, ...ledgerRecordIds].length > 0 ? [...bankRecordIds, ...ledgerRecordIds] : [benchmarkCase.ledgerTransactions[0]?.ledgerTxnId ?? benchmarkCase.bankTransactions[0]!.bankTxnId],
  }];

  if (benchmarkCase.expectedOutcome === "RECONCILED") {
    return {
      proposedOutcome: "MATCH",
      bankRecordIds,
      ledgerRecordIds,
      confidence: "HIGH",
      evidence,
      conflictingEvidence: [],
      reason: "The supplied evidence supports the configured relationship.",
    };
  }

  if (benchmarkCase.expectedOutcome === "EXPLAINED_OUTSTANDING") {
    return {
      proposedOutcome: "TIMING_DIFFERENCE",
      bankRecordIds,
      ledgerRecordIds,
      confidence: "HIGH",
      evidence,
      conflictingEvidence: [],
      reason: "The ledger record has future maturity evidence.",
    };
  }

  if (benchmarkCase.expectedOutcome === "DISCREPANCY") {
    return {
      proposedOutcome: "DISCREPANCY",
      bankRecordIds,
      ledgerRecordIds,
      confidence: "HIGH",
      evidence,
      conflictingEvidence: benchmarkCase.reasonCode === "CONFLICTING_RECORDS" ? [{
        statement: "The supplied records contain conflicting evidence.",
        source: "CROSS_RECORD",
        recordIds: [...bankRecordIds, ...ledgerRecordIds],
      }] : [],
      reason: "The supplied records do not support an equal financial relationship.",
    };
  }

  const primaryId = benchmarkCase.bankTransactions[0]?.bankTxnId ?? benchmarkCase.ledgerTransactions[0]!.ledgerTxnId;
  return {
    proposedOutcome: "INSUFFICIENT_EVIDENCE",
    bankRecordIds: benchmarkCase.bankTransactions.length > 0 ? [primaryId] : [],
    ledgerRecordIds: benchmarkCase.bankTransactions.length === 0 ? [primaryId] : [],
    confidence: "LOW",
    evidence,
    conflictingEvidence: [],
    reason: "The supplied evidence does not establish a unique relationship.",
  };
}

class FixtureAdapter implements ReasoningModelAdapter {
  readonly calls: string[] = [];

  constructor(private readonly cases: readonly BenchmarkCase[]) {}

  async generateProposal(input: { input: string }): Promise<AgentProposal> {
    const primary = input.input.match(/"primary":\{"side":"(BANK|LEDGER)","record":\{(?:"bankTxnId"|"ledgerTxnId"):\"([^\"]+)\"/);
    if (primary === null) throw new Error("fake adapter could not identify the primary record");
    const primaryId = primary[2]!;
    const benchmarkCase = this.cases.find((candidate) =>
      candidate.bankTransactions.some((record) => record.bankTxnId === primaryId)
      || candidate.ledgerTransactions.some((record) => record.ledgerTxnId === primaryId));
    if (benchmarkCase === undefined) throw new Error(`no fixture case for ${primaryId}`);
    this.calls.push(primaryId);
    return proposalFor(benchmarkCase);
  }
}

describe("T023 end-to-end reconciliation pipeline", () => {
  it("runs the full dev fixture through deterministic and injected reasoning stages", async () => {
    const fixture = buildDevFixture();
    const adapter = new FixtureAdapter(fixture.cases);
    const result = await runReconciliation({
      runId: "run-dev-001",
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: adapter,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.results).toHaveLength(20);
    expect(countBy(result.results.map((item) => item.outcome))).toEqual({
      RECONCILED: 13,
      EXPLAINED_OUTSTANDING: 2,
      DISCREPANCY: 2,
      UNRESOLVED: 3,
    });
    expect(countBy(result.results.map((item) => item.reasonCode))).toEqual({
      EXACT_MATCH: 3,
      NORMALIZED_REFERENCE_MATCH: 2,
      COUNTERPARTY_MATCH: 2,
      GROUPED_MATCH: 4,
      MULTI_EVIDENCE_MATCH: 2,
      TIMING_DIFFERENCE: 2,
      AMOUNT_DISCREPANCY: 1,
      CONFLICTING_RECORDS: 1,
      MULTIPLE_PLAUSIBLE_CANDIDATES: 2,
      NO_CANDIDATE: 1,
    });

    const falseReconciliations = result.results.filter((item) => item.outcome === "RECONCILED" && !fixture.cases.some((benchmarkCase) =>
      benchmarkCase.expectedOutcome === "RECONCILED"
      && sameIds(item.bankRecordIds, benchmarkCase.truth.bankRecordIds)
      && sameIds(item.ledgerRecordIds, benchmarkCase.truth.ledgerRecordIds),
    )).length;
    expect(falseReconciliations).toBe(0);

    expect(adapter.calls).toHaveLength(9);
    expect(result.trace[0]?.type).toBe("RUN_STARTED");
    expect(result.trace.at(-1)?.type).toBe("RUN_COMPLETED");
    expect(result.trace.map((event) => event.sequenceNo)).toEqual(
      Array.from({ length: result.trace.length }, (_, index) => index + 1),
    );
    expect(result.trace.every((event) => event.runId === "run-dev-001")).toBe(true);

    const terminalCaseIds = result.trace.filter((event) => event.type === "CASE_FINALIZED").map((event) => event.caseId);
    expect(new Set(terminalCaseIds).size).toBe(terminalCaseIds.length);
    const committedRecordIds = result.results
      .filter((item) => item.outcome === "RECONCILED" || item.outcome === "DISCREPANCY")
      .flatMap((item) => [...item.bankRecordIds.map((id) => `BANK:${id}`), ...item.ledgerRecordIds.map((id) => `LEDGER:${id}`)]);
    expect(new Set(committedRecordIds).size).toBe(committedRecordIds.length);

    const semantic = fixture.cases.filter((item) => item.category === "SEMANTIC");
    for (const benchmarkCase of semantic) {
      const primaryId = benchmarkCase.bankTransactions[0]!.bankTxnId;
      const events = result.trace.filter((event) => event.caseId === `BANK:${primaryId}`);
      expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
        "CASE_STARTED", "CANDIDATES_GENERATED", "AGENT_STARTED", "AGENT_PROPOSED", "VERIFICATION_CHECKED", "CASE_FINALIZED",
      ]));
    }

    const strongContext = fixture.cases.find((item) => item.category === "STRONG_CONTEXT")!;
    const strongContextTrace = result.trace
      .filter((event) => event.caseId === `BANK:${strongContext.bankTransactions[0]!.bankTxnId}`)
      .filter((event) => event.type !== "TRANSACTION_NORMALIZED")
      .map((event) => event.type);
    expect(strongContextTrace).toEqual([
      "CASE_STARTED", "RULE_EVALUATED", "RULE_FAILED", "RULE_EVALUATED", "RULE_FAILED",
      "RULE_EVALUATED", "RULE_PASSED", "AUTO_RECONCILED", "CASE_FINALIZED",
    ]);
  });

  it("is deterministic for identical inputs and adapter behavior", async () => {
    const fixture = buildDevFixture();
    const createInput = (adapter: ReasoningModelAdapter) => ({
      runId: "run-deterministic-001",
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: adapter,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const first = await runReconciliation(createInput(new FixtureAdapter(fixture.cases)));
    const second = await runReconciliation(createInput(new FixtureAdapter(fixture.cases)));

    expect(second.results).toEqual(first.results);
    expect(second.trace).toEqual(first.trace);
    expect(second.usedRecords).toEqual(first.usedRecords);
  });

  it("does not record fake completion when the injected adapter throws", async () => {
    const fixture = buildDevFixture();
    const adapter: ReasoningModelAdapter = { generateProposal: async () => { throw new Error("offline adapter failure"); } };

    await expect(runReconciliation({ runId: "run-failed-001", asOfDate: fixture.asOfDate, bankCsv: fixture.bankCsv, ledgerCsv: fixture.ledgerCsv, modelAdapter: adapter })).rejects.toThrow("offline adapter failure");
  });

  it("cannot finalize an invalid AI MATCH as reconciled", async () => {
    const fixture = buildDevFixture();
    const target = fixture.cases.find((item) => item.reasonCode === "AMOUNT_DISCREPANCY")!;
    const adapter: ReasoningModelAdapter = {
      generateProposal: async () => ({
        ...proposalFor(target),
        proposedOutcome: "MATCH",
      }),
    };
    const result = await runReconciliation({
      runId: "run-invalid-match-001",
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: adapter,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const targetId = `BANK:${target.bankTransactions[0]!.bankTxnId}`;
    expect(result.results.find((item) => item.caseId === targetId)).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED" });
  });

  it("rejects parsing failures before producing a run result", async () => {
    const adapter: ReasoningModelAdapter = { generateProposal: async () => { throw new Error("adapter must not run"); } };
    await expect(runReconciliation({
      runId: "run-parse-failure-001",
      asOfDate: "2026-08-23",
      bankCsv: "not,a,valid,bank,csv",
      ledgerCsv: "",
      modelAdapter: adapter,
    })).rejects.toThrow();
  });
});

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("|") === [...right].sort().join("|");
}
