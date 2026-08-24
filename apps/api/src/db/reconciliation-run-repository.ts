import { asc, eq } from "drizzle-orm";
import type { AgentEvidence, AgentProposal, FinalOutcome, ReasonCode, TraceEventType } from "@tally/contracts";

import {
  agentProposals,
  reconciliationResults,
  reconciliationRuns,
  traceEvents,
  verificationResults,
} from "./schema.js";
import type { DatabaseClient } from "./client.js";

export type PersistedFinalResult = {
  caseId: string;
  outcome: FinalOutcome;
  bankRecordIds: string[];
  ledgerRecordIds: string[];
  reasonCode: ReasonCode;
  source: "DETERMINISTIC" | "AGENT_VERIFIED";
  rule?: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  evidence?: AgentEvidence[];
  conflictingEvidence?: AgentEvidence[];
  reason?: string;
  amountDeltaPaise?: string;
  finalizationOrder?: number;
};

export type PersistedTraceEvent = {
  eventId: string;
  runId: string;
  sequenceNo: number;
  caseId: string | null;
  type: TraceEventType;
  occurredAt: string;
  message: string;
  payload: Record<string, unknown>;
};

export type PersistCompletedRunInput = {
  runId: string;
  asOfDate: string;
  results: readonly PersistedFinalResult[];
  trace: readonly PersistedTraceEvent[];
};

export interface ReconciliationRunRepository {
  saveCompletedRun(input: PersistCompletedRunInput): Promise<void>;
  getRunById(runId: string): Promise<typeof reconciliationRuns.$inferSelect | undefined>;
  getResultsForRun(runId: string): Promise<(typeof reconciliationResults.$inferSelect)[]>;
  getTraceForRun(runId: string): Promise<PersistedTraceEvent[]>;
}

export function createReconciliationRunRepository(db: DatabaseClient): ReconciliationRunRepository {
  return {
    async saveCompletedRun(input) {
      validatePersistCompletedRunInput(input);
      const startedAt = new Date(input.trace[0]!.occurredAt);
      const completedAt = new Date(input.trace.at(-1)!.occurredAt);
      const runStartedPayload = input.trace[0]!.payload;
      const totalBankRecords = integerPayload(runStartedPayload.bankRecordCount);
      const totalLedgerRecords = integerPayload(runStartedPayload.ledgerRecordCount);
      const proposalEvents = new Map(input.trace.filter((event) => event.type === "AGENT_PROPOSED").map((event) => [event.caseId, event]));
      const verificationEvents = new Map(input.trace.filter((event) => event.type === "VERIFICATION_CHECKED").map((event) => [event.caseId, event]));

      await db.transaction(async (tx) => {
        await tx.insert(reconciliationRuns).values({
          runId: input.runId,
          asOfDate: input.asOfDate,
          status: "COMPLETED",
          startedAt,
          completedAt,
          totalBankRecords,
          totalLedgerRecords,
          configuration: { asOfDate: input.asOfDate },
          modelMetadata: {},
        });

        const proposalRows = input.results
          .map((result) => mapProposalRow(input.runId, result, proposalEvents.get(result.caseId)))
          .filter((row): row is NonNullable<typeof row> => row !== undefined);
        if (proposalRows.length > 0) await tx.insert(agentProposals).values(proposalRows);

        const verificationRows = input.results
          .map((result) => mapVerificationRow(input.runId, result, verificationEvents.get(result.caseId)))
          .filter((row): row is NonNullable<typeof row> => row !== undefined);
        if (verificationRows.length > 0) await tx.insert(verificationResults).values(verificationRows);

        if (input.results.length > 0) {
          await tx.insert(reconciliationResults).values(input.results.map((result, index) => mapResultRow(input.runId, result, index, proposalEvents, verificationEvents)));
        }
        await tx.insert(traceEvents).values(input.trace.map((event) => ({
          eventId: event.eventId,
          runId: event.runId,
          sequenceNo: event.sequenceNo,
          caseId: event.caseId,
          type: event.type,
          occurredAt: new Date(event.occurredAt),
          message: event.message,
          metadata: event.payload,
        })));
      });
    },
    async getRunById(runId) {
      const rows = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.runId, runId));
      return rows[0];
    },
    async getResultsForRun(runId) {
      const rows = await db.select({
        result: reconciliationResults,
        verification: verificationResults,
      }).from(reconciliationResults)
        .leftJoin(verificationResults, eq(reconciliationResults.verificationId, verificationResults.verificationId))
        .where(eq(reconciliationResults.runId, runId))
        .orderBy(asc(reconciliationResults.createdAt));
      return rows.map(({ result, verification }) => ({
        ...result,
        verificationStatus: verification === null
          ? undefined
          : verification.result.status === "VERIFIED" ? "VERIFIED" as const : "REJECTED" as const,
      }));
    },
    async getTraceForRun(runId) {
      const rows = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId)).orderBy(asc(traceEvents.sequenceNo));
      return rows.map((row) => ({
        eventId: row.eventId,
        runId: row.runId,
        sequenceNo: row.sequenceNo,
        caseId: row.caseId,
        type: row.type,
        occurredAt: row.occurredAt.toISOString(),
        message: row.message,
        payload: row.metadata,
      }));
    },
  };
}

