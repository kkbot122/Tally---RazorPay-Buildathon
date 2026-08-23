import { describe, expect, it } from "vitest";

import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import { applyExactReferenceRule } from "./index.js";

const bank: ParsedBankTransaction = {
  bankTxnId: "B001",
  bookingDate: "2026-08-01",
  valueDate: "2026-08-01",
  amount: "10000.00",
  currency: "INR",
  direction: "CREDIT",
  reference: "INV881",
  counterparty: "Different Evidence",
  description: "Ignored by R1",
  batchId: "BANK-BATCH",
};

const ledger: ParsedLedgerTransaction = {
  ledgerTxnId: "L001",
  accountingDate: "2030-01-01",
  maturityDate: null,
  amount: "10000",
  currency: "INR",
  direction: "CREDIT",
  reference: "INV881",
  counterparty: "Another Evidence",
  description: "Also ignored by R1",
  source: "ERP",
  batchId: "LEDGER-BATCH",
};

function run(
  bankRecords: readonly ParsedBankTransaction[] = [bank],
  ledgerRecords: readonly ParsedLedgerTransaction[] = [ledger],
  usedRecords = emptyUsedRecordState(),
  bankRecordId = "B001",
) {
  return applyExactReferenceRule({
    bankRecordId,
    records: createRecordLookup(bankRecords, ledgerRecords),
    usedRecords,
  });
}

describe("R1 exact strong-reference match", () => {
  it("matches exact raw reference and exact paise amount", () => {
    const result = run();
    expect(result).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "EXACT_MATCH" });
  });

  it("rejects amount, currency, and direction mismatches", () => {
    expect(run([bank], [{ ...ledger, amount: "9999.99" }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, currency: "USD" }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, direction: "DEBIT" }])).toEqual({ status: "NO_MATCH" });
  });

  it("requires a non-null exact, case-sensitive raw reference", () => {
    expect(run([bank], [{ ...ledger, reference: null }])).toEqual({ status: "NO_MATCH" });
    expect(run([{ ...bank, reference: null }], [{ ...ledger, reference: null }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, reference: "INV-881" }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, reference: "inv881" }])).toEqual({ status: "NO_MATCH" });
  });

  it("does not apply date, counterparty, description, or batch matching", () => {
    expect(run()).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "EXACT_MATCH" });
  });

  it("returns ambiguity for multiple eligible exact candidates", () => {
    const result = run([bank], [ledger, { ...ledger, ledgerTxnId: "L000" }]);
    expect(result).toEqual({ status: "AMBIGUOUS", candidateLedgerRecordIds: ["L000", "L001"] });
  });

  it("ignores incompatible or used duplicate candidates", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>(["L001"]) };
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L002" }], used)).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L002", reasonCode: "EXACT_MATCH" });
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L002", currency: "USD" }])).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "EXACT_MATCH" });
  });

  it("rejects a used or missing bank record", () => {
    const used = { bankRecordIds: new Set<string>(["B001"]), ledgerRecordIds: new Set<string>() };
    expect(run([bank], [ledger], used)).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger], emptyUsedRecordState(), "B999")).toEqual({ status: "NO_MATCH" });
  });

  it("does not mutate used state and is deterministic", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() };
    const first = run([bank], [ledger], used);
    const second = run([bank], [ledger], used);
    expect(second).toEqual(first);
    expect(used).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });
});
