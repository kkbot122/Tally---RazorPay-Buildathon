import type { AgentProposal, FinalOutcome, ReasonCode } from "@tally/contracts";

import { buildReconciliationReasoningInput, ReasoningAdapterError, type ReasoningPrimary } from "../agent/index.js";
import type { CandidatePrimary, CandidateSet } from "../candidates/index.js";
import { generateCandidates } from "../candidates/index.js";
import { createRecordLookup, type RecordLookup, type UsedRecordState } from "../compatibility/index.js";
import { runDeterministicReconciliation, type DeterministicDecision, type DeterministicRuleId } from "../deterministic/index.js";
import { normalizeCounterpartyForExactComparison, normalizeCurrency, normalizeDate, normalizeOptionalDate, normalizeReference, parseMoneyToPaise } from "../normalization/index.js";
import { parseBankCsv, parseLedgerCsv } from "../parsing/index.js";
import { verifyMatchProposal, verifyNonMatchProposal, type MatchVerificationResult, type NonMatchVerificationResult } from "../verifier/index.js";
import { createTraceRecorder, type TraceRecorder } from "../trace/index.js";
import { ReconciliationRunAbortedError, type FinalReconciliationResult, type ReconciliationRunResult, type RunReconciliationInput } from "./types.js";

export const DEFAULT_REASONING_CONCURRENCY = 5;

type PreparedReasoningItem = {
  decision: Extract<DeterministicDecision, { status: "NEEDS_REASONING" }>;
  primary: CandidatePrimary;
  caseId: string;
  candidateSet: CandidateSet;
  promptInput: Awaited<ReturnType<typeof buildReconciliationReasoningInput>>;
  skipReciprocalAttempt: boolean;
};

type ReasoningDiagnostics = {
  callsStarted: number;
  repairCallsStarted: number;
  callBudgetSkips: number;
  reciprocalSkips: number;
  candidatesPruned: number;
  verificationRejections: number;
  verificationFailures: Record<string, number>;
};

