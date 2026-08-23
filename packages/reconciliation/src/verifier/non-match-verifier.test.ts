import { describe, expect, it } from "vitest";
import type { AgentProposal } from "@tally/contracts";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { CandidateSet } from "../candidates/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { verifyNonMatchProposal } from "./non-match-verifier.js";

const bank = (overrides: Partial<ParsedBankTransaction> = {}): ParsedBankTransaction => ({
  bankTxnId: "B1", bookingDate: "2026-08-10", valueDate: "2026-08-10", amount: "100.00",
  currency: "INR", direction: "CREDIT", reference: "INV-1", counterparty: "Acme Pvt Ltd",
  description: "Payment", batchId: null, ...overrides,
});

const ledger = (overrides: Partial<ParsedLedgerTransaction> = {}): ParsedLedgerTransaction => ({
  ledgerTxnId: "L1", accountingDate: "2026-08-10", maturityDate: null, amount: "100.00",
  currency: "INR", direction: "CREDIT", reference: "Invoice 1", counterparty: "Acme Private Limited",
  description: "Receipt", source: "ERP", batchId: null, ...overrides,
});

const supportingEvidence = { statement: "The supplied records contain relevant evidence.", source: "CROSS_RECORD" as const, recordIds: ["B1", "L1"] };
const conflictingEvidence = { statement: "The supplied records contain contradictory evidence.", source: "CROSS_RECORD" as const, recordIds: ["B1", "L1"] };

function proposal(outcome: AgentProposal["proposedOutcome"], bankRecordIds: string[], ledgerRecordIds: string[], overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    proposedOutcome: outcome,
    bankRecordIds,
    ledgerRecordIds,
    confidence: "HIGH",
    evidence: [supportingEvidence],
    conflictingEvidence: [],
    reason: "The supplied evidence supports this proposal.",
    ...overrides,
  };
}

function candidateSet(side: "BANK" | "LEDGER", primaryId: string, candidateIds: string[]): CandidateSet {
  return {
    primary: { side, recordId: primaryId },
    candidates: candidateIds.map((recordId) => ({
      side: side === "BANK" ? "LEDGER" : "BANK",
      recordId,
      selectionTier: "AMOUNT_AND_DATE",
      signals: ["EXACT_AMOUNT", "DATE_IN_RULE_WINDOW"],
      facts: {
        rawReferenceEqual: false,
        normalizedReferenceEqual: false,
        exactAmount: true,
        amountDeltaPaise: "0",
        normalizedCounterpartyEqual: false,
        batchIdEqual: false,
        dateDifferenceDays: 0,
        dateInRuleWindow: true,
      },
    })),
    totalEligibleCandidates: candidateIds.length,
    truncated: false,
  };
}

function verify(
  banks: ParsedBankTransaction[],
  ledgers: ParsedLedgerTransaction[],
  match: AgentProposal,
  primary: { side: "BANK" | "LEDGER"; recordId: string },
  candidates = primary.side === "BANK" ? ledgers.map((record) => record.ledgerTxnId) : banks.map((record) => record.bankTxnId),
  usedRecords = emptyUsedRecordState(),
  reasoningContext?: { deterministicReason?: "MULTIPLE_CANDIDATES" | "GROUPING_AMBIGUITY" },
) {
  return verifyNonMatchProposal({
    proposal: match,
    primary,
    candidateSet: candidateSet(primary.side, primary.recordId, candidates),
    records: createRecordLookup(banks, ledgers),
    usedRecords,
    runContext: { asOfDate: "2026-08-20" },
    reasoningContext,
  });
}

function failureCode(result: ReturnType<typeof verifyNonMatchProposal>): string | undefined {
  return result.status === "REJECTED" ? result.failures[0]?.code : undefined;
}

