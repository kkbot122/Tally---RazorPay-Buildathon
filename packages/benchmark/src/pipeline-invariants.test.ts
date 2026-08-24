import { describe, expect, it } from "vitest";

import { runReconciliation, type AgentProposal, type ReasoningModelAdapter } from "@tally/reconciliation";
import { buildBenchmarkFixture } from "./benchmark/index.js";

function runtimeOnlyProposal(input: string): AgentProposal {
  const bankId = input.match(/"bankTxnId":"([^"]+)"/)?.[1];
  const ledgerId = input.match(/"ledgerTxnId":"([^"]+)"/)?.[1];
  return {
    proposedOutcome: "INSUFFICIENT_EVIDENCE",
    bankRecordIds: bankId === undefined ? [] : [bankId],
    ledgerRecordIds: ledgerId === undefined ? [] : [ledgerId],
    confidence: "LOW",
    evidence: [{ statement: "The supplied evidence is insufficient.", source: "DETERMINISTIC", recordIds: [bankId ?? ledgerId!] }],
    conflictingEvidence: [],
    reason: "The runtime context does not establish a safe relationship.",
  };
}

describe("T034 runtime and benchmark boundary", () => {
  it("keeps benchmark ground-truth metadata out of runtime records, model input, and trace", async () => {
    const fixture = buildBenchmarkFixture();
    const modelInputs: string[] = [];
    const adapter: ReasoningModelAdapter = {
      generateProposal: async ({ input }) => {
        modelInputs.push(input);
        return runtimeOnlyProposal(input);
      },
    };

    const result = await runReconciliation({
      runId: "run-ground-truth-boundary",
      asOfDate: fixture.asOfDate,
      bankCsv: fixture.bankCsv,
      ledgerCsv: fixture.ledgerCsv,
      modelAdapter: adapter,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(modelInputs.length).toBeGreaterThan(0);
    const modelText = modelInputs.join("\n");
    expect(modelText).not.toMatch(/expected_outcome|expectedOutcome|ground_truth|groundTruth|reason_code|case_id|notes/);
    const suppliedContextText = modelInputs
      .map((input) => input.split("SUPPLIED REASONING CONTEXT:")[1] ?? input)
      .join("\n");
    for (const value of [
      ...fixture.cases.map((benchmarkCase) => benchmarkCase.caseId),
      ...fixture.cases.map((benchmarkCase) => benchmarkCase.category),
      ...fixture.cases.flatMap((benchmarkCase) => benchmarkCase.notes ? [benchmarkCase.notes] : []),
    ]) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(suppliedContextText).not.toMatch(new RegExp(`\\b${escaped}\\b`));
    }
    const runtimeText = JSON.stringify(result.trace);
    expect(runtimeText).not.toMatch(/expected_outcome|expectedOutcome|ground_truth|groundTruth|reason_code|case_id|notes/);
    expect(fixture.bankCsv).not.toContain("expected_outcome");
    expect(fixture.ledgerCsv).not.toContain("expected_outcome");
    expect(fixture.groundTruthCsv).toContain("expected_outcome");
  });
});