export async function runReconciliation(input: RunReconciliationInput): Promise<ReconciliationRunResult> {
  const reasoningConcurrency = validateReasoningConcurrency(input.reasoningConcurrency);
  const maxReasoningCalls = validateMaxReasoningCalls(input.maxReasoningCalls);
  let reasoningCalls = 0;
  const reasoningDiagnostics: ReasoningDiagnostics = {
    callsStarted: 0,
    repairCallsStarted: 0,
    callBudgetSkips: 0,
    reciprocalSkips: 0,
    candidatesPruned: 0,
    verificationRejections: 0,
    verificationFailures: {},
  };
  const requestProposal: RunReconciliationInput["modelAdapter"]["generateProposal"] = (modelInput) => {
    if (reasoningCalls >= maxReasoningCalls) {
      throw new ReasoningAdapterError("AI_REQUEST_ERROR", "The reconciliation run exhausted its model-call budget.", {
        diagnostics: { category: "CALL_BUDGET" },
      });
    }
    reasoningCalls += 1;
    reasoningDiagnostics.callsStarted += 1;
    return input.modelAdapter.generateProposal(modelInput);
  };
  // T022 retains an envelope timestamp for compatibility, but T023 ordering is
  // sequenceNo. Tests may inject a clock when they need reproducible snapshots.
  const trace = createTraceRecorder({ runId: input.runId, clock: input.clock });
  const records = createRecordLookup(parseBankCsv(input.bankCsv), parseLedgerCsv(input.ledgerCsv));
  trace.record({
    type: "RUN_STARTED",
    payload: {
      asOfDate: input.asOfDate,
      bankRecordCount: records.bankRecords.size,
      ledgerRecordCount: records.ledgerRecords.size,
    },
  });

  normalizeRecords(records, trace);

  const results: FinalReconciliationResult[] = [];
  const finalizedPrimaries = new Set<string>();
  const startedCases = new Set<string>();
  const startCase = (side: "BANK" | "LEDGER", recordId: string): string => {
    const id = caseId(side, recordId);
    if (!startedCases.has(id)) {
      startedCases.add(id);
      trace.record({ type: "CASE_STARTED", caseId: id, payload: { primarySide: side, primaryRecordId: recordId } });
    }
    return id;
  };
  const deterministic = runDeterministicReconciliation({
    records,
    usedRecords: cloneUsedRecords(input.usedRecords),
    observer: {
      onRuleEvaluated: ({ rule, anchorSide, anchorId }) => {
        const currentCaseId = startCase(anchorSide, anchorId);
        trace.record({ type: "RULE_EVALUATED", caseId: currentCaseId, payload: { rule, anchorSide, anchorRecordId: anchorId } });
      },
      onRuleResult: (event) => {
        if (event.type === "RULE_PASSED") {
          trace.record({
            type: "RULE_PASSED",
            caseId: caseId(event.anchorSide, event.anchorId),
            payload: {
              rule: event.rule,
              bankRecordIds: event.bankRecordIds,
              ledgerRecordIds: event.ledgerRecordIds,
              reasonCode: event.reasonCode,
            },
          });
        } else {
          trace.record({
            type: "RULE_FAILED",
            caseId: caseId(event.anchorSide, event.anchorId),
            payload: { rule: event.rule, reason: event.reason, candidateIds: event.candidateIds },
          });
        }
      },
      onDecisionCommitted: (event) => {
        const committedCaseId = caseId(event.anchorSide, event.anchorId);
        trace.record({
          type: "AUTO_RECONCILED",
          caseId: committedCaseId,
          payload: {
            rule: event.rule,
            bankRecordIds: event.bankRecordIds,
            ledgerRecordIds: event.ledgerRecordIds,
            reasonCode: event.reasonCode,
          },
        });
        trace.record({
          type: "CASE_FINALIZED",
          caseId: committedCaseId,
          payload: {
            outcome: "RECONCILED",
            bankRecordIds: event.bankRecordIds,
            ledgerRecordIds: event.ledgerRecordIds,
            reasonCode: event.reasonCode,
          },
        });
        results.push({
          caseId: committedCaseId,
          outcome: "RECONCILED",
          bankRecordIds: event.bankRecordIds,
          ledgerRecordIds: event.ledgerRecordIds,
          reasonCode: event.reasonCode,
          source: "DETERMINISTIC",
          rule: event.rule,
          finalizationOrder: results.length + 1,
        });
        finalizedPrimaries.add(primaryKey(event.anchorSide, event.anchorId));
      },
    },
  });

  const reasoningDecisions = deterministic.decisions
    .filter((decision): decision is Extract<DeterministicDecision, { status: "NEEDS_REASONING" }> => decision.status === "NEEDS_REASONING")
    .sort(compareReasoningDecisions);
  const usedRecords = cloneUsedRecords(deterministic.usedRecords);
  const attemptedSingletonPairs = new Set<string>();

  for (let waveStart = 0; waveStart < reasoningDecisions.length; waveStart += reasoningConcurrency) {
    throwIfAborted(input.signal);
    const waveDecisions = reasoningDecisions.slice(waveStart, waveStart + reasoningConcurrency);
    const waveSnapshot = cloneUsedRecords(usedRecords);
    const preparedItems: PreparedReasoningItem[] = [];

    for (const decision of waveDecisions) {
      const primary = primaryForDecision(decision);
      const primaryKeyValue = primaryKey(primary.side, primary.recordId);
      if (finalizedPrimaries.has(primaryKeyValue) || isUsed(primary, waveSnapshot)) continue;

      const currentCaseId = startCase(primary.side, primary.recordId);
      const generatedCandidateSet = generateCandidates({
        primary,
        records,
        usedRecords: waveSnapshot,
        requiredCandidateIds: decision.bankRecordIds.concat(decision.ledgerRecordIds),
      });
      const { candidateSet, prunedCount } = pruneCandidatesForReasoning(generatedCandidateSet);
      reasoningDiagnostics.candidatesPruned += prunedCount;
      const singletonPair = singletonPairKey(primary, candidateSet);
      const skipReciprocalAttempt = singletonPair !== undefined && attemptedSingletonPairs.has(singletonPair);
      if (singletonPair !== undefined && !skipReciprocalAttempt) attemptedSingletonPairs.add(singletonPair);
      trace.record({
        type: "CANDIDATES_GENERATED",
        caseId: currentCaseId,
        payload: {
          primarySide: primary.side,
          primaryRecordId: primary.recordId,
          candidateRecordIds: candidateSet.candidates.map((candidate) => candidate.recordId),
          totalEligibleCandidates: candidateSet.totalEligibleCandidates,
          truncated: candidateSet.truncated,
        },
      });
      preparedItems.push({
        decision,
        primary,
        caseId: currentCaseId,
        candidateSet,
        promptInput: buildReconciliationReasoningInput({
          primary: reasoningPrimary(records, primary),
          candidateSet,
          records,
          runContext: { asOfDate: input.asOfDate },
        }),
        skipReciprocalAttempt,
      });
    }

    const settlements = await Promise.allSettled(preparedItems.map(async (item) => {
      if (item.skipReciprocalAttempt) {
        reasoningDiagnostics.reciprocalSkips += 1;
        const fallback = reciprocalAttemptProposal(item.primary);
        trace.record({ type: "AGENT_PROPOSED", caseId: item.caseId, payload: fallback });
        return fallback;
      }
      trace.record({
        type: "AGENT_STARTED",
        caseId: item.caseId,
        payload: {
          primarySide: item.primary.side,
          primaryRecordId: item.primary.recordId,
          candidateCount: item.candidateSet.candidates.length,
        },
      });
      try {
        return await generateProposalWithVerifierRetry(item, requestProposal, records, input.asOfDate, waveSnapshot, trace, input.signal, () => {
          reasoningDiagnostics.repairCallsStarted += 1;
        });
      } catch (error) {
        if (input.signal?.aborted) throw new ReconciliationRunAbortedError(abortReason(input.signal));
        if (!(error instanceof ReasoningAdapterError) || (error.code !== "AI_SCHEMA_ERROR" && error.code !== "AI_REQUEST_ERROR")) throw error;
        input.onModelFailure?.({ runId: input.runId, caseId: item.caseId, failureCode: error.code, diagnostics: error.diagnostics });
        // A request failure means there was no model decision at all. Do not
        // disguise it as an agent-produced abstention: callers must be able to
        // distinguish unavailable inference from a genuine model conclusion.
        if (error.code === "AI_REQUEST_ERROR" && error.diagnostics?.category !== "CALL_BUDGET") throw error;
        if (error.diagnostics?.category === "CALL_BUDGET") reasoningDiagnostics.callBudgetSkips += 1;
        const fallback = insufficientEvidenceProposal(item.primary, error.code);
        trace.record({ type: "AGENT_PROPOSED", caseId: item.caseId, payload: fallback });
        return fallback;
      }
    }));

    for (let itemIndex = 0; itemIndex < preparedItems.length; itemIndex += 1) {
      const item = preparedItems[itemIndex]!;
      const settlement = settlements[itemIndex]!;
      if (settlement.status === "rejected") {
        attachTrace(settlement.reason, trace);
        throw settlement.reason;
      }
      finalizeAgentProposal(item, settlement.value, records, input.runId, input.asOfDate, usedRecords, finalizedPrimaries, results, trace, input.onVerificationFailure, reasoningDiagnostics);
    }
  }

  trace.record({ type: "RUN_COMPLETED", payload: { casesProcessed: results.length, reasoning: reasoningDiagnostics } });
  return { runId: input.runId, results, usedRecords, trace: trace.getEvents() };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ReconciliationRunAbortedError(abortReason(signal));
}

