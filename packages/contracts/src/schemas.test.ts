import { describe, expect, it } from "vitest";

import {
  AgentProposalSchema,
  BankTransactionSchema,
  FinalOutcomeSchema,
  LedgerTransactionSchema,
  TraceEventSchema,
} from "../index.js";

const bankTransaction = {
  bankTxnId: "bank_001",
  bookingDate: "2026-01-15",
  valueDate: "2026-01-16",
  amount: 125000n,
  currency: "INR",
  direction: "CREDIT",
  reference: "UTR-001",
  counterparty: "Example Customer",
  description: "Customer payment",
  batchId: "batch_001",
} as const;

const ledgerTransaction = {
  ledgerTxnId: "ledger_001",
  accountingDate: "2026-01-15",
  maturityDate: "2026-01-16",
  amount: 125000n,
  currency: "INR",
  direction: "CREDIT",
  reference: "UTR-001",
  counterparty: "Example Customer",
  description: "Customer payment",
  source: "ERP",
  batchId: "batch_001",
} as const;

describe("transaction contracts", () => {
  it("parse valid bank and ledger transactions", () => {
    expect(BankTransactionSchema.parse(bankTransaction)).toEqual(bankTransaction);
    expect(LedgerTransactionSchema.parse(ledgerTransaction)).toEqual(ledgerTransaction);
  });

  it("reject malformed transaction values", () => {
    expect(() => BankTransactionSchema.parse({ ...bankTransaction, amount: 1250.5 })).toThrow();
    expect(() => BankTransactionSchema.parse({ ...bankTransaction, bookingDate: "15/01/2026" })).toThrow();
    expect(() => LedgerTransactionSchema.parse({ ...ledgerTransaction, currency: "rupees" })).toThrow();
  });
});

describe("enum contracts", () => {
  it("reject invalid final outcomes", () => {
    expect(() => FinalOutcomeSchema.parse("MATCH")).toThrow();
  });
});

describe("agent contracts", () => {
  const validProposal = {
    proposedOutcome: "MATCH",
    bankTxnIds: ["bank_001"],
    ledgerTxnIds: ["ledger_001"],
    confidence: "HIGH",
    supportingEvidence: [
      {
        statement: "The references are equivalent.",
        source: "CROSS_RECORD",
        recordIds: ["bank_001", "ledger_001"],
      },
    ],
    conflictingEvidence: [],
    reason: "The records describe the same payment.",
  } as const;

  it("requires supporting and conflicting evidence fields", () => {
    expect(AgentProposalSchema.parse(validProposal)).toEqual(validProposal);
    expect(() => AgentProposalSchema.parse({ ...validProposal, supportingEvidence: undefined })).toThrow();
    expect(() => AgentProposalSchema.parse({ ...validProposal, conflictingEvidence: undefined })).toThrow();
  });
});

describe("trace contracts", () => {
  it("parses a trace event with structured metadata", () => {
    expect(
      TraceEventSchema.parse({
        eventId: "event_001",
        runId: "run_001",
        caseId: "case_001",
        type: "RULE_EVALUATED",
        occurredAt: "2026-01-15T10:00:00.000Z",
        message: "Evaluated exact reference rule.",
        metadata: { rule: "R1", candidateCount: 1 },
      }),
    ).toMatchObject({ type: "RULE_EVALUATED" });
  });
});
