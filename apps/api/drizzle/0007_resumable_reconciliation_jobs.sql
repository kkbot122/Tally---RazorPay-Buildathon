ALTER TYPE "run_status" ADD VALUE IF NOT EXISTS 'CANCELLED';
CREATE TYPE "work_item_status" AS ENUM ('PENDING', 'LEASED', 'COMPLETED', 'FAILED', 'CANCELLED');

ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'RUN_PLANNED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'WORK_ITEM_CREATED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'WORK_ITEM_CLAIMED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'WORK_ITEM_RELEASED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'WORK_ITEM_COMPLETED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'WORK_ITEM_FAILED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'WORK_ITEM_CANCELLED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'REASONING_BATCH_STARTED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'REASONING_BATCH_COMPLETED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'REPAIR_STARTED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'WORKER_SLICE_YIELDED';
ALTER TYPE "trace_event_type" ADD VALUE IF NOT EXISTS 'RUN_CANCELLED';

ALTER TABLE "reconciliation_runs"
  ADD COLUMN IF NOT EXISTS "total_work_items" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "completed_work_items" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failed_work_items" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pending_work_items" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "active_work_items" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "failure_code" text;

CREATE TABLE "reconciliation_run_inputs" (
  "run_id" text PRIMARY KEY NOT NULL REFERENCES "reconciliation_runs"("run_id") ON DELETE CASCADE,
  "as_of_date" date NOT NULL,
  "bank_csv" text NOT NULL,
  "ledger_csv" text NOT NULL,
  "bank_sha256" text NOT NULL,
  "ledger_sha256" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "reconciliation_work_items" (
  "work_item_id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "reconciliation_runs"("run_id") ON DELETE CASCADE,
  "sequence_no" integer NOT NULL,
  "case_ids" jsonb NOT NULL,
  "component_snapshot" jsonb NOT NULL,
  "candidate_snapshot" jsonb NOT NULL,
  "status" "work_item_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "repair_attempt_count" integer NOT NULL DEFAULT 0,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "last_failure_classification" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "reconciliation_work_items_run_sequence_unique" UNIQUE ("run_id", "sequence_no")
);
CREATE INDEX "reconciliation_work_items_runnable_idx" ON "reconciliation_work_items" ("run_id", "status", "sequence_no");
CREATE INDEX "reconciliation_work_items_expired_lease_idx" ON "reconciliation_work_items" ("status", "lease_expires_at");