function abortReason(signal: AbortSignal): "RUN_CANCELLED" | "RUN_DEADLINE_EXCEEDED" {
  return signal.reason === "RUN_CANCELLED" ? "RUN_CANCELLED" : "RUN_DEADLINE_EXCEEDED";
}

function validateReasoningConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_REASONING_CONCURRENCY;
  if (!Number.isFinite(concurrency) || !Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("reasoningConcurrency must be a finite positive integer");
  }
  return concurrency;
}

function validateMaxReasoningCalls(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) throw new Error("maxReasoningCalls must be a finite positive integer");
  return limit;
}

function finalizeAgentProposal(
  item: PreparedReasoningItem,
  proposal: AgentProposal,
  records: RecordLookup,
  runId: string,
  asOfDate: string,
  usedRecords: { bankRecordIds: Set<string>; ledgerRecordIds: Set<string> },
  finalizedPrimaries: Set<string>,
  results: FinalReconciliationResult[],
  trace: TraceRecorder,
  onVerificationFailure?: RunReconciliationInput["onVerificationFailure"],
  reasoningDiagnostics?: ReasoningDiagnostics,
): void {
  const verification = verifyAgentProposal(item, proposal, records, asOfDate, usedRecords);
  if (verification.status === "REJECTED") {
    if (reasoningDiagnostics !== undefined) {
      reasoningDiagnostics.verificationRejections += 1;
      for (const failure of verification.failures) {
        reasoningDiagnostics.verificationFailures[failure.code] = (reasoningDiagnostics.verificationFailures[failure.code] ?? 0) + 1;
      }
    }
    onVerificationFailure?.({
      runId,
      caseId: item.caseId,
      proposedBankRecordIds: [...proposal.bankRecordIds],
      proposedLedgerRecordIds: [...proposal.ledgerRecordIds],
      failureCodes: verification.failures.map((failure) => failure.code),
    });
  }
  trace.record({ type: "VERIFICATION_CHECKED", caseId: item.caseId, payload: verificationPayload(verification) });

  const result = finalizeAgentResult(item.caseId, item.primary, proposal, verification);
  result.finalizationOrder = results.length + 1;
  trace.record({
    type: "CASE_FINALIZED",
    caseId: item.caseId,
    payload: {
      outcome: result.outcome,
      bankRecordIds: result.bankRecordIds,
      ledgerRecordIds: result.ledgerRecordIds,
      reasonCode: result.reasonCode,
    },
  });
  results.push(result);
  consumeFinalResult(result, item.primary, usedRecords, finalizedPrimaries);
}

