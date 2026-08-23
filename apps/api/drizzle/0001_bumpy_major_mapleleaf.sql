DROP INDEX "bank_transactions_run_id_idx";--> statement-breakpoint
DROP INDEX "ledger_transactions_run_id_idx";--> statement-breakpoint
ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_pkey";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_pkey";--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_run_id_bank_txn_id_pk" PRIMARY KEY("run_id","bank_txn_id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_run_id_ledger_txn_id_pk" PRIMARY KEY("run_id","ledger_txn_id");--> statement-breakpoint
ALTER TABLE "trace_events" ADD COLUMN "sequence_no" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "trace_events_run_sequence_idx" ON "trace_events" USING btree ("run_id","sequence_no");
