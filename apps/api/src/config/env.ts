import { z } from "zod";

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url().default("postgresql://localhost:5432/tally"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(environment);
}
