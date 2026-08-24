import { parseBankCsv, parseLedgerCsv } from "@tally/reconciliation";

import type { BenchmarkCase } from "../generator/types.js";
import type { BenchmarkFixture } from "./generate-benchmark.js";

const forbidden = new Set(["case_id", "category", "expected_outcome", "reason_code", "truth", "ground_truth"]);
const expectedCategoryCounts = {
  EXACT: 20, NORMALIZED_REFERENCE: 10, STRONG_CONTEXT: 10, SEMANTIC: 15, TIMING: 10,
  GROUPED_ONE_TO_MANY: 8, GROUPED_MANY_TO_ONE: 7, DISCREPANCY: 10, AMBIGUOUS: 6, NO_CANDIDATE: 4,
} as const;
const expectedReasonCounts = {
  EXACT_MATCH: 20, NORMALIZED_REFERENCE_MATCH: 10, COUNTERPARTY_MATCH: 10, MULTI_EVIDENCE_MATCH: 15,
  TIMING_DIFFERENCE: 10, GROUPED_MATCH: 15, AMOUNT_DISCREPANCY: 5, CONFLICTING_RECORDS: 3,
  DUPLICATE_USAGE: 2, MULTIPLE_PLAUSIBLE_CANDIDATES: 6, NO_CANDIDATE: 4,
} as const;
const runtimeLeakTokens = [
  "EXACT", "NORMALIZED_REFERENCE", "STRONG_CONTEXT", "SEMANTIC", "TIMING", "GROUPED_ONE_TO_MANY",
  "GROUPED_MANY_TO_ONE", "DISCREPANCY", "AMBIGUOUS", "NO_CANDIDATE",
];

export function validateBenchmarkFixture(fixture: BenchmarkFixture): void {
  assert(fixture.cases.length === 100, "benchmark must contain exactly 100 cases");
  assertCounts(fixture.cases.map((benchmarkCase) => benchmarkCase.category), expectedCategoryCounts, "category");
  assertCounts(fixture.cases.map((benchmarkCase) => benchmarkCase.reasonCode), expectedReasonCounts, "reason code");
  const bank = parseBankCsv(fixture.bankCsv);
  const ledger = parseLedgerCsv(fixture.ledgerCsv);
  assert(![...bank, ...ledger].some((record) => Object.keys(record).some((key) => forbidden.has(key))), "truth leaked into runtime CSV");
  const caseIds = new Set(fixture.cases.map((benchmarkCase) => benchmarkCase.caseId));
  assert([...bank, ...ledger].every((record) => {
    const runtimeText = Object.entries(record)
      .filter(([key]) => !key.endsWith("TxnId"))
      .map(([, value]) => String(value))
      .join("|");
    return [...caseIds].every((caseId) => !runtimeText.includes(caseId))
      && runtimeLeakTokens.every((token) => !runtimeText.includes(token));
  }), "runtime values must not embed benchmark categories or case IDs");
  const bankIds = new Set(bank.map((record) => record.bankTxnId));
  const ledgerIds = new Set(ledger.map((record) => record.ledgerTxnId));
  assert(bankIds.size === bank.length && ledgerIds.size === ledger.length, "runtime IDs must be unique");
  assert(caseIds.size === fixture.cases.length, "case IDs must be unique");
  for (const benchmarkCase of fixture.cases) validateCase(benchmarkCase, bankIds, ledgerIds, fixture.asOfDate);
  const deltas = fixture.cases.filter((benchmarkCase) => benchmarkCase.reasonCode === "AMOUNT_DISCREPANCY").map((benchmarkCase) => toPaise(benchmarkCase.bankTransactions[0]!.amount) - toPaise(benchmarkCase.ledgerTransactions[0]!.amount));
  assert(deltas.some((delta) => delta > 0n) && deltas.some((delta) => delta < 0n), "amount discrepancies must include both delta signs");
  const repeatedAmounts = new Map<string, number>();
  for (const benchmarkCase of fixture.cases) repeatedAmounts.set(benchmarkCase.truth.financialEvent.amount, (repeatedAmounts.get(benchmarkCase.truth.financialEvent.amount) ?? 0) + 1);
  assert([...repeatedAmounts.values()].filter((count) => count >= 2).length >= 10, "at least ten amount values must repeat");
}

function validateCase(benchmarkCase: BenchmarkCase, bankIds: Set<string>, ledgerIds: Set<string>, asOfDate: string): void {
  for (const id of benchmarkCase.truth.bankRecordIds) assert(bankIds.has(id), `missing bank truth ID ${id}`);
  for (const id of benchmarkCase.truth.ledgerRecordIds) assert(ledgerIds.has(id), `missing ledger truth ID ${id}`);
  if (benchmarkCase.category === "GROUPED_ONE_TO_MANY") assert([2, 3].includes(benchmarkCase.ledgerTransactions.length), "invalid one-to-many size");
  if (benchmarkCase.category === "GROUPED_MANY_TO_ONE") assert([2, 3].includes(benchmarkCase.bankTransactions.length), "invalid many-to-one size");
  if (benchmarkCase.category === "TIMING") assert(benchmarkCase.ledgerTransactions[0]!.maturityDate! > asOfDate, "timing maturity must be after as-of date");
  if (benchmarkCase.category === "AMBIGUOUS") assert((benchmarkCase.truth.plausibleLedgerRecordIds?.length ?? 0) >= 2, "ambiguous case needs two candidates");
}

function assertCounts<T extends string>(values: readonly T[], expected: Record<string, number>, label: string): void {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const [value, count] of Object.entries(expected) as [T, number][]) assert(counts.get(value) === count, `${label} ${value} expected ${count}, got ${counts.get(value) ?? 0}`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid final benchmark: ${message}`);
}

function toPaise(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
