import type { UsedRecordState } from "./types.js";

export function bankRecordIsUnused(usedRecords: UsedRecordState, bankRecordId: string): boolean {
  return !usedRecords.bankRecordIds.has(bankRecordId);
}

export function ledgerRecordIsUnused(usedRecords: UsedRecordState, ledgerRecordId: string): boolean {
  return !usedRecords.ledgerRecordIds.has(ledgerRecordId);
}

export function emptyUsedRecordState(): UsedRecordState {
  return { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() };
}
