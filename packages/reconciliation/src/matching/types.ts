import type { RecordLookup, UsedRecordState } from "../compatibility/index.js";

export type ExactReferenceRuleResult =
  | {
      status: "MATCH";
      bankRecordId: string;
      ledgerRecordId: string;
      reasonCode: "EXACT_MATCH";
    }
  | {
      status: "NO_MATCH";
    }
  | {
      status: "AMBIGUOUS";
      candidateLedgerRecordIds: string[];
    };

export type ExactReferenceRuleInput = {
  bankRecordId: string;
  records: RecordLookup;
  usedRecords: UsedRecordState;
};

export type NormalizedReferenceRuleResult =
  | {
      status: "MATCH";
      bankRecordId: string;
      ledgerRecordId: string;
      reasonCode: "NORMALIZED_REFERENCE_MATCH";
    }
  | {
      status: "NO_MATCH";
    }
  | {
      status: "AMBIGUOUS";
      candidateLedgerRecordIds: string[];
    };

export type NormalizedReferenceRuleInput = ExactReferenceRuleInput;

export type StrongContextRuleResult =
  | {
      status: "MATCH";
      bankRecordId: string;
      ledgerRecordId: string;
      reasonCode: "COUNTERPARTY_MATCH";
    }
  | {
      status: "NO_MATCH";
    }
  | {
      status: "AMBIGUOUS";
      candidateLedgerRecordIds: string[];
    };

export type StrongContextRuleInput = ExactReferenceRuleInput;

export type OneToManyGroupedRuleResult =
  | {
      status: "MATCH";
      bankRecordId: string;
      ledgerRecordIds: string[];
      reasonCode: "GROUPED_MATCH";
    }
  | {
      status: "NO_MATCH";
    }
  | {
      status: "AMBIGUOUS";
      candidateGroups: string[][];
    };

export type OneToManyGroupedRuleInput = ExactReferenceRuleInput;
