import type { RecordLookup } from "./types.js";

export function bankRecordExists(records: RecordLookup, bankRecordId: string): boolean {
  return records.bankRecords.has(bankRecordId);
}

export function ledgerRecordExists(records: RecordLookup, ledgerRecordId: string): boolean {
  return records.ledgerRecords.has(ledgerRecordId);
}
