import { describe, expect, it, vi } from "vitest";

import { buildApp, type DatabaseHandle } from "./app.js";
import { BenchmarkEvaluationError, type BenchmarkEvaluationResponse } from "./benchmark-evaluation-service.js";
import type { ReconciliationRunService } from "./run-service.js";
import { createReconciliationRunService, RunFailedError, TraceUnavailableError } from "./run-service.js";
import type { ReconciliationRunRepository } from "./db/reconciliation-run-repository.js";
import type { PersistCompletedRunInput } from "./db/reconciliation-run-repository.js";
import { buildDevFixture, type BenchmarkCase } from "@tally/benchmark";
import { OpenAIResponsesAdapter, ReasoningAdapterError, type AgentProposal, type ReasoningModelAdapter } from "@tally/reconciliation";

const config = {
  NODE_ENV: "test" as const,
  PORT: 3001,
  DATABASE_URL: "postgresql://localhost:5432/tally",
  OPENAI_API_KEY: "",
  GROQ_API_KEY: "",
  OPENAI_MODEL: "gpt-5.6-terra",
  AI_PROVIDER: "openai" as const,
  AI_REASONING_EFFORT: "none" as const,
  AI_REQUEST_TIMEOUT_MS: 12000,
  AI_MAX_RETRIES: 0,
  AI_REASONING_CONCURRENCY: 8,
  AI_MAX_REASONING_CALLS_PER_RUN: 100,
  AI_GROQ_REQUESTS_PER_MINUTE: 30,
  AI_GROQ_TOKENS_PER_MINUTE: 8000,
  AI_GROQ_QUOTA_SCOPE: "groq:test",
  AI_RUN_DEADLINE_MS: 90000,
  WEB_ORIGIN: "http://localhost:3000",
};

function createTestDatabase(overrides: Partial<DatabaseHandle> = {}): DatabaseHandle {
  return {
    check: async () => {},
    close: async () => {},
    ...overrides,
  };
}

function createTestService(overrides: Partial<ReconciliationRunService> = {}): ReconciliationRunService {
  return {
    createRun: async () => ({ runId: "run-api-001", status: "COMPLETED" }),
    getSummary: async () => ({
      runId: "run-api-001",
      status: "COMPLETED",
      totalCases: 2,
      reconciled: 1,
      explainedOutstanding: 0,
      discrepancies: 1,
      unresolved: 0,
    }),
    getResults: async () => [{ caseId: "BANK:B1" }, { caseId: "BANK:B2" }],
    getResult: async (_runId, caseId) => ({ caseId }),
    getExceptions: async () => [{ caseId: "BANK:B2", finalOutcome: "DISCREPANCY" }],
    getTrace: async () => [{ sequenceNo: 1 }, { sequenceNo: 2 }],
    cancelRun: async () => true,
    ...overrides,
  };
}

function evaluationResponse(runId: string): BenchmarkEvaluationResponse {
  return {
    runId,
    metrics: {
      totalCases: 1,
      reconciledCount: 1,
      matchRate: 1,
      resolvedCount: 1,
      resolutionRate: 1,
      correctReconciliationCount: 1,
      matchPrecision: 1,
      falseReconciliationCount: 0,
      falseReconciliationRate: 0,
      exceptionCount: 0,
      correctExceptionCount: 0,
      exceptionAccuracy: 0,
      unresolvedCount: 0,
      abstentionRate: 0,
    },
    caseTypeBreakdown: { byExpectedOutcome: {}, byReasonCode: {} },
    cases: [],
  };
}

