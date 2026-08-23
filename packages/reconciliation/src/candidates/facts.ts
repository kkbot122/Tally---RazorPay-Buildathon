import { checkPairCompatibility, type RecordLookup } from "../compatibility/index.js";
import { normalizeCounterpartyForExactComparison, normalizeReference, parseMoneyToPaise } from "../normalization/index.js";
import { differenceInCalendarDays } from "../matching/date-window.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import type { CandidateFacts, CandidateSelectionTier, CandidateSignal } from "./types.js";

export function computePairFacts(
  bank: ParsedBankTransaction,
  ledger: ParsedLedgerTransaction,
): CandidateFacts {
  const rawReferenceEqual = bank.reference !== null && ledger.reference !== null && bank.reference === ledger.reference;
  const normalizedReferenceEqual = !rawReferenceEqual
    && normalizeReference(bank.reference) !== null
    && normalizeReference(bank.reference) === normalizeReference(ledger.reference);
  const bankAmount = parseMoneyToPaise(bank.amount);
  const ledgerAmount = parseMoneyToPaise(ledger.amount);
  const dateDifferenceDays = differenceInCalendarDays(bank.bookingDate, ledger.accountingDate);
  const normalizedBankCounterparty = normalizeCounterpartyForExactComparison(bank.counterparty);
  const normalizedLedgerCounterparty = normalizeCounterpartyForExactComparison(ledger.counterparty);

  return {
    rawReferenceEqual,
    normalizedReferenceEqual,
    exactAmount: bankAmount === ledgerAmount,
    amountDeltaPaise: (bankAmount - ledgerAmount).toString(),
    normalizedCounterpartyEqual: normalizedBankCounterparty !== null
      && normalizedBankCounterparty === normalizedLedgerCounterparty,
    batchIdEqual: bank.batchId !== null && ledger.batchId !== null && bank.batchId === ledger.batchId,
    dateDifferenceDays,
    dateInRuleWindow: dateDifferenceDays >= -1 && dateDifferenceDays <= 3,
  };
}

export function selectCandidateSignals(facts: CandidateFacts): CandidateSignal[] {
  const signals: CandidateSignal[] = [];
  if (facts.rawReferenceEqual) signals.push("RAW_REFERENCE_EQUAL");
  if (facts.normalizedReferenceEqual) signals.push("NORMALIZED_REFERENCE_EQUAL");
  if (facts.batchIdEqual) signals.push("BATCH_ID_EQUAL");
  if (facts.exactAmount) signals.push("EXACT_AMOUNT");
  if (facts.normalizedCounterpartyEqual) signals.push("COUNTERPARTY_EXACT_AFTER_NORMALIZATION");
  if (facts.dateInRuleWindow) signals.push("DATE_IN_RULE_WINDOW");
  return signals;
}

export function selectCandidateTier(facts: CandidateFacts): CandidateSelectionTier | null {
  if (facts.rawReferenceEqual) return "EXACT_REFERENCE";
  if (facts.normalizedReferenceEqual) return "NORMALIZED_REFERENCE";
  if (facts.batchIdEqual) return "EXACT_BATCH";
  if (facts.exactAmount && facts.normalizedCounterpartyEqual) return "AMOUNT_AND_COUNTERPARTY";
  if (facts.exactAmount && facts.dateInRuleWindow) return "AMOUNT_AND_DATE";
  if (facts.normalizedCounterpartyEqual && facts.dateInRuleWindow) return "COUNTERPARTY_AND_DATE";
  return null;
}

export function isPairHardCompatible(records: RecordLookup, bankRecordId: string, ledgerRecordId: string, usedRecords: Parameters<typeof checkPairCompatibility>[0]["usedRecords"]): boolean {
  return checkPairCompatibility({ bankRecordId, ledgerRecordId, records, usedRecords }).compatible;
}