function isRepairableModelFailure(code: string): boolean {
  return new Set([
    "NOT_RECONCILED_PROPOSAL",
    "UNKNOWN_RECORD",
    "OUT_OF_CONTEXT_RECORD",
    "PRIMARY_NOT_INCLUDED",
    "DUPLICATE_RECORD_ID",
    "INVALID_RELATIONSHIP_SHAPE",
    "CONFLICTING_EVIDENCE",
    "AMOUNT_MISMATCH",
    "INSUFFICIENT_EVIDENCE",
  ]).has(code);
}

async function generateProposalWithVerifierRetry(
  item: PreparedReasoningItem,
  requestProposal: RunReconciliationInput["modelAdapter"]["generateProposal"],
  records: RecordLookup,
  asOfDate: string,
  usedRecords: UsedRecordState,
  trace: TraceRecorder,
  signal?: AbortSignal,
  onRepair?: () => void,
): Promise<AgentProposal> {
  let proposal = await requestProposal({ ...item.promptInput, signal });
  trace.record({ type: "AGENT_PROPOSED", caseId: item.caseId, payload: proposal });

  for (let attempt = 0; attempt < 1; attempt += 1) {
    const verification = verifyAgentProposal(item, proposal, records, asOfDate, usedRecords);
    if (verification.status !== "REJECTED" || !verification.failures.some((failure) => isRepairableModelFailure(failure.code))) return proposal;
    const feedback = verification.failures.map((failure) => ({
      code: failure.code,
      message: failure.message,
      recordIds: failure.recordIds ?? [],
    }));
    onRepair?.();
    proposal = await requestProposal({
      ...item.promptInput,
      retryFeedback: JSON.stringify({ caseId: item.caseId, proposedBankRecordIds: proposal.bankRecordIds, proposedLedgerRecordIds: proposal.ledgerRecordIds, verifierFailures: feedback }),
      signal,
    });
    trace.record({ type: "AGENT_PROPOSED", caseId: item.caseId, payload: proposal });
  }
  return proposal;
}

