export type {
  AgentConfidence,
  AgentEvidence,
  AgentProposal,
  AgentProposedOutcome,
  BankTransaction,
  FinalOutcome,
  LedgerTransaction,
  ReasonCode,
  ReconciliationResult,
  TraceEvent,
  TraceEventType,
  VerificationResult,
} from "@tally/contracts";

export {
  BANK_CSV_HEADERS,
  CsvValidationError,
  LEDGER_CSV_HEADERS,
  parseBankCsv,
  parseCsvRows,
  parseLedgerCsv,
} from "./src/parsing/index.js";

export {
  NormalizationError,
  normalizeCounterpartyForExactComparison,
  normalizeCurrency,
  normalizeDate,
  normalizeOptionalDate,
  normalizeReference,
  parseMoneyToPaise,
} from "./src/normalization/index.js";

export {
  areCurrenciesCompatible,
  areDirectionsCompatible,
  bankRecordExists,
  bankRecordIsUnused,
  checkPairCompatibility,
  createRecordLookup,
  emptyUsedRecordState,
  ledgerRecordExists,
  ledgerRecordIsUnused,
} from "./src/compatibility/index.js";

export { generateCandidates, MAX_CANDIDATES_PER_PRIMARY, computePairFacts, selectCandidateSignals, selectCandidateTier } from "./src/candidates/index.js";
export type {
  CandidateFacts,
  CandidatePrimary,
  CandidateRecord,
  CandidateSelectionTier,
  CandidateSet,
  CandidateSignal,
  GenerateCandidatesInput,
} from "./src/candidates/index.js";

export {
  applyExactReferenceRule,
  applyNormalizedReferenceRule,
  applyOneToManyGroupedRule,
  applyManyToOneGroupedRule,
  applyStrongContextRule,
  differenceInCalendarDays,
} from "./src/matching/index.js";
export type {
  ExactReferenceRuleInput,
  ExactReferenceRuleResult,
  NormalizedReferenceRuleInput,
  NormalizedReferenceRuleResult,
  StrongContextRuleInput,
  StrongContextRuleResult,
  OneToManyGroupedRuleInput,
  OneToManyGroupedRuleResult,
  ManyToOneGroupedRuleInput,
  ManyToOneGroupedRuleResult,
} from "./src/matching/index.js";

export { runDeterministicReconciliation } from "./src/deterministic/index.js";
export type {
  AutoReconciledDecision,
  DeterministicObserver,
  DeterministicDecision,
  DeterministicReason,
  DeterministicReconciliationInput,
  DeterministicReconciliationResult,
  DeterministicRuleEvent,
  DeterministicRuleEventType,
  DeterministicRuleId,
  NeedsReasoningDecision,
} from "./src/deterministic/index.js";

export type {
  CompatibilityFailureCode,
  CompatibilityResult,
  PairCompatibilityInput,
  RecordLookup,
  UsedRecordState,
} from "./src/compatibility/index.js";

export {
  AgentProposalSchema,
  buildReconciliationReasoningInput,
  DEFAULT_GROQ_REASONING_MODEL,
  DEFAULT_GROQ_QUOTA_SCOPE,
  DEFAULT_GROQ_RATE_LIMIT,
  GroqRateLimiter,
  InMemoryGroqQuotaStateStore,
  GroqReasoningAdapter,
  RECONCILIATION_AGENT_INSTRUCTIONS,
  ReasoningAdapterError,
} from "./src/agent/index.js";
export { ReconciliationRunAbortedError } from "./src/pipeline/types.js";
export type {
  GroqReasoningAdapterOptions,
  GroqQuotaDimension,
  GroqQuotaState,
  GroqQuotaStateStore,
  GroqRateLimit,
  GroqReservation,
  ReasoningAdapterErrorCode,
  ReasoningAdapterDiagnostics,
  ReasoningModelAdapter,
  ReasoningModelInput,
} from "./src/agent/index.js";
export type { ReconciliationRunAbortCode } from "./src/pipeline/types.js";
export type { BuildReasoningPromptInput, ReasoningPrimary } from "./src/agent/index.js";

export { verifyMatchProposal, verifyNonMatchProposal } from "./src/verifier/index.js";
export type {
  MatchVerificationFailure,
  MatchVerificationFailureCode,
  MatchVerificationResult,
  VerifyMatchProposalInput,
  NonMatchOutcome,
  NonMatchReasonCode,
  NonMatchVerificationResult,
  VerifyNonMatchProposalInput,
} from "./src/verifier/index.js";

export { createTraceRecorder } from "./src/trace/index.js";
export type {
  RecordedTraceEvent,
  CaseScopedTraceEventType,
  RunScopedTraceEventType,
  TraceEventPayload,
  TraceRecordInput,
  TraceRecorder,
  TraceRecorderOptions,
} from "./src/trace/index.js";

export { DEFAULT_REASONING_CONCURRENCY, ReconciliationOperationalError, planReconciliation, processPlannedBatch, processPlannedComponent, runReconciliation } from "./src/pipeline/index.js";
export { partitionReasoningComponents } from "./src/pipeline/job-planner.js";
export type {
  FinalReconciliationResult,
  PlannedReasoningComponent,
  ReconciliationPlan,
  ReconciliationOperationalErrorCode,
  ReconciliationRunResult,
  RunReconciliationInput,
} from "./src/pipeline/index.js";
export type { ReasoningComponent } from "./src/pipeline/job-planner.js";

export type {
  CsvSource,
  CsvValidationIssue,
  ParsedBankTransaction,
  ParsedLedgerTransaction,
} from "./src/parsing/index.js";
