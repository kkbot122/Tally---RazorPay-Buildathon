import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { AgentEvidence, AgentProposal, FinalOutcome, ReasonCode, TraceEventType } from "@tally/contracts";

import {
  agentProposals,
  reconciliationResults,
  reconciliationRuns,
  reconciliationRunInputs,
  reconciliationWorkItems,
  traceEvents,
  verificationResults,
} from "./schema.js";
import type { DatabaseClient } from "./client.js";
import { partitionReasoningComponents, type ReconciliationPlan } from "@tally/reconciliation";

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

export type StartRunInput = {
  runId: string;
  asOfDate: string;
  bankCsv?: string;
  ledgerCsv?: string;
};

export type ReconciliationWorkItem = typeof reconciliationWorkItems.$inferSelect;
export type ClaimWorkItemInput = { runId?: string; owner: string; leaseMs: number };

export interface ReconciliationRunRepository {
  startRun(input: StartRunInput): Promise<void>;
  markRunFailed(runId: string, failureCode: string, trace?: readonly PersistedTraceEvent[]): Promise<void>;
  saveCompletedRun(input: PersistCompletedRunInput): Promise<void>;
  getRunById(runId: string): Promise<typeof reconciliationRuns.$inferSelect | undefined>;
  getResultsForRun(runId: string): Promise<(typeof reconciliationResults.$inferSelect)[]>;
  getTraceForRun(runId: string): Promise<PersistedTraceEvent[]>;
  persistRunInput?(input: { runId: string; asOfDate: string; bankCsv: string; ledgerCsv: string }): Promise<void>;
  claimWorkItem?(input: ClaimWorkItemInput): Promise<ReconciliationWorkItem | undefined>;
  releaseWorkItem?(workItemId: string, owner: string, reason?: string): Promise<boolean>;
  completeWorkItem?(workItemId: string, owner: string): Promise<boolean>;
  failWorkItem?(workItemId: string, owner: string, classification: string): Promise<boolean>;
  cancelRunDurably?(runId: string): Promise<boolean>;
  markRunProcessing?(runId: string): Promise<void>;
  renewWorkItem?(workItemId: string, owner: string, leaseMs: number): Promise<boolean>;
  enqueueRunWorkItem?(input: { runId: string; snapshot: Record<string, unknown> }): Promise<void>;
  getRunInput?(runId: string): Promise<{ runId: string; asOfDate: string; bankCsv: string; ledgerCsv: string } | undefined>;
  getRecoverableRunIds?(): Promise<string[]>;
  persistPlan?(plan: ReconciliationPlan, options?: { maxItemsPerBatch?: number }): Promise<void>;
  isRunCancelled?(runId: string): Promise<boolean>;
  persistResultCheckpoint?(input: { runId: string; results: readonly PersistedFinalResult[]; trace?: readonly PersistedTraceEvent[] }): Promise<void>;
  finalizeRun?(runId: string): Promise<boolean>;
  appendOperationalTrace?(input: { runId: string; type: TraceEventType; message: string; metadata?: Record<string, unknown>; caseId?: string }): Promise<void>;
}

