import type { AgentProposal } from "@tally/contracts";

import { differenceInCalendarDays } from "../matching/index.js";
import { parseMoneyToPaise } from "../normalization/index.js";
import { checkPairCompatibility, type RecordLookup } from "../compatibility/index.js";
import type { CandidatePrimary, CandidateSet } from "../candidates/index.js";
import type { MatchVerificationFailure } from "./types.js";
import type {
  NonMatchReasonCode,
  NonMatchVerificationResult,
  VerifyNonMatchProposalInput,
} from "./non-match-types.js";

export function verifyNonMatchProposal(input: VerifyNonMatchProposalInput): NonMatchVerificationResult {
  const { proposal, primary, candidateSet, records } = input;
  if (proposal.proposedOutcome === "MATCH") {
    return rejected({ code: "NOT_RECONCILED_PROPOSAL", message: "MATCH proposals are verified by T020, not T021." });
  }

  const structuralFailures = validateStructure(input);
  if (structuralFailures.length > 0) return rejected(...structuralFailures);

  if (hasUsedRecord(input)) return verified("DISCREPANCY", "DUPLICATE_USAGE", proposal);

  if (proposal.proposedOutcome === "TIMING_DIFFERENCE") return verifyTiming(input);
  if (proposal.proposedOutcome === "DISCREPANCY") return verifyDiscrepancy(input);
  return verifyUnresolved(input);
}

function validateStructure(input: VerifyNonMatchProposalInput): MatchVerificationFailure[] {
  const { proposal, primary, candidateSet, records } = input;
  const failures: MatchVerificationFailure[] = [];
  addDuplicateFailure(failures, "bank", proposal.bankRecordIds);
  addDuplicateFailure(failures, "ledger", proposal.ledgerRecordIds);

  const allowed = allowedIds(primary, candidateSet);
  const proposed = [
    ...proposal.bankRecordIds.map((recordId) => ({ side: "BANK" as const, recordId })),
    ...proposal.ledgerRecordIds.map((recordId) => ({ side: "LEDGER" as const, recordId })),
  ];
  for (const item of proposed) {
    const exists = item.side === "BANK" ? records.bankRecords.has(item.recordId) : records.ledgerRecords.has(item.recordId);
    if (!exists) failures.push({ code: "UNKNOWN_RECORD", message: `${item.side} record does not exist: ${item.recordId}`, recordIds: [item.recordId] });
    else if (!allowed[item.side].has(item.recordId)) failures.push({ code: "OUT_OF_CONTEXT_RECORD", message: `${item.side} record was not supplied to the model: ${item.recordId}`, recordIds: [item.recordId] });
  }

  if (primary.side === "BANK" && !proposal.bankRecordIds.includes(primary.recordId)) failures.push({ code: "PRIMARY_NOT_INCLUDED", message: `Primary bank record is missing: ${primary.recordId}`, recordIds: [primary.recordId] });
  if (primary.side === "LEDGER" && !proposal.ledgerRecordIds.includes(primary.recordId)) failures.push({ code: "PRIMARY_NOT_INCLUDED", message: `Primary ledger record is missing: ${primary.recordId}`, recordIds: [primary.recordId] });

  if (proposal.proposedOutcome === "DISCREPANCY" && !isAllowedShape(proposal.bankRecordIds.length, proposal.ledgerRecordIds.length)) {
    failures.push({ code: "INVALID_RELATIONSHIP_SHAPE", message: "Only 1↔1, 1↔2/3, and 2/3↔1 relationships are supported." });
  }
  if (proposal.proposedOutcome === "TIMING_DIFFERENCE" && (primary.side !== "LEDGER" || proposal.bankRecordIds.length !== 0 || proposal.ledgerRecordIds.length !== 1 || proposal.ledgerRecordIds[0] !== primary.recordId)) {
    failures.push({ code: "INVALID_RELATIONSHIP_SHAPE", message: "Current timing verification requires the primary ledger record only." });
  }
  return failures;
}

function verifyTiming(input: VerifyNonMatchProposalInput): NonMatchVerificationResult {
  const { proposal, primary, records, runContext } = input;
  const ledger = records.ledgerRecords.get(primary.recordId);
  if (ledger?.maturityDate === null || ledger === undefined) return unsupported(input);
  const isFuture = differenceInCalendarDays(ledger.maturityDate, runContext.asOfDate) > 0;
  return isFuture && hasEvidence(proposal)
    ? verified("EXPLAINED_OUTSTANDING", "TIMING_DIFFERENCE", proposal)
    : unsupported(input);
}

