import { describe, expect, it } from "vitest";

import { TraceEventSchema } from "@tally/contracts";

import { createTraceRecorder } from "./recorder.js";

describe("trace recorder", () => {
  it("allocates append-only sequence numbers and owns the run id", () => {
    const trace = createTraceRecorder({ runId: "run-001", clock: () => new Date("2026-01-15T10:00:00.000Z") });

    trace.record({ type: "RUN_STARTED", payload: { asOfDate: "2026-01-15" } });
    trace.record({ type: "CASE_STARTED", caseId: "case-001", payload: { primarySide: "BANK", primaryRecordId: "bank-001" } });
    trace.record({ type: "RULE_EVALUATED", caseId: "case-001", payload: { rule: "R1_EXACT_REFERENCE", anchorRecordId: "bank-001" } });

    expect(trace.getEvents()).toMatchObject([
      { runId: "run-001", sequenceNo: 1, caseId: null, type: "RUN_STARTED" },
      { runId: "run-001", sequenceNo: 2, caseId: "case-001", type: "CASE_STARTED" },
      { runId: "run-001", sequenceNo: 3, caseId: "case-001", type: "RULE_EVALUATED" },
    ]);
  });

  it("snapshots payloads and does not synthesize adjacent events", () => {
    const trace = createTraceRecorder({ runId: "run-001" });
    const payload = { rule: "R1_EXACT_REFERENCE" as const, anchorRecordId: "bank-001" };

    const recorded = trace.record({ type: "RULE_EVALUATED", caseId: "case-001", payload });
    payload.anchorRecordId = "changed";

    const events = trace.getEvents();
    expect(events).toHaveLength(1);
    expect(recorded.payload.anchorRecordId).toBe("bank-001");
    expect(Object.isFrozen(events)).toBe(true);
  });

  it("requires case ids for case-scoped events and keeps run events case-free", () => {
    const trace = createTraceRecorder({ runId: "run-001" });

    expect(() => trace.record({
      type: "RULE_EVALUATED",
      caseId: "",
      payload: { rule: "R1_EXACT_REFERENCE", anchorRecordId: "bank-001" },
    })).toThrow(/requires a non-empty caseId/);
    expect(() => trace.record({
      type: "RULE_EVALUATED",
      caseId: "   ",
      payload: { rule: "R1_EXACT_REFERENCE", anchorRecordId: "bank-001" },
    })).toThrow(/requires a non-empty caseId/);
    expect(() => trace.record({
      type: "RULE_EVALUATED",
      payload: { rule: "R1_EXACT_REFERENCE", anchorRecordId: "bank-001" },
    } as never)).toThrow(/requires a non-empty caseId/);

    expect(trace.record({ type: "RUN_STARTED", payload: {} }).caseId).toBeNull();
    expect(trace.record({ type: "RUN_COMPLETED", payload: {} }).caseId).toBeNull();
  });

  it("produces an event accepted by the shared trace envelope schema", () => {
    const trace = createTraceRecorder({
      runId: "run-001",
      clock: () => new Date("2026-01-15T10:00:00.000Z"),
    });
    const event = trace.record({
      type: "CASE_FINALIZED",
      caseId: "case-001",
      payload: {
        outcome: "RECONCILED",
        bankRecordIds: ["bank-001"],
        ledgerRecordIds: ["ledger-001"],
        reasonCode: "EXACT_MATCH",
      },
    });

    expect(TraceEventSchema.parse(event)).toMatchObject({
      runId: "run-001",
      sequenceNo: 1,
      caseId: "case-001",
      type: "CASE_FINALIZED",
    });
  });

  it("starts each recorder at sequence one", () => {
    const first = createTraceRecorder({ runId: "run-001" });
    const second = createTraceRecorder({ runId: "run-002" });

    expect(first.record({ type: "RUN_STARTED", payload: {} }).sequenceNo).toBe(1);
    expect(second.record({ type: "RUN_STARTED", payload: {} }).sequenceNo).toBe(1);
  });
});
