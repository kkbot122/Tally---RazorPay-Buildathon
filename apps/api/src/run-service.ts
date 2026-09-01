import { randomUUID } from "node:crypto";
import {
  parseBankCsv,
  parseLedgerCsv,
  runReconciliation,
  planReconciliation,
  processPlannedComponent,
  processPlannedBatch,
  ReasoningAdapterError,
  ReconciliationOperationalError,
  ReconciliationRunAbortedError,
  type ReasoningModelAdapter,
  type ReconciliationRunResult,
  type PlannedReasoningComponent,
} from "@tally/reconciliation";
import { z } from "zod";

import type {
  PersistCompletedRunInput,
  PersistedTraceEvent,
  ReconciliationRunRepository,
} from "./db/reconciliation-run-repository.js";
import { createReconciliationJobWorker } from "./reconciliation-job-worker.js";

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
export type RunStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type DurableWorkerConfiguration = { concurrency?: number; leaseMs?: number; sliceMs?: number; pollIntervalMs?: number; maxReasoningItemsPerRequest?: number };

export interface ReconciliationRunService {
  createRun(request: CreateRunRequest): Promise<{ runId: string; status: "PENDING" | "PROCESSING" | "COMPLETED" }>;
  getSummary(runId: string): Promise<RunSummary | undefined>;
  getResults(runId: string): Promise<unknown[] | undefined>;
  getResult(runId: string, caseId: string): Promise<unknown | undefined>;
  getExceptions(runId: string): Promise<unknown[] | undefined>;
  getTrace(runId: string): Promise<unknown[] | undefined>;
  cancelRun(runId: string): Promise<boolean>;
  recoverPendingRuns?(): Promise<void>;
  startWorker?(): Promise<void>;
  stopWorker?(): void;
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
};

