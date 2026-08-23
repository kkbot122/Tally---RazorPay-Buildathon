import { describe, expect, it } from "vitest";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { runDeterministicReconciliation } from "./index.js";

function bank(id: string, amount: string, overrides: Partial<ParsedBankTransaction> = {}): ParsedBankTransaction {
  return {
    bankTxnId: id, bookingDate: "2026-08-11", valueDate: "2026-08-11", amount, currency: "INR", direction: "CREDIT",
    reference: null, counterparty: null, description: null, batchId: null, ...overrides,
  };
}

function ledger(id: string, amount: string, overrides: Partial<ParsedLedgerTransaction> = {}): ParsedLedgerTransaction {
  return {
    ledgerTxnId: id, accountingDate: "2026-08-10", maturityDate: null, amount, currency: "INR", direction: "CREDIT",
    reference: null, counterparty: null, description: null, source: "ERP", batchId: null, ...overrides,
  };
}

function run(bankRecords: readonly ParsedBankTransaction[], ledgerRecords: readonly ParsedLedgerTransaction[], usedRecords = emptyUsedRecordState()) {
  return runDeterministicReconciliation({ records: createRecordLookup(bankRecords, ledgerRecords), usedRecords });
}

describe("deterministic rule orchestration", () => {
  it("runs R1 through R5 globally in priority order", () => {
    const result = run(
      [
        bank("B001", "10000", { reference: "INV1" }),
        bank("B002", "10000", { reference: "INV-2" }),
        bank("B003", "10000", { counterparty: "ACME" }),
        bank("B004", "10000", { batchId: "GROUP-R4", reference: "BATCH-R4" }),
        bank("B005", "4000", { batchId: "GROUP-R5" }), bank("B006", "6000", { batchId: "GROUP-R5" }),
      ],
      [
        ledger("L001", "10000", { reference: "INV1" }),
        ledger("L002", "10000", { reference: "INV2" }),
        ledger("L003", "10000", { counterparty: "ACME" }),
        ledger("L004", "4000", { batchId: "GROUP-R4" }), ledger("L005", "6000", { batchId: "GROUP-R4" }),
        ledger("L006", "10000", { batchId: "GROUP-R5" }),
      ],
    );

    const auto = result.decisions.filter((decision) => decision.status === "AUTO_RECONCILED");
    expect(auto.map((decision) => decision.rule)).toEqual([
      "R1_EXACT_REFERENCE", "R2_NORMALIZED_REFERENCE", "R3_STRONG_CONTEXT", "R4_ONE_TO_MANY_GROUPED", "R5_MANY_TO_ONE_GROUPED",
    ]);
    expect(result.usedRecords.bankRecordIds).toEqual(new Set(["B001", "B002", "B003", "B004", "B005", "B006"]));
    expect(result.usedRecords.ledgerRecordIds).toEqual(new Set(["L001", "L002", "L003", "L004", "L005", "L006"]));
    const evaluatedRules = result.events.filter((event) => event.type === "RULE_EVALUATED").map((event) => event.rule);
    expect([...new Set(evaluatedRules)]).toEqual([
      "R1_EXACT_REFERENCE", "R2_NORMALIZED_REFERENCE", "R3_STRONG_CONTEXT", "R4_ONE_TO_MANY_GROUPED", "R5_MANY_TO_ONE_GROUPED",
    ]);
    expect(result.events.some((event) => event.type === "RULE_PASSED")).toBe(true);
    expect(result.events.some((event) => event.type === "RULE_FAILED")).toBe(true);
    expect(result.events.filter((event) => event.type === "AUTO_RECONCILED").length).toBe(5);
  });

  it("does not first-win overlapping R1 proposals and is input-order independent", () => {
    const banks = [bank("B001", "10000", { reference: "INV1" }), bank("B002", "10000", { reference: "INV1" })];
    const ledgers = [ledger("L001", "10000", { reference: "INV1" })];
    const first = run(banks, ledgers);
    const second = run([...banks].reverse(), ledgers);

    expect(first).toEqual(second);
    expect(first.decisions.filter((decision) => decision.status === "AUTO_RECONCILED")).toEqual([]);
    expect(first.decisions.filter((decision) => decision.status === "NEEDS_REASONING").every((decision) => decision.reason === "MULTIPLE_CANDIDATES")).toBe(true);
    expect(first.usedRecords).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });

  it("blocks explicit ambiguity from weaker deterministic rules", () => {
    const result = run(
      [bank("B001", "10000", { counterparty: "ACME", batchId: "GROUP" })],
      [ledger("L001", "10000", { counterparty: "ACME", batchId: "GROUP" }), ledger("L002", "10000", { counterparty: "ACME", batchId: "GROUP" })],
    );

    expect(result.decisions.filter((decision) => decision.status === "AUTO_RECONCILED")).toEqual([]);
    expect(result.decisions.some((decision) => decision.status === "NEEDS_REASONING" && decision.reason === "MULTIPLE_CANDIDATES")).toBe(true);
    expect(result.usedRecords).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });

  it("does not first-win overlapping R4 group proposals", () => {
    const result = run(
      [
        bank("B001", "10000", { batchId: "GROUP", reference: null }),
        bank("B002", "10000", { batchId: "GROUP", reference: null }),
      ],
      [
        ledger("L001", "4000", { batchId: "GROUP" }),
        ledger("L002", "6000", { batchId: "GROUP" }),
        ledger("L003", "4000", { batchId: "GROUP" }),
      ],
    );

    expect(result.decisions.filter((decision) => decision.status === "AUTO_RECONCILED")).toEqual([]);
    expect(result.decisions.filter((decision) => decision.status === "NEEDS_REASONING").some((decision) => decision.reason === "GROUPING_AMBIGUITY")).toBe(true);
    expect(result.usedRecords).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });

  it("commits R4 before R5 can consume a shared ledger record", () => {
    const result = run(
      [
        bank("B001", "10000", { batchId: "GROUP", reference: null }),
        bank("B002", "2500", { batchId: "GROUP", reference: null }),
        bank("B003", "3500", { batchId: "GROUP", reference: null }),
      ],
      [
        ledger("L001", "4000", { batchId: "GROUP" }),
        ledger("L002", "6000", { batchId: "GROUP" }),
      ],
    );

    expect(result.decisions.filter((decision) => decision.status === "AUTO_RECONCILED")).toEqual([
      { status: "AUTO_RECONCILED", rule: "R4_ONE_TO_MANY_GROUPED", bankRecordIds: ["B001"], ledgerRecordIds: ["L001", "L002"], reasonCode: "GROUPED_MATCH" },
    ]);
    expect(result.usedRecords).toEqual({ bankRecordIds: new Set(["B001"]), ledgerRecordIds: new Set(["L001", "L002"]) });
  });

  it("respects initial used state without mutating the caller", () => {
    const usedRecords = { bankRecordIds: new Set(["B001"]), ledgerRecordIds: new Set(["L001"]) };
    const before = { bankRecordIds: new Set(usedRecords.bankRecordIds), ledgerRecordIds: new Set(usedRecords.ledgerRecordIds) };
    const result = run([bank("B001", "10000", { reference: "INV1" })], [ledger("L001", "10000", { reference: "INV1" })], usedRecords);

    expect(result.decisions.filter((decision) => decision.status === "AUTO_RECONCILED")).toEqual([]);
    expect(usedRecords).toEqual(before);
    expect(result.usedRecords).toEqual(before);
  });

  it("is deterministic for generic leftovers and keeps them out of committed usage", () => {
    const first = run([bank("B001", "10000", { reference: "Invoice 1" })], [ledger("L001", "10000", { reference: "INV1" })]);
    const second = run([bank("B001", "10000", { reference: "Invoice 1" })], [ledger("L001", "10000", { reference: "INV1" })]);
    expect(first).toEqual(second);
    expect(first.decisions).toEqual([
      { status: "NEEDS_REASONING", reason: "NO_RULE_MATCH", bankRecordIds: ["B001"], ledgerRecordIds: [] },
      { status: "NEEDS_REASONING", reason: "NO_RULE_MATCH", bankRecordIds: [], ledgerRecordIds: ["L001"] },
    ]);
    expect(first.usedRecords).toEqual({ bankRecordIds: new Set<string>(), ledgerRecordIds: new Set<string>() });
  });
});
