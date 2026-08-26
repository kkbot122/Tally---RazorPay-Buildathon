import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url().default("postgresql://localhost:5432/tally"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  AI_PROVIDER: z.enum(["openai", "nvidia"]).default("openai"),
  AI_BASE_URL: z.string().url().optional(),
  AI_REASONING_EFFORT: z.enum(["none", "high", "max"]).default("none"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(12_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(0),
  AI_REASONING_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(8),
  AI_RUN_DEADLINE_MS: z.coerce.number().int().min(10_000).max(600_000).default(90_000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  TALLY_E2E_DETERMINISTIC_ADAPTER: z.enum(["true", "false"]).optional(),
});

export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(environment);
  const config = parsed.AI_PROVIDER === "nvidia" && parsed.OPENAI_MODEL === "gpt-5.6-terra"
    ? { ...parsed, OPENAI_MODEL: DEFAULT_NVIDIA_MODEL }
    : parsed;
  if (config.NODE_ENV === "production") {
    if (config.OPENAI_API_KEY.trim().length === 0) throw new Error("OPENAI_API_KEY is required in production");
    if (config.DATABASE_URL === "postgresql://localhost:5432/tally") throw new Error("DATABASE_URL is required in production");
    if (config.WEB_ORIGIN === "http://localhost:3000") throw new Error("WEB_ORIGIN is required in production");
  }
  return config;
}

export function useE2EDeterministicAdapter(config: Pick<AppConfig, "NODE_ENV" | "TALLY_E2E_DETERMINISTIC_ADAPTER">): boolean {
  return config.NODE_ENV === "test" && config.TALLY_E2E_DETERMINISTIC_ADAPTER === "true";
}