export function createReconciliationRunRepository(db: DatabaseClient): ReconciliationRunRepository {
  return {
    async startRun(input) {
      await db.insert(reconciliationRuns).values({
        runId: input.runId,
        asOfDate: input.asOfDate,
        status: "PENDING",
        startedAt: null,
        configuration: { asOfDate: input.asOfDate },
        modelMetadata: {},
      });
      if (input.bankCsv !== undefined && input.ledgerCsv !== undefined) {
        const runInput = { runId: input.runId, asOfDate: input.asOfDate, bankCsv: input.bankCsv, ledgerCsv: input.ledgerCsv };
        await db.insert(reconciliationRunInputs).values(inputRow(runInput)).onConflictDoNothing();
      }
    },
    async markRunFailed(runId, failureCode, trace = []) {
      await db.transaction(async (tx) => {
        if (trace.length > 0) {
          await tx.insert(traceEvents).values(trace.map((event) => ({
            eventId: event.eventId,
            runId: event.runId,
            sequenceNo: event.sequenceNo,
            caseId: event.caseId,
            type: event.type,
            occurredAt: new Date(event.occurredAt),
            message: event.message,
            metadata: event.payload,
          })));
        }
        await tx.update(reconciliationRuns).set({
          status: "FAILED",
          completedAt: new Date(),
          modelMetadata: { failureCode },
        }).where(eq(reconciliationRuns.runId, runId));
      });
    },
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
        }).onConflictDoNothing({ target: reconciliationRuns.runId });
        await tx.update(reconciliationRuns).set({
          asOfDate: input.asOfDate,
          status: "COMPLETED",
          startedAt,
          completedAt,
          totalBankRecords,
          totalLedgerRecords,
          configuration: { asOfDate: input.asOfDate },
          modelMetadata: {},
        }).where(eq(reconciliationRuns.runId, input.runId));

        const proposalRows = input.results
          .map((result) => mapProposalRow(input.runId, result, proposalEvents.get(result.caseId)))
          .filter((row): row is NonNullable<typeof row> => row !== undefined);
        if (proposalRows.length > 0) await tx.insert(agentProposals).values(proposalRows).onConflictDoNothing();

        const verificationRows = input.results
          .map((result) => mapVerificationRow(input.runId, result, verificationEvents.get(result.caseId)))
          .filter((row): row is NonNullable<typeof row> => row !== undefined);
        if (verificationRows.length > 0) await tx.insert(verificationResults).values(verificationRows).onConflictDoNothing();

        if (input.results.length > 0) {
          await tx.insert(reconciliationResults).values(input.results.map((result, index) => mapResultRow(input.runId, result, index, proposalEvents, verificationEvents))).onConflictDoNothing();
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
        }))).onConflictDoNothing();
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
    async persistRunInput(input) {
      await db.insert(reconciliationRunInputs).values(inputRow(input)).onConflictDoNothing();
    },
    async claimWorkItem({ runId, owner, leaseMs }) {
      if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new Error("leaseMs must be a positive integer");
      // This statement is sent directly through postgres.js. Unlike Drizzle's
      // column mapper, its raw template binding does not accept Date values in
      // this runtime, so bind an explicit timestamp string.
      const expiry = new Date(Date.now() + leaseMs).toISOString();
      // The postgres driver renders an undefined interpolation as an empty SQL
      // fragment. The normal worker loop has no runId filter, so use TRUE
      // instead of interpolating that undefined value.
      const runScope = runId === undefined ? sql`TRUE` : sql`run_id = ${runId}`;
      const rows = await db.execute(sql`
        UPDATE reconciliation_work_items
        SET status = 'LEASED', lease_owner = ${owner}, lease_expires_at = ${expiry},
            attempt_count = attempt_count + 1, updated_at = now()
        WHERE work_item_id = (
          SELECT work_item_id FROM reconciliation_work_items
          WHERE ${runScope}
            AND (status = 'PENDING' OR (status = 'LEASED' AND lease_expires_at < now()))
            AND run_id IN (SELECT run_id FROM reconciliation_runs WHERE status IN ('PENDING', 'PROCESSING'))
          ORDER BY run_id, sequence_no
          FOR UPDATE SKIP LOCKED LIMIT 1
        )
        RETURNING *
      `);
      const row = (rows as unknown as Array<Record<string, unknown>>)[0];
      return row === undefined ? undefined : mapWorkItem(row);
    },
    async releaseWorkItem(workItemId, owner, reason) {
      const result = await db.update(reconciliationWorkItems).set({
        status: "PENDING", leaseOwner: null, leaseExpiresAt: null,
        lastFailureClassification: reason ?? null, updatedAt: new Date(),
      }).where(sql`${reconciliationWorkItems.workItemId} = ${workItemId} AND ${reconciliationWorkItems.leaseOwner} = ${owner} AND ${reconciliationWorkItems.status} = 'LEASED'`);
      if (result.length > 0) await refreshWorkProgress(db, workItemId);
      return result.length > 0;
    },
    async completeWorkItem(workItemId, owner) {
      const result = await db.update(reconciliationWorkItems).set({ status: "COMPLETED", leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() }).where(sql`${reconciliationWorkItems.workItemId} = ${workItemId} AND ${reconciliationWorkItems.leaseOwner} = ${owner} AND ${reconciliationWorkItems.status} = 'LEASED'`);
      if (result.length > 0) await refreshWorkProgress(db, workItemId);
      return result.length > 0;
    },
    async failWorkItem(workItemId, owner, classification) {
      const result = await db.update(reconciliationWorkItems).set({ status: "FAILED", leaseOwner: null, leaseExpiresAt: null, lastFailureClassification: classification, updatedAt: new Date() }).where(sql`${reconciliationWorkItems.workItemId} = ${workItemId} AND ${reconciliationWorkItems.leaseOwner} = ${owner} AND ${reconciliationWorkItems.status} = 'LEASED'`);
      if (result.length > 0) await refreshWorkProgress(db, workItemId);
      return result.length > 0;
    },
    async cancelRunDurably(runId) {
      return db.transaction(async (tx) => {
        const result = await tx.update(reconciliationRuns).set({ status: "CANCELLED", completedAt: new Date() }).where(sql`${reconciliationRuns.runId} = ${runId} AND ${reconciliationRuns.status} IN ('PENDING', 'PROCESSING')`);
        if (result.length === 0) return false;
        await tx.update(reconciliationWorkItems).set({ status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() }).where(sql`${reconciliationWorkItems.runId} = ${runId} AND ${reconciliationWorkItems.status} IN ('PENDING', 'LEASED')`);
        await refreshRunWorkProgress(tx, runId);
        return true;
      });
    },
    async markRunProcessing(runId) {
      await db.update(reconciliationRuns).set({ status: "PROCESSING", startedAt: new Date() }).where(sql`${reconciliationRuns.runId} = ${runId} AND ${reconciliationRuns.status} = 'PENDING'`);
    },
    async renewWorkItem(workItemId, owner, leaseMs) {
      const result = await db.update(reconciliationWorkItems).set({ leaseExpiresAt: new Date(Date.now() + leaseMs), updatedAt: new Date() }).where(sql`${reconciliationWorkItems.workItemId} = ${workItemId} AND ${reconciliationWorkItems.leaseOwner} = ${owner} AND ${reconciliationWorkItems.status} = 'LEASED'`);
      return result.length > 0;
    },
    async enqueueRunWorkItem(input) {
      await db.insert(reconciliationWorkItems).values({
        workItemId: `${input.runId}:work:1`, runId: input.runId, sequenceNo: 1,
        caseIds: [], componentSnapshot: input.snapshot, candidateSnapshot: {}, status: "PENDING",
      }).onConflictDoNothing();
      await db.update(reconciliationRuns).set({ totalWorkItems: 1, pendingWorkItems: 1 }).where(eq(reconciliationRuns.runId, input.runId));
    },
    async getRunInput(runId) {
      const rows = await db.select().from(reconciliationRunInputs).where(eq(reconciliationRunInputs.runId, runId));
      const row = rows[0];
      return row === undefined ? undefined : { runId: row.runId, asOfDate: row.asOfDate, bankCsv: row.bankCsv, ledgerCsv: row.ledgerCsv };
    },
    async getRecoverableRunIds() {
      const rows = await db.select({ runId: reconciliationRuns.runId }).from(reconciliationRuns).where(sql`${reconciliationRuns.status} IN ('PENDING', 'PROCESSING')`);
      return rows.map((row) => row.runId);
    },
    async persistPlan(plan, options) {
      const batches = partitionReasoningComponents(plan.components.map((component) => ({
        ...component,
        candidateCount: component.candidateSet.candidates.length,
        bankRecordIds: [
          ...component.decision.bankRecordIds,
          ...(component.primary.side === "BANK" ? [component.primary.recordId] : []),
          ...component.candidateSet.candidates.filter((candidate) => candidate.side === "BANK").map((candidate) => candidate.recordId),
        ],
        ledgerRecordIds: [
          ...component.decision.ledgerRecordIds,
          ...(component.primary.side === "LEDGER" ? [component.primary.recordId] : []),
          ...component.candidateSet.candidates.filter((candidate) => candidate.side === "LEDGER").map((candidate) => candidate.recordId),
        ],
        snapshot: component, candidateSnapshot: component.candidateSet,
      })), { maxItemsPerBatch: options?.maxItemsPerBatch ?? 3, maxCandidates: 12 });
      await db.transaction(async (tx) => {
        const updated = await tx.update(reconciliationRuns).set({ status: "PROCESSING", startedAt: new Date(plan.trace[0]?.occurredAt ?? Date.now()), totalBankRecords: plan.bankRecords.length, totalLedgerRecords: plan.ledgerRecords.length, totalWorkItems: batches.length, configuration: { asOfDate: plan.asOfDate, planned: true } }).where(sql`${reconciliationRuns.runId} = ${plan.runId} AND ${reconciliationRuns.status} IN ('PENDING', 'PROCESSING')`);
        if (updated.length === 0) return;
        if (plan.deterministicResults.length > 0) {
          await tx.insert(reconciliationResults).values(plan.deterministicResults.map((result, index) => mapResultRow(plan.runId, result, index, new Map(), new Map()))).onConflictDoNothing();
        }
        if (plan.trace.length > 0) await tx.insert(traceEvents).values(plan.trace.map((event) => ({ eventId: event.eventId, runId: event.runId, sequenceNo: event.sequenceNo, caseId: event.caseId, type: event.type, occurredAt: new Date(event.occurredAt), message: event.message, metadata: event.payload }))).onConflictDoNothing();
        if (batches.length > 0) await tx.insert(reconciliationWorkItems).values(batches.map((batch, index) => ({
          workItemId: `${plan.runId}:work:${index + 1}`, runId: plan.runId, sequenceNo: index + 1,
          caseIds: batch.map((component) => component.caseId),
          componentSnapshot: { components: batch.map((component) => component.snapshot) },
          candidateSnapshot: { components: batch.map((component) => component.candidateSnapshot) },
        }))).onConflictDoNothing();
        await refreshRunWorkProgress(tx, plan.runId);
      });
    },
    async isRunCancelled(runId) {
      const rows = await db.select({ status: reconciliationRuns.status }).from(reconciliationRuns).where(eq(reconciliationRuns.runId, runId));
      return rows[0]?.status === "CANCELLED";
    },
    async persistResultCheckpoint(input) {
      await db.transaction(async (tx) => {
        if (input.results.length > 0) await tx.insert(reconciliationResults).values(input.results.map((result, index) => mapResultRow(input.runId, result, index, new Map(), new Map()))).onConflictDoNothing();
        if (input.trace !== undefined && input.trace.length > 0) {
          const maxRows = await tx.select({ maxSequence: sql<number>`coalesce(max(${traceEvents.sequenceNo}), 0)` }).from(traceEvents).where(eq(traceEvents.runId, input.runId));
          const offset = Number(maxRows[0]?.maxSequence ?? 0);
          await tx.insert(traceEvents).values(input.trace.map((event, index) => ({ eventId: `${input.runId}:checkpoint:${event.eventId}`, runId: input.runId, sequenceNo: offset + index + 1, caseId: event.caseId, type: event.type, occurredAt: new Date(event.occurredAt), message: event.message, metadata: event.payload }))).onConflictDoNothing();
        }
      });
    },
    async finalizeRun(runId) {
      const result = await db.execute(sql`
        UPDATE reconciliation_runs
        SET status = 'COMPLETED', completed_at = now(), pending_work_items = 0, active_work_items = 0
        WHERE run_id = ${runId} AND status = 'PROCESSING'
          AND total_work_items = (SELECT count(*)::int FROM reconciliation_work_items WHERE reconciliation_work_items.run_id = ${runId})
          -- A failed work item has no persisted terminal finance outcome. Never
          -- report such a run as completed merely because nothing is queued.
          AND NOT EXISTS (SELECT 1 FROM reconciliation_work_items WHERE reconciliation_work_items.run_id = ${runId} AND status IN ('PENDING', 'LEASED', 'FAILED'))
        RETURNING run_id
      `);
      return result.length > 0;
    },
    async appendOperationalTrace(input) {
      await db.transaction(async (tx) => {
        const rows = await tx.select({ maxSequence: sql<number>`coalesce(max(${traceEvents.sequenceNo}), 0)` }).from(traceEvents).where(eq(traceEvents.runId, input.runId));
        const sequenceNo = Number(rows[0]?.maxSequence ?? 0) + 1;
        await tx.insert(traceEvents).values({
          eventId: `${input.runId}:operational:${input.type}:${sequenceNo}`,
          runId: input.runId, sequenceNo, caseId: input.caseId ?? null, type: input.type,
          occurredAt: new Date(), message: input.message, metadata: input.metadata ?? {},
        }).onConflictDoNothing();
      });
    },
  };
}

