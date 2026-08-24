import { AgentProposalSchema, type AgentProposal } from "@tally/contracts";

import { parseMoneyToPaise } from "../normalization/index.js";
import { checkPairCompatibility, type RecordLookup, type UsedRecordState } from "../compatibility/index.js";
import type { CandidatePrimary, CandidateSet } from "../candidates/index.js";
import type {
  MatchVerificationFailure,
  MatchVerificationResult,
  VerifyMatchProposalInput,
} from "./types.js";

export function verifyMatchProposal(input: VerifyMatchProposalInput): MatchVerificationResult {
  const { proposal, primary, candidateSet, records, usedRecords } = input;
  const failures: MatchVerificationFailure[] = [];

  if (proposal.proposedOutcome !== "MATCH") {
    return rejected({ code: "NOT_RECONCILED_PROPOSAL", message: "Only MATCH proposals are verified by T020." });
  }

  addDuplicateFailures(failures, "bank", proposal.bankRecordIds);
  addDuplicateFailures(failures, "ledger", proposal.ledgerRecordIds);

  const allowed = allowedIds(primary, candidateSet);
  const allProposed = [
    ...proposal.bankRecordIds.map((recordId) => ({ side: "BANK" as const, recordId })),
    ...proposal.ledgerRecordIds.map((recordId) => ({ side: "LEDGER" as const, recordId })),
  ];
  for (const proposed of allProposed) {
    const exists = proposed.side === "BANK"
      ? records.bankRecords.has(proposed.recordId)
      : records.ledgerRecords.has(proposed.recordId);
    if (!exists) {
      failures.push({ code: "UNKNOWN_RECORD", message: `${proposed.side} record does not exist: ${proposed.recordId}`, recordIds: [proposed.recordId] });
    } else if (!allowed[proposed.side].has(proposed.recordId)) {
      failures.push({ code: "OUT_OF_CONTEXT_RECORD", message: `${proposed.side} record was not supplied to the model: ${proposed.recordId}`, recordIds: [proposed.recordId] });
    }
  }

  if (primary.side === "BANK" && !proposal.bankRecordIds.includes(primary.recordId)) {
    failures.push({ code: "PRIMARY_NOT_INCLUDED", message: `Primary bank record is missing: ${primary.recordId}`, recordIds: [primary.recordId] });
  }
  if (primary.side === "LEDGER" && !proposal.ledgerRecordIds.includes(primary.recordId)) {
    failures.push({ code: "PRIMARY_NOT_INCLUDED", message: `Primary ledger record is missing: ${primary.recordId}`, recordIds: [primary.recordId] });
  }

  if (!isAllowedShape(proposal.bankRecordIds.length, proposal.ledgerRecordIds.length)) {
    failures.push({ code: "INVALID_RELATIONSHIP_SHAPE", message: "Only 1↔1, 1↔2/3, and 2/3↔1 relationships are supported." });
  }

  if (!hasNonEmptyEvidence(proposal)) {
    failures.push({ code: "INSUFFICIENT_EVIDENCE", message: "A MATCH proposal requires non-empty supporting evidence." });
  }
  if (!hasStructuredNonAmountEvidence(proposal, primary, candidateSet)) {
    failures.push({ code: "INSUFFICIENT_EVIDENCE", message: "A difficult MATCH proposal requires supplied evidence beyond amount equality." });
  }
  if (proposal.conflictingEvidence.length > 0) {
    failures.push({ code: "CONFLICTING_EVIDENCE", message: "A MATCH proposal cannot contain conflicting evidence." });
  }

  const bankRecords = proposal.bankRecordIds.map((recordId) => records.bankRecords.get(recordId));
  const ledgerRecords = proposal.ledgerRecordIds.map((recordId) => records.ledgerRecords.get(recordId));
  if (bankRecords.some((record) => record === undefined) || ledgerRecords.some((record) => record === undefined)) {
    return rejected(...failures);
  }

  const concreteBanks = bankRecords as NonNullable<typeof bankRecords[number]>[];
  const concreteLedgers = ledgerRecords as NonNullable<typeof ledgerRecords[number]>[];
  const proposedBankIds = proposal.bankRecordIds;
  const proposedLedgerIds = proposal.ledgerRecordIds;

  for (const bank of concreteBanks) {
    for (const ledger of concreteLedgers) {
      const compatibility = checkPairCompatibility({
        bankRecordId: bank.bankTxnId,
        ledgerRecordId: ledger.ledgerTxnId,
        records,
        usedRecords,
      });
      if (compatibility.failures.includes("BANK_RECORD_ALREADY_USED") || compatibility.failures.includes("LEDGER_RECORD_ALREADY_USED")) {
        failures.push({ code: "RECORD_ALREADY_USED", message: "A proposed record is already committed.", recordIds: [bank.bankTxnId, ledger.ledgerTxnId] });
      }
      if (compatibility.failures.some((failure) => failure === "CURRENCY_MISMATCH" || failure === "DIRECTION_MISMATCH")) {
        failures.push({ code: "HARD_COMPATIBILITY_FAILED", message: "A proposed bank/ledger pair violates currency or direction compatibility.", recordIds: [bank.bankTxnId, ledger.ledgerTxnId] });
      }
    }
  }

  try {
    const bankTotal = concreteBanks.reduce((total, bank) => total + parseMoneyToPaise(bank.amount), 0n);
    const ledgerTotal = concreteLedgers.reduce((total, ledger) => total + parseMoneyToPaise(ledger.amount), 0n);
    if (bankTotal !== ledgerTotal) {
      failures.push({ code: "AMOUNT_MISMATCH", message: "Proposed bank and ledger amounts do not balance exactly.", recordIds: [...proposedBankIds, ...proposedLedgerIds] });
    }
  } catch (error) {
    failures.push({ code: "INVALID_AMOUNT", message: "A proposed record contains an invalid monetary amount." });
  }

  return failures.length > 0
    ? rejected(...failures)
    : { status: "VERIFIED", bankRecordIds: [...proposedBankIds], ledgerRecordIds: [...proposedLedgerIds] };
}

