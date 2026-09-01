/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceEvent, TraceEventType } from "@tally/contracts";

const api = vi.hoisted(() => ({ getRunTrace: vi.fn() }));
vi.mock("../../lib/api/runs", () => api);

import TracePage from "./trace-page";

const occurredAt = "2026-08-24T12:00:00.000Z";

function event(type: TraceEventType, sequenceNo: number, caseId: string | null, payload: Record<string, unknown> = {}): TraceEvent {
  return { eventId: `run-test:${sequenceNo}`, runId: "run-test", sequenceNo, caseId, type, occurredAt, message: type, metadata: payload, payload };
}

const deterministicEvents: TraceEvent[] = [
  event("RUN_STARTED", 1, null, { asOfDate: "2026-08-24", bankRecordCount: 1, ledgerRecordCount: 1 }),
  event("CASE_STARTED", 2, "BANK:A", { primarySide: "BANK", primaryRecordId: "A" }),
  event("RULE_EVALUATED", 3, "BANK:A", { rule: "R1_EXACT_REFERENCE", anchorRecordId: "A" }),
  event("RULE_PASSED", 4, "BANK:A", { rule: "R1_EXACT_REFERENCE", bankRecordIds: ["A"], ledgerRecordIds: ["L1"], reasonCode: "EXACT_MATCH" }),
  event("AUTO_RECONCILED", 5, "BANK:A", { rule: "R1_EXACT_REFERENCE", bankRecordIds: ["A"], ledgerRecordIds: ["L1"], reasonCode: "EXACT_MATCH" }),
  event("CASE_FINALIZED", 6, "BANK:A", { outcome: "RECONCILED", bankRecordIds: ["A"], ledgerRecordIds: ["L1"], reasonCode: "EXACT_MATCH" }),
  event("RUN_COMPLETED", 7, null, { casesProcessed: 1 }),
];

const reasoningEvents: TraceEvent[] = [
  event("RUN_STARTED", 1, null),
  event("CASE_STARTED", 2, "BANK:A", { primarySide: "BANK", primaryRecordId: "A" }),
  event("CANDIDATES_GENERATED", 3, "BANK:A", {
    candidateRecordIds: ["L1", "L2"],
    candidates: [
      { side: "LEDGER", recordId: "L1", selectionTier: "REFERENCE", signals: ["NORMALIZED_REFERENCE"], facts: { amountPaise: "125000", currency: "INR", date: "2026-08-23" } },
      { side: "LEDGER", recordId: "L2", selectionTier: "CONTEXT", signals: ["AMOUNT", "DATE_WINDOW"], facts: { amountPaise: "125000", currency: "INR", date: "2026-08-24" } },
    ],
    totalEligibleCandidates: 2,
    truncated: false,
  }),
  event("AGENT_STARTED", 4, "BANK:A", { candidateCount: 2, primarySide: "BANK", primaryRecordId: "A" }),
  event("AGENT_PROPOSED", 5, "BANK:A", { proposedOutcome: "MATCH", bankRecordIds: ["A"], ledgerRecordIds: ["L1"], confidence: "HIGH", reason: "The references describe the same event.", evidence: [{ statement: "Reference evidence", source: "CROSS_RECORD", recordIds: ["A", "L1"] }], conflictingEvidence: [] }),
  event("VERIFICATION_CHECKED", 6, "BANK:A", { result: { status: "REJECTED", failures: [{ code: "AMOUNT_MISMATCH", message: "The proposed relationship does not balance exactly.", recordIds: ["A", "L1"] }] } }),
  event("CASE_FINALIZED", 7, "BANK:A", { outcome: "UNRESOLVED", bankRecordIds: ["A"], ledgerRecordIds: [], reasonCode: "VERIFICATION_FAILED" }),
  event("RUN_COMPLETED", 8, null, { casesProcessed: 1 }),
];

