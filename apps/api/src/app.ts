import Fastify from "fastify";
import { CsvValidationError, OpenAIResponsesAdapter } from "@tally/reconciliation";
import { ZodError } from "zod";
import type { AppConfig } from "./config/env.js";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createReconciliationRunRepository } from "./db/reconciliation-run-repository.js";
import { CreateRunRequestSchema, createReconciliationRunService, type ReconciliationRunService } from "./run-service.js";

export interface DatabaseHandle {
  db?: Parameters<typeof createReconciliationRunRepository>[0];
  check(): Promise<void>;
  close(): Promise<void>;
}

export function buildApp(
  config: AppConfig = loadConfig(),
  database: DatabaseHandle = createDatabase(config.DATABASE_URL),
  service?: ReconciliationRunService,
) {
  const app = Fastify({ logger: true });
  const runService = service ?? (database.db === undefined ? undefined : createReconciliationRunService(
    createReconciliationRunRepository(database.db),
    new OpenAIResponsesAdapter({ apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODEL }),
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

  app.post("/api/runs", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "run service unavailable" });
    const parsed = CreateRunRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid run request", details: parsed.error.flatten() });
    try {
      return await runService.createRun(parsed.data);
    } catch (error) {
      request.log.error(error, "reconciliation run failed");
      if (error instanceof CsvValidationError || error instanceof ZodError) {
        return reply.code(400).send({ error: "invalid run request" });
      }
      return reply.code(500).send({ error: "reconciliation run failed" });
    }
  });

  app.get("/api/runs/:runId", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "run service unavailable" });
    const summary = await runService.getSummary((request.params as { runId: string }).runId);
    return summary === undefined ? reply.code(404).send({ error: "run not found" }) : summary;
  });

  app.get("/api/runs/:runId/results", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "run service unavailable" });
    const results = await runService.getResults((request.params as { runId: string }).runId);
    return results === undefined ? reply.code(404).send({ error: "run not found" }) : results;
  });

  app.get("/api/runs/:runId/exceptions", async (request, reply) => {
    if (runService === undefined) return reply.code(503).send({ error: "run service unavailable" });
    const exceptions = await runService.getExceptions((request.params as { runId: string }).runId);
    return exceptions === undefined ? reply.code(404).send({ error: "run not found" }) : exceptions;
  });

  const traceHandler = async (request: { params: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (runService === undefined) return reply.code(503).send({ error: "run service unavailable" });
    const trace = await runService.getTrace((request.params as { runId: string }).runId);
    return trace === undefined ? reply.code(404).send({ error: "run not found" }) : trace;
  };
  app.get("/api/runs/:runId/events", traceHandler);
  app.get("/api/runs/:runId/trace", traceHandler);

  app.addHook("onClose", async () => {
    await database.close();
  });

  return app;
}