export function createReconciliationRunService(
  repository: ReconciliationRunRepository,
  modelAdapter: ReasoningModelAdapter,
  pipeline: typeof runReconciliation = runReconciliation,
  generateRunId: () => string = () => `run_${randomUUID()}`,
  onVerificationFailure?: Parameters<typeof runReconciliation>[0]["onVerificationFailure"],
  schedule: (task: () => Promise<void>) => void = (task) => { void task(); },
  reasoningConcurrency = 2,
  onRunFailure?: (event: { runId: string; failureCode: string; traceEventCount: number; failurePersistenceFailed?: boolean }) => void,
  onModelFailure?: Parameters<typeof runReconciliation>[0]["onModelFailure"],
  runDeadlineMs = 90_000,
  maxReasoningCalls = 100,
  workerConfiguration: DurableWorkerConfiguration = {},
): ReconciliationRunService {
  const controllers = new Map<string, AbortController>();
  const durableJobs = repository.cancelRunDurably !== undefined && repository.claimWorkItem !== undefined;
  const workerOwner = `api_${randomUUID()}`;
  let durableWorker: ReturnType<typeof createReconciliationJobWorker> | undefined;

  function ensureWorker(): void {
    if (!durableJobs || durableWorker !== undefined || repository.getRunInput === undefined || repository.persistPlan === undefined || repository.persistResultCheckpoint === undefined || repository.finalizeRun === undefined) return;
    durableWorker = createReconciliationJobWorker({
      repository, owner: workerOwner,
      concurrency: workerConfiguration.concurrency ?? 1,
      leaseMs: workerConfiguration.leaseMs ?? Math.max(runDeadlineMs * 2, 60_000),
      sliceMs: workerConfiguration.sliceMs ?? runDeadlineMs,
      pollIntervalMs: workerConfiguration.pollIntervalMs ?? 1_000,
      onEvent: (event) => {
        if (event.runId === undefined || repository.appendOperationalTrace === undefined) return;
        const type = ({ claimed: "WORK_ITEM_CLAIMED", completed: "WORK_ITEM_COMPLETED", failed: "WORK_ITEM_FAILED", released: "WORK_ITEM_RELEASED", slice_yielded: "WORKER_SLICE_YIELDED" } as const)[event.type];
        void repository.appendOperationalTrace({ runId: event.runId, type, message: `Reconciliation work item ${event.type}.`, metadata: { workItemId: event.workItemId, durationMs: event.durationMs, classification: event.classification } });
        if (event.type === "completed") void repository.finalizeRun?.(event.runId);
        if (event.type === "failed") {
          // A failed work item has no verified terminal result. Mark the run
          // failed rather than allowing a later finalization to misrepresent
          // partial checkpoint data as a completed reconciliation.
          void repository.markRunFailed(event.runId, event.classification ?? "WORK_ITEM_FAILED");
        }
      },
      processWorkItem: async (workItem, signal) => {
        const input = await repository.getRunInput!(workItem.runId);
        if (input === undefined) throw new Error("RUN_INPUT_NOT_FOUND");
        const plan = planReconciliation({ ...input, runId: workItem.runId });
        const snapshot = workItem.componentSnapshot as { components?: Array<PlannedReasoningComponent | { componentId: string }> };
        const components = (snapshot.components ?? []).map((entry) => "promptInput" in entry
          ? entry as PlannedReasoningComponent
          : plan.components.find((component) => component.componentId === entry.componentId)).filter((component): component is PlannedReasoningComponent => component !== undefined);
        const processed = await processPlannedBatch({ runId: workItem.runId, asOfDate: input.asOfDate, components, modelAdapter, signal });
        await repository.persistResultCheckpoint!({ runId: workItem.runId, results: processed.results, trace: processed.trace.map(toPersistedTrace) });
      },
    });
    void durableWorker.run();
  }

  async function executeRun(runId: string, request: CreateRunRequest, controller: AbortController): Promise<void> {
    if (durableJobs && repository.persistPlan !== undefined && repository.persistResultCheckpoint !== undefined && repository.finalizeRun !== undefined) {
      return;
    }
    await executeLegacyRun(runId, request, controller);
  }

  async function executeLegacyRun(runId: string, request: CreateRunRequest, controller: AbortController): Promise<void> {
    const workItem = durableJobs ? await repository.claimWorkItem!({ runId, owner: workerOwner, leaseMs: 60_000 }) : undefined;
    if (durableJobs && workItem === undefined) return;
    await repository.markRunProcessing?.(runId);
    const deadline = setTimeout(() => controller.abort("RUN_DEADLINE_EXCEEDED"), runDeadlineMs);
    try {
      const result = await pipeline({
        runId,
        asOfDate: request.asOfDate,
        bankCsv: request.bankCsv,
        ledgerCsv: request.ledgerCsv,
        modelAdapter,
        reasoningConcurrency,
        maxReasoningCalls,
        onVerificationFailure,
        onModelFailure,
        signal: controller.signal,
      });
      try {
        await repository.saveCompletedRun(toPersistenceInput(request.asOfDate, result));
        if (workItem !== undefined) await repository.completeWorkItem?.(workItem.workItemId, workerOwner);
      } catch (error) {
        attachTrace(error, result.trace);
        throw error;
      }
    } catch (error) {
      const code = failureCode(error);
      if (code === "RUN_CANCELLED" && repository.cancelRunDurably !== undefined) return;
      if (workItem !== undefined && code === "RUN_DEADLINE_EXCEEDED") {
        await repository.releaseWorkItem?.(workItem.workItemId, workerOwner, "WORKER_SLICE_EXPIRED");
        return;
      }
      const trace = toPersistenceTrace(runId, error);
      const persistedTrace = trace.length > 0 ? trace : fallbackFailureTrace(runId, code);
      onRunFailure?.({ runId, failureCode: code, traceEventCount: persistedTrace.length });
      try {
        await repository.markRunFailed(runId, code, persistedTrace);
      } catch {
        onRunFailure?.({ runId, failureCode: code, traceEventCount: persistedTrace.length, failurePersistenceFailed: true });
      }
    } finally {
      clearTimeout(deadline);
      controllers.delete(runId);
    }
  }

  return {
    async createRun(request) {
      const validatedRequest = CreateRunRequestSchema.parse(request);
      // Validate both CSV documents before invoking the pipeline. The pipeline
      // remains the single execution path; this guard only makes bad requests
      // fail before model calls or persistence.
      parseBankCsv(validatedRequest.bankCsv);
      parseLedgerCsv(validatedRequest.ledgerCsv);
      const runId = generateRunId();
      await repository.startRun({ runId, asOfDate: validatedRequest.asOfDate, bankCsv: validatedRequest.bankCsv, ledgerCsv: validatedRequest.ledgerCsv });
      const controller = new AbortController();
      if (!durableJobs) controllers.set(runId, controller);
      if (durableJobs && repository.persistPlan !== undefined) {
        schedule(async () => {
          await repository.persistPlan!({ ...planReconciliation({ ...validatedRequest, runId }) }, { maxItemsPerBatch: workerConfiguration.maxReasoningItemsPerRequest });
          await repository.finalizeRun?.(runId);
        });
        ensureWorker();
      } else {
        schedule(() => executeRun(runId, validatedRequest, controller));
      }
      return { runId, status: (durableJobs ? "PENDING" : "PROCESSING") as "PENDING" | "PROCESSING" };
    },
    async cancelRun(runId) {
      if (repository.cancelRunDurably !== undefined) {
        const changed = await repository.cancelRunDurably(runId);
        durableWorker?.abortRun(runId);
        controllers.get(runId)?.abort("RUN_CANCELLED");
        controllers.delete(runId);
        return changed;
      }
      const controller = controllers.get(runId);
      if (controller === undefined || controller.signal.aborted) return false;
      controller.abort("RUN_CANCELLED");
      // Remove it immediately so a scheduler that never starts the queued
      // task cannot retain controllers for abandoned runs.
      controllers.delete(runId);
      return true;
    },
    async recoverPendingRuns() {
      if (!durableJobs || repository.getRecoverableRunIds === undefined || repository.getRunInput === undefined || repository.persistPlan === undefined) return;
      ensureWorker();
      for (const runId of await repository.getRecoverableRunIds()) {
        const input = await repository.getRunInput(runId);
        if (input === undefined) continue;
        schedule(async () => {
          await repository.persistPlan!({ ...planReconciliation({ ...input, runId }) }, { maxItemsPerBatch: workerConfiguration.maxReasoningItemsPerRequest });
          await repository.finalizeRun?.(runId);
        });
      }
    },
    async startWorker() { ensureWorker(); },
    stopWorker() { durableWorker?.stop(); durableWorker = undefined; },
    async getSummary(runId) {
      const run = await repository.getRunById(runId);
      if (run === undefined) return undefined;
      if (run.status === "FAILED") return {
        runId,
        status: "FAILED",
        totalCases: 0,
        reconciled: 0,
        explainedOutstanding: 0,
        discrepancies: 0,
        unresolved: 0,
        totalWorkItems: run.totalWorkItems,
        completedWorkItems: run.completedWorkItems,
        failedWorkItems: run.failedWorkItems,
        pendingWorkItems: run.pendingWorkItems,
        activeWorkItems: run.activeWorkItems,
      };
      const results = await repository.getResultsForRun(runId);
      return {
        runId,
        status: run.status,
        totalCases: results.length,
        reconciled: results.filter((result) => result.finalOutcome === "RECONCILED").length,
        explainedOutstanding: results.filter((result) => result.finalOutcome === "EXPLAINED_OUTSTANDING").length,
        discrepancies: results.filter((result) => result.finalOutcome === "DISCREPANCY").length,
        unresolved: results.filter((result) => result.finalOutcome === "UNRESOLVED").length,
        totalWorkItems: run.totalWorkItems,
        completedWorkItems: run.completedWorkItems,
        failedWorkItems: run.failedWorkItems,
        pendingWorkItems: run.pendingWorkItems,
        activeWorkItems: run.activeWorkItems,
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
  if (error instanceof ReconciliationRunAbortedError || error instanceof ReasoningAdapterError || error instanceof ReconciliationOperationalError) return error.code;
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

function toPersistedTrace(event: ReconciliationRunResult["trace"][number]): PersistedTraceEvent {
  return {
    eventId: event.eventId,
    runId: event.runId,
    sequenceNo: event.sequenceNo,
    caseId: event.caseId,
    type: event.type,
    occurredAt: event.occurredAt,
    message: event.message,
    payload: event.payload,
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

function fallbackFailureTrace(runId: string, failureCodeValue: string): PersistedTraceEvent[] {
  return [{
    eventId: `${runId}:failure`,
    runId,
    sequenceNo: 1,
    caseId: null,
    type: "RUN_FAILED",
    occurredAt: new Date().toISOString(),
    message: "Run failed before a detailed execution trace was available.",
    payload: { failureCode: failureCodeValue },
  }];
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
