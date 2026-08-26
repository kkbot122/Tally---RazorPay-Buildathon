import { describe, expect, it, vi } from "vitest";
import { ReconciliationRunAbortedError, type ReconciliationRunResult, type ReasoningModelAdapter } from "@tally/reconciliation";

import { createReconciliationRunService, RunFailedError, type CreateRunRequest } from "./run-service.js";
import type { ReconciliationRunRepository } from "./db/reconciliation-run-repository.js";

const bankCsv = [
  "bank_txn_id,booking_date,value_date,amount,currency,direction,reference,counterparty,description,batch_id",
  "B001,2026-08-23,2026-08-23,500,INR,CREDIT,REF-1,ACME,Payment,batch-1",
].join("\n");
const ledgerCsv = [
  "ledger_txn_id,accounting_date,maturity_date,amount,currency,direction,reference,counterparty,description,source,batch_id",
  "L001,2026-08-23,2026-08-23,500,INR,CREDIT,REF-1,ACME,Payment,ERP,batch-1",
].join("\n");

function request(overrides: Partial<CreateRunRequest> = {}): CreateRunRequest {
  return { asOfDate: "2026-08-23", bankCsv, ledgerCsv, ...overrides };
}

function repository(overrides: Partial<ReconciliationRunRepository> = {}): ReconciliationRunRepository {
  return {
    startRun: vi.fn(async () => {}),
    markRunFailed: vi.fn(async () => {}),
    saveCompletedRun: vi.fn(async () => {}),
    getRunById: vi.fn(async () => undefined),
    getResultsForRun: vi.fn(async () => []),
    getTraceForRun: vi.fn(async () => []),
    ...overrides,
  };
}

function failedRunRepository(): ReconciliationRunRepository {
  return repository({
    getRunById: vi.fn(async () => ({ status: "FAILED" } as never)),
    getResultsForRun: vi.fn(async () => [{ finalOutcome: "RECONCILED" }] as never),
  });
}

function result(runId: string): ReconciliationRunResult {
  return { runId, results: [], usedRecords: { bankRecordIds: new Set(), ledgerRecordIds: new Set() }, trace: [] };
}

function controlledScheduler() {
  let task: (() => Promise<void>) | undefined;
  return {
    schedule: (next: () => Promise<void>) => { task = next; },
    run: async () => {
      if (task === undefined) throw new Error("expected a scheduled run");
      await task();
    },
    start: () => {
      if (task === undefined) throw new Error("expected a scheduled run");
      return task();
    },
  };
}

const adapter: ReasoningModelAdapter = { generateProposal: vi.fn() };