describe("verifyNonMatchProposal", () => {
  it("verifies future timing using only the supplied as-of date", () => {
    const result = verify([], [ledger({ maturityDate: "2026-08-25" })], proposal("TIMING_DIFFERENCE", [], ["L1"]), { side: "LEDGER", recordId: "L1" });
    expect(result).toEqual({ status: "VERIFIED", outcome: "EXPLAINED_OUTSTANDING", reasonCode: "TIMING_DIFFERENCE", bankRecordIds: [], ledgerRecordIds: ["L1"] });
  });

  it("falls back safely for missing, past, and same-day maturity", () => {
    for (const maturityDate of [null, "2026-08-19", "2026-08-20"] as const) {
      const result = verify([], [ledger({ maturityDate })], proposal("TIMING_DIFFERENCE", [], ["L1"]), { side: "LEDGER", recordId: "L1" });
      expect(result).toEqual({ status: "VERIFIED", outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED", bankRecordIds: [], ledgerRecordIds: ["L1"] });
    }
  });

  it("computes positive, negative, and grouped amount deltas exactly", () => {
    const positive = verify([bank({ amount: "100.00" })], [ledger({ amount: "99.50" })], proposal("DISCREPANCY", ["B1"], ["L1"]), { side: "BANK", recordId: "B1" });
    expect(positive).toMatchObject({ status: "VERIFIED", outcome: "DISCREPANCY", reasonCode: "AMOUNT_DISCREPANCY", amountDeltaPaise: "50" });
    const negative = verify([bank({ amount: "99.50" })], [ledger({ amount: "100.00" })], proposal("DISCREPANCY", ["B1"], ["L1"]), { side: "BANK", recordId: "B1" });
    expect(negative).toMatchObject({ status: "VERIFIED", reasonCode: "AMOUNT_DISCREPANCY", amountDeltaPaise: "-50" });
    const grouped = verify([bank({ amount: "100.00" })], [ledger({ ledgerTxnId: "L1", amount: "40.00" }), ledger({ ledgerTxnId: "L2", amount: "59.50" })], proposal("DISCREPANCY", ["B1"], ["L1", "L2"]), { side: "BANK", recordId: "B1" });
    expect(grouped).toMatchObject({ reasonCode: "AMOUNT_DISCREPANCY", amountDeltaPaise: "50" });
    const inverse = verify([bank({ bankTxnId: "B1", amount: "40.00" }), bank({ bankTxnId: "B2", amount: "59.50" })], [ledger({ amount: "100.00" })], proposal("DISCREPANCY", ["B1", "B2"], ["L1"]), { side: "LEDGER", recordId: "L1" });
    expect(inverse).toMatchObject({ reasonCode: "AMOUNT_DISCREPANCY", amountDeltaPaise: "-50" });
  });

  it("classifies currency and direction conflicts as conflicting records", () => {
    expect(verify([bank()], [ledger({ currency: "USD" })], proposal("DISCREPANCY", ["B1"], ["L1"]), { side: "BANK", recordId: "B1" })).toMatchObject({ outcome: "DISCREPANCY", reasonCode: "CONFLICTING_RECORDS" });
    expect(verify([bank()], [ledger({ direction: "DEBIT" })], proposal("DISCREPANCY", ["B1"], ["L1"]), { side: "BANK", recordId: "B1" })).toMatchObject({ outcome: "DISCREPANCY", reasonCode: "CONFLICTING_RECORDS" });
  });

  it("verifies semantic conflict only with supporting and conflicting evidence", () => {
    const valid = verify([bank()], [ledger()], proposal("DISCREPANCY", ["B1"], ["L1"], { conflictingEvidence: [conflictingEvidence] }), { side: "BANK", recordId: "B1" });
    expect(valid).toMatchObject({ outcome: "DISCREPANCY", reasonCode: "CONFLICTING_RECORDS" });
    const unsupported = verify([bank()], [ledger()], proposal("DISCREPANCY", ["B1"], ["L1"]), { side: "BANK", recordId: "B1" });
    expect(unsupported).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED" });
    const blank = verify([bank()], [ledger()], proposal("DISCREPANCY", ["B1"], ["L1"], { evidence: [{ ...supportingEvidence, statement: "   " }], conflictingEvidence: [conflictingEvidence] }), { side: "BANK", recordId: "B1" });
    expect(blank).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED" });
  });

  it("classifies stale committed records as duplicate usage before other discrepancy reasons", () => {
    const used = { bankRecordIds: new Set(["B1"]), ledgerRecordIds: new Set<string>() };
    const result = verify([bank({ amount: "100.00" })], [ledger({ amount: "99.50" })], proposal("DISCREPANCY", ["B1"], ["L1"]), { side: "BANK", recordId: "B1" }, ["L1"], used);
    expect(result).toMatchObject({ outcome: "DISCREPANCY", reasonCode: "DUPLICATE_USAGE" });
    expect(used.bankRecordIds).toEqual(new Set(["B1"]));
  });

  it("classifies used timing and unresolved records as duplicate usage without mutating state", () => {
    const used = { bankRecordIds: new Set(["B1"]), ledgerRecordIds: new Set(["L1"]) };
    const timing = verify([], [ledger({ maturityDate: "2026-08-25" })], proposal("TIMING_DIFFERENCE", [], ["L1"]), { side: "LEDGER", recordId: "L1" }, ["L1"], used);
    expect(timing).toMatchObject({ outcome: "DISCREPANCY", reasonCode: "DUPLICATE_USAGE" });

    const unresolved = verify([bank()], [ledger()], proposal("INSUFFICIENT_EVIDENCE", ["B1"], []), { side: "BANK", recordId: "B1" }, [], used);
    expect(unresolved).toMatchObject({ outcome: "DISCREPANCY", reasonCode: "DUPLICATE_USAGE" });
    expect(used).toEqual({ bankRecordIds: new Set(["B1"]), ledgerRecordIds: new Set(["L1"]) });
  });

  it("derives safe unresolved reasons without treating retrieval breadth as ambiguity", () => {
    const noCandidate = verify([bank()], [], proposal("INSUFFICIENT_EVIDENCE", ["B1"], []), { side: "BANK", recordId: "B1" });
    expect(noCandidate).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "NO_CANDIDATE" });
    const broadRetrieval = verify([bank()], [ledger(), ledger({ ledgerTxnId: "L2" })], proposal("INSUFFICIENT_EVIDENCE", ["B1"], []), { side: "BANK", recordId: "B1" });
    expect(broadRetrieval).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "INSUFFICIENT_EVIDENCE" });
    const explicitAmbiguity = verify([bank()], [ledger(), ledger({ ledgerTxnId: "L2" })], proposal("INSUFFICIENT_EVIDENCE", ["B1"], ["L1", "L2"]), { side: "BANK", recordId: "B1" });
    expect(explicitAmbiguity).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "MULTIPLE_PLAUSIBLE_CANDIDATES" });
    const metadataAmbiguity = verify([bank()], [ledger(), ledger({ ledgerTxnId: "L2" })], proposal("INSUFFICIENT_EVIDENCE", ["B1"], []), { side: "BANK", recordId: "B1" }, ["L1", "L2"], emptyUsedRecordState(), { deterministicReason: "MULTIPLE_CANDIDATES" });
    expect(metadataAmbiguity).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "MULTIPLE_PLAUSIBLE_CANDIDATES" });
  });

  it("rejects structural failures and MATCH proposals without delegating to T020", () => {
    expect(failureCode(verify([bank()], [ledger()], proposal("MATCH", ["B1"], ["L1"]), { side: "BANK", recordId: "B1" }))).toBe("NOT_RECONCILED_PROPOSAL");
    expect(failureCode(verify([bank()], [ledger(), ledger({ ledgerTxnId: "L999" })], proposal("DISCREPANCY", ["B1"], ["L999"]), { side: "BANK", recordId: "B1" }, ["L1"]))).toBe("OUT_OF_CONTEXT_RECORD");
    expect(failureCode(verify([bank()], [ledger()], proposal("INSUFFICIENT_EVIDENCE", ["B2"], ["L1"]), { side: "BANK", recordId: "B1" }))).toBe("UNKNOWN_RECORD");
    expect(failureCode(verify([bank()], [ledger()], proposal("DISCREPANCY", ["B1", "B1"], ["L1"]), { side: "BANK", recordId: "B1" }))).toBe("DUPLICATE_RECORD_ID");
  });

  it("does not mutate inputs and remains confidence-independent", () => {
    const used = emptyUsedRecordState();
    const match = proposal("DISCREPANCY", ["B1"], ["L1"]);
    const before = structuredClone(match);
    const first = verify([bank({ bookingDate: "2027-01-01" })], [ledger({ accountingDate: "2026-01-01", amount: "99.50" })], match, { side: "BANK", recordId: "B1" }, ["L1"], used);
    const second = verify([bank({ bookingDate: "2027-01-01" })], [ledger({ accountingDate: "2026-01-01", amount: "99.50" })], { ...match, confidence: "LOW", reason: "different" }, { side: "BANK", recordId: "B1" }, ["L1"], used);
    expect(first).toEqual(second);
    expect(match).toEqual(before);
  });
});
