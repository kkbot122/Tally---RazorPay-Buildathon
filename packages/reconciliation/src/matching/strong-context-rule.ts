import { bankRecordIsUnused, checkPairCompatibility } from "../compatibility/index.js";
import { normalizeCounterpartyForExactComparison, normalizeReference, parseMoneyToPaise } from "../normalization/index.js";
import { differenceInCalendarDays } from "./date-window.js";
import type { StrongContextRuleInput, StrongContextRuleResult } from "./types.js";

export function applyStrongContextRule(input: StrongContextRuleInput): StrongContextRuleResult {
  const bank = input.records.bankRecords.get(input.bankRecordId);
  if (bank === undefined || !bankRecordIsUnused(input.usedRecords, input.bankRecordId) || bank.counterparty === null) {
    return { status: "NO_MATCH" };
  }

  const normalizedBankCounterparty = normalizeCounterpartyForExactComparison(bank.counterparty);
  if (normalizedBankCounterparty === null) return { status: "NO_MATCH" };
  const bankAmount = parseMoneyToPaise(bank.amount);
  const qualifyingLedgerRecordIds: string[] = [];

  for (const ledger of input.records.ledgerRecords.values()) {
    if (isOwnedByEarlierReferenceRule(bank.reference, ledger.reference)) continue;
    if (ledger.counterparty === null) continue;
    if (normalizeCounterpartyForExactComparison(ledger.counterparty) !== normalizedBankCounterparty) continue;

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
    reasonCode: "COUNTERPARTY_MATCH",
  };
}

function isOwnedByEarlierReferenceRule(bankReference: string | null, ledgerReference: string | null): boolean {
  if (bankReference === null || ledgerReference === null) return false;
  if (bankReference === ledgerReference) return true;

  const normalizedBankReference = normalizeReference(bankReference);
  const normalizedLedgerReference = normalizeReference(ledgerReference);
  return normalizedBankReference !== null && normalizedBankReference === normalizedLedgerReference;
}
