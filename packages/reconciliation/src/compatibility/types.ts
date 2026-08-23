import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";

export type CompatibilityFailureCode =
  | "BANK_RECORD_NOT_FOUND"
  | "LEDGER_RECORD_NOT_FOUND"
  | "BANK_RECORD_ALREADY_USED"
  | "LEDGER_RECORD_ALREADY_USED"
  | "CURRENCY_MISMATCH"
  | "DIRECTION_MISMATCH";

export type CompatibilityResult = {
  compatible: boolean;
  failures: CompatibilityFailureCode[];
};

export type UsedRecordState = {
  bankRecordIds: ReadonlySet<string>;
  ledgerRecordIds: ReadonlySet<string>;
};

export type RecordLookup = {
  bankRecords: ReadonlyMap<string, ParsedBankTransaction>;
  ledgerRecords: ReadonlyMap<string, ParsedLedgerTransaction>;
};

export type PairCompatibilityInput = {
  bankRecordId: string;
  ledgerRecordId: string;
  records: RecordLookup;
  usedRecords: UsedRecordState;
};