describe("GET /health", () => {
  it("returns an OK status", async () => {
    const app = buildApp(config, createTestDatabase());
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("GET /health/db", () => {
  it("returns database health when the connection check succeeds", async () => {
    const app = buildApp(config, createTestDatabase());
    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ db: "ok" });
    await app.close();
  });

  it("returns service unavailable when the connection check fails", async () => {
    const app = buildApp(
      config,
      createTestDatabase({ check: async () => Promise.reject(new Error("connection refused")) }),
    );
    const response = await app.inject({ method: "GET", url: "/health/db" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ db: "error" });
    await app.close();
  });
});

describe("reconciliation routes", () => {
  it("evaluates a persisted run through the injected T028 service", async () => {
    const evaluate = vi.fn(async (runId: string) => evaluationResponse(runId));
    const app = buildApp(config, createTestDatabase(), createTestService(), { evaluate });

    const response = await app.inject({ method: "POST", url: "/api/runs/run-eval-001/evaluate" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(evaluationResponse("run-eval-001"));
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate).toHaveBeenCalledWith("run-eval-001");
    await app.close();
  });

  it("rejects client-supplied truth and maps evaluation errors safely", async () => {
    const evaluate = vi.fn(async () => { throw new BenchmarkEvaluationError("RUN_NOT_BENCHMARK_COMPATIBLE", "internal alignment detail"); });
    const app = buildApp(config, createTestDatabase(), createTestService(), { evaluate });

    const truthResponse = await app.inject({
      method: "POST",
      url: "/api/runs/run-eval-001/evaluate",
      payload: { groundTruthCsv: "case_id,expected_outcome" },
    });
    expect(truthResponse.statusCode).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();

    const truthQueryResponse = await app.inject({ method: "POST", url: "/api/runs/run-eval-001/evaluate?expectedOutcome=RECONCILED" });
    expect(truthQueryResponse.statusCode).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();

    const truthHeaderResponse = await app.inject({ method: "POST", url: "/api/runs/run-eval-001/evaluate", headers: { "truth-bank-ids": "B1" } });
    expect(truthHeaderResponse.statusCode).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();

    const response = await app.inject({ method: "POST", url: "/api/runs/run-eval-001/evaluate" });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "RUN_NOT_BENCHMARK_COMPATIBLE" });
    expect(response.body).not.toContain("internal alignment detail");
    await app.close();
  });

  it.each([
    ["RUN_NOT_FOUND", 404],
    ["RUN_NOT_COMPLETED", 422],
  ] as const)("maps %s to %i", async (code, statusCode) => {
    const app = buildApp(config, createTestDatabase(), createTestService(), {
      evaluate: async () => { throw new BenchmarkEvaluationError(code, "internal detail"); },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-eval-001/evaluate" });
    expect(response.statusCode).toBe(statusCode);
    expect(response.body).not.toContain("internal detail");
    await app.close();
  });

  it("returns a sanitized 500 for unexpected evaluation failures", async () => {
    const app = buildApp(config, createTestDatabase(), createTestService(), {
      evaluate: async () => { throw new Error("database secret"); },
    });
    const response = await app.inject({ method: "POST", url: "/api/runs/run-eval-001/evaluate" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "EVALUATION_FAILED" });
    expect(response.body).not.toContain("database secret");
    await app.close();
  });

  it("accepts the frozen 20-case fixture through the injected T024/T025 composition", async () => {
    const fixture = buildDevFixture();
    const saved = vi.fn<(input: PersistCompletedRunInput) => Promise<void>>(async () => {});
    const repo = {
      startRun: vi.fn(async () => {}),
      markRunFailed: vi.fn(async () => {}),
      saveCompletedRun: saved,
      getRunById: async () => undefined,
      getResultsForRun: async () => [],
      getTraceForRun: async () => [],
    } satisfies ReconciliationRunRepository;
    const adapter = new FixtureAdapter(fixture.cases);
    const service = createReconciliationRunService(repo, adapter, undefined, () => "run-20-case");
    const app = buildApp(config, createTestDatabase(), service);

    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { asOfDate: fixture.asOfDate, bankCsv: fixture.bankCsv, ledgerCsv: fixture.ledgerCsv } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ runId: "run-20-case", status: "PROCESSING" });
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saved).toHaveBeenCalledOnce();
    const results = saved.mock.calls[0]![0].results;
    expect({
      length: results.length,
      counts: {
        RECONCILED: results.filter((item) => item.outcome === "RECONCILED").length,
        EXPLAINED_OUTSTANDING: results.filter((item) => item.outcome === "EXPLAINED_OUTSTANDING").length,
        DISCREPANCY: results.filter((item) => item.outcome === "DISCREPANCY").length,
        UNRESOLVED: results.filter((item) => item.outcome === "UNRESOLVED").length,
      },
    }).toEqual({ length: 20, counts: { RECONCILED: 13, EXPLAINED_OUTSTANDING: 2, DISCREPANCY: 2, UNRESOLVED: 3 } });
    expect(results.filter((item) => item.outcome === "RECONCILED")).toHaveLength(13);
    expect(results.filter((item) => item.outcome === "EXPLAINED_OUTSTANDING")).toHaveLength(2);
    expect(results.filter((item) => item.outcome === "DISCREPANCY")).toHaveLength(2);
    expect(results.filter((item) => item.outcome === "UNRESOLVED")).toHaveLength(3);
    await app.close();
  });

  it("runs through an injected service without requiring an API key", async () => {
    const createRun = vi.fn(async () => ({ runId: "run-api-001", status: "COMPLETED" as const }));
    const app = buildApp(config, createTestDatabase(), createTestService({ createRun }));
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { asOfDate: "2026-08-23", bankCsv: "bank", ledgerCsv: "ledger" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ runId: "run-api-001", status: "COMPLETED" });
    expect(createRun).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects malformed CSV before the pipeline and persistence boundary", async () => {
    const fixture = buildDevFixture();
    const saved = vi.fn(async () => {});
    const repo = {
      startRun: vi.fn(async () => {}),
      markRunFailed: vi.fn(async () => {}),
      saveCompletedRun: saved,
      getRunById: async () => undefined,
      getResultsForRun: async () => [],
      getTraceForRun: async () => [],
    } satisfies ReconciliationRunRepository;
    const invalidCsvAdapter: ReasoningModelAdapter = { generateProposal: vi.fn() };
    const service = createReconciliationRunService(repo, invalidCsvAdapter, undefined, () => "run-invalid-csv");
    const app = buildApp(config, createTestDatabase(), service);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: {
      asOfDate: fixture.asOfDate,
      bankCsv: "not,a,valid,bank,csv",
      ledgerCsv: fixture.ledgerCsv,
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_CSV" });
    expect(saved).not.toHaveBeenCalled();
    expect(response.body).not.toContain("RECONCILED");
    expect(response.body).not.toContain("UNRESOLVED");
    await app.close();
  });

  it("returns a sanitized 500 when the repository fails at run creation", async () => {
    const repository = {
      startRun: vi.fn(async () => { throw new Error("postgresql://user:db-secret@host/tally"); }),
      markRunFailed: vi.fn(async () => {}),
      saveCompletedRun: vi.fn(async () => {}),
      getRunById: vi.fn(async () => undefined),
      getResultsForRun: vi.fn(async () => []),
      getTraceForRun: vi.fn(async () => []),
    } satisfies ReconciliationRunRepository;
    const service = createReconciliationRunService(repository, { generateProposal: vi.fn() }, undefined, () => "run-db-failure");
    const app = buildApp(config, createTestDatabase(), service);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: {
      asOfDate: "2026-08-23",
      bankCsv: "bank_txn_id,booking_date,value_date,amount,currency,direction,reference,counterparty,description,batch_id\nB1,2026-08-23,2026-08-23,100,INR,CREDIT,BANK-ONLY,Bank,Payment,",
      ledgerCsv: "ledger_txn_id,accounting_date,maturity_date,amount,currency,direction,reference,counterparty,description,source,batch_id\nL1,2026-08-23,2026-08-23,100,INR,CREDIT,LEDGER-ONLY,Ledger,Receipt,ERP,",
    } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "SYSTEM_ERROR", message: "The reconciliation run could not be completed." });
    expect(response.body).not.toContain("db-secret");
    expect(repository.markRunFailed).not.toHaveBeenCalled();
    await app.close();
  });

  it("persists an unresolved result when the model boundary fails", async () => {
    const repository = {
      startRun: vi.fn(async () => {}),
      markRunFailed: vi.fn(async () => {}),
      saveCompletedRun: vi.fn(async () => {}),
      getRunById: vi.fn(async () => undefined),
      getResultsForRun: vi.fn(async () => []),
      getTraceForRun: vi.fn(async () => []),
    } satisfies ReconciliationRunRepository;
    const adapter: ReasoningModelAdapter = {
      generateProposal: vi.fn(async () => { throw new ReasoningAdapterError("AI_REQUEST_ERROR", "OPENAI_API_KEY=sentinel"); }),
    };
    const service = createReconciliationRunService(repository, adapter, undefined, () => "run-ai-failure");
    const app = buildApp(config, createTestDatabase(), service);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: {
      asOfDate: "2026-08-23",
      bankCsv: "bank_txn_id,booking_date,value_date,amount,currency,direction,reference,counterparty,description,batch_id\nB1,2026-08-23,2026-08-23,100,INR,CREDIT,BANK-ONLY,Bank,Payment,",
      ledgerCsv: "ledger_txn_id,accounting_date,maturity_date,amount,currency,direction,reference,counterparty,description,source,batch_id\nL1,2026-08-23,2026-08-23,100,INR,CREDIT,LEDGER-ONLY,Ledger,Receipt,ERP,",
    } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ runId: "run-ai-failure", status: "PROCESSING" });
    await vi.waitFor(() => expect(repository.saveCompletedRun).toHaveBeenCalledOnce());
    expect(response.body).not.toContain("OPENAI_API_KEY");
    expect(repository.startRun).toHaveBeenCalledOnce();
    expect(repository.markRunFailed).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    ["malformed output", async () => ({ output_parsed: null })],
    ["provider rejection", async () => { throw new Error("provider detail"); }],
  ])("maps the real OpenAI adapter %s through the API boundary", async (_name, parse) => {
    const repository = {
      startRun: vi.fn(async () => {}),
      markRunFailed: vi.fn(async () => {}),
      saveCompletedRun: vi.fn(async () => {}),
      getRunById: vi.fn(async () => undefined),
      getResultsForRun: vi.fn(async () => []),
      getTraceForRun: vi.fn(async () => []),
    } satisfies ReconciliationRunRepository;
    const adapter = new OpenAIResponsesAdapter({ client: { parse } as never });
    const service = createReconciliationRunService(repository, adapter, undefined, () => `run-openai-${_name.replace(" ", "-")}`);
    const app = buildApp(config, createTestDatabase(), service);
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: {
      asOfDate: "2026-08-23",
      bankCsv: "bank_txn_id,booking_date,value_date,amount,currency,direction,reference,counterparty,description,batch_id\nB1,2026-08-23,2026-08-23,100,INR,CREDIT,BANK-ONLY,Bank,Payment,",
      ledgerCsv: "ledger_txn_id,accounting_date,maturity_date,amount,currency,direction,reference,counterparty,description,source,batch_id\nL1,2026-08-23,2026-08-23,100,INR,CREDIT,LEDGER-ONLY,Ledger,Receipt,ERP,",
    } });
    if (_name === "malformed output") {
      expect(response.statusCode).toBe(202);
      await vi.waitFor(() => expect(repository.saveCompletedRun).toHaveBeenCalledOnce());
      expect(repository.markRunFailed).not.toHaveBeenCalled();
    } else {
      expect(response.statusCode).toBe(202);
      await vi.waitFor(() => expect(repository.saveCompletedRun).toHaveBeenCalledOnce());
      expect(repository.markRunFailed).not.toHaveBeenCalled();
    }
    await app.close();
  });

  it("rejects truth fields and client-controlled run IDs", async () => {
    const createRun = vi.fn(async () => ({ runId: "server-run", status: "COMPLETED" as const }));
    const app = buildApp(config, createTestDatabase(), createTestService({ createRun }));
    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        runId: "client-run",
        asOfDate: "2026-08-23",
        bankCsv: "bank",
        ledgerCsv: "ledger",
        truth: { expectedOutcome: "RECONCILED" },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(createRun).not.toHaveBeenCalled();
    await app.close();
  });

  it("sanitizes infrastructure failures and does not retry the service", async () => {
    const createRun = vi.fn(async () => { throw new Error("postgres password and model details"); });
    const app = buildApp(config, createTestDatabase(), createTestService({ createRun }));
    const response = await app.inject({ method: "POST", url: "/api/runs", payload: { asOfDate: "2026-08-23", bankCsv: "bank", ledgerCsv: "ledger" } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "SYSTEM_ERROR", message: "The reconciliation run could not be completed." });
    expect(response.body).not.toContain("postgres password");
    expect(createRun).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns a sanitized system error for database failures on read routes", async () => {
    const app = buildApp(config, createTestDatabase(), createTestService({
      getSummary: async () => { throw new Error("postgresql://user:secret@host/db"); },
    }));
    const response = await app.inject({ method: "GET", url: "/api/runs/run-api-001", headers: { authorization: "Bearer bearer-sentinel" } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "SYSTEM_ERROR", message: "The service is temporarily unavailable." });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("postgresql");
    expect(response.body).not.toContain("bearer-sentinel");
    await app.close();
  });

  it("allows only the configured web origin and supports preflight", async () => {
    const app = buildApp(config, createTestDatabase(), createTestService());
    const allowed = await app.inject({ method: "OPTIONS", url: "/api/runs", headers: { origin: config.WEB_ORIGIN } });
    const denied = await app.inject({ method: "OPTIONS", url: "/api/runs", headers: { origin: "https://unexpected.example" } });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(config.WEB_ORIGIN);
    expect(denied.statusCode).toBe(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("does not expose empty finance data for a failed run", async () => {
    const app = buildApp(config, createTestDatabase(), createTestService({
      getSummary: async () => ({ runId: "run-api-001", status: "FAILED", totalCases: 0, reconciled: 0, explainedOutstanding: 0, discrepancies: 0, unresolved: 0 }),
      getResults: async () => { throw new RunFailedError(); },
    }));
    const summary = await app.inject({ method: "GET", url: "/api/runs/run-api-001" });
    const results = await app.inject({ method: "GET", url: "/api/runs/run-api-001/results" });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ runId: "run-api-001", status: "FAILED" });
    expect(results.statusCode).toBe(500);
    expect(results.json()).toEqual({ error: "RUN_FAILED", message: "This reconciliation run failed and has no finance results." });
    await app.close();
  });

  it("forwards a stop request to the run service", async () => {
    const cancelRun = vi.fn(async () => true);
    const app = buildApp(config, createTestDatabase(), createTestService({ cancelRun }));
    const response = await app.inject({ method: "POST", url: "/api/runs/run-api-001/cancel" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "CANCEL_REQUESTED" });
    expect(cancelRun).toHaveBeenCalledWith("run-api-001");
    await app.close();
  });

  it("distinguishes missing traces from empty successful traces", async () => {
    const app = buildApp(config, createTestDatabase(), createTestService({
      getTrace: async () => { throw new TraceUnavailableError(); },
    }));
    const response = await app.inject({ method: "GET", url: "/api/runs/run-api-001/trace" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "TRACE_NOT_FOUND", message: "Trace data is unavailable for this run." });
    await app.close();
  });

  it("returns resource-specific 404s for unknown cases", async () => {
    const app = buildApp(config, createTestDatabase(), createTestService({
      getResult: async () => undefined,
    }));
    const response = await app.inject({ method: "GET", url: "/api/runs/run-api-001/results/BANK%3Aunknown" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "CASE_NOT_FOUND", message: "Case result not found for this run." });
    await app.close();
  });

  it.each(["/api/runs/unknown", "/api/runs/unknown/results", "/api/runs/unknown/exceptions", "/api/runs/unknown/events", "/api/runs/unknown/trace"])("returns 404 for an unknown run via %s", async (url) => {
    const app = buildApp(config, createTestDatabase(), createTestService({
      getSummary: async () => undefined,
      getResults: async () => undefined,
      getExceptions: async () => undefined,
      getTrace: async () => undefined,
    }));
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns ordered read-only results and filters exceptions", async () => {
    const service = createTestService();
    const app = buildApp(config, createTestDatabase(), service);
    await expect(app.inject({ method: "GET", url: "/api/runs/run-api-001" })).resolves.toMatchObject({ statusCode: 200 });
    expect((await app.inject({ method: "GET", url: "/api/runs/run-api-001/results" })).json()).toEqual([{ caseId: "BANK:B1" }, { caseId: "BANK:B2" }]);
    expect((await app.inject({ method: "GET", url: "/api/runs/run-api-001/exceptions" })).json()).toEqual([{ caseId: "BANK:B2", finalOutcome: "DISCREPANCY" }]);
    expect((await app.inject({ method: "GET", url: "/api/runs/run-api-001/events" })).json()).toEqual([{ sequenceNo: 1 }, { sequenceNo: 2 }]);
    await app.close();
  });
});

