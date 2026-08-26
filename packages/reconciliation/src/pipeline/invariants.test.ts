import { describe, expect, it } from "vitest";
import type { AgentProposal } from "@tally/contracts";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { CandidateSet } from "../candidates/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { verifyMatchProposal } from "../verifier/index.js";
import { runReconciliation } from "./run-reconciliation.js";
import { ReconciliationOperationalError } from "./types.js";
import { ReasoningAdapterError, type ReasoningModelAdapter } from "../agent/index.js";

const LEDGER_HEADERS = "ledger_txn_id,accounting_date,maturity_date,amount,currency,direction,reference,counterparty,description,source,batch_id";

type BankRow = {
  id: string;
  amount?: string;
  currency?: string;
  reference?: string;
  counterparty?: string;
  bookingDate?: string;
};

type LedgerRow = {
  id: string;
  amount?: string;
  currency?: string;
  reference?: string;
  counterparty?: string;
  accountingDate?: string;
};

const BANK_HEADERS = "bank_txn_id,booking_date,value_date,amount,currency,direction,reference,counterparty,description,batch_id";

function bankCsv(rows: BankRow[]): string {
  return [BANK_HEADERS, ...rows.map((row) => [row.id, row.bookingDate ?? "2026-08-10", row.bookingDate ?? "2026-08-10", row.amount ?? "100.00", row.currency ?? "INR", "CREDIT", row.reference ?? "REF-1", row.counterparty ?? "Acme", "Payment", ""].join(","))].join("\n");
}

function ledgerCsv(rows: LedgerRow[]): string {
  return [LEDGER_HEADERS, ...rows.map((row) => [row.id, row.accountingDate ?? "2026-08-10", "", row.amount ?? "100.00", row.currency ?? "INR", "CREDIT", row.reference ?? "REF-1", row.counterparty ?? "Acme", "Receipt", "ERP", ""].join(","))].join("\n");
}

function proposalFor(primaryId: string, ledgerIds: string[], overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    proposedOutcome: "MATCH",
    bankRecordIds: [primaryId],
    ledgerRecordIds: ledgerIds,
    confidence: "HIGH",
    evidence: [{ statement: "The supplied records support this relationship.", source: "CROSS_RECORD", kind: "SEMANTIC", recordIds: [primaryId, ...ledgerIds] }],
    conflictingEvidence: [],
    reason: "The supplied evidence supports the relationship.",
    ...overrides,
  };
}

function primaryId(input: string): string {
  const match = input.match(/"bankTxnId":"([^"]+)"/);
  return match?.[1] ?? "B1";
}

function adapter(proposal: (bankId: string) => AgentProposal): ReasoningModelAdapter {
  return { generateProposal: async ({ input }) => proposal(primaryId(input)) };
}

async function runCase(bankRows: BankRow[], ledgerRows: LedgerRow[], modelAdapter: ReasoningModelAdapter) {
  return runReconciliation({
    runId: "run-invariant-test",
    asOfDate: "2026-08-23",
    bankCsv: bankCsv(bankRows),
    ledgerCsv: ledgerCsv(ledgerRows),
    modelAdapter,
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
  });
}

function bankRecord(overrides: Partial<ParsedBankTransaction> = {}): ParsedBankTransaction {
  return { bankTxnId: "B1", bookingDate: "2026-08-10", valueDate: "2026-08-10", amount: "100.00", currency: "INR", direction: "CREDIT", reference: "REF-1", counterparty: "Acme", description: "Payment", batchId: null, ...overrides };
}

function ledgerRecord(overrides: Partial<ParsedLedgerTransaction> = {}): ParsedLedgerTransaction {
  return { ledgerTxnId: "L1", accountingDate: "2026-08-10", maturityDate: null, amount: "100.00", currency: "INR", direction: "CREDIT", reference: "REF-1", counterparty: "Acme", description: "Receipt", source: "ERP", batchId: null, ...overrides };
}

function candidateSet(primaryIdValue: string, candidateIds: string[], facts = {}): CandidateSet {
  return {
    primary: { side: "BANK", recordId: primaryIdValue },
    candidates: candidateIds.map((recordId) => ({
      side: "LEDGER" as const,
      recordId,
      selectionTier: "AMOUNT_AND_DATE" as const,
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
        ...facts,
      },
    })),
    totalEligibleCandidates: candidateIds.length,
    truncated: false,
  };
}

