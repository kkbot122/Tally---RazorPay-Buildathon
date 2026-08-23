import { describe, expect, it } from "vitest";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { applyStrongContextRule } from "./index.js";

const bank: ParsedBankTransaction = {
  bankTxnId: "B001",
  bookingDate: "2026-08-12",
  valueDate: "2026-08-12",
  amount: "10000.00",
  currency: "INR",
  direction: "CREDIT",
  reference: null,
  counterparty: " Acme Private Limited ",
  description: "Ignored by R3",
  batchId: null,
};

const ledger: ParsedLedgerTransaction = {
  ledgerTxnId: "L001",
  accountingDate: "2026-08-10",
  maturityDate: null,
  amount: "10000",
  currency: "INR",
  direction: "CREDIT",
  reference: null,
  counterparty: "ACME   PRIVATE   LIMITED",
  description: "Also ignored by R3",
  source: "ERP",
  batchId: null,
};

function run(
  bankRecords: readonly ParsedBankTransaction[] = [bank],
  ledgerRecords: readonly ParsedLedgerTransaction[] = [ledger],
  usedRecords = emptyUsedRecordState(),
  bankRecordId = "B001",
) {
  return applyStrongContextRule({
    bankRecordId,
    records: createRecordLookup(bankRecords, ledgerRecords),
    usedRecords,
  });
}

describe("R3 strong-context match", () => {
  it("matches mechanically equal counterparties with exact amount and date tolerance", () => {
    expect(run()).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "COUNTERPARTY_MATCH" });
  });

  it("accepts null references but requires explicit counterparties", () => {
    expect(run([bank], [{ ...ledger, reference: "UNRELATED" }]).status).toBe("MATCH");
    expect(run([{ ...bank, counterparty: null }], [ledger])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, counterparty: null }])).toEqual({ status: "NO_MATCH" });
    expect(run([{ ...bank, counterparty: "   " }], [{ ...ledger, counterparty: "   " }])).toEqual({ status: "NO_MATCH" });
  });

  it("keeps counterparty normalization conservative", () => {
    expect(run([bank], [{ ...ledger, counterparty: "acme private limited" }]).status).toBe("MATCH");
    expect(run([bank], [{ ...ledger, counterparty: "ACME PVT LTD" }])).toEqual({ status: "NO_MATCH" });
  });

  it("requires exact amount, compatibility, and the shared date window", () => {
    expect(run([bank], [{ ...ledger, amount: "9999.99" }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, currency: "USD" }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, direction: "DEBIT" }])).toEqual({ status: "NO_MATCH" });
    expect(run([{ ...bank, bookingDate: "2026-08-08" }], [ledger])).toEqual({ status: "NO_MATCH" });
    expect(run([{ ...bank, bookingDate: "2026-08-14" }], [ledger])).toEqual({ status: "NO_MATCH" });
  });

  it("does not claim R1- or R2-owned reference relationships", () => {
    expect(run([{ ...bank, reference: "INV881" }], [{ ...ledger, reference: "INV881" }])).toEqual({ status: "NO_MATCH" });
    expect(run([{ ...bank, reference: "INV-881" }], [{ ...ledger, reference: "INV881" }])).toEqual({ status: "NO_MATCH" });
  });

  it("does not count R1/R2-owned candidates toward R3 ambiguity", () => {
    expect(run(
      [{ ...bank, reference: "INV-881" }],
      [
        { ...ledger, ledgerTxnId: "L001", reference: "INV881" },
        { ...ledger, ledgerTxnId: "L002", reference: null },
      ],
    )).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L002", reasonCode: "COUNTERPARTY_MATCH" });
  });

  it("counts only eligible candidates and reports deterministic ambiguity", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>(["L002"]) };
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L002" }], used)).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "COUNTERPARTY_MATCH" });
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L002", accountingDate: "2026-08-16" }])).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "COUNTERPARTY_MATCH" });
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L000" }])).toEqual({ status: "AMBIGUOUS", candidateLedgerRecordIds: ["L000", "L001"] });
  });

  it("does not mutate used state and safely handles a missing or used bank", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() };
    expect(run([bank], [ledger], used, "B999")).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger], { bankRecordIds: new Set(["B001"]), ledgerRecordIds: new Set<string>() })).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger], used)).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "COUNTERPARTY_MATCH" });
    expect(used).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });
});
