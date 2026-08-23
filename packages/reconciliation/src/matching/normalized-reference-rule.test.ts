import { describe, expect, it } from "vitest";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { differenceInCalendarDays, applyNormalizedReferenceRule } from "./index.js";

const bank: ParsedBankTransaction = {
  bankTxnId: "B001",
  bookingDate: "2026-08-12",
  valueDate: "2026-08-12",
  amount: "10000.00",
  currency: "INR",
  direction: "CREDIT",
  reference: "INV-881",
  counterparty: "Ignored by R2",
  description: "Ignored by R2",
  batchId: null,
};

const ledger: ParsedLedgerTransaction = {
  ledgerTxnId: "L001",
  accountingDate: "2026-08-10",
  maturityDate: null,
  amount: "10000",
  currency: "INR",
  direction: "CREDIT",
  reference: "INV881",
  counterparty: "Also ignored by R2",
  description: "Also ignored by R2",
  source: "ERP",
  batchId: null,
};

function run(
  bankRecords: readonly ParsedBankTransaction[] = [bank],
  ledgerRecords: readonly ParsedLedgerTransaction[] = [ledger],
  usedRecords = emptyUsedRecordState(),
  bankRecordId = "B001",
) {
  return applyNormalizedReferenceRule({
    bankRecordId,
    records: createRecordLookup(bankRecords, ledgerRecords),
    usedRecords,
  });
}

describe("R2 normalized-reference match", () => {
  it("matches mechanically equivalent references with exact amount and date tolerance", () => {
    expect(run()).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "NORMALIZED_REFERENCE_MATCH" });
  });

  it("keeps raw-exact references owned by R1", () => {
    expect(run([bank], [{ ...ledger, reference: "INV-881" }])).toEqual({ status: "NO_MATCH" });
  });

  it("supports mechanical reference variants but rejects semantic rewriting", () => {
    for (const reference of ["INV881", "INV_881", "INV 881", "INV#881", "inv881"]) {
      expect(run([bank], [{ ...ledger, reference }]).status).toBe("MATCH");
    }
    expect(run([bank], [{ ...ledger, reference: "Invoice 881" }])).toEqual({ status: "NO_MATCH" });
  });

  it("rejects missing references, amount mismatch, currency mismatch, and direction mismatch", () => {
    expect(run([bank], [{ ...ledger, reference: null }])).toEqual({ status: "NO_MATCH" });
    expect(run([{ ...bank, reference: null }], [ledger])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, amount: "9999.99" }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, currency: "USD" }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [{ ...ledger, direction: "DEBIT" }])).toEqual({ status: "NO_MATCH" });
  });

  it("uses the inclusive asymmetric date window from -1 through +3 days", () => {
    for (const [bookingDate, expected] of [
      ["2026-08-09", true], ["2026-08-10", true], ["2026-08-11", true], ["2026-08-13", true],
      ["2026-08-08", false], ["2026-08-14", false],
    ] as const) {
      expect(run([{ ...bank, bookingDate }]).status === "MATCH").toBe(expected);
    }
    expect(differenceInCalendarDays("2026-08-08", "2026-08-10")).toBe(-2);
    expect(differenceInCalendarDays("2026-08-14", "2026-08-10")).toBe(4);
  });

  it("handles month, year, and leap-year calendar boundaries in UTC", () => {
    expect(differenceInCalendarDays("2026-09-02", "2026-08-31")).toBe(2);
    expect(differenceInCalendarDays("2027-01-02", "2026-12-31")).toBe(2);
    expect(differenceInCalendarDays("2028-03-01", "2028-02-28")).toBe(2);
    expect(differenceInCalendarDays("0100-01-01", "0099-12-31")).toBe(1);
  });

  it("counts only fully eligible candidates for uniqueness", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>(["L002"]) };
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L002" }], used)).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "NORMALIZED_REFERENCE_MATCH" });
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L002", currency: "USD" }])).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "NORMALIZED_REFERENCE_MATCH" });
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L002", accountingDate: "2026-08-15" }])).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "NORMALIZED_REFERENCE_MATCH" });
  });

  it("returns ambiguity for multiple fully eligible normalized candidates", () => {
    expect(run([bank], [ledger, { ...ledger, ledgerTxnId: "L000", reference: "INV_881" }])).toEqual({ status: "AMBIGUOUS", candidateLedgerRecordIds: ["L000", "L001"] });
  });

  it("ignores raw-exact candidates when counting R2 candidates", () => {
    expect(run([bank], [
      { ...ledger, reference: "INV-881" },
      { ...ledger, ledgerTxnId: "L002", reference: "INV881" },
    ])).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L002", reasonCode: "NORMALIZED_REFERENCE_MATCH" });
  });

  it("rejects a missing or used bank and never mutates used state", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() };
    expect(run([bank], [ledger], used, "B999")).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger], { bankRecordIds: new Set(["B001"]), ledgerRecordIds: new Set<string>() })).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger], used)).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "NORMALIZED_REFERENCE_MATCH" });
    expect(run([bank], [ledger], used)).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordId: "L001", reasonCode: "NORMALIZED_REFERENCE_MATCH" });
    expect(used).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });
});
