import { describe, expect, it } from "vitest";
import type { AgentProposal } from "@tally/contracts";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { CandidateSet } from "../candidates/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { verifyMatchProposal } from "./match-verifier.js";

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

const evidence = { statement: "The supplied records identify the same payment.", source: "CROSS_RECORD" as const, recordIds: ["B1", "L1"] };

function proposal(bankRecordIds: string[], ledgerRecordIds: string[], overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    proposedOutcome: "MATCH",
    bankRecordIds,
    ledgerRecordIds,
    confidence: "HIGH",
    evidence: [evidence],
    conflictingEvidence: [],
    reason: "The supplied evidence supports the relationship.",
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
  primary: { side: "BANK" | "LEDGER"; recordId: string } = { side: "BANK", recordId: banks[0]!.bankTxnId },
  candidates = primary.side === "BANK" ? ledgers.map((record) => record.ledgerTxnId) : banks.map((record) => record.bankTxnId),
  usedRecords = emptyUsedRecordState(),
) {
  return verifyMatchProposal({
    proposal: match,
    primary,
    candidateSet: candidateSet(primary.side, primary.recordId, candidates),
    records: createRecordLookup(banks, ledgers),
    usedRecords,
  });
}

function hasFailure(result: ReturnType<typeof verifyMatchProposal>, code: string): boolean {
  return result.status === "REJECTED" && result.failures.some((failure) => failure.code === code);
}

