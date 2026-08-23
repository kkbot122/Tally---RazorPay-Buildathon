import { describe, expect, it } from "vitest";

import { createRecordLookup, emptyUsedRecordState } from "../compatibility/index.js";
import type { ParsedBankTransaction, ParsedLedgerTransaction } from "../parsing/types.js";
import { MAX_CANDIDATES_PER_PRIMARY } from "./constants.js";
import { computePairFacts } from "./facts.js";
import { generateCandidates } from "./generate-candidates.js";

const bank = (overrides: Partial<ParsedBankTransaction> = {}): ParsedBankTransaction => ({
  bankTxnId: "B1", bookingDate: "2026-08-10", valueDate: "2026-08-10", amount: "100.00",
  currency: "INR", direction: "CREDIT", reference: "INV-1", counterparty: "Acme Pvt Ltd",
  description: "Receipt", batchId: null, ...overrides,
});

const ledger = (overrides: Partial<ParsedLedgerTransaction> = {}): ParsedLedgerTransaction => ({
  ledgerTxnId: "L1", accountingDate: "2026-08-10", maturityDate: null, amount: "100.00",
  currency: "INR", direction: "CREDIT", reference: "INV-1", counterparty: "ACME PVT LTD",
  description: "Receipt", source: "ERP", batchId: null, ...overrides,
});

function generate(bankRecords: ParsedBankTransaction[], ledgerRecords: ParsedLedgerTransaction[], primary: "BANK" | "LEDGER" = "BANK", usedRecords = emptyUsedRecordState(), requiredCandidateIds?: string[]) {
  return generateCandidates({
    primary: primary === "BANK" ? { side: "BANK", recordId: bankRecords[0]!.bankTxnId } : { side: "LEDGER", recordId: ledgerRecords[0]!.ledgerTxnId },
    records: createRecordLookup(bankRecords, ledgerRecords),
    usedRecords,
    requiredCandidateIds,
  });
}

