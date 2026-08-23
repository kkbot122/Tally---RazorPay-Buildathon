import type { RecordLookup, UsedRecordState } from "../compatibility/index.js";

export type CandidatePrimary =
  | { side: "BANK"; recordId: string }
  | { side: "LEDGER"; recordId: string };

export type CandidateSignal =
  | "RAW_REFERENCE_EQUAL"
  | "NORMALIZED_REFERENCE_EQUAL"
  | "BATCH_ID_EQUAL"
  | "EXACT_AMOUNT"
  | "COUNTERPARTY_EXACT_AFTER_NORMALIZATION"
  | "DATE_IN_RULE_WINDOW";

export type CandidateSelectionTier =
  | "EXACT_REFERENCE"
  | "NORMALIZED_REFERENCE"
  | "EXACT_BATCH"
  | "AMOUNT_AND_COUNTERPARTY"
  | "AMOUNT_AND_DATE"
  | "COUNTERPARTY_AND_DATE";

export type CandidateFacts = {
  rawReferenceEqual: boolean;
  normalizedReferenceEqual: boolean;
  exactAmount: boolean;
  amountDeltaPaise: string;
  normalizedCounterpartyEqual: boolean;
  batchIdEqual: boolean;
  dateDifferenceDays: number;
  dateInRuleWindow: boolean;
};

export type CandidateRecord = {
  side: "BANK" | "LEDGER";
  recordId: string;
  selectionTier: CandidateSelectionTier;
  signals: CandidateSignal[];
  facts: CandidateFacts;
};

export type CandidateSet = {
  primary: CandidatePrimary;
  candidates: CandidateRecord[];
  totalEligibleCandidates: number;
  truncated: boolean;
};

export type GenerateCandidatesInput = {
  primary: CandidatePrimary;
  records: RecordLookup;
  usedRecords?: UsedRecordState;
  /** Candidate IDs carried by deterministic ambiguity metadata. */
  requiredCandidateIds?: readonly string[];
};
