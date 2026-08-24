-- Legacy rows predate T025. Preserve them with explicit, conservative defaults.
ALTER TABLE "reconciliation_runs" ADD COLUMN "as_of_date" date;--> statement-breakpoint
UPDATE "reconciliation_runs" SET "as_of_date" = "created_at"::date WHERE "as_of_date" IS NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ALTER COLUMN "as_of_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN "source" text;--> statement-breakpoint
UPDATE "reconciliation_results" SET "source" = 'DETERMINISTIC' WHERE "source" IS NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN "rule" text;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN "confidence" "agent_confidence";--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN "conflicting_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD COLUMN "amount_delta_paise" text;--> statement-breakpoint
ALTER TABLE "verification_results" ADD COLUMN "result" jsonb DEFAULT '{}'::jsonb NOT NULL;