export function validatePersistCompletedRunInput(input: PersistCompletedRunInput): void {
  if (input.runId.trim().length === 0) throw new Error("runId must be non-empty");
  if (input.trace.length === 0) throw new Error("completed run trace must not be empty");
  if (input.trace[0]!.type !== "RUN_STARTED") throw new Error("completed run trace must start with RUN_STARTED");
  if (input.trace.at(-1)!.type !== "RUN_COMPLETED") throw new Error("completed run trace must end with RUN_COMPLETED");

  const eventIds = new Set<string>();
  const caseIds = new Set<string>();
  input.trace.forEach((event, index) => {
    if (event.runId !== input.runId) throw new Error(`trace event ${event.eventId} belongs to another run`);
    if (event.sequenceNo !== index + 1) throw new Error("trace sequence numbers must be contiguous from 1");
    if (eventIds.has(event.eventId)) throw new Error(`duplicate trace event ID: ${event.eventId}`);
    eventIds.add(event.eventId);
  });
  input.results.forEach((result) => {
    if (caseIds.has(result.caseId)) throw new Error(`duplicate final result case ID: ${result.caseId}`);
    caseIds.add(result.caseId);
    if (result.finalizationOrder !== undefined && (!Number.isInteger(result.finalizationOrder) || result.finalizationOrder < 1)) {
      throw new Error(`invalid finalization order for ${result.caseId}`);
    }
  });
  if (Number.isNaN(new Date(input.asOfDate).getTime())) throw new Error("asOfDate must be a valid date");
  input.trace.forEach((event) => {
    if (Number.isNaN(new Date(event.occurredAt).getTime())) throw new Error(`invalid trace timestamp: ${event.eventId}`);
  });
}

function integerPayload(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function mapResultRow(
  runId: string,
  result: PersistedFinalResult,
  index: number,
  proposalEvents: Map<string | null, PersistedTraceEvent>,
  verificationEvents: Map<string | null, PersistedTraceEvent>,
) {
  return {
    resultId: `${runId}:result:${index + 1}`,
    runId,
    caseId: result.caseId,
    bankTxnIds: result.bankRecordIds,
    ledgerTxnIds: result.ledgerRecordIds,
    finalOutcome: result.outcome,
    reasonCode: result.reasonCode,
    source: result.source,
    rule: result.rule ?? null,
    confidence: result.confidence ?? null,
    evidence: result.evidence ?? [],
    conflictingEvidence: result.conflictingEvidence ?? [],
    reason: result.reason ?? null,
    amountDeltaPaise: result.amountDeltaPaise ?? null,
    finalizationOrder: result.finalizationOrder ?? null,
    agentProposalId: proposalEvents.has(result.caseId) ? proposalId(runId, result.caseId) : null,
    verificationId: verificationEvents.has(result.caseId) ? verificationId(runId, result.caseId) : null,
  };
}

function mapProposalRow(runId: string, result: PersistedFinalResult, event: PersistedTraceEvent | undefined) {
  if (event === undefined) return undefined;
  const proposal = event.payload as unknown as AgentProposal;
  return {
    proposalId: proposalId(runId, result.caseId),
    runId,
    caseId: result.caseId,
    proposedOutcome: proposal.proposedOutcome,
    confidence: proposal.confidence,
    bankTxnIds: proposal.bankRecordIds,
    ledgerTxnIds: proposal.ledgerRecordIds,
    supportingEvidence: proposal.evidence,
    conflictingEvidence: proposal.conflictingEvidence,
    reason: proposal.reason,
  };
}

function mapVerificationRow(runId: string, result: PersistedFinalResult, event: PersistedTraceEvent | undefined) {
  if (event === undefined) return undefined;
  const payload = event.payload as { result?: Record<string, unknown>; failures?: Array<{ code?: string }> };
  const rawResult = payload.result ?? {};
  const projection = deriveVerificationColumns(payload);
  return {
    verificationId: verificationId(runId, result.caseId),
    runId,
    caseId: result.caseId,
    ...projection,
    result: rawResult,
  };
}

export function deriveVerificationColumns(payload: {
  result?: Record<string, unknown>;
  failures?: Array<{ code?: string }>;
}): {
  accepted: boolean;
  candidateExists: boolean;
  amountValid: boolean;
  currencyValid: boolean;
  directionValid: boolean;
  groupingValid: boolean;
  uniquenessValid: boolean;
  hardConflicts: string[];
  reason: string;
} {
  // These are a legacy projection for filtering/reporting. The verifier payload
  // below remains authoritative; combined compatibility failures cannot identify
  // whether currency or direction was wrong, so both are conservatively invalid.
  const rawResult = payload.result ?? {};
  const failureCodes = (payload.failures ?? []).map((failure) => failure.code ?? "UNKNOWN_FAILURE");
  const codes = new Set(failureCodes);
  const reasonCode = typeof rawResult.reasonCode === "string" ? rawResult.reasonCode : undefined;
  const failed = (code: string): boolean => codes.has(code);
  const accepted = rawResult.status === "VERIFIED";
  return {
    accepted,
    candidateExists: !failed("UNKNOWN_RECORD") && !failed("OUT_OF_CONTEXT_RECORD"),
    amountValid: !failed("AMOUNT_MISMATCH") && !failed("INVALID_AMOUNT"),
    currencyValid: !failed("HARD_COMPATIBILITY_FAILED"),
    directionValid: !failed("HARD_COMPATIBILITY_FAILED"),
    groupingValid: !failed("INVALID_RELATIONSHIP_SHAPE"),
    uniquenessValid: !failed("DUPLICATE_RECORD_ID") && !failed("RECORD_ALREADY_USED") && reasonCode !== "DUPLICATE_USAGE",
    hardConflicts: failureCodes,
    reason: accepted ? (reasonCode ?? "VERIFIED") : failureCodes.join(","),
  };
}

function proposalId(runId: string, caseId: string): string {
  return `${runId}:proposal:${caseId}`;
}

function verificationId(runId: string, caseId: string): string {
  return `${runId}:verification:${caseId}`;
}
