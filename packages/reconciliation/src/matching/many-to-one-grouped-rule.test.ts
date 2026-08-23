import { describe, expect, it } from "vitest";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { applyManyToOneGroupedRule } from "./index.js";

const ledger: ParsedLedgerTransaction = {
  ledgerTxnId: "L001", accountingDate: "2026-08-10", maturityDate: null, amount: "10000", currency: "INR", direction: "CREDIT",
  reference: "BATCH-A", counterparty: null, description: null, source: "ERP", batchId: "BATCH-A",
};

function bank(bankTxnId: string, amount: string, overrides: Partial<ParsedBankTransaction> = {}): ParsedBankTransaction {
  return {
    bankTxnId, bookingDate: "2026-08-11", valueDate: "2026-08-11", amount, currency: "INR", direction: "CREDIT",
    reference: null, counterparty: null, description: null, batchId: "BATCH-A", ...overrides,
  };
}

function run(
  ledgerRecords: readonly ParsedLedgerTransaction[] = [ledger],
  bankRecords: readonly ParsedBankTransaction[] = [bank("B001", "4000"), bank("B002", "6000.0")],
  usedRecords = emptyUsedRecordState(),
  ledgerRecordId = "L001",
) {
  return applyManyToOneGroupedRule({ ledgerRecordId, records: createRecordLookup(bankRecords, ledgerRecords), usedRecords });
}

describe("R5 many-bank-to-one-ledger grouped match", () => {
  it("matches 2-to-1 and 3-to-1 groups with exact bigint totals", () => {
    expect(run()).toEqual({ status: "MATCH", bankRecordIds: ["B001", "B002"], ledgerRecordId: "L001", reasonCode: "GROUPED_MATCH" });
    expect(run([ledger], [bank("B001", "2500"), bank("B002", "3500"), bank("B003", "4000")])).toEqual({
      status: "MATCH", bankRecordIds: ["B001", "B002", "B003"], ledgerRecordId: "L001", reasonCode: "GROUPED_MATCH",
    });
  });

  it("rejects one-bank, four-bank, and wrong-sum groups", () => {
    expect(run([ledger], [bank("B001", "10000")])).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], [bank("B001", "2000"), bank("B002", "2500"), bank("B003", "2500"), bank("B004", "3000")])).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], [bank("B001", "4000"), bank("B002", "5999.99")])).toEqual({ status: "NO_MATCH" });
  });

  it("requires exact shared batch evidence and rejects cross-batch equal sums", () => {
    expect(run([{ ...ledger, batchId: null }])).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], [bank("B001", "4000"), bank("B002", "6000", { batchId: null })])).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], [bank("B001", "4000", { batchId: "OTHER" }), bank("B002", "6000", { batchId: "OTHER" })])).toEqual({ status: "NO_MATCH" });
  });

  it("requires compatibility, reuse, and every bank date to pass", () => {
    expect(run([ledger], [bank("B001", "4000"), bank("B002", "6000", { currency: "USD" })])).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], [bank("B001", "4000"), bank("B002", "6000", { direction: "DEBIT" })])).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], [bank("B001", "4000"), bank("B002", "6000", { bookingDate: "2026-08-14" })])).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], [bank("B001", "4000"), bank("B002", "6000")], { bankRecordIds: new Set(["B002"]), ledgerRecordIds: new Set<string>() })).toEqual({ status: "NO_MATCH" });
  });

  it("uses bank.bookingDate minus ledger.accountingDate with inclusive boundaries", () => {
    expect(run([ledger], [bank("B001", "4000", { bookingDate: "2026-08-09" }), bank("B002", "6000", { bookingDate: "2026-08-13" })])).toMatchObject({ status: "MATCH" });
    expect(run([ledger], [bank("B001", "4000", { bookingDate: "2026-08-09" }), bank("B002", "6000", { bookingDate: "2026-08-08" })])).toEqual({ status: "NO_MATCH" });
  });

  it("returns ambiguity for multiple valid groups, including 2-vs-3 groups", () => {
    expect(run([ledger], [bank("B001", "4100"), bank("B002", "5900"), bank("B003", "2000"), bank("B004", "3000"), bank("B005", "5000")])).toEqual({
      status: "AMBIGUOUS", candidateGroups: [["B001", "B002"], ["B003", "B004", "B005"]],
    });
  });

  it("removes used alternatives from ambiguity and prevents permutations", () => {
    const used = { bankRecordIds: new Set<string>(["B002"]), ledgerRecordIds: new Set<string>() };
    expect(run([ledger], [bank("B001", "4000"), bank("B002", "6000"), bank("B003", "3000"), bank("B004", "7000")], used)).toEqual({
      status: "MATCH", bankRecordIds: ["B003", "B004"], ledgerRecordId: "L001", reasonCode: "GROUPED_MATCH",
    });
  });

  it("does not mutate state and safely handles missing or used ledger anchors", () => {
    const used = emptyUsedRecordState();
    expect(run([ledger], undefined, used, "L999")).toEqual({ status: "NO_MATCH" });
    expect(run([ledger], undefined, { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set(["L001"]) })).toEqual({ status: "NO_MATCH" });
    expect(run(undefined, undefined, used)).toMatchObject({ status: "MATCH" });
    expect(used).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });
});
