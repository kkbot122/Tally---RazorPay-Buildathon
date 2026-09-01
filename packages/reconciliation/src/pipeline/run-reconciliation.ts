import type { AgentProposal, FinalOutcome, ReasonCode } from "@tally/contracts";

import { buildReconciliationReasoningInput, ReasoningAdapterError, type ReasoningPrimary } from "../agent/index.js";
import type { CandidatePrimary, CandidateSet } from "../candidates/index.js";
import { generateCandidates } from "../candidates/index.js";
import { createRecordLookup, emptyUsedRecordState, type RecordLookup, type UsedRecordState } from "../compatibility/index.js";
import { runDeterministicReconciliation, type DeterministicDecision, type DeterministicRuleId } from "../deterministic/index.js";
import { normalizeCounterpartyForExactComparison, normalizeCurrency, normalizeDate, normalizeOptionalDate, normalizeReference, parseMoneyToPaise } from "../normalization/index.js";
import { parseBankCsv, parseLedgerCsv } from "../parsing/index.js";
import { verifyMatchProposal, verifyNonMatchProposal, type MatchVerificationResult, type NonMatchVerificationResult } from "../verifier/index.js";
import { createTraceRecorder, type RecordedTraceEvent, type TraceRecorder } from "../trace/index.js";
import { ReconciliationRunAbortedError, type FinalReconciliationResult, type ReconciliationPlan, type ReconciliationRunResult, type RunReconciliationInput, type PlannedReasoningComponent } from "./types.js";

export const DEFAULT_REASONING_CONCURRENCY = 5;

type PreparedReasoningItem = {
  decision: Extract<DeterministicDecision, { status: "NEEDS_REASONING" }>;
  primary: CandidatePrimary;
  caseId: string;
  candidateSet: CandidateSet;
  promptInput: Awaited<ReturnType<typeof buildReconciliationReasoningInput>>;
  coverComponentOnUnresolved?: boolean;
  unresolvedBankRecordIds: string[];
  unresolvedLedgerRecordIds: string[];
};

type SelectedReasoningDecision = {
  decision: Extract<DeterministicDecision, { status: "NEEDS_REASONING" }>;
  unresolvedBankRecordIds: string[];
  unresolvedLedgerRecordIds: string[];
};

type ReasoningDiagnostics = {
  callsStarted: number;
  repairCallsStarted: number;
  callBudgetSkips: number;
  candidatesPruned: number;
  verificationRejections: number;
  verificationFailures: Record<string, number>;
};

