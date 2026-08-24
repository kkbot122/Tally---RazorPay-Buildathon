import { describe, expect, it } from "vitest";

import { createSubmissionLock, filterResults, isRunFormComplete, summarizeResults } from "./dashboard-model";
import type { RunResult } from "./api/runs";

const results: RunResult[] = [
  { caseId: "BANK:B1", bankTxnIds: ["B1", "B2"], ledgerTxnIds: ["L1"], finalOutcome: "RECONCILED", reasonCode: "GROUPED_MATCH" },
  { caseId: "BANK:B2", bankTxnIds: ["B2"], ledgerTxnIds: [], finalOutcome: "EXPLAINED_OUTSTANDING", reasonCode: "TIMING_DIFFERENCE" },
  { caseId: "BANK:B3", bankTxnIds: ["B3"], ledgerTxnIds: ["L3"], finalOutcome: "DISCREPANCY", reasonCode: "AMOUNT_DISCREPANCY" },
  { caseId: "LEDGER:L4", bankTxnIds: [], ledgerTxnIds: ["L4"], finalOutcome: "UNRESOLVED", reasonCode: "NO_CANDIDATE" },
];

describe("dashboard model", () => {
  it("counts all runtime outcomes and grouped IDs", () => {
    expect(summarizeResults(results)).toEqual({ total: 4, reconciled: 1, explainedOutstanding: 1, discrepancies: 1, unresolved: 1 });
    expect(results[0]?.bankTxnIds).toEqual(["B1", "B2"]);
  });

  it("filters locally without changing the source results", () => {
    expect(filterResults(results, "DISCREPANCY")).toHaveLength(1);
    expect(filterResults(results, "ALL")).toEqual(results);
    expect(results).toHaveLength(4);
  });

  it("returns zero counts for an empty run", () => {
    expect(summarizeResults([])).toEqual({ total: 0, reconciled: 0, explainedOutstanding: 0, discrepancies: 0, unresolved: 0 });
  });

  it("allows only one immediate submission", () => {
    const lock = createSubmissionLock();
    expect(lock.tryAcquire()).toBe(true);
    expect(lock.tryAcquire()).toBe(false);
    lock.release();
    expect(lock.tryAcquire()).toBe(true);
  });

  it("does not lock an invalid submission before a valid one", () => {
    const lock = createSubmissionLock();
    expect(isRunFormComplete(null, null, "")).toBe(false);
    expect(lock.tryAcquire()).toBe(true);
    lock.release();
    expect(isRunFormComplete(new File(["bank"], "bank.csv"), new File(["ledger"], "ledger.csv"), "2026-10-01")).toBe(true);
    expect(lock.tryAcquire()).toBe(true);
  });
});
