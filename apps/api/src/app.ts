import { loadFrozenGroundTruth, loadFrozenPrimaryCaseAlignment } from "@tally/benchmark";
import Fastify from "fastify";
import { CsvValidationError, NvidiaChatCompletionsAdapter, OpenAIResponsesAdapter } from "@tally/reconciliation";
import { ZodError } from "zod";
import type { AppConfig } from "./config/env.js";
import { loadConfig, useE2EDeterministicAdapter } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createReconciliationRunRepository } from "./db/reconciliation-run-repository.js";
import { BenchmarkEvaluationError, createBenchmarkEvaluationService, type BenchmarkEvaluationResponse } from "./benchmark-evaluation-service.js";
import { CreateRunRequestSchema, createReconciliationRunService, RunFailedError, TraceUnavailableError, type ReconciliationRunService } from "./run-service.js";
import { createE2EReasoningAdapter } from "./e2e-reasoning-adapter.js";

const EVALUATION_TRUTH_FIELDS = new Set([
  "groundtruthcsv",
  "groundtruth",
  "expectedoutcome",
  "expectedreasoncode",
  "benchmarkcategory",
  "truthbankids",
  "truthledgerids",
]);

function normalizedEvaluationField(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface DatabaseHandle {
  db?: Parameters<typeof createReconciliationRunRepository>[0];
  check(): Promise<void>;
  close(): Promise<void>;
}

export interface BenchmarkEvaluationService {
  evaluate(runId: string): Promise<BenchmarkEvaluationResponse>;
}

export function buildApp(
  config: AppConfig = loadConfig(),
  database: DatabaseHandle = createDatabase(config.DATABASE_URL),
  service?: ReconciliationRunService,
  evaluationService?: BenchmarkEvaluationService,
) {
  const app = Fastify({ logger: true });
  const addCorsHeaders = (reply: { header: (name: string, value: string) => unknown }, origin: string | undefined) => {
    if (origin !== config.WEB_ORIGIN) return;
    reply.header("Access-Control-Allow-Origin", origin);
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    reply.header("Vary", "Origin");
  };
  app.addHook("onSend", async (request, reply, payload) => {
    addCorsHeaders(reply, request.headers.origin);
    return payload;
  });
  app.options("/*", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin !== config.WEB_ORIGIN) return reply.code(403).send({ error: "ORIGIN_NOT_ALLOWED", message: "The request origin is not allowed." });
    addCorsHeaders(reply, origin);
    return reply.code(204).send();
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error, "request failed");
    if (error instanceof RunFailedError) return reply.code(500).send({ error: error.code, message: error.message });
    return reply.code(500).send({ error: "SYSTEM_ERROR", message: "The service is temporarily unavailable." });
  });
  const runService = service ?? (database.db === undefined ? undefined : createReconciliationRunService(
    createReconciliationRunRepository(database.db),
    useE2EDeterministicAdapter(config)
      ? createE2EReasoningAdapter()
      : config.AI_PROVIDER === "nvidia"
        ? new NvidiaChatCompletionsAdapter({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, baseURL: config.AI_BASE_URL, reasoningEffort: config.AI_REASONING_EFFORT })
        : new OpenAIResponsesAdapter({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL, baseURL: config.AI_BASE_URL }),
    undefined,
    undefined,
    (event) => app.log.warn(event, "model proposal rejected by verifier"),
  ));
  const benchmarkEvaluationService = evaluationService ?? (database.db === undefined ? undefined : createBenchmarkEvaluationService(
      createReconciliationRunRepository(database.db),
      loadFrozenGroundTruth,
      loadFrozenPrimaryCaseAlignment,
    ));

  app.get("/health", async () => ({ status: "ok" as const }));

  app.get("/health/db", async (request, reply) => {
    try {
      await database.check();
      return { db: "ok" as const };
    } catch (error) {
      request.log.error(error, "database health check failed");
      return reply.code(503).send({ db: "error" as const });
    }
  });

  app.post("/api/runs/:runId/evaluate", {
    schema: {
      params: {
        type: "object",
        required: ["runId"],
        properties: { runId: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const body = request.body as unknown;
    if (body !== undefined && body !== null && (
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body as Record<string, unknown>).length > 0
    )) {
      return reply.code(400).send({ error: "invalid evaluation request" });
    }
    const query = request.query as Record<string, unknown>;
    const hasTruthQuery = Object.keys(query).some((key) => EVALUATION_TRUTH_FIELDS.has(normalizedEvaluationField(key)));
    const hasTruthHeader = Object.keys(request.headers).some((key) => EVALUATION_TRUTH_FIELDS.has(normalizedEvaluationField(key)));
    if (hasTruthQuery || hasTruthHeader) return reply.code(400).send({ error: "invalid evaluation request" });
    if (benchmarkEvaluationService === undefined) return reply.code(503).send({ error: "evaluation service unavailable" });
    const { runId } = request.params as { runId: string };
    try {
      return await benchmarkEvaluationService.evaluate(runId);
    } catch (error) {
      if (error instanceof BenchmarkEvaluationError) {
        if (error.code === "RUN_NOT_FOUND") return reply.code(404).send({ error: error.code, message: "run not found" });
        if (error.code === "RUN_NOT_COMPLETED" || error.code === "RUN_NOT_BENCHMARK_COMPATIBLE") {
          return reply.code(422).send({ error: error.code });
        }
      }
      request.log.error(error, "benchmark evaluation failed");
      return reply.code(500).send({ error: "EVALUATION_FAILED" });
    }
  });

  app.post("/api/runs", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "The reconciliation service is unavailable." });
    const parsed = CreateRunRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid run request", details: parsed.error.flatten() });
    try {
      return await runService.createRun(parsed.data);
    } catch (error) {
      request.log.error(error, "reconciliation run failed");
      if (error instanceof CsvValidationError) {
        return reply.code(400).send({ error: "INVALID_CSV", message: "The uploaded CSV is invalid.", details: error.issues });
      }
      if (error instanceof ZodError) {
        return reply.code(400).send({ error: "INVALID_REQUEST", message: "The run request is invalid." });
      }
      return reply.code(500).send({ error: "SYSTEM_ERROR", message: "The reconciliation run could not be completed." });
    }
  });

  app.get("/api/runs/:runId", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "The reconciliation service is unavailable." });
    const summary = await runService.getSummary((request.params as { runId: string }).runId);
    return summary === undefined ? reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found." }) : summary;
  });

  app.get("/api/runs/:runId/results", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "The reconciliation service is unavailable." });
    const results = await runService.getResults((request.params as { runId: string }).runId);
    return results === undefined ? reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found." }) : results;
  });

  app.get("/api/runs/:runId/results/:caseId", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "The reconciliation service is unavailable." });
    const { runId, caseId } = request.params as { runId: string; caseId: string };
    const result = await runService.getResult(runId, caseId);
    if (result !== undefined) return result;
    const run = await runService.getSummary(runId);
    return run === undefined
      ? reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found." })
      : reply.code(404).send({ error: "CASE_NOT_FOUND", message: "Case result not found for this run." });
  });

  app.get("/api/runs/:runId/exceptions", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "The reconciliation service is unavailable." });
    const exceptions = await runService.getExceptions((request.params as { runId: string }).runId);
    return exceptions === undefined ? reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found." }) : exceptions;
  });

  const traceHandler = async (request: { params: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (runService === undefined) return reply.code(503).send({ error: "SERVICE_UNAVAILABLE", message: "The reconciliation service is unavailable." });
    try {
      const trace = await runService.getTrace((request.params as { runId: string }).runId);
      return trace === undefined ? reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found." }) : trace;
    } catch (error) {
      if (error instanceof TraceUnavailableError) {
        return reply.code(404).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  };
  app.get("/api/runs/:runId/events", traceHandler);
  app.get("/api/runs/:runId/trace", traceHandler);

  app.addHook("onClose", async () => {
    await database.close();
  });

  return app;
}