function pruneCandidatesForReasoning(candidateSet: CandidateSet): { candidateSet: CandidateSet; prunedCount: number } {
  if (!candidateSet.candidates.some((candidate) => candidate.facts.exactAmount)) return { candidateSet, prunedCount: 0 };
  // Preserve batch candidates because an individual amount mismatch can still
  // participate in a verified grouped relationship. Other mismatches are
  // dominated when an exact-amount alternative is already available.
  const candidates = candidateSet.candidates.filter((candidate) => candidate.facts.exactAmount || candidate.selectionTier === "EXACT_BATCH");
  const prunedCount = candidateSet.candidates.length - candidates.length;
  if (prunedCount === 0) return { candidateSet, prunedCount };
  return { candidateSet: { ...candidateSet, candidates, truncated: true }, prunedCount };
}

function singletonPairKey(primary: CandidatePrimary, candidateSet: CandidateSet): string | undefined {
  if (candidateSet.candidates.length !== 1) return undefined;
  const candidate = candidateSet.candidates[0]!;
  const bankRecordId = primary.side === "BANK" ? primary.recordId : candidate.recordId;
  const ledgerRecordId = primary.side === "LEDGER" ? primary.recordId : candidate.recordId;
  return `${bankRecordId}\u0000${ledgerRecordId}`;
}

function verifyAgentProposal(
  item: PreparedReasoningItem,
  proposal: AgentProposal,
  records: RecordLookup,
  asOfDate: string,
  usedRecords: UsedRecordState,
): MatchVerificationResult | NonMatchVerificationResult {
  return proposal.proposedOutcome === "MATCH"
    ? verifyMatchProposal({ proposal, primary: item.primary, candidateSet: item.candidateSet, records, usedRecords })
    : verifyNonMatchProposal({
        proposal,
        primary: item.primary,
        candidateSet: item.candidateSet,
        records,
        usedRecords,
        runContext: { asOfDate },
        reasoningContext: { deterministicReason: item.decision.reason === "MULTIPLE_CANDIDATES" || item.decision.reason === "GROUPING_AMBIGUITY" ? item.decision.reason : undefined },
      });
}

function attachTrace(error: unknown, trace: TraceRecorder): void {
  if (error !== null && typeof error === "object") {
    Object.defineProperty(error, "reconciliationTrace", {
      configurable: true,
      enumerable: false,
      value: trace.getEvents(),
    });
  }
}

function insufficientEvidenceProposal(primary: CandidatePrimary, failureCode = "AI_SCHEMA_ERROR"): AgentProposal {
  const bankRecordIds = primary.side === "BANK" ? [primary.recordId] : [];
  const ledgerRecordIds = primary.side === "LEDGER" ? [primary.recordId] : [];
  return {
    proposedOutcome: "INSUFFICIENT_EVIDENCE",
    bankRecordIds,
    ledgerRecordIds,
    confidence: "LOW",
    evidence: [{
      statement: `The model response failed with ${failureCode}; no finance relationship was accepted.`,
      source: "DETERMINISTIC",
      kind: "DETERMINISTIC",
      recordIds: [...bankRecordIds, ...ledgerRecordIds],
    }],
    conflictingEvidence: [],
    reason: `The model response failed with ${failureCode}, so this case remains unresolved.`,
  };
}

function reciprocalAttemptProposal(primary: CandidatePrimary): AgentProposal {
  const bankRecordIds = primary.side === "BANK" ? [primary.recordId] : [];
  const ledgerRecordIds = primary.side === "LEDGER" ? [primary.recordId] : [];
  return {
    proposedOutcome: "INSUFFICIENT_EVIDENCE",
    bankRecordIds,
    ledgerRecordIds,
    confidence: "LOW",
    evidence: [{
      statement: "The same one-to-one relationship was already evaluated from its reciprocal record.",
      source: "DETERMINISTIC",
      kind: "DETERMINISTIC",
      recordIds: [...bankRecordIds, ...ledgerRecordIds],
    }],
    conflictingEvidence: [],
    reason: "The reciprocal candidate relationship was already evaluated, so this duplicate model request was skipped.",
  };
}

