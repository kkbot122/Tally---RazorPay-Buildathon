import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildBenchmarkFixture, serializePrimaryCaseAlignment } from "../src/benchmark/generate-benchmark.js";
import { serializeCsv } from "../src/dev-fixture/serialize-csv.js";
import { BANK_HEADERS, GROUND_TRUTH_HEADERS, LEDGER_HEADERS } from "../src/dev-fixture/types.js";
import type { BenchmarkCase, BenchmarkCaseCategory } from "../src/generator/types.js";

const PILOT_CASE_COUNTS: Readonly<Record<BenchmarkCaseCategory, number>> = {
  EXACT: 10,
  NORMALIZED_REFERENCE: 5,
  STRONG_CONTEXT: 5,
  SEMANTIC: 7,
  TIMING: 5,
  GROUPED_ONE_TO_MANY: 4,
  GROUPED_MANY_TO_ONE: 4,
  // Include every final-profile discrepancy variant: amount, conflicting records,
  // and duplicate record usage.
  DISCREPANCY: 10,
  AMBIGUOUS: 3,
  NO_CANDIDATE: 2,
};

const fixture = buildBenchmarkFixture();
const cases = selectCases(fixture.cases);
const outputDirectory = resolve(process.cwd(), "../../data/test");
const bankRows = cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions.map((record) => ({
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
})));
const ledgerRows = cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions.map((record) => ({
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
})));
const groundTruthRows = cases.map((benchmarkCase) => ({
  case_id: benchmarkCase.caseId,
  bank_record_ids: benchmarkCase.truth.bankRecordIds.join("|"),
  ledger_record_ids: benchmarkCase.truth.ledgerRecordIds.join("|"),
  expected_outcome: benchmarkCase.expectedOutcome,
  reason_code: benchmarkCase.reasonCode,
  notes: benchmarkCase.notes ?? "",
}));

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "bank_transactions.csv"), serializeCsv(BANK_HEADERS, bankRows));
writeFileSync(resolve(outputDirectory, "ledger_transactions.csv"), serializeCsv(LEDGER_HEADERS, ledgerRows));
writeFileSync(resolve(outputDirectory, "ground_truth.csv"), serializeCsv(GROUND_TRUTH_HEADERS, groundTruthRows));
writeFileSync(resolve(outputDirectory, "primary_case_alignment.json"), serializePrimaryCaseAlignment(cases));

console.log(`Generated ${cases.length}-case pilot in ${outputDirectory}`);
console.log(JSON.stringify(PILOT_CASE_COUNTS, null, 2));

function selectCases(allCases: readonly BenchmarkCase[]): BenchmarkCase[] {
  const selected = Object.entries(PILOT_CASE_COUNTS).flatMap(([category, count]) => allCases
    .filter((benchmarkCase) => benchmarkCase.category === category)
    .slice(0, count));

  if (selected.length !== 55) throw new Error(`Expected 55 pilot cases, found ${selected.length}`);
  return selected;
}
