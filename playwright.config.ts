import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.TALLY_E2E_DATABASE_URL ?? "postgresql://tally:tally@127.0.0.1:55432/tally_e2e";
const deterministicAdapter = process.env.TALLY_E2E_DETERMINISTIC_ADAPTER !== "false" && process.env.TALLY_E2E_DETERMINISTIC_ADAPTER !== "0";
const groqApiKey = process.env.TALLY_E2E_GROQ_API_KEY ?? "";
const e2eApiPort = process.env.TALLY_E2E_API_PORT ?? "3101";
const e2eWebPort = process.env.TALLY_E2E_WEB_PORT ?? "3100";
const e2eApiOrigin = `http://127.0.0.1:${e2eApiPort}`;
const e2eWebOrigin = `http://127.0.0.1:${e2eWebPort}`;
const executablePath = process.env.TALLY_E2E_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 180_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: e2eWebOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: "pnpm --filter @tally/api dev",
      url: `${e2eApiOrigin}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "test",
        PORT: e2eApiPort,
        DATABASE_URL: databaseUrl,
        GROQ_API_KEY: groqApiKey,
        GROQ_MODEL: process.env.TALLY_E2E_GROQ_MODEL ?? "openai/gpt-oss-120b",
        WEB_ORIGIN: e2eWebOrigin,
        TALLY_E2E_DETERMINISTIC_ADAPTER: deterministicAdapter ? "true" : "false",
      },
    },
    {
      command: `pnpm --filter @tally/web exec next dev -p ${e2eWebPort}`,
      url: e2eWebOrigin,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { TALLY_API_ORIGIN: e2eApiOrigin },
    },
  ],
});
