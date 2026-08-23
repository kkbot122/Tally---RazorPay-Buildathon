import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({ logger: true });
  return app;
}
