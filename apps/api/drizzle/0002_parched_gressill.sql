ALTER TABLE "bank_transactions" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ALTER COLUMN "reference" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ALTER COLUMN "counterparty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "maturity_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "reference" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "counterparty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ALTER COLUMN "description" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_results_run_case_idx" ON "reconciliation_results" USING btree ("run_id","case_id");