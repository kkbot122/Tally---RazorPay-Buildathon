import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import type { RecordLookup } from "./types.js";

export function createRecordLookup(
  bankRecords: readonly ParsedBankTransaction[],
  ledgerRecords: readonly ParsedLedgerTransaction[],
): RecordLookup {
  return {
    bankRecords: toUniqueMap(bankRecords, "bankTxnId", "bank"),
    ledgerRecords: toUniqueMap(ledgerRecords, "ledgerTxnId", "ledger"),
  };
}

function toUniqueMap<T extends { [key in K]: string }, K extends "bankTxnId" | "ledgerTxnId">(
  records: readonly T[],
  key: K,
  label: string,
): ReadonlyMap<string, T> {
  const result = new Map<string, T>();
  for (const record of records) {
    const id = record[key];
    if (result.has(id)) throw new Error(`Duplicate ${label} record ID "${id}"`);
    result.set(id, record);
  }
  return result;
}
