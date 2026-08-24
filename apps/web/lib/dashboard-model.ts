import type { FinalOutcome } from "@tally/contracts";

import type { RunResult } from "./api/runs";

export type OutcomeCounts = {
  total: number;
  reconciled: number;
  explainedOutstanding: number;
  discrepancies: number;
  unresolved: number;
};

export function summarizeResults(results: readonly RunResult[]): OutcomeCounts {
  return {
    total: results.length,
    reconciled: results.filter((result) => result.finalOutcome === "RECONCILED").length,
    explainedOutstanding: results.filter((result) => result.finalOutcome === "EXPLAINED_OUTSTANDING").length,
    discrepancies: results.filter((result) => result.finalOutcome === "DISCREPANCY").length,
    unresolved: results.filter((result) => result.finalOutcome === "UNRESOLVED").length,
  };
}

export function filterResults(results: readonly RunResult[], outcome: "ALL" | FinalOutcome): RunResult[] {
  return outcome === "ALL" ? [...results] : results.filter((result) => result.finalOutcome === outcome);
}

export function createSubmissionLock(): { tryAcquire(): boolean; release(): void } {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() { locked = false; },
  };
}

export function isRunFormComplete(bankFile: File | null, ledgerFile: File | null, asOfDate: string): boolean {
  return bankFile !== null && ledgerFile !== null && asOfDate !== "";
}
