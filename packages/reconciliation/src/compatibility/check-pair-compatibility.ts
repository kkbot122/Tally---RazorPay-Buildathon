import { areCurrenciesCompatible } from "./currency-compatible.js";
import { areDirectionsCompatible } from "./direction-compatible.js";
import { bankRecordExists, ledgerRecordExists } from "./record-exists.js";
import { bankRecordIsUnused, ledgerRecordIsUnused } from "./record-unused.js";
import type { CompatibilityFailureCode, CompatibilityResult, PairCompatibilityInput } from "./types.js";

export function checkPairCompatibility(input: PairCompatibilityInput): CompatibilityResult {
  const failures: CompatibilityFailureCode[] = [];
  const bankExists = bankRecordExists(input.records, input.bankRecordId);
  const ledgerExists = ledgerRecordExists(input.records, input.ledgerRecordId);

  if (!bankExists) failures.push("BANK_RECORD_NOT_FOUND");
  if (!ledgerExists) failures.push("LEDGER_RECORD_NOT_FOUND");
  if (failures.length > 0) return result(failures);

  const bank = input.records.bankRecords.get(input.bankRecordId)!;
  const ledger = input.records.ledgerRecords.get(input.ledgerRecordId)!;

  if (!bankRecordIsUnused(input.usedRecords, input.bankRecordId)) failures.push("BANK_RECORD_ALREADY_USED");
  if (!ledgerRecordIsUnused(input.usedRecords, input.ledgerRecordId)) failures.push("LEDGER_RECORD_ALREADY_USED");
  if (!areCurrenciesCompatible(bank.currency, ledger.currency)) failures.push("CURRENCY_MISMATCH");
  if (!areDirectionsCompatible(bank.direction, ledger.direction)) failures.push("DIRECTION_MISMATCH");

  return result(failures);
}

function result(failures: CompatibilityFailureCode[]): CompatibilityResult {
  return { compatible: failures.length === 0, failures };
}
