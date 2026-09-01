import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { planReconciliation } from "@tally/reconciliation";
import { buildDevFixture } from "@tally/benchmark";

import { createDatabase } from "./client.js";
import {
  createReconciliationRunRepository,
  type PersistCompletedRunInput,
  type PersistedTraceEvent,
} from "./reconciliation-run-repository.js";

const databaseUrl = process.env.TALLY_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function inputFor(runId: string): PersistCompletedRunInput {
  const caseId = `${runId}:case-1`;
  const trace: PersistedTraceEvent[] = [
    event(runId, 1, "RUN_STARTED", null, { asOfDate: "2026-08-23", bankRecordCount: 2, ledgerRecordCount: 2 }),
    event(runId, 2, "CASE_STARTED", caseId),
    event(runId, 3, "AGENT_PROPOSED", caseId, {
      proposedOutcome: "MATCH",
      confidence: "HIGH",
      bankRecordIds: ["B1"],
      ledgerRecordIds: ["L1"],
      evidence: [{ source: "BANK_RECORD", statement: "Reference and amount agree", recordIds: ["B1"] }],
      conflictingEvidence: [],
      reason: "Reference and amount agree",
    }),
    event(runId, 4, "VERIFICATION_CHECKED", caseId, {
      result: { status: "VERIFIED", reasonCode: "EXACT_MATCH", metadata: { verifier: "unit" } },
      failures: [],
    }),
    event(runId, 5, "CASE_FINALIZED", caseId),
    event(runId, 6, "RUN_COMPLETED", null),
  ];
  return {
    runId,
    asOfDate: "2026-08-23",
    results: [
      {
        caseId,
        outcome: "RECONCILED",
        bankRecordIds: ["B1"],
        ledgerRecordIds: ["L1"],
        reasonCode: "EXACT_MATCH",
        source: "AGENT_VERIFIED",
        confidence: "HIGH",
        evidence: [{ source: "BANK_RECORD", statement: "Reference and amount agree", recordIds: ["B1"] }],
        conflictingEvidence: [],
        reason: "Reference and amount agree",
        amountDeltaPaise: "-5000",
      },
    ],
    trace,
  };
}

function event(
  runId: string,
  sequenceNo: number,
  type: PersistedTraceEvent["type"],
  caseId: string | null,
  payload: Record<string, unknown> = {},
): PersistedTraceEvent {
  return {
    eventId: `${runId}:event:${sequenceNo}`,
    runId,
    sequenceNo,
    caseId,
    type,
    occurredAt: `2026-08-23T10:00:${String(sequenceNo).padStart(2, "0")}.000Z`,
    message: type,
    payload,
  };
}

function testRunId(label: string): string {
  return `t036-${label}-${randomUUID()}`;
}

