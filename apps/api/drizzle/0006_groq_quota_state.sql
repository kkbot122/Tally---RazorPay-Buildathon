CREATE TABLE "groq_quota_state" (
  "scope" text PRIMARY KEY NOT NULL,
  "minute_started_at" timestamp with time zone NOT NULL,
  "requests_in_minute" integer NOT NULL,
  "tokens_in_minute" integer NOT NULL,
  "blocked_until" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
