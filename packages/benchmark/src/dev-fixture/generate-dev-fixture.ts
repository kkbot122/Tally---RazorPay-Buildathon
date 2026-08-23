import { parseBankCsv, parseLedgerCsv } from "@tally/reconciliation";

import { createBenchmarkGenerator, type BenchmarkCaseCategory } from "../generator/index.js";
import { serializeCsv } from "./serialize-csv.js";
import { shuffle } from "./randomize.js";
import {
  BANK_HEADERS,
  DEV_FIXTURE_AS_OF_DATE,
  DEV_FIXTURE_SEED,
  GROUND_TRUTH_HEADERS,
  LEDGER_HEADERS,
  type DevFixture,
} from "./types.js";
import { validateDevFixture } from "./validate-dev-fixture.js";

const composition: readonly BenchmarkCaseCategory[] = [
  "EXACT", "EXACT", "EXACT",
  "NORMALIZED_REFERENCE", "NORMALIZED_REFERENCE",
  "STRONG_CONTEXT", "STRONG_CONTEXT",
  "SEMANTIC", "SEMANTIC",
  "TIMING", "TIMING",
  "GROUPED_ONE_TO_MANY", "GROUPED_ONE_TO_MANY",
  "GROUPED_MANY_TO_ONE", "GROUPED_MANY_TO_ONE",
  "DISCREPANCY", "DISCREPANCY",
  "AMBIGUOUS", "AMBIGUOUS",
  "NO_CANDIDATE",
];

export function buildDevFixture(seed = DEV_FIXTURE_SEED): DevFixture {
  const generator = createBenchmarkGenerator({ seed });
  const cases = composition.map((category, index) =>
    generator.generateCase({ caseId: `C${String(index + 1).padStart(3, "0")}`, category }),
  );

  const bankRecords = shuffle(cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions), seed + 1);
  const ledgerRecords = shuffle(cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions), seed + 2);

  const bankCsv = serializeCsv(BANK_HEADERS, bankRecords.map((record) => ({
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
  const ledgerCsv = serializeCsv(LEDGER_HEADERS, ledgerRecords.map((record) => ({
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
  const groundTruthCsv = serializeCsv(GROUND_TRUTH_HEADERS, cases.map((benchmarkCase) => ({
    case_id: benchmarkCase.caseId,
    bank_record_ids: benchmarkCase.truth.bankRecordIds.join("|"),
    ledger_record_ids: benchmarkCase.truth.ledgerRecordIds.join("|"),
    expected_outcome: benchmarkCase.expectedOutcome,
    reason_code: benchmarkCase.reasonCode,
    notes: benchmarkCase.category === "TIMING"
      ? `${benchmarkCase.notes ?? ""} As-of date: ${DEV_FIXTURE_AS_OF_DATE}.`
      : benchmarkCase.notes ?? "",
  })));

  const fixture = { asOfDate: DEV_FIXTURE_AS_OF_DATE, cases, bankCsv, ledgerCsv, groundTruthCsv };
  validateDevFixture(fixture);
  return fixture;
}

export { composition as DEV_FIXTURE_COMPOSITION };
