import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
    const input = inputFor("db-round-trip");
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
    await expect(repository.getTraceForRun(input.runId)).resolves.toMatchObject([{
      eventId: `${input.runId}:event:3`,
      payload: before.trace[2]!.payload,
    }]);
  });

  it("rejects a duplicate run without overwriting its history", async () => {
    const input = inputFor("db-duplicate");
    runIds.push(input.runId);
    await repository.saveCompletedRun(input);
    await expect(repository.saveCompletedRun(input)).rejects.toThrow();
    expect((await repository.getResultsForRun(input.runId))).toHaveLength(1);
    expect((await repository.getTraceForRun(input.runId))).toHaveLength(input.trace.length);
  });

  it("rolls back run, results, proposals, verification, and trace when the late trace insert fails", async () => {
    const input = inputFor("db-rollback");
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
    const input = inputFor("db-sequence-unique");
    runIds.push(input.runId);
    await repository.saveCompletedRun(input);
    await expect(database.sql`
      insert into trace_events (event_id, run_id, case_id, type, sequence_no, occurred_at, message, metadata)
      values (${`${input.runId}:duplicate`}, ${input.runId}, null, 'RUN_COMPLETED', 1, now(), 'duplicate', '{}'::jsonb)
    `).rejects.toThrow();
  });
});
