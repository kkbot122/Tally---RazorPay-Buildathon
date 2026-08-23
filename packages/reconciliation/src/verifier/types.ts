import type { AgentProposal } from "@tally/contracts";
import type { CandidatePrimary, CandidateSet } from "../candidates/index.js";
import type { RecordLookup, UsedRecordState } from "../compatibility/index.js";

export type MatchVerificationFailureCode =
  | "NOT_RECONCILED_PROPOSAL"
  | "UNKNOWN_RECORD"
  | "OUT_OF_CONTEXT_RECORD"
  | "PRIMARY_NOT_INCLUDED"
  | "DUPLICATE_RECORD_ID"
  | "INVALID_RELATIONSHIP_SHAPE"
  | "RECORD_ALREADY_USED"
  | "HARD_COMPATIBILITY_FAILED"
  | "AMOUNT_MISMATCH"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICTING_EVIDENCE"
  | "INVALID_AMOUNT";

export type MatchVerificationFailure = {
  code: MatchVerificationFailureCode;
  message: string;
  recordIds?: string[];
};

export type MatchVerificationResult =
  | {
      status: "VERIFIED";
      bankRecordIds: string[];
      ledgerRecordIds: string[];
    }
  | {
      status: "REJECTED";
      failures: MatchVerificationFailure[];
    };

export type VerifyMatchProposalInput = {
  proposal: AgentProposal;
  primary: CandidatePrimary;
  candidateSet: CandidateSet;
  records: RecordLookup;
  usedRecords: UsedRecordState;
};
