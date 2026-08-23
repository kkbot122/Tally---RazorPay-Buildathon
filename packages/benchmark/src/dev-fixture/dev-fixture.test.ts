import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyExactReferenceRule,
  applyNormalizedReferenceRule,
  applyStrongContextRule,
  applyOneToManyGroupedRule,
  applyManyToOneGroupedRule,
  checkPairCompatibility,
  createRecordLookup,
  emptyUsedRecordState,
  normalizeCounterpartyForExactComparison,
  normalizeReference,
  parseBankCsv,
  parseLedgerCsv,
} from "@tally/reconciliation";
import { describe, expect, it } from "vitest";

import { buildDevFixture, DEV_FIXTURE_COMPOSITION } from "./index.js";
import { BANK_HEADERS, DEV_FIXTURE_AS_OF_DATE, GROUND_TRUTH_HEADERS, LEDGER_HEADERS } from "./types.js";

const fixtureDirectory = resolve(process.cwd(), "../../data/dev");

describe("20-case development fixture", () => {
  it("has the exact requested composition and all four outcomes", () => {
    const fixture = buildDevFixture();
    const counts = new Map<string, number>();
    for (const benchmarkCase of fixture.cases) counts.set(benchmarkCase.category, (counts.get(benchmarkCase.category) ?? 0) + 1);

    expect(counts).toEqual(new Map([
      ["EXACT", 3], ["NORMALIZED_REFERENCE", 2], ["STRONG_CONTEXT", 2], ["SEMANTIC", 2],
      ["TIMING", 2], ["GROUPED_ONE_TO_MANY", 2], ["GROUPED_MANY_TO_ONE", 2], ["DISCREPANCY", 2],
      ["AMBIGUOUS", 2], ["NO_CANDIDATE", 1],
    ]));
    expect(new Set(fixture.cases.map((benchmarkCase) => benchmarkCase.expectedOutcome))).toEqual(
      new Set(["RECONCILED", "EXPLAINED_OUTSTANDING", "DISCREPANCY", "UNRESOLVED"]),
    );
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_ONE_TO_MANY").map((benchmarkCase) => benchmarkCase.ledgerTransactions.length)).toEqual([2, 3]);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_MANY_TO_ONE").map((benchmarkCase) => benchmarkCase.bankTransactions.length)).toEqual([2, 3]);
    expect(DEV_FIXTURE_COMPOSITION).toHaveLength(20);
    expect(fixture.asOfDate).toBe(DEV_FIXTURE_AS_OF_DATE);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "TIMING").every((benchmarkCase) => benchmarkCase.truth.timingEvidence?.expectedDate! > fixture.asOfDate)).toBe(true);
  });

  it("round-trips generated CSV through T006 and uses exact headers", () => {
    const fixture = buildDevFixture();
    const bank = parseBankCsv(fixture.bankCsv);
    const ledger = parseLedgerCsv(fixture.ledgerCsv);

    expect(fixture.bankCsv.split("\n")[0]).toBe(BANK_HEADERS.join(","));
    expect(fixture.ledgerCsv.split("\n")[0]).toBe(LEDGER_HEADERS.join(","));
    expect(fixture.groundTruthCsv.split("\n")[0]).toBe(GROUND_TRUTH_HEADERS.join(","));
    expect(bank).toHaveLength(fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions).length);
    expect(ledger).toHaveLength(fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions).length);
    expect(bank.some((record) => record.description?.includes(","))).toBe(true);
  });

  it("is deterministic and fixture files do not drift from the generator", () => {
    const first = buildDevFixture();
    const second = buildDevFixture();
    expect(second).toEqual(first);
    expect(first.bankCsv).toBe(readFileSync(resolve(fixtureDirectory, "bank_transactions.csv"), "utf8"));
    expect(first.ledgerCsv).toBe(readFileSync(resolve(fixtureDirectory, "ledger_transactions.csv"), "utf8"));
    expect(first.groundTruthCsv).toBe(readFileSync(resolve(fixtureDirectory, "ground_truth.csv"), "utf8"));
  });

  it("shuffles bank and ledger rows independently and keeps IDs opaque", () => {
    const fixture = buildDevFixture();
    const caseBankOrder = fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions.map((record) => record.bankTxnId));
    const caseLedgerOrder = fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions.map((record) => record.ledgerTxnId));
    const generatedBankOrder = parseBankCsv(fixture.bankCsv).map((record) => record.bankTxnId);
    const generatedLedgerOrder = parseLedgerCsv(fixture.ledgerCsv).map((record) => record.ledgerTxnId);

    expect(generatedBankOrder).not.toEqual(caseBankOrder);
    expect(generatedLedgerOrder).not.toEqual(caseLedgerOrder);
    expect(generatedBankOrder[0]).not.toBe(caseBankOrder[0]);
    expect(fixture.bankCsv).not.toContain("case_id");
    expect(fixture.ledgerCsv).not.toContain("expected_outcome");

    const bankNumbers = caseBankOrder.map((id) => Number(id.slice(1)));
    const ledgerNumbers = caseLedgerOrder.map((id) => Number(id.slice(1)));
    expect(bankNumbers).not.toEqual(ledgerNumbers);
    expect(new Set(bankNumbers.map((value, index) => value - (ledgerNumbers[index] ?? 0))).size).toBeGreaterThan(1);
  });

  it("preserves the normalization boundary across benchmark categories", () => {
    const fixture = buildDevFixture();
    const normalizedReference = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "NORMALIZED_REFERENCE")!;
    const strongContext = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "STRONG_CONTEXT")!;
    const semantic = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "SEMANTIC")!;

    expect(normalizeReference(normalizedReference.bankTransactions[0]!.reference)).toBe(
      normalizeReference(normalizedReference.ledgerTransactions[0]!.reference),
    );
    expect(normalizeCounterpartyForExactComparison(strongContext.bankTransactions[0]!.counterparty)).toBe(
      normalizeCounterpartyForExactComparison(strongContext.ledgerTransactions[0]!.counterparty),
    );
    expect(normalizeReference(semantic.bankTransactions[0]!.reference)).not.toBe(
      normalizeReference(semantic.ledgerTransactions[0]!.reference),
    );
    expect(normalizeCounterpartyForExactComparison(semantic.bankTransactions[0]!.counterparty)).not.toBe(
      normalizeCounterpartyForExactComparison(semantic.ledgerTransactions[0]!.counterparty),
    );
  });

  it("keeps hard compatibility separate from future matching decisions", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const unused = emptyUsedRecordState();
    const discrepancy = fixture.cases.find((benchmarkCase) => benchmarkCase.reasonCode === "AMOUNT_DISCREPANCY")!;
    const conflicting = fixture.cases.find((benchmarkCase) => benchmarkCase.reasonCode === "CONFLICTING_RECORDS")!;
    const semantic = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "SEMANTIC")!;
    const strongContext = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "STRONG_CONTEXT")!;

    expect(checkPairCompatibility({
      bankRecordId: discrepancy.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: discrepancy.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
    expect(conflicting.bankTransactions[0]!.direction).toBe(conflicting.ledgerTransactions[0]!.direction);
    expect(conflicting.bankTransactions[0]!.amount).toBe(conflicting.ledgerTransactions[0]!.amount);
    expect(checkPairCompatibility({
      bankRecordId: conflicting.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: conflicting.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
    expect(checkPairCompatibility({
      bankRecordId: semantic.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: semantic.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
    expect(strongContext.bankTransactions[0]!.reference).toBeNull();
    expect(checkPairCompatibility({
      bankRecordId: strongContext.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: strongContext.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
  });

  it("applies R1 across the full fixture without collapsing later categories", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (benchmarkCase: (typeof fixture.cases)[number]) => applyExactReferenceRule({
      bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
      records,
      usedRecords,
    });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "EXACT")) {
      expect(apply(benchmarkCase)).toEqual({
        status: "MATCH",
        bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
        ledgerRecordId: benchmarkCase.truth.ledgerRecordIds[0],
        reasonCode: "EXACT_MATCH",
      });
    }
    for (const category of ["NORMALIZED_REFERENCE", "STRONG_CONTEXT", "SEMANTIC", "DISCREPANCY", "AMBIGUOUS"] as const) {
      for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === category)) {
        expect(apply(benchmarkCase)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R2 across the full fixture with explicit rule ownership", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (bankRecordId: string) => applyNormalizedReferenceRule({ bankRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "NORMALIZED_REFERENCE")) {
      expect(apply(benchmarkCase.bankTransactions[0]!.bankTxnId)).toEqual({
        status: "MATCH",
        bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
        ledgerRecordId: benchmarkCase.truth.ledgerRecordIds[0],
        reasonCode: "NORMALIZED_REFERENCE_MATCH",
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "NORMALIZED_REFERENCE")) {
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(apply(bankRecord.bankTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R3 across the full fixture with explicit rule ownership", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (bankRecordId: string) => applyStrongContextRule({ bankRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "STRONG_CONTEXT")) {
      expect(apply(benchmarkCase.bankTransactions[0]!.bankTxnId)).toEqual({
        status: "MATCH",
        bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
        ledgerRecordId: benchmarkCase.truth.ledgerRecordIds[0],
        reasonCode: "COUNTERPARTY_MATCH",
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "AMBIGUOUS")) {
      expect(apply(benchmarkCase.bankTransactions[0]!.bankTxnId)).toEqual({
        status: "AMBIGUOUS",
        candidateLedgerRecordIds: [...benchmarkCase.ledgerTransactions.map((record) => record.ledgerTxnId)].sort(),
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "STRONG_CONTEXT" && candidate.category !== "AMBIGUOUS")) {
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(apply(bankRecord.bankTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R4 only to grouped one-bank-to-many-ledger cases", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (bankRecordId: string) => applyOneToManyGroupedRule({ bankRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "GROUPED_ONE_TO_MANY")) {
      const bankRecordId = benchmarkCase.bankTransactions[0]!.bankTxnId;
      expect(applyExactReferenceRule({ bankRecordId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      expect(applyNormalizedReferenceRule({ bankRecordId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      expect(applyStrongContextRule({ bankRecordId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      expect(apply(bankRecordId)).toEqual({
        status: "MATCH",
        bankRecordId,
        ledgerRecordIds: [...benchmarkCase.truth.ledgerRecordIds].sort(),
        reasonCode: "GROUPED_MATCH",
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "GROUPED_ONE_TO_MANY")) {
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(apply(bankRecord.bankTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R5 only to grouped many-bank-to-one-ledger cases", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (ledgerRecordId: string) => applyManyToOneGroupedRule({ ledgerRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "GROUPED_MANY_TO_ONE")) {
      const ledgerRecordId = benchmarkCase.ledgerTransactions[0]!.ledgerTxnId;
      expect(apply(ledgerRecordId)).toEqual({
        status: "MATCH",
        bankRecordIds: [...benchmarkCase.truth.bankRecordIds].sort(),
        ledgerRecordId,
        reasonCode: "GROUPED_MATCH",
      });
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(applyExactReferenceRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
        expect(applyNormalizedReferenceRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
        expect(applyStrongContextRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
        expect(applyOneToManyGroupedRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      }
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "GROUPED_MANY_TO_ONE")) {
      for (const ledgerRecord of benchmarkCase.ledgerTransactions) {
        expect(apply(ledgerRecord.ledgerTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });
});
