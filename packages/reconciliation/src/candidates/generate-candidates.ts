import { emptyUsedRecordState } from "../compatibility/index.js";
import { MAX_CANDIDATES_PER_PRIMARY } from "./constants.js";
import { computePairFacts, isPairHardCompatible, selectCandidateSignals, selectCandidateTier } from "./facts.js";
import type { CandidateRecord, CandidateSet, GenerateCandidatesInput } from "./types.js";

const TIER_ORDER = new Map([
  ["EXACT_REFERENCE", 0],
  ["NORMALIZED_REFERENCE", 1],
  ["EXACT_BATCH", 2],
  ["AMOUNT_AND_COUNTERPARTY", 3],
  ["AMOUNT_AND_DATE", 4],
  ["COUNTERPARTY_AND_DATE", 5],
]);

export function generateCandidates(input: GenerateCandidatesInput): CandidateSet {
  const usedRecords = input.usedRecords ?? emptyUsedRecordState();
  const primaryRecordExists = input.primary.side === "BANK"
    ? input.records.bankRecords.has(input.primary.recordId)
    : input.records.ledgerRecords.has(input.primary.recordId);
  const primaryUsed = input.primary.side === "BANK"
    ? usedRecords.bankRecordIds.has(input.primary.recordId)
    : usedRecords.ledgerRecordIds.has(input.primary.recordId);

  if (!primaryRecordExists || primaryUsed) return emptyCandidateSet(input);

  const required = new Set(input.requiredCandidateIds ?? []);
  const qualifying: CandidateRecord[] = [];

  if (input.primary.side === "BANK") {
    const bank = input.records.bankRecords.get(input.primary.recordId)!;
    const ledgers = [...input.records.ledgerRecords.values()].sort((left, right) => left.ledgerTxnId.localeCompare(right.ledgerTxnId));
    for (const ledger of ledgers) addCandidate(bank, ledger, "LEDGER", ledger.ledgerTxnId);
  } else {
    const ledger = input.records.ledgerRecords.get(input.primary.recordId)!;
    const banks = [...input.records.bankRecords.values()].sort((left, right) => left.bankTxnId.localeCompare(right.bankTxnId));
    for (const bank of banks) addCandidate(bank, ledger, "BANK", bank.bankTxnId);
  }

  function addCandidate(
    bank: Parameters<typeof computePairFacts>[0],
    ledger: Parameters<typeof computePairFacts>[1],
    side: "BANK" | "LEDGER",
    recordId: string,
  ): void {
    if (!isPairHardCompatible(input.records, bank.bankTxnId, ledger.ledgerTxnId, usedRecords)) return;
    const facts = computePairFacts(bank, ledger);
    const tier = selectCandidateTier(facts);
    if (tier === null) return;
    qualifying.push({ side, recordId, selectionTier: tier, signals: selectCandidateSignals(facts), facts });
  }

  qualifying.sort((left, right) => {
    const tierDifference = TIER_ORDER.get(left.selectionTier)! - TIER_ORDER.get(right.selectionTier)!;
    if (tierDifference !== 0) return tierDifference;
    const dateDifference = Math.abs(left.facts.dateDifferenceDays) - Math.abs(right.facts.dateDifferenceDays);
    return dateDifference !== 0 ? dateDifference : left.recordId.localeCompare(right.recordId);
  });

  const requiredCandidates = qualifying.filter((candidate) => required.has(candidate.recordId));
  const optionalCandidates = qualifying.filter((candidate) => !required.has(candidate.recordId));
  // Required IDs are prioritized, but the shortlist remains bounded. T016
  // metadata cannot turn the candidate cap into an unbounded allocation.
  const selected = [...requiredCandidates, ...optionalCandidates]
    .slice(0, MAX_CANDIDATES_PER_PRIMARY);
  selected.sort((left, right) => {
    const tierDifference = TIER_ORDER.get(left.selectionTier)! - TIER_ORDER.get(right.selectionTier)!;
    if (tierDifference !== 0) return tierDifference;
    const dateDifference = Math.abs(left.facts.dateDifferenceDays) - Math.abs(right.facts.dateDifferenceDays);
    return dateDifference !== 0 ? dateDifference : left.recordId.localeCompare(right.recordId);
  });

  return {
    primary: input.primary,
    candidates: selected,
    totalEligibleCandidates: qualifying.length,
    truncated: selected.length < qualifying.length,
  };
}

function emptyCandidateSet(input: GenerateCandidatesInput): CandidateSet {
  return { primary: input.primary, candidates: [], totalEligibleCandidates: 0, truncated: false };
}