describe("generateCandidates", () => {
  it("computes canonical facts and supports both primary directions", () => {
    const facts = computePairFacts(
      bank({ amount: "99.99", bookingDate: "2026-08-09", reference: "INV-881" }),
      ledger({ amount: "100.00", accountingDate: "2026-08-10", reference: "INV 881" }),
    );
    expect(facts).toEqual({
      rawReferenceEqual: false,
      normalizedReferenceEqual: true,
      exactAmount: false,
      amountDeltaPaise: "-1",
      normalizedCounterpartyEqual: true,
      batchIdEqual: false,
      dateDifferenceDays: -1,
      dateInRuleWindow: true,
    });

    const bankPrimary = generate([bank()], [ledger()]);
    const ledgerPrimary = generate([bank()], [ledger()], "LEDGER");
    expect(bankPrimary.candidates[0]!.facts).toEqual(ledgerPrimary.candidates[0]!.facts);
    expect(bankPrimary.candidates[0]!.side).toBe("LEDGER");
    expect(ledgerPrimary.candidates[0]!.side).toBe("BANK");
  });

  it("qualifies strong signals and two contextual signals, but rejects one weak signal", () => {
    const result = generate([
      bank(),
    ], [
      ledger({ ledgerTxnId: "L-EXACT", amount: "101.00" }),
      ledger({ ledgerTxnId: "L-CONTEXT", reference: "OTHER", counterparty: "Other", amount: "100.00" }),
      ledger({ ledgerTxnId: "L-WEAK", reference: "OTHER", counterparty: "Other", amount: "100.00", accountingDate: "2026-09-30" }),
    ]);
    expect(result.candidates.map((candidate) => candidate.recordId)).toEqual(["L-EXACT", "L-CONTEXT"]);
    expect(result.candidates[0]!.facts.exactAmount).toBe(false);
    expect(result.candidates[0]!.signals).toContain("RAW_REFERENCE_EQUAL");
    expect(result.candidates[1]!.selectionTier).toBe("AMOUNT_AND_DATE");
  });

  it("reuses hard compatibility and excludes used records", () => {
    const used = { bankRecordIds: new Set<string>(), ledgerRecordIds: new Set(["L-USED"]) };
    const result = generate([bank()], [
      ledger({ ledgerTxnId: "L-BAD-CURRENCY", currency: "USD" }),
      ledger({ ledgerTxnId: "L-BAD-DIRECTION", direction: "DEBIT" }),
      ledger({ ledgerTxnId: "L-USED" }),
    ], "BANK", used);
    expect(result.candidates).toEqual([]);
  });

  it("applies hard compatibility and used-state filtering for ledger primaries", () => {
    const result = generate([
      bank({ bankTxnId: "B-CURRENCY", currency: "USD" }),
      bank({ bankTxnId: "B-DIRECTION", direction: "DEBIT" }),
      bank({ bankTxnId: "B-USED" }),
    ], [ledger()], "LEDGER", {
      bankRecordIds: new Set(["B-USED"]),
      ledgerRecordIds: new Set(),
    });
    expect(result.candidates).toEqual([]);
  });

  it("orders by tier then date distance and is independent of input order", () => {
    const records = [
      ledger({ ledgerTxnId: "L-CONTEXT", reference: "OTHER", counterparty: "Acme Pvt Ltd" }),
      ledger({ ledgerTxnId: "L-BATCH", reference: "OTHER", batchId: "BATCH-1" }),
      ledger({ ledgerTxnId: "L-NORMALIZED", reference: "INV 1" }),
      ledger({ ledgerTxnId: "L-EXACT" }),
    ];
    const first = generate([bank({ batchId: "BATCH-1" })], records);
    const second = generate([bank({ batchId: "BATCH-1" })], [...records].reverse());
    expect(first).toEqual(second);
    expect(first.candidates.map((candidate) => candidate.selectionTier)).toEqual([
      "EXACT_REFERENCE", "NORMALIZED_REFERENCE", "EXACT_BATCH", "AMOUNT_AND_COUNTERPARTY",
    ]);
  });

  it("preserves required candidates through the cap and reports truncation", () => {
    const ledgers = Array.from({ length: MAX_CANDIDATES_PER_PRIMARY + 2 }, (_, index) => ledger({
      ledgerTxnId: `L${index}`,
      reference: `OTHER-${index}`,
      counterparty: `Different ${index}`,
      accountingDate: "2026-08-10",
    }));
    const result = generate([bank()], ledgers, "BANK", emptyUsedRecordState(), ["L9"]);
    expect(result.totalEligibleCandidates).toBe(MAX_CANDIDATES_PER_PRIMARY + 2);
    expect(result.candidates).toHaveLength(MAX_CANDIDATES_PER_PRIMARY);
    expect(result.candidates.map((candidate) => candidate.recordId)).toContain("L9");
    expect(result.truncated).toBe(true);
  });

  it("never allows more than the hard cap of required candidates", () => {
    const ledgers = Array.from({ length: MAX_CANDIDATES_PER_PRIMARY + 3 }, (_, index) => ledger({
      ledgerTxnId: `L${index}`,
      reference: `OTHER-${index}`,
      counterparty: `Different ${index}`,
      accountingDate: "2026-08-10",
    }));
    const required = ledgers.map((record) => record.ledgerTxnId);
    const result = generate([bank()], ledgers, "BANK", emptyUsedRecordState(), required);
    expect(result.candidates).toHaveLength(MAX_CANDIDATES_PER_PRIMARY);
    expect(result.totalEligibleCandidates).toBe(required.length);
    expect(result.truncated).toBe(true);
  });

  it("does not mutate state and fails safely for missing or used primaries", () => {
    const records = createRecordLookup([bank()], [ledger()]);
    const usedRecords = emptyUsedRecordState();
    const inputIds = ["L1"];
    const missing = generateCandidates({ primary: { side: "BANK", recordId: "MISSING" }, records, usedRecords, requiredCandidateIds: inputIds });
    expect(missing.candidates).toEqual([]);
    expect(inputIds).toEqual(["L1"]);
    const usedPrimary = generateCandidates({
      primary: { side: "BANK", recordId: "B1" },
      records,
      usedRecords: { bankRecordIds: new Set(["B1"]), ledgerRecordIds: new Set() },
    });
    expect(usedPrimary.candidates).toEqual([]);
    expect(usedRecords.bankRecordIds.size).toBe(0);
  });
});
