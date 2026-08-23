import type { FinalOutcome, ReasonCode } from "@tally/contracts";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "@tally/reconciliation";

export type BenchmarkCaseCategory =
  | "EXACT"
  | "NORMALIZED_REFERENCE"
  | "STRONG_CONTEXT"
  | "SEMANTIC"
  | "TIMING"
  | "GROUPED_ONE_TO_MANY"
  | "GROUPED_MANY_TO_ONE"
  | "DISCREPANCY"
  | "AMBIGUOUS"
  | "NO_CANDIDATE";

export type TrueFinancialEvent = {
  amount: string;
  currency: "INR";
  direction: "CREDIT" | "DEBIT";
  counterpartyEntityId: string;
  canonicalCounterpartyName: string;
  canonicalReference: string;
  baseDate: string;
};

export type TimingEvidence = {
  asOfDate: string;
  accountingDate: string;
  expectedDate: string;
};

export const BENCHMARK_AS_OF_DATE = "2026-10-01";

export type BenchmarkTruth = {
  bankRecordIds: string[];
  ledgerRecordIds: string[];
  plausibleLedgerRecordIds?: string[];
  timingEvidence?: TimingEvidence;
  financialEvent: TrueFinancialEvent;
};

export type BenchmarkCase = {
  caseId: string;
  category: BenchmarkCaseCategory;
  expectedOutcome: FinalOutcome;
  reasonCode: ReasonCode;
  bankTransactions: ParsedBankTransaction[];
  ledgerTransactions: ParsedLedgerTransaction[];
  truth: BenchmarkTruth;
  notes?: string;
};

export type GenerateCaseInput = {
  caseId: string;
  category: BenchmarkCaseCategory;
};

export type BenchmarkGenerator = {
  generateCase(input: GenerateCaseInput): BenchmarkCase;
};
