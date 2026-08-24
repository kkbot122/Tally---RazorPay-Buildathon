import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseBankCsv, parseLedgerCsv } from "@tally/reconciliation";

import { createBenchmarkGenerator } from "../generator/index.js";
import type { BenchmarkCase, BenchmarkCaseCategory } from "../generator/types.js";
import { BANK_HEADERS, GROUND_TRUTH_HEADERS, LEDGER_HEADERS } from "../dev-fixture/types.js";
import { serializeCsv } from "../dev-fixture/serialize-csv.js";
import { shuffle } from "../dev-fixture/randomize.js";
import { validateBenchmarkFixture } from "./validate-benchmark.js";

export const BENCHMARK_SEED = 20260824;
export const BENCHMARK_CASE_COUNT = 100;
const BENCHMARK_AMOUNT_VALUES = [500_000, 750_000, 995_000, 1_000_000, 1_245_000, 1_500_000, 1_750_000, 2_000_000, 2_500_000, 3_000_000];

export const BENCHMARK_COMPOSITION: readonly BenchmarkCaseCategory[] = [
  ...Array<BenchmarkCaseCategory>(20).fill("EXACT"),
  ...Array<BenchmarkCaseCategory>(10).fill("NORMALIZED_REFERENCE"),
  ...Array<BenchmarkCaseCategory>(10).fill("STRONG_CONTEXT"),
  ...Array<BenchmarkCaseCategory>(15).fill("SEMANTIC"),
  ...Array<BenchmarkCaseCategory>(10).fill("TIMING"),
  ...Array<BenchmarkCaseCategory>(8).fill("GROUPED_ONE_TO_MANY"),
  ...Array<BenchmarkCaseCategory>(7).fill("GROUPED_MANY_TO_ONE"),
  ...Array<BenchmarkCaseCategory>(10).fill("DISCREPANCY"),
  ...Array<BenchmarkCaseCategory>(6).fill("AMBIGUOUS"),
  ...Array<BenchmarkCaseCategory>(4).fill("NO_CANDIDATE"),
];

export type BenchmarkFixture = {
  asOfDate: string;
  cases: BenchmarkCase[];
  bankCsv: string;
  ledgerCsv: string;
  groundTruthCsv: string;
};

export function buildBenchmarkFixture(seed = BENCHMARK_SEED): BenchmarkFixture {
  if (seed !== BENCHMARK_SEED) throw new Error("The final benchmark seed is frozen");
  const generator = createBenchmarkGenerator({ seed, amountValues: BENCHMARK_AMOUNT_VALUES, profile: "FINAL" });
  const cases = BENCHMARK_COMPOSITION.map((category, index) => generator.generateCase({
    caseId: `C${String(index + 1).padStart(3, "0")}`,
    category,
  }));
  const bankRecords = shuffle(cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions), seed + 1);
  const ledgerRecords = shuffle(cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions), seed + 2);
  const groundTruthRows = shuffle(cases, seed + 3);
  const fixture: BenchmarkFixture = {
    asOfDate: "2026-10-01",
    cases,
    bankCsv: serializeCsv(BANK_HEADERS, bankRecords.map((record) => ({
      bank_txn_id: record.bankTxnId,
      booking_date: record.bookingDate,
      value_date: record.valueDate,
      amount: record.amount,
      currency: record.currency,
      direction: record.direction,
      reference: record.reference,
      counterparty: record.counterparty,
      description: record.description,
      batch_id: record.batchId,
    }))),
    ledgerCsv: serializeCsv(LEDGER_HEADERS, ledgerRecords.map((record) => ({
      ledger_txn_id: record.ledgerTxnId,
      accounting_date: record.accountingDate,
      maturity_date: record.maturityDate,
      amount: record.amount,
      currency: record.currency,
      direction: record.direction,
      reference: record.reference,
      counterparty: record.counterparty,
      description: record.description,
      source: record.source,
      batch_id: record.batchId,
    }))),
    groundTruthCsv: serializeCsv(GROUND_TRUTH_HEADERS, groundTruthRows.map((benchmarkCase) => ({
      case_id: benchmarkCase.caseId,
      bank_record_ids: benchmarkCase.truth.bankRecordIds.join("|"),
      ledger_record_ids: benchmarkCase.truth.ledgerRecordIds.join("|"),
      expected_outcome: benchmarkCase.expectedOutcome,
      reason_code: benchmarkCase.reasonCode,
      notes: benchmarkCase.notes ?? "",
    }))),
  };
  validateBenchmarkFixture(fixture);
  return fixture;
}

export function writeBenchmarkFixture(outputDirectory = resolve(process.cwd(), "../../data/benchmark")): void {
  const fixture = buildBenchmarkFixture();
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, "bank_transactions.csv"), fixture.bankCsv);
  writeFileSync(resolve(outputDirectory, "ledger_transactions.csv"), fixture.ledgerCsv);
  writeFileSync(resolve(outputDirectory, "ground_truth.csv"), fixture.groundTruthCsv);
  writeFileSync(resolve(outputDirectory, "primary_case_alignment.json"), serializePrimaryCaseAlignment(fixture.cases));
  console.log(`Generated ${fixture.cases.length}-case benchmark in ${outputDirectory}`);
  const counts = (values: readonly string[]) => Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
  console.log(JSON.stringify({ categories: counts(fixture.cases.map((benchmarkCase) => benchmarkCase.category)), reasons: counts(fixture.cases.map((benchmarkCase) => benchmarkCase.reasonCode)) }, null, 2));
}

export function serializePrimaryCaseAlignment(cases: readonly BenchmarkCase[]): string {
  return `${JSON.stringify(cases.flatMap((benchmarkCase) => [
    ...benchmarkCase.bankTransactions.map((record) => ({ side: "BANK", recordId: record.bankTxnId, caseId: benchmarkCase.caseId })),
    ...benchmarkCase.ledgerTransactions.map((record) => ({ side: "LEDGER", recordId: record.ledgerTxnId, caseId: benchmarkCase.caseId })),
  ]), null, 2)}\n`;
}

export { parseBankCsv, parseLedgerCsv };
