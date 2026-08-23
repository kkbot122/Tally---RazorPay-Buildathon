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
