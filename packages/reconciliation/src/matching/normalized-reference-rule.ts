import { bankRecordIsUnused, checkPairCompatibility } from "../compatibility/index.js";
import { normalizeReference, parseMoneyToPaise } from "../normalization/index.js";
import { differenceInCalendarDays } from "./date-window.js";
import type { NormalizedReferenceRuleInput, NormalizedReferenceRuleResult } from "./types.js";

export function applyNormalizedReferenceRule(input: NormalizedReferenceRuleInput): NormalizedReferenceRuleResult {
  const bank = input.records.bankRecords.get(input.bankRecordId);
  if (bank === undefined || !bankRecordIsUnused(input.usedRecords, input.bankRecordId) || bank.reference === null) {
    return { status: "NO_MATCH" };
  }

  const normalizedBankReference = normalizeReference(bank.reference);
  if (normalizedBankReference === null) return { status: "NO_MATCH" };
  const bankAmount = parseMoneyToPaise(bank.amount);
  const qualifyingLedgerRecordIds: string[] = [];

  for (const ledger of input.records.ledgerRecords.values()) {
    if (ledger.reference === null || ledger.reference === bank.reference) continue;
    if (normalizeReference(ledger.reference) !== normalizedBankReference) continue;

    const compatibility = checkPairCompatibility({
      bankRecordId: input.bankRecordId,
      ledgerRecordId: ledger.ledgerTxnId,
      records: input.records,
      usedRecords: input.usedRecords,
    });
    if (!compatibility.compatible) continue;
    if (parseMoneyToPaise(ledger.amount) !== bankAmount) continue;

    const differenceDays = differenceInCalendarDays(bank.bookingDate, ledger.accountingDate);
    if (differenceDays < -1 || differenceDays > 3) continue;

    qualifyingLedgerRecordIds.push(ledger.ledgerTxnId);
  }

  if (qualifyingLedgerRecordIds.length === 0) return { status: "NO_MATCH" };
  qualifyingLedgerRecordIds.sort();
  if (qualifyingLedgerRecordIds.length > 1) {
    return { status: "AMBIGUOUS", candidateLedgerRecordIds: qualifyingLedgerRecordIds };
  }

  return {
    status: "MATCH",
    bankRecordId: input.bankRecordId,
    ledgerRecordId: qualifyingLedgerRecordIds[0]!,
    reasonCode: "NORMALIZED_REFERENCE_MATCH",
  };
}
