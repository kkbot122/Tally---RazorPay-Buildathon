import Fastify from "fastify";
import type { AppConfig } from "./config/env.js";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";

export interface DatabaseHandle {
  check(): Promise<void>;
  close(): Promise<void>;
}

export function buildApp(
  config: AppConfig = loadConfig(),
  database: DatabaseHandle = createDatabase(config.DATABASE_URL),
) {
  const app = Fastify({ logger: true });

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

  app.addHook("onClose", async () => {
    await database.close();
  });

  return app;
}
