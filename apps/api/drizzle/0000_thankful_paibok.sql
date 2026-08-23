CREATE TYPE "public"."agent_proposed_outcome" AS ENUM('MATCH', 'TIMING_DIFFERENCE', 'DISCREPANCY', 'INSUFFICIENT_EVIDENCE');--> statement-breakpoint
CREATE TYPE "public"."agent_confidence" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('CREDIT', 'DEBIT');--> statement-breakpoint
CREATE TYPE "public"."final_outcome" AS ENUM('RECONCILED', 'EXPLAINED_OUTSTANDING', 'DISCREPANCY', 'UNRESOLVED');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."trace_event_type" AS ENUM('RUN_STARTED', 'CASE_STARTED', 'TRANSACTION_NORMALIZED', 'RULE_EVALUATED', 'RULE_PASSED', 'RULE_FAILED', 'AUTO_RECONCILED', 'CANDIDATES_GENERATED', 'AGENT_STARTED', 'AGENT_PROPOSED', 'VERIFICATION_CHECKED', 'CASE_FINALIZED', 'RUN_COMPLETED');--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"proposal_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"proposed_outcome" "agent_proposed_outcome" NOT NULL,
	"confidence" "agent_confidence" NOT NULL,
	"bank_txn_ids" jsonb NOT NULL,
	"ledger_txn_ids" jsonb NOT NULL,
	"supporting_evidence" jsonb NOT NULL,
	"conflicting_evidence" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"bank_txn_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"booking_date" date NOT NULL,
	"value_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"reference" text NOT NULL,
	"counterparty" text NOT NULL,
	"description" text NOT NULL,
	"original_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_evaluations" (
	"evaluation_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"reasoning_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"latency_ms" integer,
	"token_usage" jsonb,
	"estimated_cost" text,
	"git_commit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"ledger_txn_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"accounting_date" date NOT NULL,
	"maturity_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"reference" text NOT NULL,
	"counterparty" text NOT NULL,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"original_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_results" (
	"result_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"bank_txn_ids" jsonb NOT NULL,
	"ledger_txn_ids" jsonb NOT NULL,
	"final_outcome" "final_outcome" NOT NULL,
	"reason_code" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"agent_proposal_id" text,
	"verification_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"status" "run_status" DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total_bank_records" integer DEFAULT 0 NOT NULL,
	"total_ledger_records" integer DEFAULT 0 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text,
	"type" "trace_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_results" (
	"verification_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text NOT NULL,
	"accepted" boolean NOT NULL,
	"candidate_exists" boolean NOT NULL,
	"amount_valid" boolean NOT NULL,
	"currency_valid" boolean NOT NULL,
	"direction_valid" boolean NOT NULL,
	"grouping_valid" boolean NOT NULL,
	"uniqueness_valid" boolean NOT NULL,
	"hard_conflicts" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_run_id_reconciliation_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_run_id_reconciliation_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_evaluations" ADD CONSTRAINT "benchmark_evaluations_run_id_reconciliation_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_run_id_reconciliation_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_run_id_reconciliation_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_agent_proposal_id_agent_proposals_proposal_id_fk" FOREIGN KEY ("agent_proposal_id") REFERENCES "public"."agent_proposals"("proposal_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_results" ADD CONSTRAINT "reconciliation_results_verification_id_verification_results_verification_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."verification_results"("verification_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_run_id_reconciliation_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_run_id_reconciliation_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_run_id_idx" ON "bank_transactions" USING btree ("run_id","bank_txn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_run_id_idx" ON "ledger_transactions" USING btree ("run_id","ledger_txn_id");