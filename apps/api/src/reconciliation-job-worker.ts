import { randomUUID } from "node:crypto";

import type { ReconciliationWorkItem, ReconciliationRunRepository } from "./db/reconciliation-run-repository.js";

export type ReconciliationJobWorkerOptions = {
  repository: ReconciliationRunRepository;
  processWorkItem: (item: ReconciliationWorkItem, signal: AbortSignal) => Promise<void>;
  owner?: string;
  concurrency?: number;
  leaseMs?: number;
  sliceMs?: number;
  pollIntervalMs?: number;
  onEvent?: (event: { type: "claimed" | "completed" | "failed" | "released" | "slice_yielded"; workItemId?: string; runId?: string; durationMs?: number; classification?: string }) => void;
};

/**
 * Bounded, lease-backed worker loop. The worker deliberately knows nothing
 * about reconciliation rules: recovery and ownership are infrastructure
 * concerns, while the supplied handler owns planning, reasoning, verification,
 * and idempotent result persistence.
 */
export function createReconciliationJobWorker(options: ReconciliationJobWorkerOptions) {
  const repository = options.repository;
  if (repository.claimWorkItem === undefined || repository.releaseWorkItem === undefined || repository.completeWorkItem === undefined || repository.failWorkItem === undefined) {
    throw new Error("The reconciliation repository does not support durable work items.");
  }
  const owner = options.owner ?? `worker_${randomUUID()}`;
  const concurrency = positiveInt(options.concurrency ?? 1, "concurrency");
  const leaseMs = positiveInt(options.leaseMs ?? 60_000, "leaseMs");
  const sliceMs = positiveInt(options.sliceMs ?? 30_000, "sliceMs");
  const pollIntervalMs = positiveInt(options.pollIntervalMs ?? 1_000, "pollIntervalMs");
  let stopped = false;
  const controllers = new Map<string, Set<AbortController>>();

  async function processOne(item: ReconciliationWorkItem): Promise<void> {
    const started = Date.now();
    const controller = new AbortController();
    const runControllers = controllers.get(item.runId) ?? new Set<AbortController>();
    runControllers.add(controller);
    controllers.set(item.runId, runControllers);
    const timer = setTimeout(() => controller.abort("WORKER_SLICE_EXPIRED"), sliceMs);
    const renewal = setInterval(() => {
      void repository.isRunCancelled?.(item.runId).then((cancelled) => {
        if (cancelled) controller.abort("RUN_CANCELLED");
      });
      void repository.renewWorkItem?.(item.workItemId, owner, leaseMs);
    }, Math.max(1_000, Math.floor(leaseMs / 2)));
    options.onEvent?.({ type: "claimed", workItemId: item.workItemId, runId: item.runId });
    try {
      await options.processWorkItem(item, controller.signal);
      if (controller.signal.aborted) {
        await repository.releaseWorkItem!(item.workItemId, owner, "WORKER_SLICE_EXPIRED");
        options.onEvent?.({ type: "slice_yielded", workItemId: item.workItemId, runId: item.runId, durationMs: Date.now() - started });
      } else if (await repository.completeWorkItem!(item.workItemId, owner)) {
        options.onEvent?.({ type: "completed", workItemId: item.workItemId, runId: item.runId, durationMs: Date.now() - started });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        await repository.releaseWorkItem!(item.workItemId, owner, "WORKER_SLICE_EXPIRED");
        options.onEvent?.({ type: "slice_yielded", workItemId: item.workItemId, runId: item.runId, durationMs: Date.now() - started });
      } else {
        const classification = error instanceof Error ? error.name : "UNKNOWN";
        await repository.failWorkItem!(item.workItemId, owner, classification);
        options.onEvent?.({ type: "failed", workItemId: item.workItemId, runId: item.runId, durationMs: Date.now() - started, classification });
      }
    } finally {
      clearTimeout(timer);
      clearInterval(renewal);
      runControllers.delete(controller);
      if (runControllers.size === 0) controllers.delete(item.runId);
    }
  }

  async function runOnce(runId?: string): Promise<number> {
    const tasks: Promise<void>[] = [];
    for (let index = 0; index < concurrency; index += 1) {
      const item = await repository.claimWorkItem!({ runId, owner, leaseMs });
      if (item === undefined) break;
      tasks.push(processOne(item));
    }
    await Promise.all(tasks);
    return tasks.length;
  }

  async function run(runId?: string): Promise<void> {
    while (!stopped) {
      const count = await runOnce(runId);
      if (count === 0) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return {
    owner,
    run,
    runOnce,
    abortRun(runId: string) { controllers.get(runId)?.forEach((controller) => controller.abort("RUN_CANCELLED")); },
    stop() { stopped = true; },
  };
}

function positiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
