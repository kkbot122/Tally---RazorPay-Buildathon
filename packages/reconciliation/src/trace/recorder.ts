import type {
  AgentProposal,
  FinalOutcome,
  ReasonCode,
  TraceEventType,
  VerificationResult,
} from "@tally/contracts";

import type { CandidatePrimary } from "../candidates/index.js";
import type { DeterministicReason, DeterministicRuleId } from "../deterministic/index.js";
import type { MatchVerificationFailure, NonMatchVerificationResult } from "../verifier/index.js";

export type TraceEventPayload = {
  RUN_STARTED: {
    asOfDate?: string;
    bankRecordCount?: number;
    ledgerRecordCount?: number;
  };
  CASE_STARTED: {
    primarySide?: CandidatePrimary["side"];
    primaryRecordId?: string;
  };
  TRANSACTION_NORMALIZED: {
    side: CandidatePrimary["side"];
    recordId: string;
  };
  RULE_EVALUATED: {
    rule: DeterministicRuleId;
    anchorSide?: CandidatePrimary["side"];
    anchorRecordId: string;
  };
  RULE_PASSED: {
    rule: DeterministicRuleId;
    bankRecordIds: string[];
    ledgerRecordIds: string[];
    reasonCode: Extract<ReasonCode, "EXACT_MATCH" | "NORMALIZED_REFERENCE_MATCH" | "COUNTERPARTY_MATCH" | "GROUPED_MATCH">;
  };
  RULE_FAILED: {
    rule: DeterministicRuleId;
    reason: DeterministicReason;
    candidateIds?: string[];
  };
  AUTO_RECONCILED: {
    rule: DeterministicRuleId;
    bankRecordIds: string[];
    ledgerRecordIds: string[];
    reasonCode: Extract<ReasonCode, "EXACT_MATCH" | "NORMALIZED_REFERENCE_MATCH" | "COUNTERPARTY_MATCH" | "GROUPED_MATCH">;
  };
  CANDIDATES_GENERATED: {
    primarySide: CandidatePrimary["side"];
    primaryRecordId: string;
    candidateRecordIds: string[];
    totalEligibleCandidates: number;
    truncated: boolean;
  };
  AGENT_STARTED: {
    primarySide: CandidatePrimary["side"];
    primaryRecordId: string;
    candidateCount: number;
    model?: string;
  };
  AGENT_PROPOSED: AgentProposal;
  VERIFICATION_CHECKED: {
    result: VerificationResult | NonMatchVerificationResult;
    failures?: MatchVerificationFailure[];
    outcome?: FinalOutcome;
    reasonCode?: ReasonCode;
    amountDeltaPaise?: string;
  };
  CASE_FINALIZED: {
    outcome: FinalOutcome;
    bankRecordIds: string[];
    ledgerRecordIds: string[];
    reasonCode: ReasonCode;
  };
  RUN_COMPLETED: {
    casesProcessed?: number;
  };
};

export type RunScopedTraceEventType = "RUN_STARTED" | "RUN_COMPLETED";
export type CaseScopedTraceEventType = Exclude<TraceEventType, RunScopedTraceEventType>;

export type TraceRecordInput<T extends TraceEventType = TraceEventType> = T extends RunScopedTraceEventType
  ? {
      type: T;
      caseId?: never;
      payload: TraceEventPayload[T];
      /** Retained for compatibility with the existing trace envelope. It is never used for ordering. */
      message?: string;
    }
  : {
      type: T;
      caseId: string;
      payload: TraceEventPayload[T];
      /** Retained for compatibility with the existing trace envelope. It is never used for ordering. */
      message?: string;
    };

export type RecordedTraceEvent<T extends TraceEventType = TraceEventType> = {
  readonly eventId: string;
  readonly runId: string;
  readonly sequenceNo: number;
  readonly caseId: string | null;
  readonly type: T;
  readonly occurredAt: string;
  readonly message: string;
  readonly payload: Readonly<TraceEventPayload[T]>;
  /** Compatibility projection of payload for the pre-existing trace envelope. */
  readonly metadata: Readonly<TraceEventPayload[T]>;
};

export type TraceRecorderOptions = {
  runId: string;
  /** Required by the pre-existing envelope; it does not determine event order. */
  clock?: () => Date;
};

export interface TraceRecorder {
  record<T extends TraceEventType>(event: TraceRecordInput<T>): RecordedTraceEvent<T>;
  getEvents(): readonly RecordedTraceEvent[];
}

function cloneAndFreeze<T>(value: T): T {
  const cloned = structuredClone(value);
  return freezeDeep(cloned);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function createTraceRecorder(options: TraceRecorderOptions): TraceRecorder {
  if (options.runId.trim().length === 0) throw new Error("runId must be non-empty");

  let sequenceNo = 0;
  const events: RecordedTraceEvent[] = [];
  const clock = options.clock ?? (() => new Date());

  return {
    record<T extends TraceEventType>(input: TraceRecordInput<T>): RecordedTraceEvent<T> {
      const eventType = input.type as TraceEventType;
      const isCaseScoped = eventType !== "RUN_STARTED" && eventType !== "RUN_COMPLETED";
      if (isCaseScoped && (typeof input.caseId !== "string" || input.caseId.trim().length === 0)) {
        throw new Error(`${eventType} requires a non-empty caseId`);
      }
      if (!isCaseScoped && input.caseId !== undefined) {
        throw new Error(`${eventType} is run-scoped and cannot have a caseId`);
      }

      const payload = cloneAndFreeze(input.payload);
      sequenceNo += 1;
      const event = Object.freeze({
        eventId: `${options.runId}:${sequenceNo}`,
        runId: options.runId,
        sequenceNo,
        caseId: input.caseId ?? null,
        type: input.type,
        occurredAt: clock().toISOString(),
        message: input.message ?? input.type,
        payload,
        metadata: payload,
      }) as RecordedTraceEvent<T>;
      events.push(event as RecordedTraceEvent);
      return event;
    },
    getEvents(): readonly RecordedTraceEvent[] {
      return Object.freeze(events.slice());
    },
  };
}
