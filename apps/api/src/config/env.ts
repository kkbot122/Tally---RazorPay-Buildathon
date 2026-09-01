import { z } from "zod";
import { DEFAULT_GROQ_REASONING_MODEL, DEFAULT_GROQ_QUOTA_SCOPE, DEFAULT_GROQ_RATE_LIMIT } from "@tally/reconciliation";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url().default("postgresql://localhost:5432/tally"),
  OPENAI_API_KEY: z.string().default(""),
  GROQ_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  AI_PROVIDER: z.enum(["openai", "nvidia", "groq"]).default("openai"),
  AI_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  AI_REASONING_EFFORT: z.enum(["none", "high", "max"]).default("none"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(12_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(0),
  AI_REASONING_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  AI_MAX_REASONING_CALLS_PER_RUN: z.coerce.number().int().min(1).max(100).default(3),
  AI_GROQ_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(DEFAULT_GROQ_RATE_LIMIT.requestsPerMinute),
  AI_GROQ_TOKENS_PER_MINUTE: z.coerce.number().int().min(1_000).max(10_000_000).default(DEFAULT_GROQ_RATE_LIMIT.tokensPerMinute),
  /** A shared value for every replica using the same Groq organization. */
  AI_GROQ_QUOTA_SCOPE: z.string().trim().min(1).max(200).default(DEFAULT_GROQ_QUOTA_SCOPE),
  AI_RUN_DEADLINE_MS: z.coerce.number().int().min(10_000).max(600_000).default(90_000),
  /** Durable worker controls. Undefined values use deployment-safe defaults. */
  AI_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).optional(),
  AI_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).optional(),
  AI_WORKER_LEASE_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  AI_WORKER_SLICE_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  AI_MAX_REASONING_ITEMS_PER_REQUEST: z.coerce.number().int().min(1).max(5).optional(),
  AI_REASONING_COMPLETION_TOKEN_CAP: z.coerce.number().int().min(128).max(16_384).optional(),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  TALLY_E2E_DETERMINISTIC_ADAPTER: z.enum(["true", "false"]).optional(),
});

export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const DEFAULT_GROQ_MODEL = DEFAULT_GROQ_REASONING_MODEL;

export type AppConfig = z.infer<typeof EnvSchema>;

export const DEFAULT_WORKER_CONFIGURATION = {
  pollIntervalMs: 1_000,
  concurrency: 1,
  leaseMs: 60_000,
  sliceMs: 30_000,
  maxReasoningItemsPerRequest: 3,
  completionTokenCap: 1_536,
} as const;

const GROQ_QUOTA_WAIT_SLICE_MS = 75_000;

export function workerConfiguration(config: AppConfig) {
  const concurrency = config.AI_WORKER_CONCURRENCY ?? DEFAULT_WORKER_CONFIGURATION.concurrency;
  const sliceMs = config.AI_WORKER_SLICE_MS ?? DEFAULT_WORKER_CONFIGURATION.sliceMs;
  // The free Groq budget is 8k TPM. A three-item batch reserves most of it,
  // so concurrent workers only queue behind the shared limiter and repeatedly
  // expire their 60-second slices before the next minute begins.
  const constrainedGroq = config.AI_PROVIDER === "groq" && config.AI_GROQ_TOKENS_PER_MINUTE <= DEFAULT_GROQ_RATE_LIMIT.tokensPerMinute;
  return {
    pollIntervalMs: config.AI_WORKER_POLL_INTERVAL_MS ?? DEFAULT_WORKER_CONFIGURATION.pollIntervalMs,
    concurrency: constrainedGroq ? 1 : concurrency,
    leaseMs: config.AI_WORKER_LEASE_MS ?? DEFAULT_WORKER_CONFIGURATION.leaseMs,
    sliceMs: constrainedGroq ? Math.max(sliceMs, GROQ_QUOTA_WAIT_SLICE_MS) : sliceMs,
    maxReasoningItemsPerRequest: config.AI_MAX_REASONING_ITEMS_PER_REQUEST ?? DEFAULT_WORKER_CONFIGURATION.maxReasoningItemsPerRequest,
    completionTokenCap: config.AI_REASONING_COMPLETION_TOKEN_CAP ?? DEFAULT_WORKER_CONFIGURATION.completionTokenCap,
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(environment);
  const config = parsed.AI_PROVIDER === "nvidia" && parsed.OPENAI_MODEL === "gpt-5.6-terra"
    ? { ...parsed, OPENAI_MODEL: DEFAULT_NVIDIA_MODEL }
    : parsed.AI_PROVIDER === "groq" && parsed.OPENAI_MODEL === "gpt-5.6-terra"
      ? { ...parsed, OPENAI_MODEL: DEFAULT_GROQ_MODEL }
      : parsed;
  if (config.NODE_ENV === "production") {
    const apiKey = config.AI_PROVIDER === "groq" ? config.GROQ_API_KEY : config.OPENAI_API_KEY;
    if (apiKey.trim().length === 0) {
      throw new Error(config.AI_PROVIDER === "groq" ? "GROQ_API_KEY is required in production" : "OPENAI_API_KEY is required in production");
    }
    if (config.DATABASE_URL === "postgresql://localhost:5432/tally") throw new Error("DATABASE_URL is required in production");
    if (config.WEB_ORIGIN === "http://localhost:3000") throw new Error("WEB_ORIGIN is required in production");
  }
  return config;
}

export function useE2EDeterministicAdapter(config: Pick<AppConfig, "NODE_ENV" | "TALLY_E2E_DETERMINISTIC_ADAPTER">): boolean {
  return config.NODE_ENV === "test" && config.TALLY_E2E_DETERMINISTIC_ADAPTER === "true";
}
