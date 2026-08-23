import { describe, expect, it } from "vitest";

import {
  agentProposals,
  bankTransactions,
  benchmarkEvaluations,
  ledgerTransactions,
  reconciliationResults,
  reconciliationRuns,
  traceEvents,
  verificationResults,
} from "./schema.js";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("persistence schema", () => {
  it("exports exactly the frozen application tables", () => {
    expect([
      reconciliationRuns,
      bankTransactions,
      ledgerTransactions,
      reconciliationResults,
      agentProposals,
      verificationResults,
      traceEvents,
      benchmarkEvaluations,
    ]).toHaveLength(8);
  });

  it("does not define a ground-truth table", () => {
    expect(Object.keys({
      reconciliationRuns,
      bankTransactions,
      ledgerTransactions,
      reconciliationResults,
      agentProposals,
      verificationResults,
      traceEvents,
      benchmarkEvaluations,
    })).not.toContain("groundTruth");
  });

  it("scopes transaction identity to a reconciliation run", () => {
    expect(getTableConfig(bankTransactions).primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "run_id",
      "bank_txn_id",
    ]);
    expect(getTableConfig(ledgerTransactions).primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "run_id",
      "ledger_txn_id",
    ]);
  });

  it("defines deterministic trace ordering per run", () => {
    const traceIndexes = getTableConfig(traceEvents).indexes;
    expect(traceIndexes.some((index) => index.config.name === "trace_events_run_sequence_idx")).toBe(true);
  });

  it("allows only one final result per case within a run", () => {
    const resultIndexes = getTableConfig(reconciliationResults).indexes;
    expect(resultIndexes.some((index) => index.config.name === "reconciliation_results_run_case_idx")).toBe(true);
  });
});
