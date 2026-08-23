import type { AgentProposal, ReasonCode } from "@tally/contracts";
import type { CandidatePrimary, CandidateSet } from "../candidates/index.js";
import type { RecordLookup, UsedRecordState } from "../compatibility/index.js";
import type { MatchVerificationFailure } from "./types.js";

export type NonMatchOutcome = "EXPLAINED_OUTSTANDING" | "DISCREPANCY" | "UNRESOLVED";
export type NonMatchReasonCode = Extract<ReasonCode,
  | "TIMING_DIFFERENCE"
  | "AMOUNT_DISCREPANCY"
  | "CONFLICTING_RECORDS"
  | "DUPLICATE_USAGE"
  | "NO_CANDIDATE"
  | "MULTIPLE_PLAUSIBLE_CANDIDATES"
  | "INSUFFICIENT_EVIDENCE"
  | "VERIFICATION_FAILED"
>;

export type NonMatchVerificationResult =
  | {
      status: "VERIFIED";
      outcome: NonMatchOutcome;
      reasonCode: NonMatchReasonCode;
      bankRecordIds: string[];
      ledgerRecordIds: string[];
      amountDeltaPaise?: string;
    }
  | {
      status: "REJECTED";
      failures: MatchVerificationFailure[];
    };

export type VerifyNonMatchProposalInput = {
  proposal: AgentProposal;
  primary: CandidatePrimary;
  candidateSet: CandidateSet;
  records: RecordLookup;
  usedRecords: UsedRecordState;
  runContext: { asOfDate: string };
  reasoningContext?: {
    deterministicReason?: "MULTIPLE_CANDIDATES" | "GROUPING_AMBIGUITY";
  };
};