function verifyDiscrepancy(input: VerifyNonMatchProposalInput): NonMatchVerificationResult {
  const { proposal, records, usedRecords } = input;
  const bankRecords = proposal.bankRecordIds.map((id) => records.bankRecords.get(id)!);
  const ledgerRecords = proposal.ledgerRecordIds.map((id) => records.ledgerRecords.get(id)!);
  let hardConflict = false;
  for (const bank of bankRecords) {
    for (const ledger of ledgerRecords) {
      const compatibility = checkPairCompatibility({ bankRecordId: bank.bankTxnId, ledgerRecordId: ledger.ledgerTxnId, records, usedRecords });
      if (compatibility.failures.includes("CURRENCY_MISMATCH") || compatibility.failures.includes("DIRECTION_MISMATCH")) hardConflict = true;
    }
  }
  if (hardConflict) return verified("DISCREPANCY", "CONFLICTING_RECORDS", proposal);

  try {
    const bankTotal = bankRecords.reduce((total, record) => total + parseMoneyToPaise(record.amount), 0n);
    const ledgerTotal = ledgerRecords.reduce((total, record) => total + parseMoneyToPaise(record.amount), 0n);
    const amountDeltaPaise = (bankTotal - ledgerTotal).toString();
    if (bankTotal !== ledgerTotal) return verified("DISCREPANCY", "AMOUNT_DISCREPANCY", proposal, amountDeltaPaise);
  } catch {
    return unsupported(input);
  }

  return hasEvidence(proposal) && hasConflictingEvidence(proposal)
    ? verified("DISCREPANCY", "CONFLICTING_RECORDS", proposal, "0")
    : unsupported(input);
}

function hasUsedRecord(input: VerifyNonMatchProposalInput): boolean {
  return input.proposal.bankRecordIds.some((id) => input.usedRecords.bankRecordIds.has(id))
    || input.proposal.ledgerRecordIds.some((id) => input.usedRecords.ledgerRecordIds.has(id));
}

function verifyUnresolved(input: VerifyNonMatchProposalInput): NonMatchVerificationResult {
  const { proposal, candidateSet, reasoningContext } = input;
  let reasonCode: NonMatchReasonCode = "INSUFFICIENT_EVIDENCE";
  if (candidateSet.candidates.length === 0) reasonCode = "NO_CANDIDATE";
  else if (reasoningContext?.deterministicReason !== undefined || proposedCandidateCount(proposal, input.primary) > 1) reasonCode = "MULTIPLE_PLAUSIBLE_CANDIDATES";
  return verified("UNRESOLVED", reasonCode, proposal);
}

function unsupported(input: VerifyNonMatchProposalInput): NonMatchVerificationResult {
  return verified("UNRESOLVED", "VERIFICATION_FAILED", input.proposal);
}

function verified(outcome: "EXPLAINED_OUTSTANDING" | "DISCREPANCY" | "UNRESOLVED", reasonCode: NonMatchReasonCode, proposal: AgentProposal, amountDeltaPaise?: string): NonMatchVerificationResult {
  return { status: "VERIFIED", outcome, reasonCode, bankRecordIds: [...proposal.bankRecordIds], ledgerRecordIds: [...proposal.ledgerRecordIds], ...(amountDeltaPaise === undefined ? {} : { amountDeltaPaise }) };
}

function allowedIds(primary: CandidatePrimary, candidateSet: CandidateSet): { BANK: Set<string>; LEDGER: Set<string> } {
  const candidateIds = new Set(candidateSet.candidates.map((candidate) => candidate.recordId));
  return primary.side === "BANK" ? { BANK: new Set([primary.recordId]), LEDGER: candidateIds } : { BANK: candidateIds, LEDGER: new Set([primary.recordId]) };
}

function addDuplicateFailure(failures: MatchVerificationFailure[], side: "bank" | "ledger", ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) failures.push({ code: "DUPLICATE_RECORD_ID", message: `Duplicate ${side} record IDs are not allowed.`, recordIds: [...ids] });
}

function isAllowedShape(bankCount: number, ledgerCount: number): boolean {
  return (bankCount === 1 && ledgerCount >= 1 && ledgerCount <= 3) || (ledgerCount === 1 && bankCount >= 1 && bankCount <= 3);
}

function hasEvidence(proposal: AgentProposal): boolean {
  return proposal.evidence.some((item) => item.statement.trim().length > 0);
}

function hasConflictingEvidence(proposal: AgentProposal): boolean {
  return proposal.conflictingEvidence.some((item) => item.statement.trim().length > 0);
}

function proposedCandidateCount(proposal: AgentProposal, primary: CandidatePrimary): number {
  return primary.side === "BANK"
    ? proposal.ledgerRecordIds.length
    : proposal.bankRecordIds.length;
}

function rejected(...failures: MatchVerificationFailure[]): NonMatchVerificationResult {
  return { status: "REJECTED", failures };
}
