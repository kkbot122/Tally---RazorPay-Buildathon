import {
  DEFAULT_REASONING_CONCURRENCY,
  runReconciliation,
  type AgentProposal,
  type ReasoningModelAdapter,
} from "@tally/reconciliation";
import { describe, expect, it } from "vitest";

import { buildDevFixture } from "./dev-fixture/index.js";
import { BANK_HEADERS, LEDGER_HEADERS } from "./dev-fixture/types.js";
import type { BenchmarkCase } from "./generator/index.js";

function proposalFor(benchmarkCase: BenchmarkCase): AgentProposal {
  const bankRecordIds = benchmarkCase.truth.bankRecordIds;
  const ledgerRecordIds = benchmarkCase.truth.ledgerRecordIds;
  const evidence = [{
    statement: "The supplied records provide the configured fixture evidence.",
    source: "CROSS_RECORD" as const,
    kind: "SEMANTIC" as const,
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
  activeCalls = 0;
  maxActiveCalls = 0;

  constructor(private readonly cases: readonly BenchmarkCase[], private readonly barrier?: ReleaseBarrier) {}

  async generateProposal(input: { input: string }): Promise<AgentProposal> {
    const primary = input.input.match(/"primary":\{"side":"(BANK|LEDGER)","record":\{(?:"bankTxnId"|"ledgerTxnId"):\"([^\"]+)\"/);
    if (primary === null) throw new Error("fake adapter could not identify the primary record");
    const primaryId = primary[2]!;
    const benchmarkCase = this.cases.find((candidate) =>
      candidate.bankTransactions.some((record) => record.bankTxnId === primaryId)
      || candidate.ledgerTransactions.some((record) => record.ledgerTxnId === primaryId));
    if (benchmarkCase === undefined) throw new Error(`no fixture case for ${primaryId}`);
    this.calls.push(primaryId);
    this.activeCalls += 1;
    this.maxActiveCalls = Math.max(this.maxActiveCalls, this.activeCalls);
    this.barrier?.started();
    try {
      if (this.barrier !== undefined) await this.barrier.wait;
      return proposalFor(benchmarkCase);
    } finally {
      this.activeCalls -= 1;
    }
  }
}

type ReleaseBarrier = {
  wait: Promise<void>;
  started: () => void;
};

function releaseAfter(target: number): ReleaseBarrier {
  let resolve!: () => void;
  let startedCount = 0;
  const wait = new Promise<void>((resolveWait) => { resolve = resolveWait; });
  return {
    wait,
    started: () => {
      startedCount += 1;
      if (startedCount >= target) resolve();
    },
  };
}

describe("T023 end-to-end reconciliation pipeline", () => {
  it("runs the full dev fixture through deterministic and injected reasoning stages", async () => {
    const fixture = buildDevFixture();
    expect(DEFAULT_REASONING_CONCURRENCY).toBe(5);
    const adapter = new FixtureAdapter(fixture.cases);
    const result = await runReconciliation({
      runId: "run-dev-001",
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: adapter,
      reasoningConcurrency: DEFAULT_REASONING_CONCURRENCY,
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

    const agentStarts = result.trace.filter((event) => event.type === "AGENT_STARTED");
    expect(adapter.calls).toHaveLength(6);
    expect(agentStarts).toHaveLength(adapter.calls.length);
    expect(agentStarts.every((event) => (event.payload as { candidateCount?: number }).candidateCount! > 0)).toBe(true);
    expect(new Set(adapter.calls).size).toBe(adapter.calls.length);
    expect(result.results.filter((item) => item.source === "DETERMINISTIC").every((item) =>
      !result.trace.some((event) => event.caseId === item.caseId && event.type === "AGENT_STARTED"),
    )).toBe(true);
    expect(result.trace[0]?.type).toBe("RUN_STARTED");
    expect(result.trace.at(-1)?.type).toBe("RUN_COMPLETED");
    expect(result.trace.at(-1)?.payload).toMatchObject({ metrics: {
      totalSourceRecords: 45,
      logicalCases: 20,
      deterministicallyResolved: 11,
      deterministicExceptions: 3,
      aiEscalations: 6,
      aiEscalationRate: 0.3,
      initialAiCalls: 6,
      aiRepairCalls: 0,
      aiProposalsAccepted: 6,
      aiProposalsRejected: 0,
      aiAbstentions: 2,
      totalModelCalls: 6,
    } });
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
      expectReasoningTraceOrder(events);
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

  it("bounds active model calls and proves concurrency is real", async () => {
    const fixture = buildDevFixture();
    const adapter = new FixtureAdapter(fixture.cases, releaseAfter(3));
    await runReconciliation({
      runId: "run-concurrency-3",
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: adapter,
      reasoningConcurrency: 3,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(adapter.maxActiveCalls).toBe(3);
  });

  it("keeps concurrency one sequential and rejects invalid limits", async () => {
    const fixture = buildDevFixture();
    const adapter = new FixtureAdapter(fixture.cases, releaseAfter(1));
    const result = await runReconciliation({
      runId: "run-concurrency-1",
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: adapter,
      reasoningConcurrency: 1,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(adapter.maxActiveCalls).toBe(1);
    expect(result.results).toHaveLength(20);

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalidAdapter = new FixtureAdapter(fixture.cases);
      await expect(runReconciliation({
        runId: `run-invalid-concurrency-${String(invalid)}`,
        asOfDate: fixture.asOfDate,
        bankCsv: fixture.bankCsv,
        ledgerCsv: fixture.ledgerCsv,
        modelAdapter: invalidAdapter,
        reasoningConcurrency: invalid,
      })).rejects.toThrow(/reasoningConcurrency/);
      expect(invalidAdapter.calls).toEqual([]);
    }
  });

  it("keeps financial results equivalent between concurrency one and three", async () => {
    const fixture = buildDevFixture();
    const input = (reasoningConcurrency: number) => ({
      runId: `run-equivalence-${reasoningConcurrency}`,
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: new FixtureAdapter(fixture.cases),
      reasoningConcurrency,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const sequential = await runReconciliation(input(1));
    const concurrent = await runReconciliation(input(3));
    const normalize = (run: typeof sequential) => run.results.map(({ caseId, outcome, reasonCode, bankRecordIds, ledgerRecordIds }) => ({ caseId, outcome, reasonCode, bankRecordIds, ledgerRecordIds }));
    expect(normalize(concurrent)).toEqual(normalize(sequential));
  });

  it("serializes overlapping same-wave verification against live usage", async () => {
    const bankCsv = [
      BANK_HEADERS.join(","),
      "B1,2026-08-11,2026-08-11,100.00,INR,CREDIT,,Same,,",
      "B2,2026-08-11,2026-08-11,100.00,INR,CREDIT,,Same,,",
    ].join("\n");
    const ledgerCsv = [
      LEDGER_HEADERS.join(","),
      "L1,2026-08-10,,100.00,INR,CREDIT,,Same,,ERP,",
    ].join("\n");
    const adapter: ReasoningModelAdapter = {
      generateProposal: async ({ input }) => {
        const primary = input.match(/"primary":\{"side":"BANK","record":\{"bankTxnId":"([^"]+)"/);
        if (primary === null) throw new Error("missing primary");
        return {
          proposedOutcome: "MATCH",
          bankRecordIds: [primary[1]!],
          ledgerRecordIds: ["L1"],
          confidence: "HIGH",
          evidence: [{ statement: "Same amount and counterparty.", source: "CROSS_RECORD", kind: "COUNTERPARTY", recordIds: [primary[1]!, "L1"] }],
          conflictingEvidence: [],
          reason: "Configured overlap test proposal.",
        };
      },
    };
    const result = await runReconciliation({
      runId: "run-overlap-001",
      asOfDate: "2026-08-23",
      bankCsv,
      ledgerCsv,
      modelAdapter: adapter,
      reasoningConcurrency: 2,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.results.map((item) => item.outcome)).toEqual(["RECONCILED", "UNRESOLVED"]);
    expect(result.results[0]?.ledgerRecordIds).toEqual(["L1"]);
    expect(result.results[1]?.reasonCode).toBe("VERIFICATION_FAILED");
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
    expect(result.results.some((item) => item.outcome === "RECONCILED" && item.source === "AGENT_VERIFIED")).toBe(false);
    expect(result.trace.some((event) => event.type === "VERIFICATION_CHECKED" && (event.payload as { failures?: { code: string }[] }).failures?.some((failure) => failure.code === "AMOUNT_MISMATCH"))).toBe(true);
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

  it("finalizes stable work order even when the later proposal returns first", async () => {
    const bankCsv = [
      BANK_HEADERS.join(","),
      "B1,2026-08-11,2026-08-11,100.00,INR,CREDIT,,Same,,",
      "B2,2026-08-11,2026-08-11,100.00,INR,CREDIT,,Same,,",
    ].join("\n");
    const ledgerCsv = [LEDGER_HEADERS.join(","), "L1,2026-08-10,,100.00,INR,CREDIT,,Same,,ERP,"].join("\n");
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const adapter: ReasoningModelAdapter = {
      generateProposal: async ({ input }) => {
        const primary = input.match(/"primary":\{"side":"BANK","record":\{"bankTxnId":"([^"]+)"/);
        if (primary === null) throw new Error("missing primary");
        const bankId = primary[1]!;
        if (bankId === "B1") await firstBlocked;
        else releaseFirst();
        return {
          proposedOutcome: "MATCH",
          bankRecordIds: [bankId],
          ledgerRecordIds: ["L1"],
          confidence: "HIGH",
          evidence: [{ statement: "Configured overlap evidence.", source: "CROSS_RECORD", kind: "SEMANTIC", recordIds: [bankId, "L1"] }],
          conflictingEvidence: [],
          reason: "Configured completion-order test proposal.",
        };
      },
    };
    const result = await runReconciliation({
      runId: "run-completion-order-001",
      asOfDate: "2026-08-23",
      bankCsv,
      ledgerCsv,
      modelAdapter: adapter,
      reasoningConcurrency: 2,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const proposed = result.trace.filter((event) => event.type === "AGENT_PROPOSED");
    expect(proposed.map((event) => event.caseId)).toEqual(["BANK:B2", "BANK:B1"]);
    expect(result.results.map((item) => [item.caseId, item.outcome])).toEqual([
      ["BANK:B1", "RECONCILED"],
      ["BANK:B2", "UNRESOLVED"],
    ]);
  });

  it("skips a later-wave primary consumed by an earlier wave", async () => {
    const bankCsv = [
      BANK_HEADERS.join(","),
      "B1,2026-08-11,2026-08-11,100.00,INR,CREDIT,,Alpha,,GROUP-1",
      "B2,2026-08-11,2026-08-11,100.00,INR,CREDIT,,Beta,,",
    ].join("\n");
    const ledgerCsv = [LEDGER_HEADERS.join(","), "L1,2026-08-10,,100.00,INR,CREDIT,,Gamma,,ERP,GROUP-1"].join("\n");
    const calls: string[] = [];
    const adapter: ReasoningModelAdapter = {
      generateProposal: async ({ input }) => {
        const bankPrimary = input.match(/"primary":\{"side":"BANK","record":\{"bankTxnId":"([^"]+)"/);
        const ledgerPrimary = input.match(/"primary":\{"side":"LEDGER","record":\{"ledgerTxnId":"([^"]+)"/);
        if (bankPrimary !== null) {
          calls.push(bankPrimary[1]!);
          if (bankPrimary[1] === "B1") {
            return {
              proposedOutcome: "MATCH",
              bankRecordIds: ["B1"],
              ledgerRecordIds: ["L1"],
              confidence: "HIGH",
              evidence: [{ statement: "Configured reuse evidence.", source: "CROSS_RECORD", kind: "SEMANTIC", recordIds: ["B1", "L1"] }],
              conflictingEvidence: [],
              reason: "Configured later-wave test proposal.",
            };
          }
        }
        if (ledgerPrimary !== null) calls.push(ledgerPrimary[1]!);
        return {
          proposedOutcome: "INSUFFICIENT_EVIDENCE",
          bankRecordIds: bankPrimary === null ? [] : [bankPrimary[1]!],
          ledgerRecordIds: [],
          confidence: "LOW",
          evidence: [{ statement: "Insufficient evidence.", source: "BANK_RECORD", recordIds: [bankPrimary?.[1] ?? "B2"] }],
          conflictingEvidence: [],
          reason: "Configured later-wave skip proposal.",
        };
      },
    };
    await runReconciliation({
      runId: "run-later-wave-skip-001",
      asOfDate: "2026-08-23",
      bankCsv,
      ledgerCsv,
      modelAdapter: adapter,
      reasoningConcurrency: 2,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(calls).toEqual(["B1", "B2"]);
  });

  it("selects the earliest stable failure when multiple in-flight calls fail", async () => {
    const bankCsv = [
      BANK_HEADERS.join(","),
      "B1,2026-08-11,2026-08-11,100.00,INR,CREDIT,NO1,,,",
      "B2,2026-08-11,2026-08-11,100.00,INR,CREDIT,NO2,,,",
      "B3,2026-08-11,2026-08-11,100.00,INR,CREDIT,NO3,,,",
    ].join("\n");
    const adapter: ReasoningModelAdapter = {
      generateProposal: async ({ input }) => {
        const primary = input.match(/"primary":\{"side":"BANK","record":\{"bankTxnId":"([^"]+)"/);
        const id = primary?.[1] ?? "unknown";
        if (id === "B1") await new Promise((resolve) => setTimeout(resolve, 15));
        if (id === "B3") await new Promise((resolve) => setTimeout(resolve, 1));
        throw new Error(`${id} failure`);
      },
    };
    await expect(runReconciliation({
      runId: "run-multi-failure-001",
      asOfDate: "2026-08-23",
      bankCsv,
      ledgerCsv: [
        LEDGER_HEADERS.join(","),
        "L1,2026-08-10,,100.00,INR,CREDIT,LEDGER-1,Ledger One,Receipt,ERP,",
        "L2,2026-08-10,,100.00,INR,CREDIT,LEDGER-2,Ledger Two,Receipt,ERP,",
        "L3,2026-08-10,,100.00,INR,CREDIT,LEDGER-3,Ledger Three,Receipt,ERP,",
      ].join("\n"),
      modelAdapter: adapter,
      reasoningConcurrency: 3,
    })).rejects.toThrow("B1 failure");
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

function expectReasoningTraceOrder(events: readonly { type: string; sequenceNo: number }[]): void {
  const required = ["CANDIDATES_GENERATED", "AGENT_STARTED", "AGENT_PROPOSED", "VERIFICATION_CHECKED", "CASE_FINALIZED"];
  const positions = required.map((type) => events.find((event) => event.type === type)?.sequenceNo);
  expect(positions.every((position): position is number => position !== undefined)).toBe(true);
  const presentPositions = positions.filter((position): position is number => position !== undefined);
  expect(presentPositions).toEqual([...presentPositions].sort((left, right) => left - right));
}
