import {
  BenchmarkCompatibilityError,
  evaluateBenchmarkRun,
  finalizeRuntimeCaseResults,
  validatePrimaryCaseAlignment,
  type BenchmarkEvaluationReport,
  type GroundTruthRow,
  type RuntimePrimaryAlignment,
} from "@tally/benchmark";
import { FinalOutcomeSchema, ReasonCodeSchema } from "@tally/contracts";
import type { FinalReconciliationResult } from "@tally/reconciliation";

import type { ReconciliationRunRepository } from "./db/reconciliation-run-repository.js";

export type BenchmarkEvaluationResponse = {
  runId: string;
  metrics: BenchmarkEvaluationReport["metrics"];
  caseTypeBreakdown: BenchmarkEvaluationReport["caseTypeBreakdown"];
  cases: BenchmarkEvaluationReport["cases"];
};

export type GroundTruthLoader = () => GroundTruthRow[] | Promise<GroundTruthRow[]>;
export type PrimaryCaseAlignmentLoader = () => RuntimePrimaryAlignment[] | Promise<RuntimePrimaryAlignment[]>;

export type BenchmarkEvaluationErrorCode =
  | "RUN_NOT_FOUND"
  | "RUN_NOT_COMPLETED"
  | "RUN_NOT_BENCHMARK_COMPATIBLE"
  | "EVALUATION_FAILED";

export class BenchmarkEvaluationError extends Error {
  constructor(readonly code: BenchmarkEvaluationErrorCode, message: string) {
    super(message);
    this.name = "BenchmarkEvaluationError";
  }
}

export function createBenchmarkEvaluationService(
  repository: ReconciliationRunRepository,
  loadGroundTruth: GroundTruthLoader,
  loadPrimaryCaseAlignment: PrimaryCaseAlignmentLoader,
): { evaluate(runId: string): Promise<BenchmarkEvaluationResponse> } {
  return {
    async evaluate(runId) {
      const run = await repository.getRunById(runId);
      if (run === undefined) throw new BenchmarkEvaluationError("RUN_NOT_FOUND", "run not found");
      if (run.status !== "COMPLETED") throw new BenchmarkEvaluationError("RUN_NOT_COMPLETED", "run is not completed");

      const persistedResults = await repository.getResultsForRun(runId);
      const results = persistedResults.map(toFinalResult);
      let groundTruth: GroundTruthRow[];
      let primaryCaseAlignment: RuntimePrimaryAlignment[];
      try {
        groundTruth = await loadGroundTruth();
        primaryCaseAlignment = await loadPrimaryCaseAlignment();
        validatePrimaryCaseAlignment(primaryCaseAlignment);
      } catch (error) {
        throw new BenchmarkEvaluationError("EVALUATION_FAILED", error instanceof Error ? error.message : "ground truth could not be loaded");
      }

      try {
        const finalizedResults = finalizeRuntimeCaseResults({ results, primaryCaseAlignment });
        const report = evaluateBenchmarkRun({ results: finalizedResults, groundTruth, primaryCaseAlignment });
        return { runId, ...report };
      } catch (error) {
        if (error instanceof BenchmarkCompatibilityError) {
          throw new BenchmarkEvaluationError("RUN_NOT_BENCHMARK_COMPATIBLE", error.message);
        }
        throw new BenchmarkEvaluationError("EVALUATION_FAILED", error instanceof Error ? error.message : "evaluation failed");
      }
    },
  };
}

function toFinalResult(row: Awaited<ReturnType<ReconciliationRunRepository["getResultsForRun"]>>[number]): FinalReconciliationResult {
  const outcome = FinalOutcomeSchema.safeParse(row.finalOutcome);
  const reasonCode = ReasonCodeSchema.safeParse(row.reasonCode);
  if (!outcome.success || !reasonCode.success) throw new BenchmarkEvaluationError("EVALUATION_FAILED", `invalid persisted result ${row.caseId}`);
  if (row.source !== "DETERMINISTIC" && row.source !== "AGENT_VERIFIED") {
    throw new BenchmarkEvaluationError("EVALUATION_FAILED", `invalid persisted result source ${row.caseId}`);
  }
  return {
    caseId: row.caseId,
    outcome: outcome.data,
    bankRecordIds: [...row.bankTxnIds],
    ledgerRecordIds: [...row.ledgerTxnIds],
    reasonCode: reasonCode.data,
    source: row.source,
    ...(row.rule === null ? {} : { rule: row.rule as FinalReconciliationResult["rule"] }),
    ...(row.confidence === null ? {} : { confidence: row.confidence }),
    evidence: row.evidence as FinalReconciliationResult["evidence"],
    conflictingEvidence: row.conflictingEvidence as FinalReconciliationResult["conflictingEvidence"],
    reason: row.reason ?? undefined,
    amountDeltaPaise: row.amountDeltaPaise ?? undefined,
    finalizationOrder: row.finalizationOrder ?? invalidFinalizationOrder(row.caseId),
  };
}

function invalidFinalizationOrder(caseId: string): never {
  throw new BenchmarkEvaluationError("RUN_NOT_BENCHMARK_COMPATIBLE", `persisted result lacks finalization order: ${caseId}`);
}