export async function runReconciliation(input: RunReconciliationInput): Promise<ReconciliationRunResult> {
  const executionStartedAt = Date.now();
  const reasoningConcurrency = validateReasoningConcurrency(input.reasoningConcurrency);
  const maxReasoningCalls = validateMaxReasoningCalls(input.maxReasoningCalls);
  let reasoningCalls = 0;
  const reasoningDiagnostics: ReasoningDiagnostics = {
    callsStarted: 0,
    repairCallsStarted: 0,
    callBudgetSkips: 0,
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
            source: "DETERMINISTIC",
            aiEscalated: false,
            reason: `Resolved by deterministic rule ${event.rule}.`,
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
  const pendingReasoningDecisions: typeof reasoningDecisions = [];
  for (const decision of reasoningDecisions) {
    const primary = primaryForDecision(decision);
    const result = mechanicalExceptionResult(records, primary, usedRecords, input.asOfDate, caseId(primary.side, primary.recordId), results.length + 1);
    if (result === undefined) {
      pendingReasoningDecisions.push(decision);
      continue;
    }
    startCase(primary.side, primary.recordId);
    trace.record({ type: "CASE_FINALIZED", caseId: result.caseId, payload: { ...result, aiEscalated: false } });
    results.push(result);
    consumeFinalResult(result, primary, usedRecords, finalizedPrimaries);
  }
  const selectedReasoningDecisions = selectConnectedReasoningDecisions(pendingReasoningDecisions, records, usedRecords);
  for (let waveStart = 0; waveStart < selectedReasoningDecisions.length; waveStart += reasoningConcurrency) {
    throwIfAborted(input.signal);
    const waveDecisions = selectedReasoningDecisions.slice(waveStart, waveStart + reasoningConcurrency);
    const waveSnapshot = cloneUsedRecords(usedRecords);
    const preparedItems: PreparedReasoningItem[] = [];

    for (const selection of waveDecisions) {
      const decision = selection.decision;
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
      trace.record({
        type: "CANDIDATES_GENERATED",
        caseId: currentCaseId,
        payload: {
          primarySide: primary.side,
          primaryRecordId: primary.recordId,
          candidateRecordIds: candidateSet.candidates.map((candidate) => candidate.recordId),
          candidates: traceCandidates(candidateSet),
          totalEligibleCandidates: candidateSet.totalEligibleCandidates,
          truncated: candidateSet.truncated,
        },
      });
      if (!shouldEscalateToAI(candidateSet)) {
        finalizeNoCandidate({ primary, caseId: currentCaseId }, results, finalizedPrimaries, trace);
        continue;
      }
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
        coverComponentOnUnresolved: true,
        unresolvedBankRecordIds: selection.unresolvedBankRecordIds,
        unresolvedLedgerRecordIds: selection.unresolvedLedgerRecordIds,
      });
    }

    const settlements = await Promise.allSettled(preparedItems.map(async (item) => {
      trace.record({
        type: "AGENT_STARTED",
        caseId: item.caseId,
        payload: {
          primarySide: item.primary.side,
          primaryRecordId: item.primary.recordId,
          candidateCount: item.candidateSet.candidates.length,
          escalationReason: item.decision.reason,
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

  const verificationEvents = trace.getEvents().filter((event) => event.type === "VERIFICATION_CHECKED");
  const metrics = {
    totalSourceRecords: records.bankRecords.size + records.ledgerRecords.size,
    logicalCases: results.length,
    deterministicallyResolved: results.filter((result) => result.source === "DETERMINISTIC" && result.outcome === "RECONCILED").length,
    deterministicExceptions: results.filter((result) => result.source === "DETERMINISTIC" && result.outcome !== "RECONCILED").length,
    aiEscalations: trace.getEvents().filter((event) => event.type === "AGENT_STARTED").length,
    aiEscalationRate: results.length === 0 ? 0 : trace.getEvents().filter((event) => event.type === "AGENT_STARTED").length / results.length,
    initialAiCalls: reasoningDiagnostics.callsStarted - reasoningDiagnostics.repairCallsStarted,
    aiRepairCalls: reasoningDiagnostics.repairCallsStarted,
    aiProposalsAccepted: verificationEvents.filter((event) => (event.payload as { result?: { status?: string } }).result?.status === "VERIFIED").length,
    aiProposalsRejected: verificationEvents.filter((event) => (event.payload as { result?: { status?: string } }).result?.status === "REJECTED").length,
    aiAbstentions: results.filter((result) => result.source === "AGENT_VERIFIED" && result.outcome === "UNRESOLVED").length,
    totalModelCalls: reasoningDiagnostics.callsStarted,
    durationMs: input.clock === undefined ? Date.now() - executionStartedAt : 0,
  };
  trace.record({ type: "RUN_COMPLETED", payload: { casesProcessed: results.length, reasoning: reasoningDiagnostics, metrics } });
  return { runId: input.runId, results, usedRecords, trace: trace.getEvents() };
}

export function shouldEscalateToAI(candidateSet: CandidateSet): boolean {
  return candidateSet.candidates.length > 0;
}

function finalizeNoCandidate(
  item: { primary: CandidatePrimary; caseId: string },
  results: FinalReconciliationResult[],
  finalizedPrimaries: Set<string>,
  trace: TraceRecorder,
): void {
  const result = noCandidateResult(item.primary, item.caseId, results.length + 1);
  trace.record({ type: "CASE_FINALIZED", caseId: item.caseId, payload: { ...result, aiEscalated: false } });
  results.push(result);
  finalizedPrimaries.add(primaryKey(item.primary.side, item.primary.recordId));
}

function noCandidateResult(primary: CandidatePrimary, caseIdValue: string, finalizationOrder: number): FinalReconciliationResult {
  return {
    caseId: caseIdValue,
    outcome: "UNRESOLVED",
    bankRecordIds: primary.side === "BANK" ? [primary.recordId] : [],
    ledgerRecordIds: primary.side === "LEDGER" ? [primary.recordId] : [],
    reasonCode: "NO_CANDIDATE",
    source: "DETERMINISTIC",
    reason: "No viable reconciliation candidate was found; AI reasoning cannot add evidence.",
    finalizationOrder,
  };
}

function mechanicalExceptionResult(
  records: RecordLookup,
  primary: CandidatePrimary,
  usedRecords: UsedRecordState,
  asOfDate: string,
  caseIdValue: string,
  finalizationOrder: number,
): FinalReconciliationResult | undefined {
  if (primary.side !== "LEDGER") return undefined;
  const maturityDate = records.ledgerRecords.get(primary.recordId)?.maturityDate;
  if (maturityDate === null || maturityDate === undefined || maturityDate <= asOfDate) return undefined;
  if (generateCandidates({ primary, records, usedRecords }).candidates.length > 0) return undefined;
  return {
    caseId: caseIdValue,
    outcome: "EXPLAINED_OUTSTANDING",
    bankRecordIds: [],
    ledgerRecordIds: [primary.recordId],
    reasonCode: "TIMING_DIFFERENCE",
    source: "DETERMINISTIC",
    reason: `Ledger maturity date ${maturityDate} is after the run as-of date ${asOfDate}.`,
    finalizationOrder,
  };
}

/** Execute the non-model half of a run and return durable, JSON-safe work units. */
export function planReconciliation(input: Pick<RunReconciliationInput, "runId" | "asOfDate" | "bankCsv" | "ledgerCsv" | "clock">): ReconciliationPlan {
  const trace = createTraceRecorder({ runId: input.runId, clock: input.clock });
  const bankRecords = parseBankCsv(input.bankCsv);
  const ledgerRecords = parseLedgerCsv(input.ledgerCsv);
  const records = createRecordLookup(bankRecords, ledgerRecords);
  trace.record({ type: "RUN_STARTED", payload: { asOfDate: input.asOfDate, bankRecordCount: bankRecords.length, ledgerRecordCount: ledgerRecords.length } });
  normalizeRecords(records, trace);
  const deterministicResults: FinalReconciliationResult[] = [];
  const startedCases = new Set<string>();
  const startCase = (side: "BANK" | "LEDGER", id: string) => {
    const value = caseId(side, id);
    if (!startedCases.has(value)) {
      startedCases.add(value);
      trace.record({ type: "CASE_STARTED", caseId: value, payload: { primarySide: side, primaryRecordId: id } });
    }
    return value;
  };
  const deterministic = runDeterministicReconciliation({
    records,
    observer: {
      onRuleEvaluated: ({ rule, anchorSide, anchorId }) => { trace.record({ type: "RULE_EVALUATED", caseId: startCase(anchorSide, anchorId), payload: { rule, anchorSide, anchorRecordId: anchorId } }); },
      onRuleResult: (event) => {
        const currentCaseId = caseId(event.anchorSide, event.anchorId);
        if (event.type === "RULE_PASSED") trace.record({ type: "RULE_PASSED", caseId: currentCaseId, payload: { rule: event.rule, bankRecordIds: event.bankRecordIds, ledgerRecordIds: event.ledgerRecordIds, reasonCode: event.reasonCode } });
        else trace.record({ type: "RULE_FAILED", caseId: currentCaseId, payload: { rule: event.rule, reason: event.reason, candidateIds: event.candidateIds } });
      },
      onDecisionCommitted: (event) => {
        const currentCaseId = caseId(event.anchorSide, event.anchorId);
        trace.record({ type: "AUTO_RECONCILED", caseId: currentCaseId, payload: { rule: event.rule, bankRecordIds: event.bankRecordIds, ledgerRecordIds: event.ledgerRecordIds, reasonCode: event.reasonCode } });
        trace.record({ type: "CASE_FINALIZED", caseId: currentCaseId, payload: { outcome: "RECONCILED", bankRecordIds: event.bankRecordIds, ledgerRecordIds: event.ledgerRecordIds, reasonCode: event.reasonCode, source: "DETERMINISTIC", aiEscalated: false, reason: `Resolved by deterministic rule ${event.rule}.` } });
        deterministicResults.push({ caseId: currentCaseId, outcome: "RECONCILED", bankRecordIds: event.bankRecordIds, ledgerRecordIds: event.ledgerRecordIds, reasonCode: event.reasonCode, source: "DETERMINISTIC", rule: event.rule, finalizationOrder: deterministicResults.length + 1 });
      },
    },
  });
  const usedRecords = cloneUsedRecords(deterministic.usedRecords);
  const reasoningDecisions = deterministic.decisions
    .filter((decision): decision is Extract<DeterministicDecision, { status: "NEEDS_REASONING" }> => decision.status === "NEEDS_REASONING")
    .sort(compareReasoningDecisions);
  const pendingReasoningDecisions: typeof reasoningDecisions = [];
  for (const decision of reasoningDecisions) {
    const primary = primaryForDecision(decision);
    const result = mechanicalExceptionResult(records, primary, usedRecords, input.asOfDate, caseId(primary.side, primary.recordId), deterministicResults.length + 1);
    if (result === undefined) {
      pendingReasoningDecisions.push(decision);
      continue;
    }
    startCase(primary.side, primary.recordId);
    deterministicResults.push(result);
    addPrimary(primary, usedRecords);
    trace.record({ type: "CASE_FINALIZED", caseId: result.caseId, payload: { ...result, aiEscalated: false } });
  }
  const selectedReasoningDecisions = selectConnectedReasoningDecisions(pendingReasoningDecisions, records, usedRecords);
  const components: PlannedReasoningComponent[] = [];
  for (const selection of selectedReasoningDecisions) {
    const decision = selection.decision;
    const primary = primaryForDecision(decision);
    const candidateSet = pruneCandidatesForReasoning(generateCandidates({ primary, records, usedRecords, requiredCandidateIds: decision.bankRecordIds.concat(decision.ledgerRecordIds) })).candidateSet;
    const currentCaseId = startCase(primary.side, primary.recordId);
    trace.record({ type: "CANDIDATES_GENERATED", caseId: currentCaseId, payload: { primarySide: primary.side, primaryRecordId: primary.recordId, candidateRecordIds: candidateSet.candidates.map((candidate) => candidate.recordId), candidates: traceCandidates(candidateSet), totalEligibleCandidates: candidateSet.totalEligibleCandidates, truncated: candidateSet.truncated } });
    if (!shouldEscalateToAI(candidateSet)) {
      const result = noCandidateResult(primary, currentCaseId, deterministicResults.length + 1);
      deterministicResults.push(result);
      trace.record({ type: "CASE_FINALIZED", caseId: currentCaseId, payload: { ...result, aiEscalated: false } });
      continue;
    }
    components.push({ componentId: `${input.runId}:component:${components.length + 1}`, caseId: currentCaseId, primary, candidateSet, decision, promptInput: buildReconciliationReasoningInput({ primary: reasoningPrimary(records, primary), candidateSet, records, runContext: { asOfDate: input.asOfDate } }), unresolvedBankRecordIds: selection.unresolvedBankRecordIds, unresolvedLedgerRecordIds: selection.unresolvedLedgerRecordIds, bankRecords, ledgerRecords });
  }
  const logicalCases = deterministicResults.length + components.length;
  trace.record({ type: "RUN_PLANNED", payload: {
    totalWorkItems: components.length,
    deterministicResults: deterministicResults.length,
    reasoningComponents: components.length,
    totalSourceRecords: bankRecords.length + ledgerRecords.length,
    logicalCases,
    deterministicallyResolved: deterministicResults.filter((result) => result.outcome === "RECONCILED").length,
    deterministicExceptions: deterministicResults.filter((result) => result.outcome !== "RECONCILED").length,
    aiEscalations: components.length,
    aiEscalationRate: logicalCases === 0 ? 0 : components.length / logicalCases,
  } });
  return { runId: input.runId, asOfDate: input.asOfDate, bankRecords, ledgerRecords, deterministicResults, deterministicUsedBankRecordIds: [...usedRecords.bankRecordIds], deterministicUsedLedgerRecordIds: [...usedRecords.ledgerRecordIds], components, trace: trace.getEvents() };
}

export async function processPlannedComponent(
  input: { runId: string; asOfDate: string; component: PlannedReasoningComponent; modelAdapter: RunReconciliationInput["modelAdapter"]; usedRecords?: { bankRecordIds: Set<string>; ledgerRecordIds: Set<string> }; signal?: AbortSignal; onProviderRequestStart?: () => void },
): Promise<{ result: FinalReconciliationResult; trace: readonly RecordedTraceEvent[] }> {
  const records = createRecordLookup(input.component.bankRecords, input.component.ledgerRecords);
  const item: PreparedReasoningItem = { ...input.component, coverComponentOnUnresolved: true };
  const trace = createTraceRecorder({ runId: `${input.runId}:component:${input.component.componentId}` });
  trace.record({ type: "AGENT_STARTED", caseId: input.component.caseId, payload: { primarySide: input.component.primary.side, primaryRecordId: input.component.primary.recordId, candidateCount: input.component.candidateSet.candidates.length, escalationReason: input.component.decision.reason } });
  const usedRecords = input.usedRecords ?? cloneUsedRecords(emptyUsedRecordState());
  const proposal = await generateProposalWithVerifierRetry(item, input.modelAdapter.generateProposal.bind(input.modelAdapter), records, input.asOfDate, cloneUsedRecords(usedRecords), trace, input.signal, undefined, input.onProviderRequestStart);
  const results: FinalReconciliationResult[] = [];
  finalizeAgentProposal(item, proposal, records, input.runId, input.asOfDate, usedRecords, new Set(), results, trace);
  return { result: results[0]!, trace: trace.getEvents() };
}

export async function processPlannedBatch(input: {
  runId: string;
  asOfDate: string;
  components: readonly PlannedReasoningComponent[];
  modelAdapter: RunReconciliationInput["modelAdapter"];
  signal?: AbortSignal;
  onProviderRequestStart?: () => void;
  usedRecords?: { bankRecordIds: Set<string>; ledgerRecordIds: Set<string> };
}): Promise<{ results: FinalReconciliationResult[]; trace: readonly RecordedTraceEvent[] }> {
  if (input.components.length === 0) return { results: [], trace: [] };
  if (componentsOverlap(input.components)) {
    const usedRecords = input.usedRecords ?? cloneUsedRecords(emptyUsedRecordState());
    const processed = [] as Awaited<ReturnType<typeof processPlannedComponent>>[];
    for (const component of input.components) processed.push(await processPlannedComponent({ ...input, component, usedRecords }));
    return { results: processed.map((item) => item.result), trace: processed.flatMap((item) => item.trace) };
  }
  const processed = await Promise.all(input.components.map((component) => processPlannedComponent({ ...input, component })));
  return { results: processed.map((item) => item.result), trace: processed.flatMap((item) => item.trace) };
}

function componentsOverlap(components: readonly PlannedReasoningComponent[]): boolean {
  const seen = new Set<string>();
  for (const component of components) {
    const ids = [
      `${component.primary.side}:${component.primary.recordId}`,
      ...component.candidateSet.candidates.map((candidate) => `${candidate.side}:${candidate.recordId}`),
    ];
    if (ids.some((id) => seen.has(id))) return true;
    ids.forEach((id) => seen.add(id));
  }
  return false;
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
  if (result.outcome === "UNRESOLVED" && item.coverComponentOnUnresolved === true) {
    result.bankRecordIds = investigationRecordIds(item, "BANK");
    result.ledgerRecordIds = investigationRecordIds(item, "LEDGER");
  }
  result.finalizationOrder = results.length + 1;
  trace.record({
    type: "CASE_FINALIZED",
    caseId: item.caseId,
    payload: {
      outcome: result.outcome,
      bankRecordIds: result.bankRecordIds,
      ledgerRecordIds: result.ledgerRecordIds,
      reasonCode: result.reasonCode,
      source: result.source,
      reason: result.reason,
      aiEscalated: true,
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
  onProviderRequestStart?: () => void,
): Promise<AgentProposal> {
  let proposal = await requestProposal({ ...item.promptInput, signal, onProviderRequestStart });
  trace.record({ type: "AGENT_PROPOSED", caseId: item.caseId, payload: proposal });

  for (let attempt = 0; attempt < 1; attempt += 1) {
    const verification = verifyAgentProposal(item, proposal, records, asOfDate, usedRecords);
    if (verification.status !== "REJECTED" || !verification.failures.some((failure) => isRepairableModelFailure(failure.code))) return proposal;
    trace.record({ type: "VERIFICATION_CHECKED", caseId: item.caseId, payload: verificationPayload(verification) });
    const feedback = verification.failures.map((failure) => ({
      code: failure.code,
      message: failure.message,
      recordIds: failure.recordIds ?? [],
    }));
    trace.record({ type: "REPAIR_STARTED", payload: { caseId: item.caseId, repairAttempt: attempt + 1 } });
    onRepair?.();
    proposal = await requestProposal({
      ...item.promptInput,
      retryFeedback: JSON.stringify({ caseId: item.caseId, proposedBankRecordIds: proposal.bankRecordIds, proposedLedgerRecordIds: proposal.ledgerRecordIds, verifierFailures: feedback }),
      signal,
      onProviderRequestStart,
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

function selectConnectedReasoningDecisions(
  decisions: readonly Extract<DeterministicDecision, { status: "NEEDS_REASONING" }>[],
  records: RecordLookup,
  usedRecords: UsedRecordState,
): SelectedReasoningDecision[] {
  const items = decisions.map((decision) => {
    const primary = primaryForDecision(decision);
    const candidateSet = pruneCandidatesForReasoning(generateCandidates({ primary, records, usedRecords, requiredCandidateIds: decision.bankRecordIds.concat(decision.ledgerRecordIds) })).candidateSet;
    return { decision, primary, candidateSet };
  });
  const byPrimary = new Map(items.map((item) => [primaryKey(item.primary.side, item.primary.recordId), item]));
  const covered = new Set<string>();
  const selectedItems: typeof items = [];
  const hubs = items.filter((item) => componentCandidates(item.candidateSet).length > 1).sort((left, right) =>
    componentCandidates(right.candidateSet).length - componentCandidates(left.candidateSet).length
    || compareReasoningDecisions(left.decision, right.decision));
  for (const hub of hubs) {
    const hubKey = primaryKey(hub.primary.side, hub.primary.recordId);
    const candidates = componentCandidates(hub.candidateSet);
    const isIsolatedStar = candidates.every((candidate) => {
      const leaf = byPrimary.get(primaryKey(candidate.side, candidate.recordId));
      const leafCandidates = leaf === undefined ? [] : componentCandidates(leaf.candidateSet);
      return leafCandidates.length === 1
        && leafCandidates[0]!.side === hub.primary.side
        && leafCandidates[0]!.recordId === hub.primary.recordId;
    });
    if (!isIsolatedStar || covered.has(hubKey) || candidates.some((candidate) => covered.has(primaryKey(candidate.side, candidate.recordId)))) continue;
    selectedItems.push(hub);
    covered.add(hubKey);
    candidates.forEach((candidate) => covered.add(primaryKey(candidate.side, candidate.recordId)));
  }
  for (const item of items.sort((left, right) => compareReasoningDecisions(left.decision, right.decision))) {
    const itemKey = primaryKey(item.primary.side, item.primary.recordId);
    if (covered.has(itemKey)) continue;
    const reciprocalAlreadySelected = selectedItems.some((existing) =>
      existing.candidateSet.candidates.some((candidate) => candidate.side === item.primary.side && candidate.recordId === item.primary.recordId)
      && item.candidateSet.candidates.some((candidate) => candidate.side === existing.primary.side && candidate.recordId === existing.primary.recordId));
    if (reciprocalAlreadySelected) continue;
    selectedItems.push(item);
    covered.add(itemKey);
  }
  return selectedItems.sort((left, right) => compareReasoningDecisions(left.decision, right.decision)).map((item) => {
    const candidates = componentCandidates(item.candidateSet);
    return {
      decision: item.decision,
      unresolvedBankRecordIds: [
        ...(item.primary.side === "BANK" ? [item.primary.recordId] : []),
        ...candidates.filter((candidate) => candidate.side === "BANK").map((candidate) => candidate.recordId),
      ].sort(),
      unresolvedLedgerRecordIds: [
        ...(item.primary.side === "LEDGER" ? [item.primary.recordId] : []),
        ...candidates.filter((candidate) => candidate.side === "LEDGER").map((candidate) => candidate.recordId),
      ].sort(),
    };
  });
}

function investigationRecordIds(item: PreparedReasoningItem, side: CandidatePrimary["side"]): string[] {
  return side === "BANK" ? item.unresolvedBankRecordIds : item.unresolvedLedgerRecordIds;
}

function componentCandidates(candidateSet: CandidateSet): CandidateSet["candidates"] {
  const strong = candidateSet.candidates.filter((candidate) =>
    candidate.selectionTier === "EXACT_REFERENCE"
    || candidate.selectionTier === "NORMALIZED_REFERENCE"
    || candidate.selectionTier === "EXACT_BATCH");
  return strong.length > 0 ? strong : candidateSet.candidates.length === 1 ? candidateSet.candidates : [];
}

function traceCandidates(candidateSet: CandidateSet) {
  return candidateSet.candidates.map((candidate) => ({
    side: candidate.side,
    recordId: candidate.recordId,
    selectionTier: candidate.selectionTier,
    signals: [...candidate.signals],
    facts: { ...candidate.facts },
  }));
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
