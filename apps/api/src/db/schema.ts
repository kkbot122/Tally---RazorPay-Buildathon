import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const runStatusEnum = pgEnum("run_status", [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const workItemStatusEnum = pgEnum("work_item_status", [
  "PENDING",
  "LEASED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const directionEnum = pgEnum("transaction_direction", ["CREDIT", "DEBIT"]);

export const finalOutcomeEnum = pgEnum("final_outcome", [
  "RECONCILED",
  "EXPLAINED_OUTSTANDING",
  "DISCREPANCY",
  "UNRESOLVED",
]);

export const agentOutcomeEnum = pgEnum("agent_proposed_outcome", [
  "MATCH",
  "TIMING_DIFFERENCE",
  "DISCREPANCY",
  "INSUFFICIENT_EVIDENCE",
]);

export const confidenceEnum = pgEnum("agent_confidence", ["HIGH", "MEDIUM", "LOW"]);

export const traceEventTypeEnum = pgEnum("trace_event_type", [
  "RUN_STARTED",
  "RUN_FAILED",
  "CASE_STARTED",
  "TRANSACTION_NORMALIZED",
  "RULE_EVALUATED",
  "RULE_PASSED",
  "RULE_FAILED",
  "AUTO_RECONCILED",
  "CANDIDATES_GENERATED",
  "AGENT_STARTED",
  "AGENT_PROPOSED",
  "VERIFICATION_CHECKED",
  "CASE_FINALIZED",
  "RUN_COMPLETED",
  "RUN_PLANNED",
  "WORK_ITEM_CREATED",
  "WORK_ITEM_CLAIMED",
  "WORK_ITEM_RELEASED",
  "WORK_ITEM_COMPLETED",
  "WORK_ITEM_FAILED",
  "WORK_ITEM_CANCELLED",
  "REASONING_BATCH_STARTED",
  "REASONING_BATCH_COMPLETED",
  "REPAIR_STARTED",
  "WORKER_SLICE_YIELDED",
  "RUN_CANCELLED",
]);

export const reconciliationRuns = pgTable("reconciliation_runs", {
  runId: text("run_id").primaryKey(),
  asOfDate: date("as_of_date").notNull(),
  status: runStatusEnum("status").notNull().default("PENDING"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalBankRecords: integer("total_bank_records").notNull().default(0),
  totalLedgerRecords: integer("total_ledger_records").notNull().default(0),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
  modelMetadata: jsonb("model_metadata").$type<Record<string, unknown>>().notNull().default({}),
  totalWorkItems: integer("total_work_items").notNull().default(0),
  completedWorkItems: integer("completed_work_items").notNull().default(0),
  failedWorkItems: integer("failed_work_items").notNull().default(0),
  pendingWorkItems: integer("pending_work_items").notNull().default(0),
  activeWorkItems: integer("active_work_items").notNull().default(0),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reconciliationRunInputs = pgTable("reconciliation_run_inputs", {
  runId: text("run_id").primaryKey().references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
  asOfDate: date("as_of_date").notNull(),
  bankCsv: text("bank_csv").notNull(),
  ledgerCsv: text("ledger_csv").notNull(),
  bankSha256: text("bank_sha256").notNull(),
  ledgerSha256: text("ledger_sha256").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reconciliationWorkItems = pgTable("reconciliation_work_items", {
  workItemId: text("work_item_id").primaryKey(),
  runId: text("run_id").notNull().references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
  sequenceNo: integer("sequence_no").notNull(),
  caseIds: jsonb("case_ids").$type<string[]>().notNull(),
  componentSnapshot: jsonb("component_snapshot").$type<Record<string, unknown>>().notNull(),
  candidateSnapshot: jsonb("candidate_snapshot").$type<Record<string, unknown>>().notNull(),
  status: workItemStatusEnum("status").notNull().default("PENDING"),
  attemptCount: integer("attempt_count").notNull().default(0),
  repairAttemptCount: integer("repair_attempt_count").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  lastFailureClassification: text("last_failure_classification"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reconciliation_work_items_run_sequence_idx").on(table.runId, table.sequenceNo),
]);

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    bankTxnId: text("bank_txn_id").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
    batchId: text("batch_id"),
    bookingDate: date("booking_date").notNull(),
    valueDate: date("value_date").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    direction: directionEnum("direction").notNull(),
    reference: text("reference"),
    counterparty: text("counterparty"),
    description: text("description"),
    originalData: jsonb("original_data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.bankTxnId] })],
);

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    ledgerTxnId: text("ledger_txn_id").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
    batchId: text("batch_id"),
    accountingDate: date("accounting_date").notNull(),
    maturityDate: date("maturity_date"),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    direction: directionEnum("direction").notNull(),
    reference: text("reference"),
    counterparty: text("counterparty"),
    description: text("description"),
    source: text("source").notNull(),
    originalData: jsonb("original_data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.ledgerTxnId] })],
);

export const agentProposals = pgTable("agent_proposals", {
  proposalId: text("proposal_id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
  caseId: text("case_id").notNull(),
  proposedOutcome: agentOutcomeEnum("proposed_outcome").notNull(),
  confidence: confidenceEnum("confidence").notNull(),
  bankTxnIds: jsonb("bank_txn_ids").$type<string[]>().notNull(),
  ledgerTxnIds: jsonb("ledger_txn_ids").$type<string[]>().notNull(),
  supportingEvidence: jsonb("supporting_evidence").$type<Record<string, unknown>[]>().notNull(),
  conflictingEvidence: jsonb("conflicting_evidence").$type<Record<string, unknown>[]>().notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const verificationResults = pgTable("verification_results", {
  verificationId: text("verification_id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
  caseId: text("case_id").notNull(),
  accepted: boolean("accepted").notNull(),
  candidateExists: boolean("candidate_exists").notNull(),
  amountValid: boolean("amount_valid").notNull(),
  currencyValid: boolean("currency_valid").notNull(),
  directionValid: boolean("direction_valid").notNull(),
  groupingValid: boolean("grouping_valid").notNull(),
  uniquenessValid: boolean("uniqueness_valid").notNull(),
  hardConflicts: jsonb("hard_conflicts").$type<string[]>().notNull(),
  reason: text("reason").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reconciliationResults = pgTable(
  "reconciliation_results",
  {
    resultId: text("result_id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
    caseId: text("case_id").notNull(),
    bankTxnIds: jsonb("bank_txn_ids").$type<string[]>().notNull(),
    ledgerTxnIds: jsonb("ledger_txn_ids").$type<string[]>().notNull(),
    finalOutcome: finalOutcomeEnum("final_outcome").notNull(),
    reasonCode: text("reason_code").notNull(),
    source: text("source").notNull(),
    rule: text("rule"),
    confidence: confidenceEnum("confidence"),
    evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull(),
    conflictingEvidence: jsonb("conflicting_evidence").$type<Record<string, unknown>[]>().notNull().default([]),
    reason: text("reason"),
    amountDeltaPaise: text("amount_delta_paise"),
    finalizationOrder: integer("finalization_order"),
    agentProposalId: text("agent_proposal_id").references(() => agentProposals.proposalId, {
      onDelete: "set null",
    }),
    verificationId: text("verification_id").references(() => verificationResults.verificationId, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("reconciliation_results_run_case_idx").on(table.runId, table.caseId)],
);

export const traceEvents = pgTable("trace_events", {
  eventId: text("event_id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
  caseId: text("case_id"),
  type: traceEventTypeEnum("type").notNull(),
  sequenceNo: integer("sequence_no").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [uniqueIndex("trace_events_run_sequence_idx").on(table.runId, table.sequenceNo)]);

export const benchmarkEvaluations = pgTable("benchmark_evaluations", {
  evaluationId: text("evaluation_id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => reconciliationRuns.runId, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  reasoningConfiguration: jsonb("reasoning_configuration")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  latencyMs: integer("latency_ms"),
  tokenUsage: jsonb("token_usage").$type<Record<string, unknown>>(),
  estimatedCost: text("estimated_cost"),
  gitCommit: text("git_commit"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
