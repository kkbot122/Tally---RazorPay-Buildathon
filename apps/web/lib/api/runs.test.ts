import { afterEach, describe, expect, it, vi } from "vitest";

import { createRun, getRun, getRunResults } from "./runs";

describe("runtime run API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the selected CSV contents and date to the runtime endpoint", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ runId: "run_001", status: "COMPLETED" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createRun({ asOfDate: "2026-10-01", bankCsv: "bank_txn_id\nB1", ledgerCsv: "ledger_txn_id\nL1" });

    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ asOfDate: "2026-10-01", bankCsv: "bank_txn_id\nB1", ledgerCsv: "ledger_txn_id\nL1" });
    expect(fetchMock.mock.calls[0]![0]).not.toContain("evaluate");
  });

  it("keeps reads on runtime run endpoints", async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input) => new Response(JSON.stringify(input.endsWith("results") ? [] : { runId: "run_001", status: "COMPLETED", totalCases: 0, reconciled: 0, explainedOutstanding: 0, discrepancies: 0, unresolved: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getRun("run_001");
    await getRunResults("run_001");

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/api/runs/run_001", "/api/runs/run_001/results"]);
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes("evaluate"))).toBe(true);
  });
});
