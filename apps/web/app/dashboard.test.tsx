/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunResult } from "../lib/api/runs";

const api = vi.hoisted(() => ({
  createRun: vi.fn(),
  getRun: vi.fn(),
  getRunResults: vi.fn(),
  cancelRun: vi.fn(),
}));

vi.mock("../lib/api/runs", () => api);

import Dashboard from "./dashboard";

const resultSet: RunResult[] = [
  { caseId: "BANK:B1", bankTxnIds: ["B1", "B2"], ledgerTxnIds: ["L1"], finalOutcome: "RECONCILED", reasonCode: "GROUPED_MATCH", source: "DETERMINISTIC", rule: "R4_ONE_TO_MANY" },
  { caseId: "BANK:B2", bankTxnIds: ["B2"], ledgerTxnIds: [], finalOutcome: "EXPLAINED_OUTSTANDING", reasonCode: "TIMING_DIFFERENCE", source: "AGENT_VERIFIED", confidence: "HIGH", reason: "The maturity date explains the outstanding balance.", evidence: [{ statement: "The ledger record matures after the as-of date.", source: "LEDGER_RECORD", kind: null, recordIds: ["L2"] }], conflictingEvidence: [] },
  { caseId: "BANK:B3", bankTxnIds: ["B3"], ledgerTxnIds: ["L3"], finalOutcome: "DISCREPANCY", reasonCode: "AMOUNT_DISCREPANCY", source: "AGENT_VERIFIED", confidence: "HIGH", amountDeltaPaise: "5000", reason: "The records differ in amount.", evidence: [{ statement: "The references identify the same business event.", source: "CROSS_RECORD", kind: null, recordIds: ["B3", "L3"] }], conflictingEvidence: [{ statement: "The ledger amount does not agree with the bank amount.", source: "CROSS_RECORD", kind: null, recordIds: ["B3", "L3"] }] },
  { caseId: "LEDGER:L4", bankTxnIds: [], ledgerTxnIds: ["L4"], finalOutcome: "UNRESOLVED", reasonCode: "NO_CANDIDATE", source: "DETERMINISTIC" },
];

function completedSummary() {
  return { runId: "run_001", status: "COMPLETED", totalCases: 4, reconciled: 1, explainedOutstanding: 1, discrepancies: 1, unresolved: 1 };
}

function browserFile(contents: string, name: string) {
  const file = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(contents) });
  return file;
}

function fillForm() {
  fireEvent.change(document.getElementById("bank-file")!, { target: { files: [browserFile("bank_txn_id\nB1", "bank.csv")] } });
  fireEvent.change(document.getElementById("ledger-file")!, { target: { files: [browserFile("ledger_txn_id\nL1", "ledger.csv")] } });
  fireEvent.change(document.getElementById("as-of-date")!, { target: { value: "2026-10-01" } });
}