function proposalFor(benchmarkCase: BenchmarkCase): AgentProposal {
  const bankRecordIds = benchmarkCase.truth.bankRecordIds;
  const ledgerRecordIds = benchmarkCase.truth.ledgerRecordIds;
  const recordIds = [...bankRecordIds, ...ledgerRecordIds];
  const evidence = [{
    statement: "The supplied records provide the configured fixture evidence.",
    source: "CROSS_RECORD" as const,
    kind: "SEMANTIC" as const,
    recordIds: recordIds.length > 0 ? recordIds : [benchmarkCase.ledgerTransactions[0]?.ledgerTxnId ?? benchmarkCase.bankTransactions[0]!.bankTxnId],
  }];
  if (benchmarkCase.expectedOutcome === "RECONCILED") return { proposedOutcome: "MATCH", bankRecordIds, ledgerRecordIds, confidence: "HIGH", evidence, conflictingEvidence: [], reason: "The supplied evidence supports the configured relationship." };
  if (benchmarkCase.expectedOutcome === "EXPLAINED_OUTSTANDING") return { proposedOutcome: "TIMING_DIFFERENCE", bankRecordIds, ledgerRecordIds, confidence: "HIGH", evidence, conflictingEvidence: [], reason: "The ledger record has future maturity evidence." };
  if (benchmarkCase.expectedOutcome === "DISCREPANCY") return { proposedOutcome: "DISCREPANCY", bankRecordIds, ledgerRecordIds, confidence: "HIGH", evidence, conflictingEvidence: benchmarkCase.reasonCode === "CONFLICTING_RECORDS" ? [{ statement: "The supplied records contain conflicting evidence.", source: "CROSS_RECORD", recordIds }] : [], reason: "The supplied records do not support an equal financial relationship." };
  const primaryId = benchmarkCase.bankTransactions[0]?.bankTxnId ?? benchmarkCase.ledgerTransactions[0]!.ledgerTxnId;
  return { proposedOutcome: "INSUFFICIENT_EVIDENCE", bankRecordIds: benchmarkCase.bankTransactions.length > 0 ? [primaryId] : [], ledgerRecordIds: benchmarkCase.bankTransactions.length === 0 ? [primaryId] : [], confidence: "LOW", evidence, conflictingEvidence: [], reason: "The supplied evidence does not establish a unique relationship." };
}

class FixtureAdapter implements ReasoningModelAdapter {
  constructor(private readonly cases: readonly BenchmarkCase[]) {}

  async generateProposal(input: { input: string }): Promise<AgentProposal> {
    const match = input.input.match(/"primary":\{"side":"(BANK|LEDGER)","record":\{(?:"bankTxnId"|"ledgerTxnId"):"([^"]+)"/);
    if (match === null) throw new Error("fixture adapter could not identify primary record");
    const primaryId = match[2]!;
    const benchmarkCase = this.cases.find((candidate) => candidate.bankTransactions.some((record) => record.bankTxnId === primaryId) || candidate.ledgerTransactions.some((record) => record.ledgerTxnId === primaryId));
    if (benchmarkCase === undefined) throw new Error(`fixture case not found for ${primaryId}`);
    return proposalFor(benchmarkCase);
  }
}
