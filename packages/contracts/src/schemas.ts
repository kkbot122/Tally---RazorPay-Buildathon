import { z } from "zod";

const id = z.string().trim().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const nonEmptyText = z.string().trim().min(1);

export const BankTransactionSchema = z.object({
  bankTxnId: id,
  bookingDate: isoDate,
  valueDate: isoDate,
  amount: z.bigint().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Expected an uppercase ISO 4217 currency code"),
  direction: z.enum(["CREDIT", "DEBIT"]),
  reference: nonEmptyText,
  counterparty: nonEmptyText,
  description: nonEmptyText,
  batchId: id,
});

export const LedgerTransactionSchema = z.object({
  ledgerTxnId: id,
  accountingDate: isoDate,
  maturityDate: isoDate,
  amount: z.bigint().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Expected an uppercase ISO 4217 currency code"),
  direction: z.enum(["CREDIT", "DEBIT"]),
  reference: nonEmptyText,
  counterparty: nonEmptyText,
  description: nonEmptyText,
  source: nonEmptyText,
  batchId: id,
});

export const FinalOutcomeSchema = z.enum([
  "RECONCILED",
  "EXPLAINED_OUTSTANDING",
  "DISCREPANCY",
  "UNRESOLVED",
]);

export const ReasonCodeSchema = z.enum([
  "EXACT_MATCH",
  "NORMALIZED_REFERENCE_MATCH",
  "SEMANTIC_REFERENCE_MATCH",
  "COUNTERPARTY_MATCH",
  "GROUPED_MATCH",
  "MULTI_EVIDENCE_MATCH",
  "TIMING_DIFFERENCE",
  "AMOUNT_DISCREPANCY",
  "CONFLICTING_RECORDS",
  "DUPLICATE_USAGE",
  "NO_CANDIDATE",
  "MULTIPLE_PLAUSIBLE_CANDIDATES",
  "INSUFFICIENT_EVIDENCE",
  "VERIFICATION_FAILED",
]);

export const AgentProposedOutcomeSchema = z.enum([
  "MATCH",
  "TIMING_DIFFERENCE",
  "DISCREPANCY",
  "INSUFFICIENT_EVIDENCE",
]);

export const AgentConfidenceSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const AgentEvidenceSchema = z.object({
  statement: nonEmptyText,
  source: z.enum(["BANK_RECORD", "LEDGER_RECORD", "CROSS_RECORD", "DETERMINISTIC"]),
  recordIds: z.array(id).min(1),
});

export const AgentProposalSchema = z.object({
  proposedOutcome: AgentProposedOutcomeSchema,
  bankTxnIds: z.array(id),
  ledgerTxnIds: z.array(id),
  confidence: AgentConfidenceSchema,
  supportingEvidence: z.array(AgentEvidenceSchema).min(1),
  conflictingEvidence: z.array(AgentEvidenceSchema),
  reason: nonEmptyText,
});

export const VerificationResultSchema = z.object({
  accepted: z.boolean(),
  candidateExists: z.boolean(),
  amountValid: z.boolean(),
  currencyValid: z.boolean(),
  directionValid: z.boolean(),
  groupingValid: z.boolean(),
  uniquenessValid: z.boolean(),
  hardConflicts: z.array(nonEmptyText),
  reason: nonEmptyText,
});

export const ReconciliationResultSchema = z.object({
  caseId: id,
  bankTxnIds: z.array(id),
  ledgerTxnIds: z.array(id),
  finalOutcome: FinalOutcomeSchema,
  reasonCode: ReasonCodeSchema,
  evidence: z.array(AgentEvidenceSchema),
  verification: VerificationResultSchema,
});

export const TraceEventTypeSchema = z.enum([
  "RUN_STARTED",
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
]);

export const TraceEventSchema = z.object({
  eventId: id,
  runId: id,
  caseId: id.optional(),
  type: TraceEventTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  message: nonEmptyText,
  metadata: z.record(z.unknown()),
});