beforeEach(() => {
  api.createRun.mockResolvedValue({ runId: "run_001", status: "COMPLETED" });
  api.getRun.mockResolvedValue(completedSummary());
  api.getRunResults.mockResolvedValue(resultSet);
  api.cancelRun.mockResolvedValue({ status: "CANCEL_REQUESTED" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("T030 dashboard workflows", () => {
  it("allows an invalid attempt followed by a valid submission", async () => {
    render(<Dashboard />);
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    expect(api.createRun).not.toHaveBeenCalled();

    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(api.createRun).toHaveBeenCalledOnce());
  });

  it("renders an operational error without finance metrics or an unresolved result", async () => {
    api.createRun.mockRejectedValueOnce({ code: "SYSTEM_ERROR", message: "The service is temporarily unavailable." });
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No finance outcome was produced"));
    expect(screen.queryByRole("region", { name: "Run summary" })).toBeNull();
    expect(screen.queryByText("Unresolved")).toBeNull();
  });

  it("replaces processing with the persisted failed status", async () => {
    api.createRun.mockResolvedValueOnce({ runId: "run_failed", status: "PROCESSING" });
    api.getRun.mockResolvedValueOnce({ runId: "run_failed", status: "FAILED", totalCases: 0, reconciled: 0, explainedOutstanding: 0, discrepancies: 0, unresolved: 0 });
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("FAILED")).toBeTruthy());
    expect(screen.getByText(/failed operationally/)).toBeTruthy();
    expect(api.getRunResults).not.toHaveBeenCalled();
  });

  it("cancels a processing run from the dashboard", async () => {
    api.createRun.mockResolvedValueOnce({ runId: "run_cancel", status: "PROCESSING" });
    api.getRun.mockImplementation(() => new Promise(() => {}));
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop run" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    await waitFor(() => expect(api.cancelRun).toHaveBeenCalledWith("run_cancel"));
  });

  it("turns two immediate submissions into one POST and sends File.text contents", async () => {
    let resolveRun!: (value: { runId: string; status: "COMPLETED" }) => void;
    api.createRun.mockReturnValue(new Promise((resolve) => { resolveRun = resolve; }));
    render(<Dashboard />);
    fillForm();
    const form = screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(api.createRun).toHaveBeenCalledOnce());
    expect(api.createRun).toHaveBeenCalledWith({ asOfDate: "2026-10-01", bankCsv: "bank_txn_id\nB1", ledgerCsv: "ledger_txn_id\nL1" });
    resolveRun({ runId: "run_001", status: "COMPLETED" });
  });

  it("retains the created run and retries only GET after read failure", async () => {
    api.getRun.mockRejectedValueOnce(new Error("results unavailable")).mockResolvedValue(completedSummary());
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry loading results" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Retry loading results" }));
    await waitFor(() => expect(screen.getAllByText("Reconciled").length).toBeGreaterThan(0));
    expect(api.createRun).toHaveBeenCalledOnce();
    expect(api.getRun).toHaveBeenCalledTimes(2);
    expect(api.getRunResults).toHaveBeenCalledOnce();
  });

  it("renders zero results without distribution segments", async () => {
    api.getRunResults.mockResolvedValue([]);
    api.getRun.mockResolvedValue({ runId: "run_empty", status: "COMPLETED", totalCases: 0, reconciled: 0, explainedOutstanding: 0, discrepancies: 0, unresolved: 0 });
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("0 of 0 persisted results")).toBeTruthy());
    expect(document.querySelectorAll(".distribution-segment")).toHaveLength(0);
  });

  it("renders all outcomes and grouped IDs while filtering locally", async () => {
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByText("B1")).toBeTruthy());
    expect(screen.getAllByText("Processed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Explained outstanding").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Discrepancy").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unresolved").length).toBeGreaterThan(0);
    const postCalls = api.createRun.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "DISCREPANCY" } });
    expect(screen.getByText("1 of 4 persisted results")).toBeTruthy();
    expect(screen.getByText("Processed")).toBeTruthy();
    expect(api.createRun).toHaveBeenCalledTimes(postCalls);
  });

  it("opens deterministic details without inventing agent sections or fetching again", async () => {
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect result BANK:B1" })).toBeTruthy());
    const callsBeforeOpen = { create: api.createRun.mock.calls.length, summary: api.getRun.mock.calls.length, results: api.getRunResults.mock.calls.length };

    fireEvent.click(screen.getByRole("button", { name: "Inspect result BANK:B1" }));
    expect(screen.getByRole("dialog", { name: "BANK:B1" })).toBeTruthy();
    expect(screen.getAllByText("Reconciled").length).toBeGreaterThan(0);
    expect(screen.getByText("R4_ONE_TO_MANY")).toBeTruthy();
    expect(screen.getAllByText("B1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L1").length).toBeGreaterThan(0);
    expect(screen.queryByText("Agent confidence")).toBeNull();
    expect(screen.queryByText("Supporting evidence")).toBeNull();
    expect(api.createRun).toHaveBeenCalledTimes(callsBeforeOpen.create);
    expect(api.getRun).toHaveBeenCalledTimes(callsBeforeOpen.summary);
    expect(api.getRunResults).toHaveBeenCalledTimes(callsBeforeOpen.results);

    fireEvent.click(screen.getByRole("button", { name: "Close result details" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Inspect result BANK:B1" }));
    expect(screen.getByText("4 of 4 persisted results")).toBeTruthy();
  });

  it("keeps keyboard focus inside the open inspector", async () => {
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect result BANK:B1" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Inspect result BANK:B1" }));

    const closeButton = screen.getByRole("button", { name: "Close result details" });
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(closeButton);
  });

  it("renders every ID in an inverse grouped relationship", async () => {
    api.getRunResults.mockResolvedValue([
      ...resultSet,
      { caseId: "BANK:B4", bankTxnIds: ["B4"], ledgerTxnIds: ["L5", "L6", "L7"], finalOutcome: "RECONCILED", reasonCode: "GROUPED_MATCH", source: "DETERMINISTIC", rule: "R5_MANY_TO_ONE" },
    ]);
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect result BANK:B4" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Inspect result BANK:B4" }));

    expect(screen.getByRole("dialog", { name: "BANK:B4" })).toBeTruthy();
    expect(screen.getAllByText("B4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L6").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L7").length).toBeGreaterThan(0);
  });

  it("renders agent evidence, conflicts, qualitative confidence, and signed-safe amount details", async () => {
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect result BANK:B3" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Inspect result BANK:B3" }));

    expect(screen.getByRole("dialog", { name: "BANK:B3" })).toBeTruthy();
    expect(screen.getByText("Agent verified")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
    expect(screen.getByText("Supporting evidence")).toBeTruthy();
    expect(screen.getByText("The references identify the same business event.")).toBeTruthy();
    expect(screen.getByText("Conflicting evidence")).toBeTruthy();
    expect(screen.getByText("The ledger amount does not agree with the bank amount.")).toBeTruthy();
    expect(screen.getByText("5,000 paise")).toBeTruthy();
    expect(screen.queryByText("95%")).toBeNull();
  });

  it("supports one-sided results, Escape close, and filter preservation", async () => {
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect result BANK:B2" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "EXPLAINED_OUTSTANDING" } });
    const trigger = screen.getByRole("button", { name: "Inspect result BANK:B2" });
    fireEvent.click(trigger);
    expect(screen.getByText("No matched ledger record")).toBeTruthy();
    expect(screen.getByText("The maturity date explains the outstanding balance.")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((screen.getByLabelText("Filter") as HTMLSelectElement).value).toBe("EXPLAINED_OUTSTANDING");
  });

  it("renders no-candidate results without inventing a possible match", async () => {
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect result LEDGER:L4" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Inspect result LEDGER:L4" }));

    expect(screen.getByRole("dialog", { name: "LEDGER:L4" })).toBeTruthy();
    expect(screen.getAllByText("Unresolved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NO_CANDIDATE").length).toBeGreaterThan(0);
    expect(screen.getByText("No matched bank record")).toBeTruthy();
    expect(screen.queryByText(/possible match/i)).toBeNull();
  });

  it("keeps verification-failed details limited to the persisted safe outcome", async () => {
    api.getRunResults.mockResolvedValue([
      ...resultSet,
      { caseId: "BANK:B5", bankTxnIds: ["B5"], ledgerTxnIds: [], finalOutcome: "UNRESOLVED", reasonCode: "VERIFICATION_FAILED", source: "AGENT_VERIFIED", confidence: "LOW", reason: "The proposal did not pass verification.", evidence: [], conflictingEvidence: [] },
    ]);
    render(<Dashboard />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: "Run reconciliation" }).closest("form")!);
    await waitFor(() => expect(screen.getByRole("button", { name: "Inspect result BANK:B5" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Inspect result BANK:B5" }));

    expect(screen.getAllByText("Unresolved").length).toBeGreaterThan(0);
    expect(screen.getAllByText("VERIFICATION_FAILED").length).toBeGreaterThan(0);
    expect(screen.getByText("The proposal did not pass verification.")).toBeTruthy();
    expect(screen.queryByText("Verifier checks")).toBeNull();
  });
});
