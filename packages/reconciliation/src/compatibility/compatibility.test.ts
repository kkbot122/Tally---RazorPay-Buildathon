import { describe, expect, it } from "vitest";

import {
  areCurrenciesCompatible,
  areDirectionsCompatible,
  checkPairCompatibility,
  createRecordLookup,
  emptyUsedRecordState,
} from "./index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";

const bank: ParsedBankTransaction = {
  bankTxnId: "B001",
  bookingDate: "2026-08-01",
  valueDate: "2026-08-01",
  amount: "10000.00",
  currency: "INR",
  direction: "CREDIT",
  reference: null,
  counterparty: null,
  description: null,
  batchId: null,
};

const ledger: ParsedLedgerTransaction = {
  ledgerTxnId: "L001",
  accountingDate: "2026-08-20",
  maturityDate: null,
  amount: "9950.00",
  currency: "INR",
  direction: "CREDIT",
  reference: null,
  counterparty: null,
  description: null,
  source: "ERP",
  batchId: null,
};

function input(overrides: Partial<ParsedLedgerTransaction> = {}) {
  return {
    bankRecordId: "B001",
    ledgerRecordId: "L001",
    records: createRecordLookup([bank], [{ ...ledger, ...overrides }]),
    usedRecords: emptyUsedRecordState(),
  };
}

describe("hard compatibility checks", () => {
  it("compares currencies after T009 normalization and rejects different currencies", () => {
    expect(areCurrenciesCompatible("inr", " INR ")).toBe(true);
    expect(areCurrenciesCompatible("INR", "USD")).toBe(false);
    expect(checkPairCompatibility(input()).compatible).toBe(true);
    expect(checkPairCompatibility(input({ currency: "USD" })).failures).toContain("CURRENCY_MISMATCH");
  });

  it("uses simplified cash-flow direction semantics", () => {
    expect(areDirectionsCompatible("CREDIT", "CREDIT")).toBe(true);
    expect(areDirectionsCompatible("DEBIT", "DEBIT")).toBe(true);
    expect(areDirectionsCompatible("CREDIT", "DEBIT")).toBe(false);
    expect(areDirectionsCompatible("DEBIT", "CREDIT")).toBe(false);
    expect(checkPairCompatibility(input({ direction: "DEBIT" })).failures).toContain("DIRECTION_MISMATCH");
  });

  it("accumulates currency and direction failures", () => {
    const result = checkPairCompatibility(input({ currency: "USD", direction: "DEBIT" }));
    expect(result.compatible).toBe(false);
    expect(result.failures).toEqual(["CURRENCY_MISMATCH", "DIRECTION_MISMATCH"]);
  });

  it("reports missing bank, ledger, or both records without throwing", () => {
    const records = createRecordLookup([bank], [ledger]);
    const usedRecords = emptyUsedRecordState();
    expect(checkPairCompatibility({ bankRecordId: "B999", ledgerRecordId: "L001", records, usedRecords }).failures).toEqual(["BANK_RECORD_NOT_FOUND"]);
    expect(checkPairCompatibility({ bankRecordId: "B001", ledgerRecordId: "L999", records, usedRecords }).failures).toEqual(["LEDGER_RECORD_NOT_FOUND"]);
    expect(checkPairCompatibility({ bankRecordId: "B999", ledgerRecordId: "L999", records, usedRecords }).failures).toEqual([
      "BANK_RECORD_NOT_FOUND",
      "LEDGER_RECORD_NOT_FOUND",
    ]);
  });

  it("rejects used records without mutating the supplied state", () => {
    const usedRecords = {
      bankRecordIds: new Set<string>(["B001"]),
      ledgerRecordIds: new Set<string>(["L001"]),
    };
    const bankBefore = new Set(usedRecords.bankRecordIds);
    const ledgerBefore = new Set(usedRecords.ledgerRecordIds);
    const result = checkPairCompatibility({ ...input(), usedRecords });

    expect(result.failures).toEqual(["BANK_RECORD_ALREADY_USED", "LEDGER_RECORD_ALREADY_USED"]);
    expect(usedRecords.bankRecordIds).toEqual(bankBefore);
    expect(usedRecords.ledgerRecordIds).toEqual(ledgerBefore);
    expect(checkPairCompatibility({ ...input(), usedRecords }).failures).toEqual(result.failures);
  });

  it("rejects duplicate IDs when creating an in-memory lookup", () => {
    expect(() => createRecordLookup([bank, bank], [ledger])).toThrow(/Duplicate bank record ID/);
    expect(() => createRecordLookup([bank], [ledger, ledger])).toThrow(/Duplicate ledger record ID/);
  });

  it("does not hard-reject amount, date, reference, counterparty, or missing optional evidence", () => {
    expect(checkPairCompatibility(input()).compatible).toBe(true);
  });
});
