import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = buildApp(config);

try {
await app.listen({ host: "0.0.0.0", port: config.PORT });
const service = (app as unknown as { reconciliationRunService?: { recoverPendingRuns?: () => Promise<void> } }).reconciliationRunService;
await (service as { startWorker?: () => Promise<void> } | undefined)?.startWorker?.();
await service?.recoverPendingRuns?.();
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
