import { describe, expect, it, vi } from "vitest";
import { createReconciliationJobWorker } from "./reconciliation-job-worker.js";
import type { ReconciliationWorkItem, ReconciliationRunRepository } from "./db/reconciliation-run-repository.js";

function item(): ReconciliationWorkItem {
  return { workItemId: "run:work:1", runId: "run", sequenceNo: 1, caseIds: ["BANK:B1"], componentSnapshot: {}, candidateSnapshot: {}, status: "LEASED", attemptCount: 1, repairAttemptCount: 0, leaseOwner: "worker", leaseExpiresAt: new Date(), lastFailureClassification: null, createdAt: new Date(), updatedAt: new Date() };
}

function repository(claim: () => Promise<ReconciliationWorkItem | undefined>): ReconciliationRunRepository {
  return {
    startRun: vi.fn(), markRunFailed: vi.fn(), saveCompletedRun: vi.fn(), getRunById: vi.fn(), getResultsForRun: vi.fn(), getTraceForRun: vi.fn(),
    claimWorkItem: vi.fn(claim), releaseWorkItem: vi.fn(async () => true), completeWorkItem: vi.fn(async () => true), failWorkItem: vi.fn(async () => true), renewWorkItem: vi.fn(async () => true),
  };
}

describe("reconciliation job worker", () => {
  it("claims and completes one leased item, then becomes idle", async () => {
    let available = true;
    const repo = repository(async () => available ? (available = false, item()) : undefined);
    const processed = vi.fn(async () => {});
    const worker = createReconciliationJobWorker({ repository: repo, owner: "worker", processWorkItem: processed });
    await expect(worker.runOnce()).resolves.toBe(1);
    await expect(worker.runOnce()).resolves.toBe(0);
    expect(processed).toHaveBeenCalledOnce();
    expect(repo.completeWorkItem).toHaveBeenCalledWith("run:work:1", "worker");
  });

  it("releases a slice-expired item for another worker to reclaim", async () => {
    const repo = repository(async () => item());
    const worker = createReconciliationJobWorker({ repository: repo, owner: "worker", sliceMs: 1, processWorkItem: async () => new Promise((resolve) => setTimeout(resolve, 5)) });
    await worker.runOnce();
    expect(repo.releaseWorkItem).toHaveBeenCalledWith("run:work:1", "worker", "WORKER_SLICE_EXPIRED");
    expect(repo.completeWorkItem).not.toHaveBeenCalled();
  });

  it("aborts in-flight provider work when its run is cancelled", async () => {
    const repo = repository(async () => item());
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const worker = createReconciliationJobWorker({
      repository: repo, owner: "worker",
      processWorkItem: (_item, signal) => new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        entered();
      }),
    });
    const execution = worker.runOnce();
    await started;
    worker.abortRun("run");
    await execution;
    expect(repo.releaseWorkItem).toHaveBeenCalledWith("run:work:1", "worker", "WORKER_SLICE_EXPIRED");
  });
});
