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

  it("releases a slice even when provider work ignores cancellation", async () => {
    const repo = repository(async () => item());
    const worker = createReconciliationJobWorker({
      repository: repo,
      owner: "worker",
      sliceMs: 1,
      processWorkItem: async () => await new Promise<void>(() => {}),
    });

    await worker.runOnce();

    expect(repo.releaseWorkItem).toHaveBeenCalledWith("run:work:1", "worker", "WORKER_SLICE_EXPIRED");
  });

  it("does not spend the provider execution slice while waiting for quota capacity", async () => {
    vi.useFakeTimers();
    const repo = repository(async () => item());
    let startProviderRequest!: () => void;
    const worker = createReconciliationJobWorker({
      repository: repo,
      owner: "worker",
      sliceMs: 10,
      deferSliceUntilProviderRequest: true,
      processWorkItem: async (_item, signal, controls) => {
        startProviderRequest = controls.startProviderRequest;
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      },
    });

    const running = worker.runOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(repo.releaseWorkItem).not.toHaveBeenCalled();

    startProviderRequest();
    await vi.advanceTimersByTimeAsync(10);
    await running;

    expect(repo.releaseWorkItem).toHaveBeenCalledWith("run:work:1", "worker", "WORKER_SLICE_EXPIRED");
    vi.useRealTimers();
  });

  it("keeps polling after a claim failure", async () => {
    let attempts = 0;
    const repo = repository(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary database failure");
      return attempts === 2 ? item() : undefined;
    });
    let processed!: () => void;
    const didProcess = new Promise<void>((resolve) => { processed = resolve; });
    const worker = createReconciliationJobWorker({ repository: repo, owner: "worker", pollIntervalMs: 1, processWorkItem: async () => processed() });

    const running = worker.run();
    await didProcess;
    worker.stop();
    await running;

    expect(repo.completeWorkItem).toHaveBeenCalledOnce();
  });

  it("logs a claimWorkItem failure with its stack before polling again", async () => {
    const failure = new Error("claim query failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    let worker!: ReturnType<typeof createReconciliationJobWorker>;
    const repo = repository(async () => {
      attempts += 1;
      if (attempts === 1) throw failure;
      worker.stop();
      return undefined;
    });
    worker = createReconciliationJobWorker({ repository: repo, owner: "worker", pollIntervalMs: 1, processWorkItem: async () => {} });

    await worker.run("run");

    expect(log).toHaveBeenCalledWith("[reconciliation-worker] claimWorkItem failed", failure);
    log.mockRestore();
  });

  it("logs a getRecoverableRunIds failure with its stack before polling again", async () => {
    const failure = new Error("recovery query failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = repository(async () => undefined);
    let attempts = 0;
    let worker!: ReturnType<typeof createReconciliationJobWorker>;
    repo.getRecoverableRunIds = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw failure;
      worker.stop();
      return [];
    });
    worker = createReconciliationJobWorker({ repository: repo, owner: "worker", pollIntervalMs: 1, processWorkItem: async () => {} });

    await worker.run();

    expect(log).toHaveBeenCalledWith("[reconciliation-worker] getRecoverableRunIds failed", failure);
    log.mockRestore();
  });

  it("claims recoverable runs with an explicit run ID", async () => {
    const repo = repository(async () => undefined);
    let polls = 0;
    let worker!: ReturnType<typeof createReconciliationJobWorker>;
    repo.getRecoverableRunIds = vi.fn(async () => {
      polls += 1;
      if (polls > 1) worker.stop();
      return polls === 1 ? ["run"] : [];
    });
    worker = createReconciliationJobWorker({ repository: repo, owner: "worker", pollIntervalMs: 1, processWorkItem: async () => {} });

    await worker.run();

    expect(repo.claimWorkItem).toHaveBeenCalledWith({ runId: "run", owner: "worker", leaseMs: 60_000 });
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