function normalizeRecords(records: RecordLookup, trace: TraceRecorder): void {
  for (const recordId of [...records.bankRecords.keys()].sort()) {
    const record = records.bankRecords.get(recordId)!;
    normalizeDate(record.bookingDate);
    normalizeDate(record.valueDate);
    normalizeCurrency(record.currency);
    normalizeReference(record.reference);
    normalizeCounterpartyForExactComparison(record.counterparty);
    parseMoneyToPaise(record.amount);
    trace.record({ type: "TRANSACTION_NORMALIZED", caseId: caseId("BANK", recordId), payload: { side: "BANK", recordId } });
  }
  for (const recordId of [...records.ledgerRecords.keys()].sort()) {
    const record = records.ledgerRecords.get(recordId)!;
    normalizeDate(record.accountingDate);
    normalizeOptionalDate(record.maturityDate);
    normalizeCurrency(record.currency);
    normalizeReference(record.reference);
    normalizeCounterpartyForExactComparison(record.counterparty);
    parseMoneyToPaise(record.amount);
    trace.record({ type: "TRANSACTION_NORMALIZED", caseId: caseId("LEDGER", recordId), payload: { side: "LEDGER", recordId } });
  }
}

function cloneUsedRecords(usedRecords?: UsedRecordState): { bankRecordIds: Set<string>; ledgerRecordIds: Set<string> } {
  return {
    bankRecordIds: new Set(usedRecords?.bankRecordIds),
    ledgerRecordIds: new Set(usedRecords?.ledgerRecordIds),
  };
}

function caseId(side: "BANK" | "LEDGER", recordId: string): string {
  return `${side}:${recordId}`;
}

function primaryKey(side: "BANK" | "LEDGER", recordId: string): string {
  return `${side}:${recordId}`;
}

function primaryForDecision(decision: Extract<DeterministicDecision, { status: "NEEDS_REASONING" }>): CandidatePrimary {
  if (decision.sourceRule === "R5_MANY_TO_ONE_GROUPED" && decision.ledgerRecordIds.length > 0) return { side: "LEDGER", recordId: decision.ledgerRecordIds[0]! };
  if (decision.bankRecordIds.length > 0) return { side: "BANK", recordId: decision.bankRecordIds[0]! };
  return { side: "LEDGER", recordId: decision.ledgerRecordIds[0]! };
}

function compareReasoningDecisions(
  left: Extract<DeterministicDecision, { status: "NEEDS_REASONING" }>,
  right: Extract<DeterministicDecision, { status: "NEEDS_REASONING" }>,
): number {
  const leftPrimary = primaryForDecision(left);
  const rightPrimary = primaryForDecision(right);
  const sideDifference = (leftPrimary.side === "BANK" ? 0 : 1) - (rightPrimary.side === "BANK" ? 0 : 1);
  if (sideDifference !== 0) return sideDifference;
  const idDifference = leftPrimary.recordId.localeCompare(rightPrimary.recordId);
  if (idDifference !== 0) return idDifference;
  return `${left.bankRecordIds.join(",")}|${left.ledgerRecordIds.join(",")}`.localeCompare(`${right.bankRecordIds.join(",")}|${right.ledgerRecordIds.join(",")}`);
}

function isUsed(primary: CandidatePrimary, usedRecords: UsedRecordState): boolean {
  return primary.side === "BANK" ? usedRecords.bankRecordIds.has(primary.recordId) : usedRecords.ledgerRecordIds.has(primary.recordId);
}

