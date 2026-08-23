import { describe, expect, it } from "vitest";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { applyOneToManyGroupedRule } from "./index.js";

const bank: ParsedBankTransaction = {
  bankTxnId: "B001",
  bookingDate: "2026-08-12",
  valueDate: "2026-08-12",
  amount: "10000",
  currency: "INR",
  direction: "CREDIT",
  reference: "BATCH-A",
  counterparty: null,
  description: null,
  batchId: "BATCH-A",
};

function ledger(
  ledgerTxnId: string,
  amount: string,
  overrides: Partial<ParsedLedgerTransaction> = {},
): ParsedLedgerTransaction {
  return {
    ledgerTxnId,
    accountingDate: "2026-08-10",
    maturityDate: null,
    amount,
    currency: "INR",
    direction: "CREDIT",
    reference: null,
    counterparty: null,
    description: null,
    source: "ERP",
    batchId: "BATCH-A",
    ...overrides,
  };
}

function run(
  bankRecords: readonly ParsedBankTransaction[] = [bank],
  ledgerRecords: readonly ParsedLedgerTransaction[] = [ledger("L001", "4000.0"), ledger("L002", "6000.00")],
  usedRecords = emptyUsedRecordState(),
  bankRecordId = "B001",
) {
  return applyOneToManyGroupedRule({
    bankRecordId,
    records: createRecordLookup(bankRecords, ledgerRecords),
    usedRecords,
  });
}

describe("R4 one-bank-to-many-ledger grouped match", () => {
  it("matches a 1-to-2 group with an exact bigint total", () => {
    expect(run()).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordIds: ["L001", "L002"], reasonCode: "GROUPED_MATCH" });
  });

  it("matches a 1-to-3 group", () => {
    expect(run([bank], [ledger("L001", "2500"), ledger("L002", "3500"), ledger("L003", "4000")])).toEqual({
      status: "MATCH", bankRecordId: "B001", ledgerRecordIds: ["L001", "L002", "L003"], reasonCode: "GROUPED_MATCH",
    });
  });

  it("rejects one-ledger, four-ledger, and wrong-sum groups", () => {
    expect(run([bank], [ledger("L001", "10000")])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger("L001", "2500"), ledger("L002", "2500"), ledger("L003", "2500"), ledger("L004", "2500")])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger("L001", "4000"), ledger("L002", "5999.99")])).toEqual({ status: "NO_MATCH" });
  });

  it("requires exact shared batch evidence", () => {
    expect(run([{ ...bank, batchId: null }])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger("L001", "4000"), ledger("L002", "6000", { batchId: null })])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger("L001", "4000", { batchId: "OTHER" }), ledger("L002", "6000", { batchId: "OTHER" })])).toEqual({ status: "NO_MATCH" });
  });

  it("requires every member to pass compatibility, reuse, and date checks", () => {
    expect(run([bank], [ledger("L001", "4000"), ledger("L002", "6000", { currency: "USD" })])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger("L001", "4000"), ledger("L002", "6000", { direction: "DEBIT" })])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger("L001", "4000"), ledger("L002", "6000", { accountingDate: "2026-08-08" })])).toEqual({ status: "NO_MATCH" });
    expect(run([bank], [ledger("L001", "4000"), ledger("L002", "6000")], { bankRecordIds: new Set(), ledgerRecordIds: new Set(["L002"]) })).toEqual({ status: "NO_MATCH" });
  });

  it("does not group unrelated equal-sum rows", () => {
    expect(run([bank], [ledger("L001", "4000", { batchId: "OTHER" }), ledger("L002", "6000", { batchId: "OTHER" })])).toEqual({ status: "NO_MATCH" });
  });

  it("returns ambiguity for multiple valid groups, including 2-vs-3 groups", () => {
    expect(run([bank], [
      ledger("L001", "4100"), ledger("L002", "5900"),
      ledger("L003", "2000"), ledger("L004", "3000"), ledger("L005", "5000"),
    ])).toEqual({ status: "AMBIGUOUS", candidateGroups: [["L001", "L002"], ["L003", "L004", "L005"]] });
  });

  it("removes used alternatives from ambiguity and prevents permutations", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>(["L002"]) };
    expect(run([bank], [
      ledger("L001", "4000"), ledger("L002", "6000"),
      ledger("L003", "3000"), ledger("L004", "7000"),
    ], used)).toEqual({ status: "MATCH", bankRecordId: "B001", ledgerRecordIds: ["L003", "L004"], reasonCode: "GROUPED_MATCH" });
  });

  it("handles the asymmetric date boundaries and requires every member to pass", () => {
    expect(run([bank], [ledger("L001", "4000", { accountingDate: "2026-08-09" }), ledger("L002", "6000", { accountingDate: "2026-08-13" })])).toMatchObject({ status: "MATCH" });
    expect(run([bank], [ledger("L001", "4000", { accountingDate: "2026-08-09" }), ledger("L002", "6000", { accountingDate: "2026-08-08" })])).toEqual({ status: "NO_MATCH" });
  });

  it("does not mutate used state and safely handles missing or used banks", () => {
    const used = emptyUsedRecordState();
    expect(run([bank], undefined, used, "B999")).toEqual({ status: "NO_MATCH" });
    expect(run([bank], undefined, { bankRecordIds: new Set(["B001"]), ledgerRecordIds: new Set<string>() })).toEqual({ status: "NO_MATCH" });
    expect(run(undefined, undefined, used)).toMatchObject({ status: "MATCH" });
    expect(used).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });
});
