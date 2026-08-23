import { BENCHMARK_AS_OF_DATE, type BenchmarkCase } from "../generator/index.js";

export const DEV_FIXTURE_SEED = 20260823;
export const DEV_FIXTURE_AS_OF_DATE = BENCHMARK_AS_OF_DATE;

export const BANK_HEADERS = [
  "bank_txn_id",
  "booking_date",
  "value_date",
  "amount",
  "currency",
  "direction",
  "reference",
  "counterparty",
  "description",
  "batch_id",
] as const;

export const LEDGER_HEADERS = [
  "ledger_txn_id",
  "accounting_date",
  "maturity_date",
  "amount",
  "currency",
  "direction",
  "reference",
  "counterparty",
  "description",
  "source",
  "batch_id",
] as const;

export const GROUND_TRUTH_HEADERS = [
  "case_id",
  "bank_record_ids",
  "ledger_record_ids",
  "expected_outcome",
  "reason_code",
  "notes",
] as const;

export type DevFixture = {
  asOfDate: string;
  cases: BenchmarkCase[];
  bankCsv: string;
  ledgerCsv: string;
  groundTruthCsv: string;
};