function reasoningPrimary(records: RecordLookup, primary: CandidatePrimary): ReasoningPrimary {
  if (primary.side === "BANK") {
    const record = records.bankRecords.get(primary.recordId);
    if (record === undefined) throw new Error(`Primary bank record ${primary.recordId} was not found`);
    return { side: "BANK", record };
  }
  const record = records.ledgerRecords.get(primary.recordId);
  if (record === undefined) throw new Error(`Primary ledger record ${primary.recordId} was not found`);
  return { side: "LEDGER", record };
}

function verificationPayload(verification: MatchVerificationResult | NonMatchVerificationResult) {
  if (verification.status === "VERIFIED") {
    return {
      result: verification,
      ...("outcome" in verification ? { outcome: verification.outcome, reasonCode: verification.reasonCode, amountDeltaPaise: verification.amountDeltaPaise } : {}),
    };
  }
  return { result: verification, failures: verification.failures };
}

function finalizeAgentResult(
  caseIdValue: string,
  primary: CandidatePrimary,
  proposal: AgentProposal,
  verification: MatchVerificationResult | NonMatchVerificationResult,
): FinalReconciliationResult {
  if (proposal.proposedOutcome === "MATCH") {
    if (verification.status === "VERIFIED") {
      return {
        caseId: caseIdValue,
        outcome: "RECONCILED",
        bankRecordIds: verification.bankRecordIds,
        ledgerRecordIds: verification.ledgerRecordIds,
        reasonCode: "MULTI_EVIDENCE_MATCH",
        source: "AGENT_VERIFIED",
        confidence: proposal.confidence,
        evidence: proposal.evidence,
        conflictingEvidence: proposal.conflictingEvidence,
        reason: proposal.reason,
      };
    }
    return rejectedAgentResult(caseIdValue, primary, proposal);
  }

  if (verification.status === "VERIFIED" && "outcome" in verification) {
    return {
      caseId: caseIdValue,
      outcome: verification.outcome,
      bankRecordIds: verification.bankRecordIds,
      ledgerRecordIds: verification.ledgerRecordIds,
      reasonCode: verification.reasonCode,
      source: "AGENT_VERIFIED",
      confidence: proposal.confidence,
      evidence: proposal.evidence,
      conflictingEvidence: proposal.conflictingEvidence,
      reason: proposal.reason,
      ...(verification.amountDeltaPaise === undefined ? {} : { amountDeltaPaise: verification.amountDeltaPaise }),
    };
  }
  return rejectedAgentResult(caseIdValue, primary, proposal);
}

function rejectedAgentResult(caseIdValue: string, primary: CandidatePrimary, proposal: AgentProposal): FinalReconciliationResult {
  return {
    caseId: caseIdValue,
    outcome: "UNRESOLVED",
    bankRecordIds: primary.side === "BANK" ? [primary.recordId] : [],
    ledgerRecordIds: primary.side === "LEDGER" ? [primary.recordId] : [],
    reasonCode: "VERIFICATION_FAILED",
    source: "AGENT_VERIFIED",
    confidence: proposal.confidence,
    evidence: proposal.evidence,
    conflictingEvidence: proposal.conflictingEvidence,
    reason: proposal.reason,
  };
}

function consumeFinalResult(
  result: FinalReconciliationResult,
  primary: CandidatePrimary,
  usedRecords: { bankRecordIds: Set<string>; ledgerRecordIds: Set<string> },
  finalizedPrimaries: Set<string>,
): void {
  if (result.outcome === "RECONCILED" || result.outcome === "DISCREPANCY") {
    result.bankRecordIds.forEach((id) => usedRecords.bankRecordIds.add(id));
    result.ledgerRecordIds.forEach((id) => usedRecords.ledgerRecordIds.add(id));
  } else if (result.outcome === "EXPLAINED_OUTSTANDING") {
    addPrimary(primary, usedRecords);
  }
  finalizedPrimaries.add(primaryKey(primary.side, primary.recordId));
}

function addPrimary(primary: CandidatePrimary, usedRecords: { bankRecordIds: Set<string>; ledgerRecordIds: Set<string> }): void {
  if (primary.side === "BANK") usedRecords.bankRecordIds.add(primary.recordId);
  else usedRecords.ledgerRecordIds.add(primary.recordId);
}