function allowedIds(primary: CandidatePrimary, candidateSet: CandidateSet): { BANK: Set<string>; LEDGER: Set<string> } {
  const candidateIds = new Set(candidateSet.candidates.map((candidate) => candidate.recordId));
  return primary.side === "BANK"
    ? { BANK: new Set([primary.recordId]), LEDGER: candidateIds }
    : { BANK: candidateIds, LEDGER: new Set([primary.recordId]) };
}

function addDuplicateFailures(failures: MatchVerificationFailure[], side: "bank" | "ledger", ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    failures.push({ code: "DUPLICATE_RECORD_ID", message: `Duplicate ${side} record IDs are not allowed.`, recordIds: [...ids] });
  }
}

function isAllowedShape(bankCount: number, ledgerCount: number): boolean {
  return (bankCount === 1 && ledgerCount >= 1 && ledgerCount <= 3)
    || (ledgerCount === 1 && bankCount >= 1 && bankCount <= 3);
}

function hasNonEmptyEvidence(proposal: AgentProposal): boolean {
  return proposal.evidence.some((evidence) => evidence.statement.trim().length > 0);
}

function hasStructuredNonAmountEvidence(
  proposal: AgentProposal,
  primary: CandidatePrimary,
  candidateSet: CandidateSet,
): boolean {
  const nonAmountKinds = new Set(["REFERENCE", "COUNTERPARTY", "DESCRIPTION", "BATCH", "GROUPING", "SEMANTIC", "DETERMINISTIC"]);
  const proposedRecordIds = [...proposal.bankRecordIds, ...proposal.ledgerRecordIds];
  const candidateRecordIds = new Set(candidateSet.candidates.map((candidate) => candidate.recordId));
  return proposal.evidence.some((evidence) =>
    evidence.kind !== undefined && evidence.kind !== null
      && nonAmountKinds.has(evidence.kind)
      && evidence.source === "CROSS_RECORD"
      && proposedRecordIds.every((recordId) => evidence.recordIds.includes(recordId))
      && proposedRecordIds.every((recordId) => recordId === primary.recordId || candidateRecordIds.has(recordId)),
  );
}

function rejected(...failures: MatchVerificationFailure[]): MatchVerificationResult {
  return { status: "REJECTED", failures };
}
