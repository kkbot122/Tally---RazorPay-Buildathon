import { randomUUID } from "node:crypto";
import {
  parseBankCsv,
  parseLedgerCsv,
  runReconciliation,
  ReasoningAdapterError,
  ReconciliationOperationalError,
  type ReasoningModelAdapter,
  type ReconciliationRunResult,
} from "@tally/reconciliation";
import { z } from "zod";

import type {
  PersistCompletedRunInput,
  PersistedTraceEvent,
  ReconciliationRunRepository,
} from "./db/reconciliation-run-repository.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must use YYYY-MM-DD").refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "asOfDate must be a real calendar date");

export const CreateRunRequestSchema = z.object({
  asOfDate: date,
  bankCsv: z.string().min(1),
  ledgerCsv: z.string().min(1),
}).strict();

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export interface ReconciliationRunService {
  createRun(request: CreateRunRequest): Promise<{ runId: string; status: "COMPLETED" }>;
  getSummary(runId: string): Promise<RunSummary | undefined>;
  getResults(runId: string): Promise<unknown[] | undefined>;
  getResult(runId: string, caseId: string): Promise<unknown | undefined>;
  getExceptions(runId: string): Promise<unknown[] | undefined>;
  getTrace(runId: string): Promise<unknown[] | undefined>;
}

export class TraceUnavailableError extends Error {
  readonly code = "TRACE_NOT_FOUND" as const;

  constructor() {
    super("Trace data is unavailable for this run.");
    this.name = "TraceUnavailableError";
  }
}

export class RunFailedError extends Error {
  readonly code = "RUN_FAILED" as const;

  constructor() {
    super("This reconciliation run failed and has no finance results.");
    this.name = "RunFailedError";
  }
}

export type RunSummary = {
  runId: string;
  status: string;
  totalCases: number;
  reconciled: number;
  explainedOutstanding: number;
  discrepancies: number;
  unresolved: number;
};

export function createReconciliationRunService(
  repository: ReconciliationRunRepository,
  modelAdapter: ReasoningModelAdapter,
  pipeline: typeof runReconciliation = runReconciliation,
  generateRunId: () => string = () => `run_${randomUUID()}`,
  onVerificationFailure?: Parameters<typeof runReconciliation>[0]["onVerificationFailure"],
): ReconciliationRunService {
  return {
    async createRun(request) {
      const validatedRequest = CreateRunRequestSchema.parse(request);
      // Validate both CSV documents before invoking the pipeline. The pipeline
      // remains the single execution path; this guard only makes bad requests
      // fail before model calls or persistence.
      parseBankCsv(validatedRequest.bankCsv);
      parseLedgerCsv(validatedRequest.ledgerCsv);
      const runId = generateRunId();
      await repository.startRun({ runId, asOfDate: validatedRequest.asOfDate });
      try {
        const result = await pipeline({
          runId,
          asOfDate: validatedRequest.asOfDate,
          bankCsv: validatedRequest.bankCsv,
          ledgerCsv: validatedRequest.ledgerCsv,
          modelAdapter,
          onVerificationFailure,
        });
        try {
          await repository.saveCompletedRun(toPersistenceInput(validatedRequest.asOfDate, result));
        } catch (error) {
          attachTrace(error, result.trace);
          throw error;
        }
      } catch (error) {
        try {
          const trace = toPersistenceTrace(runId, error);
          if (trace.length > 0) await repository.markRunFailed(runId, failureCode(error), trace);
          else await repository.markRunFailed(runId, failureCode(error));
        } catch {
          // Preserve the original provider/pipeline/persistence failure.
        }
        throw error;
      }
      return { runId, status: "COMPLETED" as const };
    },
    async getSummary(runId) {
      const run = await repository.getRunById(runId);
      if (run === undefined) return undefined;
      if (run.status === "FAILED") throw new RunFailedError();
      const results = await repository.getResultsForRun(runId);
      return {
        runId,
        status: run.status,
        totalCases: results.length,
        reconciled: results.filter((result) => result.finalOutcome === "RECONCILED").length,
        explainedOutstanding: results.filter((result) => result.finalOutcome === "EXPLAINED_OUTSTANDING").length,
        discrepancies: results.filter((result) => result.finalOutcome === "DISCREPANCY").length,
        unresolved: results.filter((result) => result.finalOutcome === "UNRESOLVED").length,
      };
    },
    async getResults(runId) {
      const run = await repository.getRunById(runId);
      if (run === undefined) return undefined;
      if (run.status === "FAILED") throw new RunFailedError();
      return repository.getResultsForRun(runId);
    },
    async getResult(runId, caseId) {
      const results = await this.getResults(runId);
      if (results === undefined) return undefined;
      return results.find((result) => (result as { caseId?: unknown }).caseId === caseId);
    },
    async getExceptions(runId) {
      const results = await this.getResults(runId);
      if (results === undefined) return undefined;
      return results.filter((result) => {
        const outcome = (result as { finalOutcome?: unknown }).finalOutcome;
        return outcome === "DISCREPANCY" || outcome === "UNRESOLVED";
      });
    },
    async getTrace(runId) {
      if (await repository.getRunById(runId) === undefined) return undefined;
      const trace = await repository.getTraceForRun(runId);
      if (trace.length === 0) throw new TraceUnavailableError();
      return trace;
    },
  };
}

function failureCode(error: unknown): string {
  if (error instanceof ReasoningAdapterError || error instanceof ReconciliationOperationalError) return error.code;
  return "SYSTEM_ERROR";
}

function toPersistenceInput(asOfDate: string, result: ReconciliationRunResult): PersistCompletedRunInput {
  return {
    runId: result.runId,
    asOfDate,
    results: result.results,
    trace: result.trace.map((event) => ({
      eventId: event.eventId,
      runId: event.runId,
      sequenceNo: event.sequenceNo,
      caseId: event.caseId,
      type: event.type,
      occurredAt: event.occurredAt,
      message: event.message,
      payload: event.payload,
    })),
  };
}

function toPersistenceTrace(runId: string, error: unknown): PersistedTraceEvent[] {
  const trace = (error as { reconciliationTrace?: ReconciliationRunResult["trace"] }).reconciliationTrace;
  if (!Array.isArray(trace)) return [];
  return trace.map((event) => ({
    eventId: event.eventId,
    runId,
    sequenceNo: event.sequenceNo,
    caseId: event.caseId,
    type: event.type,
    occurredAt: event.occurredAt,
    message: event.message,
    payload: event.payload,
  }));
}

function attachTrace(error: unknown, trace: ReconciliationRunResult["trace"]): void {
  if (error !== null && typeof error === "object") {
    Object.defineProperty(error, "reconciliationTrace", {
      configurable: true,
      enumerable: false,
      value: trace,
    });
  }
}