describeDatabase("PostgreSQL reconciliation persistence", () => {
  const database = createDatabase(databaseUrl!);
  const repository = createReconciliationRunRepository(database.db);
  const runIds: string[] = [];

  beforeEach(async () => {
    for (const runId of runIds.splice(0)) {
      await database.sql`delete from reconciliation_runs where run_id = ${runId}`;
    }
  });

  afterAll(async () => {
    for (const runId of runIds) {
      await database.sql`delete from reconciliation_runs where run_id = ${runId}`;
    }
    await database.close();
  });

  it("round-trips results, raw verifier data, nested payloads, and signed deltas", async () => {
    const input = inputFor(testRunId("round-trip"));
    runIds.push(input.runId);
    const before = structuredClone(input);

    await repository.saveCompletedRun(input);

    expect(input).toEqual(before);
    expect((await repository.getRunById(input.runId))?.asOfDate).toBe("2026-08-23");
    await expect(repository.getResultsForRun(input.runId)).resolves.toMatchObject([{
      finalOutcome: "RECONCILED",
      source: "AGENT_VERIFIED",
      verificationStatus: "VERIFIED",
      amountDeltaPaise: "-5000",
      evidence: before.results[0]!.evidence,
    }]);
    const persistedTrace = await repository.getTraceForRun(input.runId);
    expect(persistedTrace[2]).toMatchObject({
      eventId: `${input.runId}:event:3`,
      payload: before.trace[2]!.payload,
    });
  });

  it("rejects a duplicate run without overwriting its history", async () => {
    const input = inputFor(testRunId("duplicate"));
    runIds.push(input.runId);
    await repository.saveCompletedRun(input);
    await expect(repository.saveCompletedRun(input)).rejects.toThrow();
    expect((await repository.getResultsForRun(input.runId))).toHaveLength(1);
    expect((await repository.getTraceForRun(input.runId))).toHaveLength(input.trace.length);
  });

  it("persists PROCESSING to FAILED without finance rows or unsafe failure details", async () => {
    const runId = testRunId("failed-lifecycle");
    runIds.push(runId);
    await repository.startRun({ runId, asOfDate: "2026-08-23" });
    await repository.markRunFailed(runId, "AI_REQUEST_ERROR");

    await expect(repository.getRunById(runId)).resolves.toMatchObject({ runId, status: "FAILED" });
    await expect(repository.getResultsForRun(runId)).resolves.toEqual([]);
    await expect(repository.getTraceForRun(runId)).resolves.toEqual([]);
    const metadata = await database.sql`select model_metadata from reconciliation_runs where run_id = ${runId}`;
    expect(metadata[0]?.model_metadata).toEqual({ failureCode: "AI_REQUEST_ERROR" });
  });

  it("rolls back run, results, proposals, verification, and trace when the late trace insert fails", async () => {
    const input = inputFor(testRunId("rollback"));
    runIds.push(input.runId);
    (input.trace as PersistedTraceEvent[])[input.trace.length - 1] = {
      ...input.trace[input.trace.length - 1]!,
      type: "NOT_A_TRACE_EVENT" as PersistedTraceEvent["type"],
    };

    await expect(repository.saveCompletedRun(input)).rejects.toThrow();
    const counts = await database.sql`
      select
        (select count(*) from reconciliation_runs where run_id = ${input.runId})::int as runs,
        (select count(*) from reconciliation_results where run_id = ${input.runId})::int as results,
        (select count(*) from agent_proposals where run_id = ${input.runId})::int as proposals,
        (select count(*) from verification_results where run_id = ${input.runId})::int as verifications,
        (select count(*) from trace_events where run_id = ${input.runId})::int as traces
    `;
    expect(counts[0]).toEqual({ runs: 0, results: 0, proposals: 0, verifications: 0, traces: 0 });
  });

  it("enforces unique run sequence numbers at the database boundary", async () => {
    const input = inputFor(testRunId("sequence-unique"));
    runIds.push(input.runId);
    await repository.saveCompletedRun(input);
    await expect(database.sql`
      insert into trace_events (event_id, run_id, case_id, type, sequence_no, occurred_at, message, metadata)
      values (${`${input.runId}:duplicate`}, ${input.runId}, null, 'RUN_COMPLETED', 1, now(), 'duplicate', '{}'::jsonb)
    `).rejects.toThrow();
  });

  it("persists and claims planned durable work", async () => {
    const runId = testRunId("durable-work");
    runIds.push(runId);
    const bankCsv = "bank_txn_id,booking_date,value_date,amount,currency,direction,reference,counterparty,description,batch_id\nB1,2026-08-23,2026-08-23,100,INR,CREDIT,REF-1,ACME,Payment,";
    const ledgerCsv = "ledger_txn_id,accounting_date,maturity_date,amount,currency,direction,reference,counterparty,description,source,batch_id\nL1,2026-08-23,,99,INR,CREDIT,REF-1,ACME,Payment,ERP,";
    await repository.startRun({ runId, asOfDate: "2026-08-23", bankCsv, ledgerCsv });

    const plan = planReconciliation({ runId, asOfDate: "2026-08-23", bankCsv, ledgerCsv });
    expect(plan.components.length).toBeGreaterThan(0);
    await repository.persistPlan!(plan);

    await expect(repository.getRunById(runId)).resolves.toMatchObject({ status: "PROCESSING", pendingWorkItems: 1 });
    const claimed = await repository.claimWorkItem!({ runId, owner: "test-worker", leaseMs: 60_000 });
    expect(claimed).toMatchObject({ runId, status: "LEASED" });
    expect(claimed?.caseIds).toHaveLength(1);
    expect(claimed?.componentSnapshot).toMatchObject({ componentId: expect.any(String) });
    expect(await repository.completeWorkItem!(claimed!.workItemId, "test-worker")).toBe(true);
    await expect(repository.getRunById(runId)).resolves.toMatchObject({ completedWorkItems: 1, pendingWorkItems: 0 });
  });

  it("persists the six frozen-dev AI escalations as six investigations", async () => {
    const runId = testRunId("dev-investigations");
    runIds.push(runId);
    const fixture = buildDevFixture();
    await repository.startRun({ runId, asOfDate: fixture.asOfDate, bankCsv: fixture.bankCsv, ledgerCsv: fixture.ledgerCsv });

    const plan = planReconciliation({ runId, asOfDate: fixture.asOfDate, bankCsv: fixture.bankCsv, ledgerCsv: fixture.ledgerCsv });
    expect(plan.components).toHaveLength(6);
    await repository.persistPlan!(plan);

    await expect(repository.getRunById(runId)).resolves.toMatchObject({ totalWorkItems: 6, pendingWorkItems: 6 });
  });
});
