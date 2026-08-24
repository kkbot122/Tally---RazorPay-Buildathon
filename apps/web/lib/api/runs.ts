import type { FinalOutcome, ReasonCode } from "@tally/contracts";

export type CreateRunInput = { asOfDate: string; bankCsv: string; ledgerCsv: string };
export type CreatedRun = { runId: string; status: "COMPLETED" };
export type RunSummary = {
  runId: string;
  status: string;
  totalCases: number;
  reconciled: number;
  explainedOutstanding: number;
  discrepancies: number;
  unresolved: number;
};
export type RunResult = {
  resultId?: string;
  caseId: string;
  bankTxnIds: string[];
  ledgerTxnIds: string[];
  finalOutcome: FinalOutcome;
  reasonCode: ReasonCode;
  source?: string;
  rule?: string | null;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | null;
  amountDeltaPaise?: string | null;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* Keep the status message when the response is not JSON. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function createRun(input: CreateRunInput): Promise<CreatedRun> {
  return request<CreatedRun>("/api/runs", { method: "POST", body: JSON.stringify(input) });
}

export function getRun(runId: string): Promise<RunSummary> {
  return request<RunSummary>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function getRunResults(runId: string): Promise<RunResult[]> {
  return request<RunResult[]>(`/api/runs/${encodeURIComponent(runId)}/results`);
}
