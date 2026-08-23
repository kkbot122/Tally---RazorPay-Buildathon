import { bankRecordIsUnused, checkPairCompatibility } from "../compatibility/index.js";
import { parseMoneyToPaise } from "../normalization/index.js";
import { differenceInCalendarDays } from "./date-window.js";
import type { OneToManyGroupedRuleInput, OneToManyGroupedRuleResult } from "./types.js";

export function applyOneToManyGroupedRule(input: OneToManyGroupedRuleInput): OneToManyGroupedRuleResult {
  const bank = input.records.bankRecords.get(input.bankRecordId);
  if (bank === undefined || !bankRecordIsUnused(input.usedRecords, input.bankRecordId) || bank.batchId === null) {
    return { status: "NO_MATCH" };
  }

  const eligibleLedgers = [...input.records.ledgerRecords.values()]
    .filter((ledger) => ledger.batchId === bank.batchId)
    .filter((ledger) => checkPairCompatibility({
      bankRecordId: input.bankRecordId,
      ledgerRecordId: ledger.ledgerTxnId,
      records: input.records,
      usedRecords: input.usedRecords,
    }).compatible)
    .filter((ledger) => {
      const differenceDays = differenceInCalendarDays(bank.bookingDate, ledger.accountingDate);
      return differenceDays >= -1 && differenceDays <= 3;
    })
    .sort((left, right) => left.ledgerTxnId.localeCompare(right.ledgerTxnId));

  const bankAmount = parseMoneyToPaise(bank.amount);
  const qualifyingGroups: string[][] = [];
  for (const size of [2, 3] as const) {
    for (const combination of combinationsOfSize(eligibleLedgers, size)) {
      const total = combination.reduce((sum, ledger) => sum + parseMoneyToPaise(ledger.amount), 0n);
      if (total === bankAmount) {
        qualifyingGroups.push(combination.map((ledger) => ledger.ledgerTxnId).sort());
      }
    }
  }

  qualifyingGroups.sort(compareGroups);
  if (qualifyingGroups.length === 0) return { status: "NO_MATCH" };
  if (qualifyingGroups.length > 1) return { status: "AMBIGUOUS", candidateGroups: qualifyingGroups };

  return {
    status: "MATCH",
    bankRecordId: input.bankRecordId,
    ledgerRecordIds: qualifyingGroups[0]!,
    reasonCode: "GROUPED_MATCH",
  };
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
  const leftKey = left.join("\u0000");
  const rightKey = right.join("\u0000");
  return leftKey.localeCompare(rightKey);
}