beforeEach(() => {
  api.getRunTrace.mockResolvedValue(deterministicEvents);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("T032 reconciliation trace", () => {
  it("shows an intentional empty state without requesting a trace", () => {
    render(<TracePage />);
    expect(screen.getByRole("heading", { name: "Select a reconciliation run" })).toBeTruthy();
    expect(api.getRunTrace).not.toHaveBeenCalled();
  });

  it("loads the persisted trace once and preserves sequence order", async () => {
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(api.getRunTrace).toHaveBeenCalledOnce());
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent?.match(/#\d+/)?.[0])).toEqual(["#1", "#2", "#3", "#4", "#5", "#6", "#7"]);
    expect(screen.getAllByText("Run-level event").length).toBe(2);
    expect(screen.queryByText("Case null")).toBeNull();
  });

  it("renders deterministic execution without inventing later stages", async () => {
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(screen.getByText("Rule produced proposal")).toBeTruthy());
    expect(screen.queryByText("Candidates generated")).toBeNull();
    expect(screen.queryByText("Agent reasoning started")).toBeNull();
    expect(screen.queryByText("Verification checked")).toBeNull();
    expect(screen.getByText(/produced a successful MATCH proposal/)).toBeTruthy();
    expect(screen.queryByText("Final reconciliation")).toBeNull();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1]!).getByText("Run")).toBeTruthy();
    expect(within(rows[3]!).getByText("Rules").className).toContain("bg-tally-accent-soft");
    expect(within(rows[4]!).getByText("Rules").className).toContain("bg-tally-success-soft");
  });

  it("distinguishes candidate generation, rejected proposal, verification, and final outcome", async () => {
    api.getRunTrace.mockResolvedValue(reasoningEvents);
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(screen.getByText("Candidates generated")).toBeTruthy());
    const rows = screen.getAllByRole("listitem");
    expect(screen.getByText("2 eligible candidates generated")).toBeTruthy();
    fireEvent.click(within(rows[2]!).getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Candidate L1")).toBeTruthy();
    expect(screen.getByText("Normalized Reference")).toBeTruthy();
    expect(screen.getAllByText("INR")).toHaveLength(2);
    expect(screen.getByText("Agent proposal")).toBeTruthy();
    fireEvent.click(within(rows[4]!).getByRole("button", { name: "Show details" }));
    expect(screen.getByText("The references describe the same event.")).toBeTruthy();
    fireEvent.click(within(rows[5]!).getByRole("button", { name: "Show details" }));
    expect(screen.getAllByText("Verification rejected").length).toBeGreaterThan(0);
    expect(screen.getByText("AMOUNT_MISMATCH")).toBeTruthy();
    expect(screen.getByText("The proposed relationship does not balance exactly.")).toBeTruthy();
    expect(screen.getByText("Records: A, L1")).toBeTruthy();
    expect(screen.getByText("Case finalized")).toBeTruthy();
    expect(screen.getByText(/Unresolved · Verification Failed/)).toBeTruthy();
  });

  it("renders run workload metrics as an operational summary", async () => {
    api.getRunTrace.mockResolvedValue([
      event("RUN_COMPLETED", 1, null, {
        casesProcessed: 20,
        metrics: {
          totalSourceRecords: 45,
          logicalCases: 20,
          deterministicallyResolved: 11,
          deterministicExceptions: 3,
          aiEscalations: 6,
          aiEscalationRate: 0.3,
          initialAiCalls: 6,
          aiRepairCalls: 0,
          aiProposalsAccepted: 6,
          aiProposalsRejected: 0,
          aiAbstentions: 2,
          totalModelCalls: 6,
          durationMs: 17,
        },
      }),
    ]);
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(screen.getByText("20 investigations · 6 AI escalations · 6 model calls")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("30% escalation rate")).toBeTruthy();
    expect(screen.getByText("14 deterministic")).toBeTruthy();
    expect(screen.getByText("2 abstentions")).toBeTruthy();
  });

  it("uses the persisted final outcome for finalization styling", async () => {
    api.getRunTrace.mockResolvedValue([
      event("CASE_FINALIZED", 1, "BANK:A", { outcome: "RECONCILED", reasonCode: "EXACT_MATCH" }),
      event("CASE_FINALIZED", 2, "BANK:B", { outcome: "DISCREPANCY", reasonCode: "AMOUNT_DISCREPANCY" }),
      event("CASE_FINALIZED", 3, "BANK:C", { outcome: "UNRESOLVED", reasonCode: "INSUFFICIENT_EVIDENCE" }),
    ]);
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]!).getByText("Outcome").className).toContain("bg-tally-success-soft");
    expect(within(rows[1]!).getByText("Outcome").className).toContain("bg-tally-danger-soft");
    expect(within(rows[2]!).getByText("Outcome").className).toContain("bg-tally-warning-soft");
  });

  it("renders verified relationship details from the persisted verifier union", async () => {
    api.getRunTrace.mockResolvedValue([
      event("VERIFICATION_CHECKED", 1, "BANK:A", { result: { status: "VERIFIED", bankRecordIds: ["A"], ledgerRecordIds: ["L1"], outcome: "DISCREPANCY", reasonCode: "AMOUNT_DISCREPANCY", amountDeltaPaise: "5000" } }),
    ]);
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(screen.getByText("Verification checked")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("L1")).toBeTruthy();
    expect(screen.getByText("AMOUNT_DISCREPANCY")).toBeTruthy();
    expect(screen.getByText("Amount delta: 5000")).toBeTruthy();
  });

  it("discloses a truncated candidate list without inferring hidden candidates", async () => {
    api.getRunTrace.mockResolvedValue([
      event("CANDIDATES_GENERATED", 1, "BANK:A", { candidateRecordIds: ["L1"], totalEligibleCandidates: 4, truncated: true }),
    ]);
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(screen.getByText("4 eligible candidates generated · list truncated")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Truncated")).toBeTruthy();
    expect(screen.getByText("The persisted candidate list was truncated; hidden candidates are not inferred.")).toBeTruthy();
  });

  it("preserves concurrent agent interleaving and filters cases client-side", async () => {
    const concurrent = [
      event("AGENT_STARTED", 1, "BANK:A", { candidateCount: 1 }),
      event("AGENT_STARTED", 2, "BANK:B", { candidateCount: 1 }),
      event("AGENT_PROPOSED", 3, "BANK:B", { proposedOutcome: "MATCH", confidence: "HIGH", evidence: [], conflictingEvidence: [] }),
      event("AGENT_PROPOSED", 4, "BANK:A", { proposedOutcome: "MATCH", confidence: "HIGH", evidence: [], conflictingEvidence: [] }),
      event("RUN_COMPLETED", 5, null, { casesProcessed: 2 }),
    ];
    api.getRunTrace.mockResolvedValue(concurrent);
    render(<TracePage runId="run-test" />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));
    expect(screen.getAllByRole("listitem").map((row) => row.textContent?.match(/#\d+/)?.[0])).toEqual(["#1", "#2", "#3", "#4", "#5"]);
    fireEvent.change(screen.getByLabelText("Case"), { target: { value: "BANK:A" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText("Case BANK:B")).toBeNull();
    expect(screen.getByText("Run-level event")).toBeTruthy();
  });

  it("shows safe not-found and generic error states", async () => {
    api.getRunTrace.mockRejectedValueOnce(new Error("run not found"));
    render(<TracePage runId="missing" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Run not found" })).toBeTruthy());

    cleanup();
    api.getRunTrace.mockRejectedValueOnce(new Error("database alignment failure"));
    render(<TracePage runId="broken" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Trace could not be loaded" })).toBeTruthy());
    expect(screen.queryByText("database alignment failure")).toBeNull();
  });

  it("shows an explicit unavailable state when the run has no persisted trace", async () => {
    api.getRunTrace.mockRejectedValueOnce({ code: "TRACE_NOT_FOUND", message: "Trace data is unavailable for this run." });
    render(<TracePage runId="empty-trace" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Trace unavailable" })).toBeTruthy());
    expect(screen.getByText("This run has no persisted execution trace. No events were synthesized.")).toBeTruthy();
    expect(screen.queryByText("No recorded events match these filters.")).toBeNull();
  });
});
