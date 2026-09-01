import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import {
  createReconciliationRunRepository,
  deriveVerificationColumns,
  validatePersistCompletedRunInput,
  type PersistCompletedRunInput,
  type PersistedTraceEvent,
} from "./reconciliation-run-repository.js";

function validInput(): PersistCompletedRunInput {
  const types = [
    "RUN_STARTED",
    "CASE_STARTED",
    "RULE_EVALUATED",
    "RULE_FAILED",
    "CANDIDATES_GENERATED",
    "AGENT_STARTED",
    "AGENT_PROPOSED",
    "VERIFICATION_CHECKED",
    "CASE_FINALIZED",
    "RUN_COMPLETED",
  ] as const;
  return {
    runId: "run-persistence-001",
    asOfDate: "2026-08-23",
    results: [{
      caseId: "BANK:B001",
      outcome: "RECONCILED",
      bankRecordIds: ["B001"],
      ledgerRecordIds: ["L001"],
      reasonCode: "EXACT_MATCH",
      source: "DETERMINISTIC",
      rule: "R1_EXACT_REFERENCE",
    }],
    trace: types.map((type, index) => ({
      eventId: `event-${index + 1}`,
      runId: "run-persistence-001",
      sequenceNo: index + 1,
      caseId: type === "RUN_STARTED" || type === "RUN_COMPLETED" ? null : "BANK:B001",
      type,
      occurredAt: `2026-08-23T10:00:${String(index).padStart(2, "0")}.000Z`,
      message: type,
      payload: type === "RUN_STARTED" ? { asOfDate: "2026-08-23", bankRecordCount: 1, ledgerRecordCount: 1 } : {},
    })),
  };
}

describe("completed reconciliation persistence input", () => {
  it("accepts a complete trace with contiguous sequence numbers", () => {
    expect(() => validatePersistCompletedRunInput(validInput())).not.toThrow();
  });

  it.each([
    ["wrong run id", (input: PersistCompletedRunInput) => { input.trace[2]!.runId = "run-other"; }],
    ["sequence gap", (input: PersistCompletedRunInput) => { input.trace[2]!.sequenceNo = 4; }],
    ["missing completion", (input: PersistCompletedRunInput) => { (input.trace as PersistCompletedRunInput["trace"] & PersistedTraceEvent[]).pop(); }],
    ["duplicate result case", (input: PersistCompletedRunInput) => { input.results = [...input.results, input.results[0]!]; }],
  ])("rejects %s before database writes", (_name, mutate) => {
    const input = validInput();
    mutate(input);
    expect(() => validatePersistCompletedRunInput(input)).toThrow();
  });

  it("does not mutate the supplied completed run data", () => {
    const input = validInput();
    const before = structuredClone(input);
    validatePersistCompletedRunInput(input);
    expect(input).toEqual(before);
  });
});

describe("verification persistence projection", () => {
  it("keeps independent validity facts true for evidence-only rejection", () => {
    expect(deriveVerificationColumns({
      result: { status: "REJECTED" },
      failures: [{ code: "INSUFFICIENT_EVIDENCE" }],
    })).toEqual({
      accepted: false,
      candidateExists: true,
      amountValid: true,
      currencyValid: true,
      directionValid: true,
      groupingValid: true,
      uniquenessValid: true,
      hardConflicts: ["INSUFFICIENT_EVIDENCE"],
      reason: "INSUFFICIENT_EVIDENCE",
    });
  });

  it("marks uniqueness invalid for duplicate usage without fabricating other failures", () => {
    expect(deriveVerificationColumns({
      result: { status: "VERIFIED", reasonCode: "DUPLICATE_USAGE" },
    })).toMatchObject({
      accepted: true,
      candidateExists: true,
      amountValid: true,
      currencyValid: true,
      directionValid: true,
      groupingValid: true,
      uniquenessValid: false,
      reason: "DUPLICATE_USAGE",
    });
  });

  it("derives only the facts named by concrete verifier failures", () => {
    expect(deriveVerificationColumns({
      result: { status: "REJECTED" },
      failures: [
        { code: "UNKNOWN_RECORD" },
        { code: "AMOUNT_MISMATCH" },
        { code: "INVALID_RELATIONSHIP_SHAPE" },
        { code: "RECORD_ALREADY_USED" },
      ],
    })).toMatchObject({
      accepted: false,
      candidateExists: false,
      amountValid: false,
      currencyValid: true,
      directionValid: true,
      groupingValid: false,
      uniquenessValid: false,
    });
  });

  it("preserves hard compatibility as a conservative legacy projection", () => {
    expect(deriveVerificationColumns({
      result: { status: "REJECTED", diagnostics: { currency: "EUR/USD" } },
      failures: [{ code: "HARD_COMPATIBILITY_FAILED" }],
    })).toMatchObject({ currencyValid: false, directionValid: false });
  });
});

describe("durable work-item claims", () => {
  it("renders an unfiltered claim without interpolating an undefined run id", async () => {
    const execute = vi.fn(async (_query: unknown) => []);
    const repository = createReconciliationRunRepository({ execute } as never);

    await repository.claimWorkItem!({ owner: "worker", leaseMs: 60_000 });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(query.sql).toContain("WHERE TRUE");
    expect(query.params).not.toContain(undefined);
  });

  it("binds the claim lease expiry as a timestamp string", async () => {
    const execute = vi.fn(async (_query: unknown) => []);
    const repository = createReconciliationRunRepository({ execute } as never);

    await repository.claimWorkItem!({ owner: "worker", leaseMs: 60_000 });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as SQL);
    expect(query.params).toEqual(expect.arrayContaining([
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    ]));
    expect(query.params.some((parameter) => parameter instanceof Date)).toBe(false);
  });
});
