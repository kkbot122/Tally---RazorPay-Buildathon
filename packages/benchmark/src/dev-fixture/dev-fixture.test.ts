import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseBankCsv, parseLedgerCsv } from "@tally/reconciliation";
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
});
