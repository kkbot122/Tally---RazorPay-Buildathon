import { ReasonCodeSchema, FinalOutcomeSchema } from "@tally/contracts";
import { BankTransactionSchema, LedgerTransactionSchema } from "@tally/contracts";

import { cents } from "./helpers.js";
import type { BenchmarkCase, BenchmarkCaseCategory } from "./types.js";

const categories: readonly BenchmarkCaseCategory[] = [
  "EXACT", "NORMALIZED_REFERENCE", "STRONG_CONTEXT", "SEMANTIC", "TIMING",
  "GROUPED_ONE_TO_MANY", "GROUPED_MANY_TO_ONE", "DISCREPANCY", "AMBIGUOUS", "NO_CANDIDATE",
];

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid benchmark case: ${message}`);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateBenchmarkCase(benchmarkCase: BenchmarkCase): BenchmarkCase {
  assert(benchmarkCase.caseId.trim().length > 0, "caseId is required");
  assert(categories.includes(benchmarkCase.category), "category is invalid");
  assert(FinalOutcomeSchema.safeParse(benchmarkCase.expectedOutcome).success, "expected outcome is invalid");
  assert(ReasonCodeSchema.safeParse(benchmarkCase.reasonCode).success, "reason code is invalid");

  const bankIds = benchmarkCase.bankTransactions.map((record) => record.bankTxnId);
  const ledgerIds = benchmarkCase.ledgerTransactions.map((record) => record.ledgerTxnId);
  assert(unique(bankIds) && unique(ledgerIds), "transaction IDs must be unique within each source");
  assert(benchmarkCase.bankTransactions.every((record) => BankTransactionSchema.safeParse({ ...record, amount: BigInt(cents(record.amount)), reference: record.reference ?? "BENCHMARK", counterparty: record.counterparty ?? "BENCHMARK", description: record.description ?? "BENCHMARK", batchId: record.batchId ?? "BENCHMARK" }).success), "bank records must be structurally valid after pre-normalization adaptation");
  assert(benchmarkCase.ledgerTransactions.every((record) => LedgerTransactionSchema.safeParse({ ...record, amount: BigInt(cents(record.amount)), batchId: record.batchId ?? "BENCHMARK", maturityDate: record.maturityDate ?? record.accountingDate, reference: record.reference ?? "BENCHMARK", counterparty: record.counterparty ?? "BENCHMARK", description: record.description ?? "BENCHMARK" }).success), "ledger records must be structurally valid after pre-normalization adaptation");
  assert([...benchmarkCase.bankTransactions, ...benchmarkCase.ledgerTransactions].every((record) => record.currency === "INR"), "currency must be INR");
  assert(unique(benchmarkCase.truth.bankRecordIds) && unique(benchmarkCase.truth.ledgerRecordIds), "truth IDs must be unique");

  switch (benchmarkCase.category) {
    case "EXACT":
    case "NORMALIZED_REFERENCE":
    case "STRONG_CONTEXT":
    case "SEMANTIC":
    case "DISCREPANCY":
      assert(benchmarkCase.reasonCode === "DUPLICATE_USAGE"
        ? benchmarkCase.bankTransactions.length === 2 && benchmarkCase.ledgerTransactions.length === 2 && benchmarkCase.truth.bankRecordIds.length === 1 && benchmarkCase.truth.ledgerRecordIds.length === 1
        : benchmarkCase.bankTransactions.length === 1 && benchmarkCase.ledgerTransactions.length === 1, "category requires supported cardinality");
      break;
    case "TIMING":
      assert(benchmarkCase.expectedOutcome === "EXPLAINED_OUTSTANDING", "timing outcome is incorrect");
      assert(benchmarkCase.truth.timingEvidence !== undefined, "timing evidence is required");
      assert(benchmarkCase.bankTransactions.length === 0, "timing case must have no current bank counterpart");
      assert(benchmarkCase.truth.timingEvidence.expectedDate > benchmarkCase.truth.timingEvidence.asOfDate, "timing maturity must be after the run as-of date");
      assert(benchmarkCase.truth.timingEvidence.accountingDate < benchmarkCase.truth.timingEvidence.asOfDate, "timing accounting date must be before the run as-of date");
      break;
    case "GROUPED_ONE_TO_MANY":
      assert(benchmarkCase.bankTransactions.length === 1 && [2, 3].includes(benchmarkCase.ledgerTransactions.length), "one-to-many group size must be 2 or 3");
      assert(total(benchmarkCase.bankTransactions.map((record) => record.amount)) === total(benchmarkCase.ledgerTransactions.map((record) => record.amount)), "group totals must balance");
      break;
    case "GROUPED_MANY_TO_ONE":
      assert([2, 3].includes(benchmarkCase.bankTransactions.length) && benchmarkCase.ledgerTransactions.length === 1, "many-to-one group size must be 2 or 3");
      assert(total(benchmarkCase.bankTransactions.map((record) => record.amount)) === total(benchmarkCase.ledgerTransactions.map((record) => record.amount)), "group totals must balance");
      break;
    case "AMBIGUOUS":
      assert(benchmarkCase.expectedOutcome === "UNRESOLVED", "ambiguous outcome is incorrect");
      assert(benchmarkCase.ledgerTransactions.length >= 2, "ambiguous case needs at least two candidates");
      assert((benchmarkCase.truth.plausibleLedgerRecordIds?.length ?? 0) >= 2, "ambiguous truth needs plausible candidates");
      assert(benchmarkCase.truth.ledgerRecordIds.length === 0, "ambiguous truth must not expose a resolved ledger ID");
      break;
    case "NO_CANDIDATE":
      assert(benchmarkCase.expectedOutcome === "UNRESOLVED", "no-candidate outcome is incorrect");
      assert(benchmarkCase.bankTransactions.length === 1 && benchmarkCase.ledgerTransactions.length === 0, "no-candidate case must have no counterpart");
      break;
  }

  if (benchmarkCase.category === "SEMANTIC") {
    const bank = benchmarkCase.bankTransactions[0];
    const ledger = benchmarkCase.ledgerTransactions[0];
    assert(bank !== undefined && ledger !== undefined, "semantic records are required");
    assert(bank.reference !== ledger.reference || bank.counterparty !== ledger.counterparty || bank.description !== ledger.description, "semantic case must not be textually exact");
  }

  if (benchmarkCase.category === "DISCREPANCY") {
    if (benchmarkCase.reasonCode === "AMOUNT_DISCREPANCY") {
      assert(benchmarkCase.bankTransactions[0]?.amount !== benchmarkCase.ledgerTransactions[0]?.amount, "amount discrepancy records must differ in amount");
    } else if (benchmarkCase.reasonCode === "DUPLICATE_USAGE") {
      assert(benchmarkCase.bankTransactions.every((record) => record.amount === benchmarkCase.ledgerTransactions[0]?.amount), "duplicate usage records must remain financially compatible");
      assert(benchmarkCase.bankTransactions.every((record) => record.reference === null && record.counterparty === "Duplicate Usage Holdings"), "duplicate usage bank evidence must be intentionally ambiguous");
    } else {
      assert(benchmarkCase.bankTransactions[0]?.amount === benchmarkCase.ledgerTransactions[0]?.amount, "conflicting records retain the same amount");
      assert(benchmarkCase.bankTransactions[0]?.direction === benchmarkCase.ledgerTransactions[0]?.direction, "conflicting records must retain the same direction");
      assert(benchmarkCase.bankTransactions[0]?.reference !== benchmarkCase.ledgerTransactions[0]?.reference, "conflicting records must differ in reference evidence");
    }
  }

  return benchmarkCase;
}

function total(amounts: readonly string[]): number {
  return amounts.reduce((sum, amount) => sum + cents(amount), 0);
}
