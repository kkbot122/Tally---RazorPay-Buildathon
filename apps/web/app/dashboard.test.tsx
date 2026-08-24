/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunResult } from "../lib/api/runs";

const api = vi.hoisted(() => ({
  createRun: vi.fn(),
  getRun: vi.fn(),
  getRunResults: vi.fn(),
}));

vi.mock("../lib/api/runs", () => api);

import Dashboard from "./dashboard";

const resultSet: RunResult[] = [
  { caseId: "BANK:B1", bankTxnIds: ["B1", "B2"], ledgerTxnIds: ["L1"], finalOutcome: "RECONCILED", reasonCode: "GROUPED_MATCH" },
  { caseId: "BANK:B2", bankTxnIds: ["B2"], ledgerTxnIds: [], finalOutcome: "EXPLAINED_OUTSTANDING", reasonCode: "TIMING_DIFFERENCE" },
  { caseId: "BANK:B3", bankTxnIds: ["B3"], ledgerTxnIds: ["L3"], finalOutcome: "DISCREPANCY", reasonCode: "AMOUNT_DISCREPANCY" },
  { caseId: "LEDGER:L4", bankTxnIds: [], ledgerTxnIds: ["L4"], finalOutcome: "UNRESOLVED", reasonCode: "NO_CANDIDATE" },
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
    expect(api.getRunResults).toHaveBeenCalledTimes(2);
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
});
