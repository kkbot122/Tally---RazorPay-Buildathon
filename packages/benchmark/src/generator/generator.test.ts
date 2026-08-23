import { describe, expect, it } from "vitest";

import { createBenchmarkGenerator, generateBenchmarkCase, validateBenchmarkCase } from "./index.js";
import type { BenchmarkCaseCategory } from "./types.js";

const categories: readonly BenchmarkCaseCategory[] = [
  "EXACT",
  "NORMALIZED_REFERENCE",
  "STRONG_CONTEXT",
  "SEMANTIC",
  "TIMING",
  "GROUPED_ONE_TO_MANY",
  "GROUPED_MANY_TO_ONE",
  "DISCREPANCY",
  "AMBIGUOUS",
  "NO_CANDIDATE",
];

describe("truth-first benchmark generator", () => {
  it("is deterministic for the same seed, case ID, and category", () => {
    const first = generateBenchmarkCase({ seed: 42, caseId: "C001", category: "SEMANTIC" });
    expect(first).toEqual(generateBenchmarkCase({ seed: 42, caseId: "C001", category: "SEMANTIC" }));
    expect(first.truth.financialEvent).not.toEqual(
      generateBenchmarkCase({ seed: 43, caseId: "C001", category: "SEMANTIC" }).truth.financialEvent,
    );
  });

  it("supports every frozen category with explicit outcomes and truth IDs", () => {
    const generator = createBenchmarkGenerator({ seed: 42 });
    const cases = categories.map((category, index) => generator.generateCase({ caseId: `C${String(index + 1).padStart(3, "0")}`, category }));

    expect(cases.map((benchmarkCase) => benchmarkCase.category)).toEqual(categories);
    expect(cases.map((benchmarkCase) => benchmarkCase.expectedOutcome)).toEqual([
      "RECONCILED", "RECONCILED", "RECONCILED", "RECONCILED", "EXPLAINED_OUTSTANDING",
      "RECONCILED", "RECONCILED", "DISCREPANCY", "UNRESOLVED", "UNRESOLVED",
    ]);
    expect(cases.every((benchmarkCase) => benchmarkCase.truth.financialEvent.currency === "INR")).toBe(true);
  });

  it("keeps all generated transaction IDs unique across a generated dataset", () => {
    const generator = createBenchmarkGenerator({ seed: 7 });
    const cases = categories.map((category, index) => generator.generateCase({ caseId: `C${index + 1}`, category }));
    const bankIds = cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions.map((record) => record.bankTxnId));
    const ledgerIds = cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions.map((record) => record.ledgerTxnId));

    expect(new Set(bankIds).size).toBe(bankIds.length);
    expect(new Set(ledgerIds).size).toBe(ledgerIds.length);
    expect(() => generator.generateCase({ caseId: "C1", category: "EXACT" })).toThrow(/Duplicate benchmark case ID/);
  });

  it("balances grouped amounts and keeps groups at the supported size", () => {
    const generator = createBenchmarkGenerator({ seed: 11 });
    const oneToMany = generator.generateCase({ caseId: "C001", category: "GROUPED_ONE_TO_MANY" });
    const manyToOne = generator.generateCase({ caseId: "C002", category: "GROUPED_MANY_TO_ONE" });

    expect(oneToMany.ledgerTransactions.length).toBeGreaterThanOrEqual(2);
    expect(oneToMany.ledgerTransactions.length).toBeLessThanOrEqual(3);
    expect(manyToOne.bankTransactions.length).toBeGreaterThanOrEqual(2);
    expect(manyToOne.bankTransactions.length).toBeLessThanOrEqual(3);
    expect(oneToMany.truth.ledgerRecordIds).toHaveLength(oneToMany.ledgerTransactions.length);
    expect(manyToOne.truth.bankRecordIds).toHaveLength(manyToOne.bankTransactions.length);
  });

  it("contains real timing evidence, visible ambiguity, and no-candidate truth", () => {
    const generator = createBenchmarkGenerator({ seed: 19 });
    const timing = generator.generateCase({ caseId: "C001", category: "TIMING" });
    const ambiguous = generator.generateCase({ caseId: "C002", category: "AMBIGUOUS" });
    const noCandidate = generator.generateCase({ caseId: "C003", category: "NO_CANDIDATE" });

    expect(timing.truth.timingEvidence?.expectedDate).toBeDefined();
    expect(ambiguous.truth.plausibleLedgerRecordIds).toHaveLength(2);
    expect(ambiguous.truth.ledgerRecordIds).toEqual([]);
    expect(noCandidate.ledgerTransactions).toEqual([]);
  });

  it("keeps semantic cases non-exact and discrepancy cases contradictory", () => {
    const semantic = generateBenchmarkCase({ seed: 23, caseId: "C001", category: "SEMANTIC" });
    const discrepancy = generateBenchmarkCase({ seed: 23, caseId: "C002", category: "DISCREPANCY" });

    expect(semantic.bankTransactions[0]?.counterparty).not.toBe(semantic.ledgerTransactions[0]?.counterparty);
    expect(discrepancy.bankTransactions[0]?.amount).not.toBe(discrepancy.ledgerTransactions[0]?.amount);
    const conflicting = generateBenchmarkCase({ seed: 23, caseId: "C003", category: "DISCREPANCY" });
    expect(conflicting.reasonCode).toBe("CONFLICTING_RECORDS");
    expect(conflicting.bankTransactions[0]?.amount).toBe(conflicting.ledgerTransactions[0]?.amount);
    expect(conflicting.bankTransactions[0]?.direction).not.toBe(conflicting.ledgerTransactions[0]?.direction);
  });

  it("uses canonical reason codes and keeps semantic references distinct after normalization", () => {
    const semantic = generateBenchmarkCase({ seed: 51, caseId: "C001", category: "SEMANTIC" });
    const normalize = (value: string | null) => (value ?? "").toLowerCase().replace(/[\s\p{P}]/gu, "");
    expect(semantic.reasonCode).toBe("MULTI_EVIDENCE_MATCH");
    expect(normalize(semantic.bankTransactions[0]?.reference ?? null)).not.toBe(normalize(semantic.ledgerTransactions[0]?.reference ?? null));
  });

  it("makes ambiguous alternatives observably identical and timing relative to as-of", () => {
    const ambiguous = generateBenchmarkCase({ seed: 61, caseId: "C001", category: "AMBIGUOUS" });
    const [first, second] = ambiguous.ledgerTransactions;
    expect({ ...first!, ledgerTxnId: undefined }).toEqual({ ...second!, ledgerTxnId: undefined });
    const timing = generateBenchmarkCase({ seed: 61, caseId: "C002", category: "TIMING" });
    expect(timing.truth.timingEvidence!.accountingDate < timing.truth.timingEvidence!.asOfDate).toBe(true);
    expect(timing.truth.timingEvidence!.expectedDate > timing.truth.timingEvidence!.asOfDate).toBe(true);
  });

  it("rejects unsupported many-to-many output", () => {
    const valid = generateBenchmarkCase({ seed: 31, caseId: "C001", category: "EXACT" });
    const invalid = {
      ...valid,
      category: "GROUPED_ONE_TO_MANY" as const,
      bankTransactions: [valid.bankTransactions[0]!, valid.bankTransactions[0]!],
      ledgerTransactions: [valid.ledgerTransactions[0]!, valid.ledgerTransactions[0]!],
    };

    expect(() => validateBenchmarkCase(invalid)).toThrow(/transaction IDs|one-to-many group size/);
  });
});