function matchProposal(bankRecordIds: string[], ledgerRecordIds: string[], evidenceStatement = "The supplied records support this relationship."): AgentProposal {
  return {
    proposedOutcome: "MATCH",
    bankRecordIds,
    ledgerRecordIds,
    confidence: "HIGH",
    evidence: [{ statement: evidenceStatement, source: "CROSS_RECORD", kind: "SEMANTIC", recordIds: [...bankRecordIds, ...ledgerRecordIds] }],
    conflictingEvidence: [],
    reason: "The supplied evidence supports the relationship.",
  };
}

describe("T034 core engine safety invariants", () => {
  it("rejects reconciliation when currencies differ", async () => {
    const result = await runCase(
      [{ id: "B1", currency: "INR" }],
      [{ id: "L1", currency: "USD" }],
      adapter((id) => proposalFor(id, ["L1"])),
    );
    expect(result.results.find((item) => item.caseId === "BANK:B1")).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED" });
  });

  it("never auto-reconciles when amounts differ", async () => {
    const result = await runCase([{ id: "B1", amount: "100.00" }], [{ id: "L1", amount: "99.99" }], adapter((id) => proposalFor(id, ["L1"])));
    expect(result.results.some((item) => item.source === "DETERMINISTIC" && item.outcome === "RECONCILED")).toBe(false);
    expect(result.results.some((item) => item.outcome === "RECONCILED")).toBe(false);
  });

  it("keeps ambiguous deterministic candidates unresolved", async () => {
    const result = await runCase([{ id: "B1" }], [{ id: "L1" }, { id: "L2" }], adapter((id) => ({ ...proposalFor(id, []), proposedOutcome: "INSUFFICIENT_EVIDENCE", confidence: "LOW" })));
    expect(result.results.some((item) => item.outcome === "RECONCILED")).toBe(false);
    expect(result.usedRecords.bankRecordIds.size).toBe(0);
    expect(result.usedRecords.ledgerRecordIds.size).toBe(0);
  });

  it("prevents record reuse after an accepted reconciliation", async () => {
    const result = await runCase([{ id: "B1" }, { id: "B2" }], [{ id: "L1" }], adapter((id) => proposalFor(id, ["L1"])));
    expect(result.results.filter((item) => item.outcome === "RECONCILED")).toHaveLength(1);
    expect(result.usedRecords.ledgerRecordIds).toEqual(new Set(["L1"]));
    expect(result.results.filter((item) => item.outcome === "RECONCILED").flatMap((item) => item.ledgerRecordIds)).toEqual(["L1"]);
  });

  it("retries a verifier-rejected relationship with exact failure feedback", async () => {
    let calls = 0;
    const result = await runCase(
      [{ id: "B1", counterparty: "Bank Only" }],
      [{ id: "L1", reference: "LEDGER-ONLY", counterparty: "Ledger Only" }],
      { generateProposal: async ({ retryFeedback }) => {
        calls += 1;
        if (retryFeedback === undefined) return proposalFor("B404", ["L1"]);
        expect(retryFeedback).toContain("UNKNOWN_RECORD");
        return proposalFor("B1", ["L1"]);
      } },
    );
    expect(calls).toBe(4);
    expect(result.results.find((item) => item.caseId === "BANK:B1")).toMatchObject({ outcome: "RECONCILED" });
  });

  it("isolates exhausted model schema failures as unresolved cases", async () => {
    const result = await runCase(
      [{ id: "B1", reference: "BANK-ONLY", counterparty: "Bank Only" }],
      [{ id: "L1", reference: "LEDGER-ONLY", counterparty: "Ledger Only" }],
      { generateProposal: async () => { throw new ReasoningAdapterError("AI_SCHEMA_ERROR", "malformed model output"); } },
    );
    expect(result.results.find((item) => item.caseId === "BANK:B1")).toMatchObject({ outcome: "UNRESOLVED" });
    expect(result.trace.at(-1)?.type).toBe("RUN_COMPLETED");
  });

  it("isolates model request failures as unresolved cases and completes the run", async () => {
    const result = await runCase(
      [{ id: "B1", reference: "BANK-ONLY", counterparty: "Bank Only" }],
      [{ id: "L1", reference: "LEDGER-ONLY", counterparty: "Ledger Only" }],
      { generateProposal: async () => { throw new ReasoningAdapterError("AI_REQUEST_ERROR", "provider timeout"); } },
    );
    expect(result.results.find((item) => item.caseId === "BANK:B1")).toMatchObject({ outcome: "UNRESOLVED" });
    expect(result.trace.at(-1)?.type).toBe("RUN_COMPLETED");
  });

  it("prevents a later AI proposal from reusing a record committed by a deterministic rule", async () => {
    const result = await runCase(
      [{ id: "B1", reference: "REF-1", counterparty: "Acme" }, { id: "B2", reference: "OTHER-REF", counterparty: "Other" }],
      [{ id: "L1", reference: "REF-1", counterparty: "Acme" }],
      adapter((id) => proposalFor(id, ["L1"])),
    );
    expect(result.results.some((item) => item.outcome === "RECONCILED")).toBe(true);
    expect(result.results.some((item) => item.caseId === "BANK:B2" && item.outcome === "UNRESOLVED")).toBe(true);
  });

  it("rejects candidate groups larger than three records", () => {
    const records = createRecordLookup([bankRecord()], [ledgerRecord({ ledgerTxnId: "L1" }), ledgerRecord({ ledgerTxnId: "L2" }), ledgerRecord({ ledgerTxnId: "L3" }), ledgerRecord({ ledgerTxnId: "L4" })]);
    const result = verifyMatchProposal({ proposal: matchProposal(["B1"], ["L1", "L2", "L3", "L4"]), primary: { side: "BANK", recordId: "B1" }, candidateSet: candidateSet("B1", ["L1", "L2", "L3", "L4"]), records, usedRecords: emptyUsedRecordState() });
    expect(result.status).toBe("REJECTED");
    expect(result.status === "REJECTED" && result.failures.some((failure) => failure.code === "INVALID_RELATIONSHIP_SHAPE")).toBe(true);
  });

  it("rejects many-to-many reconciliation proposals", () => {
    const banks = [bankRecord(), bankRecord({ bankTxnId: "B2" })];
    const ledgers = [ledgerRecord(), ledgerRecord({ ledgerTxnId: "L2" })];
    const result = verifyMatchProposal({ proposal: matchProposal(["B1", "B2"], ["L1", "L2"]), primary: { side: "BANK", recordId: "B1" }, candidateSet: candidateSet("B1", ["L1", "L2"]), records: createRecordLookup(banks, ledgers), usedRecords: emptyUsedRecordState() });
    expect(result.status).toBe("REJECTED");
    expect(result.status === "REJECTED" && result.failures.some((failure) => failure.code === "INVALID_RELATIONSHIP_SHAPE")).toBe(true);
  });

  it("requires verifier approval before accepting an AI proposal", async () => {
    const result = await runCase([{ id: "B1", amount: "100.00" }], [{ id: "L1", amount: "99.99" }], adapter((id) => proposalFor(id, ["L1"])));
    expect(result.results.some((item) => item.outcome === "RECONCILED")).toBe(false);
    expect(result.trace.some((event) => event.type === "VERIFICATION_CHECKED")).toBe(true);
  });

  it("rejects AI proposals containing unknown record IDs", async () => {
    const result = await runCase(
      [{ id: "B1", reference: "BANK-ONLY", counterparty: "Bank Counterparty" }],
      [{ id: "L1", reference: "LEDGER-ONLY", counterparty: "Ledger Counterparty" }],
      adapter((id) => proposalFor(id, ["L404"])),
    );
    expect(result.results.find((item) => item.caseId === "BANK:B1")).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED" });
  });

  it("rejects semantic matches supported only by equal amount in the full AMOUNT_AND_DATE pipeline path", async () => {
    const result = await runCase(
      [{ id: "B1", reference: "BANK-ONLY", counterparty: "Bank Counterparty" }],
      [{ id: "L1", reference: "LEDGER-ONLY", counterparty: "Ledger Counterparty" }],
      adapter((id) => proposalFor(id, ["L1"], { evidence: [{ statement: "The amounts are equal.", kind: "AMOUNT", source: "CROSS_RECORD", recordIds: [id, "L1"] }] })),
    );
    expect(result.results.some((item) => item.outcome === "RECONCILED")).toBe(false);
    expect(result.results.find((item) => item.caseId === "BANK:B1")).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED" });
  });

  it("does not treat a generic shared description token as non-amount evidence", async () => {
    const result = await runCase(
      [{ id: "B1", reference: "BANK-ONLINE", counterparty: "Northwind" }],
      [{ id: "L1", reference: "LEDGER-ONLINE", counterparty: "Southridge" }],
      adapter((id) => proposalFor(id, ["L1"], {
        evidence: [{ statement: "The online amounts are equal.", kind: "AMOUNT", source: "CROSS_RECORD", recordIds: [id, "L1"] }],
      })),
    );
    expect(result.results.find((item) => item.caseId === "BANK:B1")).toMatchObject({ outcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED" });
  });
});