describe("verifyMatchProposal", () => {
  it("verifies a semantic 1↔1 match without requiring mechanical reference equality", () => {
    expect(verify([bank()], [ledger()], proposal(["B1"], ["L1"]))).toEqual({
      status: "VERIFIED", bankRecordIds: ["B1"], ledgerRecordIds: ["L1"],
    });
  });

  it("rejects non-MATCH proposals without implementing T021", () => {
    const result = verify([bank()], [ledger()], proposal(["B1"], ["L1"], { proposedOutcome: "DISCREPANCY" }));
    expect(result).toEqual({ status: "REJECTED", failures: [{ code: "NOT_RECONCILED_PROPOSAL", message: "Only MATCH proposals are verified by T020." }] });
  });

  it("enforces closed-world IDs, primary participation, and duplicate rejection", () => {
    const records = [bank(), bank({ bankTxnId: "B2" })];
    const ledgers = [ledger(), ledger({ ledgerTxnId: "L999" })];
    expect(hasFailure(verify(records, ledgers, proposal(["B1"], ["L999"]), { side: "BANK", recordId: "B1" }, ["L1"]), "OUT_OF_CONTEXT_RECORD")).toBe(true);
    expect(hasFailure(verify(records, ledgers, proposal(["B2"], ["L1"])), "PRIMARY_NOT_INCLUDED")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger()], proposal(["B1", "B1"], ["L1"])), "DUPLICATE_RECORD_ID")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger()], proposal(["B1"], ["L404"])), "UNKNOWN_RECORD")).toBe(true);
  });

  it("verifies exact 1↔2, 1↔3, 2↔1, and 3↔1 group sums", () => {
    expect(verify([bank({ amount: "100.00" })], [ledger({ ledgerTxnId: "L1", amount: "40.00" }), ledger({ ledgerTxnId: "L2", amount: "60.00" })], proposal(["B1"], ["L1", "L2"]))).toMatchObject({ status: "VERIFIED" });
    expect(verify([bank({ amount: "100.00" })], [ledger({ ledgerTxnId: "L1", amount: "30.00" }), ledger({ ledgerTxnId: "L2", amount: "30.00" }), ledger({ ledgerTxnId: "L3", amount: "40.00" })], proposal(["B1"], ["L1", "L2", "L3"]))).toMatchObject({ status: "VERIFIED" });
    expect(verify([bank({ bankTxnId: "B1", amount: "40.00" }), bank({ bankTxnId: "B2", amount: "60.00" })], [ledger({ amount: "100.00" })], proposal(["B1", "B2"], ["L1"]), { side: "LEDGER", recordId: "L1" })).toMatchObject({ status: "VERIFIED" });
    expect(verify([bank({ bankTxnId: "B1", amount: "30.00" }), bank({ bankTxnId: "B2", amount: "30.00" }), bank({ bankTxnId: "B3", amount: "40.00" })], [ledger({ amount: "100.00" })], proposal(["B1", "B2", "B3"], ["L1"]), { side: "LEDGER", recordId: "L1" })).toMatchObject({ status: "VERIFIED" });
  });

  it("rejects many-to-many and groups larger than three", () => {
    const banks = [bank({ bankTxnId: "B1", amount: "50.00" }), bank({ bankTxnId: "B2", amount: "50.00" }), bank({ bankTxnId: "B3", amount: "50.00" }), bank({ bankTxnId: "B4", amount: "50.00" })];
    const ledgers = [ledger({ ledgerTxnId: "L1", amount: "50.00" }), ledger({ ledgerTxnId: "L2", amount: "50.00" }), ledger({ ledgerTxnId: "L3", amount: "50.00" }), ledger({ ledgerTxnId: "L4", amount: "50.00" })];
    expect(hasFailure(verify(banks.slice(0, 2), ledgers.slice(0, 2), proposal(["B1", "B2"], ["L1", "L2"])), "INVALID_RELATIONSHIP_SHAPE")).toBe(true);
    expect(hasFailure(verify([banks[0]!], ledgers, proposal(["B1"], ["L1", "L2", "L3", "L4"])), "INVALID_RELATIONSHIP_SHAPE")).toBe(true);
    expect(hasFailure(verify(banks, [ledgers[0]!], proposal(["B1", "B2", "B3", "B4"], ["L1"])), "INVALID_RELATIONSHIP_SHAPE")).toBe(true);
  });

  it("rejects amount, currency, direction, and group-member compatibility failures", () => {
    expect(hasFailure(verify([bank({ amount: "100.00" })], [ledger({ amount: "99.99" })], proposal(["B1"], ["L1"])), "AMOUNT_MISMATCH")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger({ currency: "USD" })], proposal(["B1"], ["L1"])), "HARD_COMPATIBILITY_FAILED")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger({ direction: "DEBIT" })], proposal(["B1"], ["L1"])), "HARD_COMPATIBILITY_FAILED")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger({ ledgerTxnId: "L1", amount: "40.00" }), ledger({ ledgerTxnId: "L2", amount: "60.00", currency: "USD" })], proposal(["B1"], ["L1", "L2"])), "HARD_COMPATIBILITY_FAILED")).toBe(true);
  });

  it("rejects used records, empty evidence, and conflicting evidence", () => {
    expect(hasFailure(verify([bank()], [ledger()], proposal(["B1"], ["L1"], {}), { side: "BANK", recordId: "B1" }, ["L1"], { bankRecordIds: new Set(["B1"]), ledgerRecordIds: new Set() }), "RECORD_ALREADY_USED")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger()], proposal(["B1"], ["L1"], { evidence: [] }), { side: "BANK", recordId: "B1" }), "INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger()], proposal(["B1"], ["L1"], { evidence: [{ ...evidence, statement: "   " }] }), { side: "BANK", recordId: "B1" }), "INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(hasFailure(verify([bank()], [ledger()], proposal(["B1"], ["L1"], { conflictingEvidence: [evidence] })), "CONFLICTING_EVIDENCE")).toBe(true);
  });

  it("does not use confidence, reason, or the deterministic date window as hard match rules", () => {
    const banks = [bank({ bookingDate: "2027-01-01" })];
    const ledgers = [ledger({ accountingDate: "2026-01-01" })];
    for (const confidence of ["HIGH", "MEDIUM", "LOW"] as const) {
      expect(verify(banks, ledgers, proposal(["B1"], ["L1"], { confidence, reason: `reason-${confidence}` }))).toMatchObject({ status: "VERIFIED" });
    }
  });

  it("does not mutate inputs and is deterministic", () => {
    const match = proposal(["B1"], ["L1"]);
    const set = candidateSet("BANK", "B1", ["L1"]);
    const used = emptyUsedRecordState();
    const before = { proposal: structuredClone(match), candidateSet: structuredClone(set), used: { bankRecordIds: new Set(used.bankRecordIds), ledgerRecordIds: new Set(used.ledgerRecordIds) } };
    const input = { proposal: match, primary: { side: "BANK" as const, recordId: "B1" }, candidateSet: set, records: createRecordLookup([bank()], [ledger()]), usedRecords: used };
    expect(verifyMatchProposal(input)).toEqual(verifyMatchProposal(input));
    expect(match).toEqual(before.proposal);
    expect(set).toEqual(before.candidateSet);
    expect(used).toEqual(before.used);
  });
});
