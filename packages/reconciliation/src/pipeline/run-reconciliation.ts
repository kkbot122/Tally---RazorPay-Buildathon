import type { AgentProposal, FinalOutcome, ReasonCode } from "@tally/contracts";

import { buildReconciliationReasoningInput, type ReasoningPrimary } from "../agent/index.js";
import type { CandidatePrimary, CandidateSet } from "../candidates/index.js";
import { generateCandidates } from "../candidates/index.js";
import { createRecordLookup, type RecordLookup, type UsedRecordState } from "../compatibility/index.js";
import { runDeterministicReconciliation, type DeterministicDecision, type DeterministicRuleId } from "../deterministic/index.js";
import { normalizeCounterpartyForExactComparison, normalizeCurrency, normalizeDate, normalizeOptionalDate, normalizeReference, parseMoneyToPaise } from "../normalization/index.js";
import { parseBankCsv, parseLedgerCsv } from "../parsing/index.js";
import { verifyMatchProposal, verifyNonMatchProposal, type MatchVerificationResult, type NonMatchVerificationResult } from "../verifier/index.js";
import { createTraceRecorder, type TraceRecorder } from "../trace/index.js";
import type { FinalReconciliationResult, ReconciliationRunResult, RunReconciliationInput } from "./types.js";

export async function runReconciliation(input: RunReconciliationInput): Promise<ReconciliationRunResult> {
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
        });
        finalizedPrimaries.add(primaryKey(event.anchorSide, event.anchorId));
      },
    },
  });

  const reasoningDecisions = deterministic.decisions
    .filter((decision): decision is Extract<DeterministicDecision, { status: "NEEDS_REASONING" }> => decision.status === "NEEDS_REASONING")
    .sort(compareReasoningDecisions);
  const usedRecords = cloneUsedRecords(deterministic.usedRecords);

  for (const decision of reasoningDecisions) {
    const primary = primaryForDecision(decision);
    const primaryKeyValue = primaryKey(primary.side, primary.recordId);
    if (finalizedPrimaries.has(primaryKeyValue) || isUsed(primary, usedRecords)) continue;

    const currentCaseId = startCase(primary.side, primary.recordId);

    const candidateSet = generateCandidates({
      primary,
      records,
      usedRecords,
      requiredCandidateIds: decision.bankRecordIds.concat(decision.ledgerRecordIds),
    });
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

    const promptInput = buildReconciliationReasoningInput({
      primary: reasoningPrimary(records, primary),
      candidateSet,
      records,
      runContext: { asOfDate: input.asOfDate },
    });
    trace.record({
      type: "AGENT_STARTED",
      caseId: currentCaseId,
      payload: {
        primarySide: primary.side,
        primaryRecordId: primary.recordId,
        candidateCount: candidateSet.candidates.length,
      },
    });
    const proposal = await input.modelAdapter.generateProposal(promptInput);
    trace.record({ type: "AGENT_PROPOSED", caseId: currentCaseId, payload: proposal });

    const verification = proposal.proposedOutcome === "MATCH"
      ? verifyMatchProposal({ proposal, primary, candidateSet, records, usedRecords })
      : verifyNonMatchProposal({
          proposal,
          primary,
          candidateSet,
          records,
          usedRecords,
          runContext: { asOfDate: input.asOfDate },
          reasoningContext: { deterministicReason: decision.reason === "MULTIPLE_CANDIDATES" || decision.reason === "GROUPING_AMBIGUITY" ? decision.reason : undefined },
        });
    trace.record({
      type: "VERIFICATION_CHECKED",
      caseId: currentCaseId,
      payload: verificationPayload(verification),
    });

    const result = finalizeAgentResult(currentCaseId, proposal, verification);
    trace.record({
      type: "CASE_FINALIZED",
      caseId: currentCaseId,
      payload: {
        outcome: result.outcome,
        bankRecordIds: result.bankRecordIds,
        ledgerRecordIds: result.ledgerRecordIds,
        reasonCode: result.reasonCode,
      },
    });
    results.push(result);
    consumeFinalResult(result, primary, usedRecords, finalizedPrimaries);
  }

  trace.record({ type: "RUN_COMPLETED", payload: { casesProcessed: results.length } });
  return { runId: input.runId, results, usedRecords, trace: trace.getEvents() };
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
    return rejectedAgentResult(caseIdValue, proposal);
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
  return rejectedAgentResult(caseIdValue, proposal);
}

function rejectedAgentResult(caseIdValue: string, proposal: AgentProposal): FinalReconciliationResult {
  return {
    caseId: caseIdValue,
    outcome: "UNRESOLVED",
    bankRecordIds: [],
    ledgerRecordIds: [],
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
