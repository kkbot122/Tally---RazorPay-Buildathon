import { checkPairCompatibility } from "../compatibility/index.js";
import { bankRecordIsUnused } from "../compatibility/index.js";
import { parseMoneyToPaise } from "../normalization/index.js";
import type { ExactReferenceRuleInput, ExactReferenceRuleResult } from "./types.js";

export function applyExactReferenceRule(input: ExactReferenceRuleInput): ExactReferenceRuleResult {
  const bank = input.records.bankRecords.get(input.bankRecordId);
  if (bank === undefined || !bankRecordIsUnused(input.usedRecords, input.bankRecordId) || bank.reference === null) {
    return { status: "NO_MATCH" };
  }

  const bankAmount = parseMoneyToPaise(bank.amount);
  const qualifyingLedgerRecordIds: string[] = [];

  for (const ledger of input.records.ledgerRecords.values()) {
    if (ledger.reference === null || ledger.reference !== bank.reference) continue;

    const compatibility = checkPairCompatibility({
      bankRecordId: input.bankRecordId,
      ledgerRecordId: ledger.ledgerTxnId,
      records: input.records,
      usedRecords: input.usedRecords,
    });
    if (!compatibility.compatible) continue;
    if (parseMoneyToPaise(ledger.amount) !== bankAmount) continue;

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
    reasonCode: "EXACT_MATCH",
  };
}
