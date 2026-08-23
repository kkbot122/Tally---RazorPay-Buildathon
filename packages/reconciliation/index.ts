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

export type {
  CsvSource,
  CsvValidationIssue,
  ParsedBankTransaction,
  ParsedLedgerTransaction,
} from "./src/parsing/index.js";