function mapWorkItem(row: Record<string, unknown>): ReconciliationWorkItem {
  return {
    workItemId: String(row.work_item_id), runId: String(row.run_id), sequenceNo: Number(row.sequence_no),
    caseIds: row.case_ids as string[], componentSnapshot: row.component_snapshot as Record<string, unknown>,
    candidateSnapshot: row.candidate_snapshot as Record<string, unknown>, status: row.status as ReconciliationWorkItem["status"],
    attemptCount: Number(row.attempt_count), repairAttemptCount: Number(row.repair_attempt_count),
    leaseOwner: row.lease_owner as string | null, leaseExpiresAt: row.lease_expires_at as Date | null,
    lastFailureClassification: row.last_failure_classification as string | null,
    createdAt: row.created_at as Date, updatedAt: row.updated_at as Date,
  };
}

type SqlExecutor = Pick<DatabaseClient, "execute">;

async function refreshWorkProgress(db: SqlExecutor, workItemId: string): Promise<void> {
  const row = await db.execute(sql`SELECT run_id FROM reconciliation_work_items WHERE work_item_id = ${workItemId}`) as unknown as Array<{ run_id: string }>;
  if (row[0] !== undefined) await refreshRunWorkProgress(db, row[0].run_id);
}

async function refreshRunWorkProgress(db: SqlExecutor, runId: string): Promise<void> {
  await db.execute(sql`
    UPDATE reconciliation_runs AS runs
    SET total_work_items = counts.total,
        completed_work_items = counts.completed,
        failed_work_items = counts.failed,
        pending_work_items = counts.pending,
        active_work_items = counts.active
    FROM (
      SELECT run_id, count(*)::int AS total,
        count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
        count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
        count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
        count(*) FILTER (WHERE status = 'LEASED')::int AS active
      FROM reconciliation_work_items
      WHERE run_id = ${runId}
      GROUP BY run_id
    ) AS counts
    WHERE runs.run_id = counts.run_id
  `);
}

function inputRow(input: { runId: string; asOfDate: string; bankCsv: string; ledgerCsv: string }) {
  return {
    runId: input.runId,
    asOfDate: input.asOfDate,
    bankCsv: input.bankCsv,
    ledgerCsv: input.ledgerCsv,
    bankSha256: createHash("sha256").update(input.bankCsv).digest("hex"),
    ledgerSha256: createHash("sha256").update(input.ledgerCsv).digest("hex"),
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
    resultId: `${runId}:result:${result.caseId}`,
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
