import { parseBankCsv, parseLedgerCsv } from "@tally/reconciliation";

import type { DevFixture } from "./types.js";
import { DEV_FIXTURE_AS_OF_DATE } from "./types.js";

const forbiddenInputHeaders = new Set(["case_id", "category", "expected_outcome", "reason_code", "true_match", "ground_truth"]);

export function validateDevFixture(fixture: DevFixture): void {
  assert(fixture.cases.length === 20, "fixture must contain exactly 20 cases");
  assert(fixture.asOfDate === DEV_FIXTURE_AS_OF_DATE, "fixture as-of date is not the frozen development date");

  const caseIds = fixture.cases.map((benchmarkCase) => benchmarkCase.caseId);
  const bankIds = fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions.map((record) => record.bankTxnId));
  const ledgerIds = fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions.map((record) => record.ledgerTxnId));
  assertUnique(caseIds, "case IDs");
  assertUnique(bankIds, "bank IDs");
  assertUnique(ledgerIds, "ledger IDs");

  const parsedBank = parseBankCsv(fixture.bankCsv);
  const parsedLedger = parseLedgerCsv(fixture.ledgerCsv);
  assert(parsedBank.length === bankIds.length, "bank CSV record count differs from generated records");
  assert(parsedLedger.length === ledgerIds.length, "ledger CSV record count differs from generated records");
  assert(![...parsedBank, ...parsedLedger].some((record) => Object.keys(record).some((key) => forbiddenInputHeaders.has(key))), "truth metadata leaked into runtime records");

  const parsedBankIds = new Set(parsedBank.map((record) => record.bankTxnId));
  const parsedLedgerIds = new Set(parsedLedger.map((record) => record.ledgerTxnId));
  for (const benchmarkCase of fixture.cases) {
    for (const bankId of benchmarkCase.truth.bankRecordIds) assert(parsedBankIds.has(bankId), `missing ground-truth bank ID ${bankId}`);
    for (const ledgerId of benchmarkCase.truth.ledgerRecordIds) assert(parsedLedgerIds.has(ledgerId), `missing ground-truth ledger ID ${ledgerId}`);
    if (benchmarkCase.category === "TIMING") {
      assert(benchmarkCase.truth.timingEvidence !== undefined, "timing evidence is required");
      assert(benchmarkCase.truth.timingEvidence.asOfDate === fixture.asOfDate, "timing evidence must use the fixture as-of date");
    }
    if (benchmarkCase.category === "AMBIGUOUS") assert((benchmarkCase.truth.plausibleLedgerRecordIds?.length ?? 0) >= 2, "ambiguous alternatives are required");
    if (benchmarkCase.category === "GROUPED_ONE_TO_MANY") assert(benchmarkCase.ledgerTransactions.length <= 3, "one-to-many group is too large");
    if (benchmarkCase.category === "GROUPED_MANY_TO_ONE") assert(benchmarkCase.bankTransactions.length <= 3, "many-to-one group is too large");
  }

  const outcomes = new Set(fixture.cases.map((benchmarkCase) => benchmarkCase.expectedOutcome));
  assert(outcomes.size === 4, "all final outcomes must be represented");
  assert(new Set(fixture.cases.map((benchmarkCase) => benchmarkCase.category)).size === 10, "all categories must be represented");

  const caseAmounts = new Map<string, number>();
  for (const benchmarkCase of fixture.cases) {
    const amount = benchmarkCase.truth.financialEvent.amount;
    caseAmounts.set(amount, (caseAmounts.get(amount) ?? 0) + 1);
  }
  assert([...caseAmounts.values()].filter((count) => count > 1).length >= 3, "at least three amounts must repeat across cases");
}

function assertUnique(values: readonly string[], label: string): void {
  assert(new Set(values).size === values.length, `${label} must be unique`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid dev fixture: ${message}`);
}