describe("reconciliation run service", () => {
  it("executes the pipeline and persistence exactly once", async () => {
    const runPipeline = vi.fn(async ({ runId }: { runId: string }) => result(runId));
    const repo = repository();
    const scheduler = controlledScheduler();
    const service = createReconciliationRunService(repo, adapter, runPipeline as typeof import("@tally/reconciliation").runReconciliation, () => "run-pipeline-failure", undefined, scheduler.schedule);

    await expect(service.createRun(request())).resolves.toMatchObject({ status: "PROCESSING" });
    expect(runPipeline).not.toHaveBeenCalled();
    await scheduler.run();
    expect(runPipeline).toHaveBeenCalledOnce();
    expect(repo.saveCompletedRun).toHaveBeenCalledOnce();
  });

  it("rejects invalid CSV and date before pipeline, model, or persistence", async () => {
    const runPipeline = vi.fn(async ({ runId }: { runId: string }) => result(runId));
    const repo = repository();
    const service = createReconciliationRunService(repo, adapter, runPipeline as typeof import("@tally/reconciliation").runReconciliation);

    await expect(service.createRun(request({ bankCsv: "not,csv" }))).rejects.toThrow();
    await expect(service.createRun(request({ asOfDate: "2026-02-30" }))).rejects.toThrow();
    expect(runPipeline).not.toHaveBeenCalled();
    expect(adapter.generateProposal).not.toHaveBeenCalled();
    expect(repo.saveCompletedRun).not.toHaveBeenCalled();
  });

  it("does not persist or rerun after a pipeline failure", async () => {
    const runPipeline = vi.fn(async () => { throw new Error("pipeline failed"); });
    const repo = repository();
    const scheduler = controlledScheduler();
    const service = createReconciliationRunService(repo, adapter, runPipeline as typeof import("@tally/reconciliation").runReconciliation, () => "run-pipeline-failure", undefined, scheduler.schedule);

    await expect(service.createRun(request())).resolves.toMatchObject({ status: "PROCESSING" });
    await scheduler.run();
    expect(runPipeline).toHaveBeenCalledOnce();
    expect(repo.saveCompletedRun).not.toHaveBeenCalled();
    expect(repo.markRunFailed).toHaveBeenCalledWith("run-pipeline-failure", "SYSTEM_ERROR", expect.arrayContaining([
      expect.objectContaining({ type: "RUN_FAILED" }),
    ]));
  });

  it("does not rerun the pipeline when persistence fails", async () => {
    const runPipeline = vi.fn(async ({ runId }: { runId: string }) => result(runId));
    const repo = repository({ saveCompletedRun: vi.fn(async () => { throw new Error("persistence failed"); }) });
    const scheduler = controlledScheduler();
    const service = createReconciliationRunService(repo, adapter, runPipeline as typeof import("@tally/reconciliation").runReconciliation, undefined, undefined, scheduler.schedule);

    await expect(service.createRun(request())).resolves.toMatchObject({ status: "PROCESSING" });
    await scheduler.run();
    expect(runPipeline).toHaveBeenCalledOnce();
  });

  it("does not expose finance results for a persisted failed run", async () => {
    const service = createReconciliationRunService(failedRunRepository(), adapter);
    await expect(service.getSummary("run-failed")).resolves.toMatchObject({ runId: "run-failed", status: "FAILED", totalCases: 0 });
    await expect(service.getResults("run-failed")).rejects.toBeInstanceOf(RunFailedError);
    await expect(service.getExceptions("run-failed")).rejects.toBeInstanceOf(RunFailedError);
  });

  it("marks a run failed when its inference deadline aborts the pipeline", async () => {
    const runPipeline = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      await new Promise<void>((_, reject) => signal?.addEventListener("abort", () => reject(new ReconciliationRunAbortedError(signal.reason === "RUN_CANCELLED" ? "RUN_CANCELLED" : "RUN_DEADLINE_EXCEEDED")), { once: true }));
      return result("run-deadline");
    });
    const repo = repository();
    const scheduler = controlledScheduler();
    const service = createReconciliationRunService(repo, adapter, runPipeline as typeof import("@tally/reconciliation").runReconciliation, () => "run-deadline", undefined, scheduler.schedule, 2, undefined, undefined, 10);

    await service.createRun(request());
    await scheduler.run();

    expect(repo.markRunFailed).toHaveBeenCalledWith("run-deadline", "RUN_DEADLINE_EXCEEDED", expect.any(Array));
  });

  it("cancels in-flight model work when the user stops a run", async () => {
    const runPipeline = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      await new Promise<void>((_, reject) => signal?.addEventListener("abort", () => reject(new ReconciliationRunAbortedError("RUN_CANCELLED")), { once: true }));
      return result("run-cancel");
    });
    const repo = repository();
    const scheduler = controlledScheduler();
    const service = createReconciliationRunService(repo, adapter, runPipeline as typeof import("@tally/reconciliation").runReconciliation, () => "run-cancel", undefined, scheduler.schedule, 2, undefined, undefined, 90_000);

    await service.createRun(request());
    const execution = scheduler.start();
    await Promise.resolve();
    await expect(service.cancelRun("run-cancel")).resolves.toBe(true);
    await execution;
    await expect(service.cancelRun("run-cancel")).resolves.toBe(false);

    expect(repo.markRunFailed).toHaveBeenCalledWith("run-cancel", "RUN_CANCELLED", expect.any(Array));
  });
});
