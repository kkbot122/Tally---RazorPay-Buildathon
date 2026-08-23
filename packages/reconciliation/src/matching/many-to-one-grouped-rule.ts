import { checkPairCompatibility, ledgerRecordIsUnused } from "../compatibility/index.js";
import { parseMoneyToPaise } from "../normalization/index.js";
import { differenceInCalendarDays } from "./date-window.js";
import type { ManyToOneGroupedRuleInput, ManyToOneGroupedRuleResult } from "./types.js";

export function applyManyToOneGroupedRule(input: ManyToOneGroupedRuleInput): ManyToOneGroupedRuleResult {
  const ledger = input.records.ledgerRecords.get(input.ledgerRecordId);
  if (ledger === undefined || !ledgerRecordIsUnused(input.usedRecords, input.ledgerRecordId) || ledger.batchId === null) {
    return { status: "NO_MATCH" };
  }

  const eligibleBanks = [...input.records.bankRecords.values()]
    .filter((bank) => bank.batchId === ledger.batchId)
    .filter((bank) => checkPairCompatibility({ bankRecordId: bank.bankTxnId, ledgerRecordId: input.ledgerRecordId, records: input.records, usedRecords: input.usedRecords }).compatible)
    .filter((bank) => {
      const differenceDays = differenceInCalendarDays(bank.bookingDate, ledger.accountingDate);
      return differenceDays >= -1 && differenceDays <= 3;
    })
    .sort((left, right) => left.bankTxnId.localeCompare(right.bankTxnId));

  const ledgerAmount = parseMoneyToPaise(ledger.amount);
  const qualifyingGroups: string[][] = [];
  for (const size of [2, 3] as const) {
    for (const combination of combinationsOfSize(eligibleBanks, size)) {
      const total = combination.reduce((sum, bank) => sum + parseMoneyToPaise(bank.amount), 0n);
      if (total === ledgerAmount) qualifyingGroups.push(combination.map((bank) => bank.bankTxnId).sort());
    }
  }

  qualifyingGroups.sort(compareGroups);
  if (qualifyingGroups.length === 0) return { status: "NO_MATCH" };
  if (qualifyingGroups.length > 1) return { status: "AMBIGUOUS", candidateGroups: qualifyingGroups };
  return { status: "MATCH", bankRecordIds: qualifyingGroups[0]!, ledgerRecordId: input.ledgerRecordId, reasonCode: "GROUPED_MATCH" };
}

function combinationsOfSize<T>(values: readonly T[], size: 2 | 3): T[][] {
  const combinations: T[][] = [];
  const current: T[] = [];
  function visit(start: number): void {
    if (current.length === size) {
      combinations.push([...current]);
      return;
    }
    for (let index = start; index <= values.length - (size - current.length); index += 1) {
      current.push(values[index]!);
      visit(index + 1);
      current.pop();
    }
  }
  visit(0);
  return combinations;
}

function compareGroups(left: readonly string[], right: readonly string[]): number {
  return left.join("\u0000").localeCompare(right.join("\u0000"));
}
