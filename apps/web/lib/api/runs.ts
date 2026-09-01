import type { AgentEvidence, FinalOutcome, ReasonCode, TraceEvent } from "@tally/contracts";

export type CreateRunInput = { asOfDate: string; bankCsv: string; ledgerCsv: string };
export type RunStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type CreatedRun = { runId: string; status: "PENDING" | "PROCESSING" | "COMPLETED" };
export type RunSummary = {
  runId: string;
  status: RunStatus;
  totalCases: number;
  reconciled: number;
  explainedOutstanding: number;
  discrepancies: number;
  unresolved: number;
  totalWorkItems?: number;
  completedWorkItems?: number;
  failedWorkItems?: number;
  pendingWorkItems?: number;
  activeWorkItems?: number;
  totalSourceRecords?: number;
  logicalCases?: number;
  deterministicallyResolved?: number;
  deterministicExceptions?: number;
  aiEscalations?: number;
  aiEscalationRate?: number;
  initialAiCalls?: number;
  aiRepairCalls?: number;
  aiProposalsAccepted?: number;
  aiProposalsRejected?: number;
  aiAbstentions?: number;
  totalModelCalls?: number;
  durationMs?: number;
};
export type RunResult = {
  resultId?: string;
  caseId: string;
  bankTxnIds: string[];
  ledgerTxnIds: string[];
  finalOutcome: FinalOutcome;
  reasonCode: ReasonCode;
  source?: string;
  verificationStatus?: "VERIFIED" | "REJECTED";
  rule?: string | null;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | null;
  evidence?: AgentEvidence[];
  conflictingEvidence?: AgentEvidence[];
  reason?: string | null;
  amountDeltaPaise?: string | null;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code = "REQUEST_FAILED";
    try {
      const body = await response.json() as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
      else if (body.error) message = body.error;
    } catch { /* Keep the status message when the response is not JSON. */ }
    throw new ApiRequestError(code, message, response.status);
  }
  return response.json() as Promise<T>;
}

export function createRun(input: CreateRunInput): Promise<CreatedRun> {
  return request<CreatedRun>("/api/runs", { method: "POST", body: JSON.stringify(input) });
}

export function getRun(runId: string): Promise<RunSummary> {
  return request<RunSummary>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function cancelRun(runId: string): Promise<{ status: "CANCEL_REQUESTED" }> {
  return request<{ status: "CANCEL_REQUESTED" }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

export function getRunResults(runId: string): Promise<RunResult[]> {
  return request<RunResult[]>(`/api/runs/${encodeURIComponent(runId)}/results`);
}

export function getRunTrace(runId: string): Promise<TraceEvent[]> {
  return request<TraceEvent[]>(`/api/runs/${encodeURIComponent(runId)}/trace`);
}
