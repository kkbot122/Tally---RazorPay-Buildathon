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

export {
  applyExactReferenceRule,
  applyNormalizedReferenceRule,
  applyOneToManyGroupedRule,
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
} from "./src/matching/index.js";

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
