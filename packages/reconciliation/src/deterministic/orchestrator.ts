import {
  applyExactReferenceRule,
  applyManyToOneGroupedRule,
  applyNormalizedReferenceRule,
  applyOneToManyGroupedRule,
  applyStrongContextRule,
} from "../matching/index.js";
import type {
  AutoReconciledDecision,
  DeterministicDecision,
  DeterministicRuleEvent,
  DeterministicReconciliationInput,
  DeterministicReconciliationResult,
  DeterministicReason,
  DeterministicRuleId,
  NeedsReasoningDecision,
} from "./types.js";
import type { UsedRecordState } from "../compatibility/index.js";

type Proposal = {
  status: "MATCH";
  rule: DeterministicRuleId;
  anchorId: string;
  bankRecordIds: string[];
  ledgerRecordIds: string[];
  reasonCode: AutoReconciledDecision["reasonCode"];
};

type MutableUsedRecordState = {
  bankRecordIds: Set<string>;
  ledgerRecordIds: Set<string>;
};

type RuleStage = {
  rule: DeterministicRuleId;
  anchors: string[];
  evaluate: (anchorId: string, usedRecords: UsedRecordState) => RuleEvaluation;
};

type RuleEvaluation =
  | { kind: "MATCH"; proposal: Proposal }
  | { kind: "AMBIGUOUS"; bankRecordIds: string[]; ledgerRecordIds: string[]; reason: DeterministicReason }
  | { kind: "NONE" };

export function runDeterministicReconciliation(input: DeterministicReconciliationInput): DeterministicReconciliationResult {
  const usedRecords = cloneUsedRecords(input.usedRecords);
  const blockedBankIds = new Set<string>();
  const blockedLedgerIds = new Set<string>();
  const coveredBankIds = new Set<string>();
  const coveredLedgerIds = new Set<string>();
  const decisions: DeterministicDecision[] = [];
  const events: DeterministicRuleEvent[] = [];

  const stages: RuleStage[] = [
    {
      rule: "R1_EXACT_REFERENCE",
      anchors: [...input.records.bankRecords.keys()].sort(),
      evaluate: (anchorId, stageUsed) => {
        const result = applyExactReferenceRule({ bankRecordId: anchorId, records: input.records, usedRecords: stageUsed });
        return normalizeOneToOneResult(result, "R1_EXACT_REFERENCE", anchorId, "MULTIPLE_CANDIDATES");
      },
    },
    {
      rule: "R2_NORMALIZED_REFERENCE",
      anchors: [...input.records.bankRecords.keys()].sort(),
      evaluate: (anchorId, stageUsed) => {
        const result = applyNormalizedReferenceRule({ bankRecordId: anchorId, records: input.records, usedRecords: stageUsed });
        return normalizeOneToOneResult(result, "R2_NORMALIZED_REFERENCE", anchorId, "MULTIPLE_CANDIDATES");
      },
    },
    {
      rule: "R3_STRONG_CONTEXT",
      anchors: [...input.records.bankRecords.keys()].sort(),
      evaluate: (anchorId, stageUsed) => {
        const result = applyStrongContextRule({ bankRecordId: anchorId, records: input.records, usedRecords: stageUsed });
        return normalizeOneToOneResult(result, "R3_STRONG_CONTEXT", anchorId, "MULTIPLE_CANDIDATES");
      },
    },
    {
      rule: "R4_ONE_TO_MANY_GROUPED",
      anchors: [...input.records.bankRecords.keys()].sort(),
      evaluate: (anchorId, stageUsed) => {
        const result = applyOneToManyGroupedRule({ bankRecordId: anchorId, records: input.records, usedRecords: stageUsed });
        if (result.status === "MATCH") return { kind: "MATCH", proposal: { status: "MATCH", rule: "R4_ONE_TO_MANY_GROUPED", anchorId, bankRecordIds: [result.bankRecordId], ledgerRecordIds: result.ledgerRecordIds, reasonCode: result.reasonCode } };
        if (result.status === "AMBIGUOUS") return { kind: "AMBIGUOUS", bankRecordIds: [anchorId], ledgerRecordIds: result.candidateGroups.flat(), reason: "GROUPING_AMBIGUITY" };
        return { kind: "NONE" };
      },
    },
    {
      rule: "R5_MANY_TO_ONE_GROUPED",
      anchors: [...input.records.ledgerRecords.keys()].sort(),
      evaluate: (anchorId, stageUsed) => {
        const result = applyManyToOneGroupedRule({ ledgerRecordId: anchorId, records: input.records, usedRecords: stageUsed });
        if (result.status === "MATCH") return { kind: "MATCH", proposal: { status: "MATCH", rule: "R5_MANY_TO_ONE_GROUPED", anchorId, bankRecordIds: result.bankRecordIds, ledgerRecordIds: [result.ledgerRecordId], reasonCode: result.reasonCode } };
        if (result.status === "AMBIGUOUS") return { kind: "AMBIGUOUS", bankRecordIds: result.candidateGroups.flat(), ledgerRecordIds: [anchorId], reason: "GROUPING_AMBIGUITY" };
        return { kind: "NONE" };
      },
    },
  ];

  for (const stage of stages) {
    const stageUsed = withBlockedRecords(usedRecords, blockedBankIds, blockedLedgerIds);
    const evaluations = stage.anchors.filter((anchorId) => {
      return stage.rule === "R5_MANY_TO_ONE_GROUPED"
        ? !stageUsed.ledgerRecordIds.has(anchorId)
        : !stageUsed.bankRecordIds.has(anchorId);
    }).map((anchorId) => {
      const anchorSide = stage.rule === "R5_MANY_TO_ONE_GROUPED" ? "LEDGER" as const : "BANK" as const;
      events.push({ type: "RULE_EVALUATED", rule: stage.rule, anchorId });
      input.observer?.onRuleEvaluated?.({ rule: stage.rule, anchorSide, anchorId });
      const evaluation = stage.evaluate(anchorId, stageUsed);
      if (evaluation.kind === "MATCH") {
        events.push({ type: "RULE_PASSED", rule: stage.rule, anchorId, bankRecordIds: [...evaluation.proposal.bankRecordIds].sort(), ledgerRecordIds: [...evaluation.proposal.ledgerRecordIds].sort() });
        input.observer?.onRuleResult?.({
          type: "RULE_PASSED",
          rule: stage.rule,
          anchorSide,
          anchorId,
          bankRecordIds: [...evaluation.proposal.bankRecordIds].sort(),
          ledgerRecordIds: [...evaluation.proposal.ledgerRecordIds].sort(),
          reasonCode: evaluation.proposal.reasonCode,
        });
      } else {
        events.push({ type: "RULE_FAILED", rule: stage.rule, anchorId, reason: evaluation.kind === "AMBIGUOUS" ? evaluation.reason : "NO_RULE_MATCH" });
        input.observer?.onRuleResult?.({
          type: "RULE_FAILED",
          rule: stage.rule,
          anchorSide,
          anchorId,
          reason: evaluation.kind === "AMBIGUOUS" ? evaluation.reason : "NO_RULE_MATCH",
          ...(evaluation.kind === "AMBIGUOUS" ? { candidateIds: [...evaluation.ledgerRecordIds, ...evaluation.bankRecordIds].sort() } : {}),
        });
      }
      return evaluation;
    });
    const ambiguous = evaluations.filter((evaluation): evaluation is Extract<RuleEvaluation, { kind: "AMBIGUOUS" }> => evaluation.kind === "AMBIGUOUS");
    const proposals = evaluations.filter((evaluation): evaluation is Extract<RuleEvaluation, { kind: "MATCH" }> => evaluation.kind === "MATCH").map((evaluation) => evaluation.proposal);

    const stageBlockedBankIds = new Set<string>();
    const stageBlockedLedgerIds = new Set<string>();
    for (const evaluation of ambiguous) {
      block(evaluation.bankRecordIds, evaluation.ledgerRecordIds, stageBlockedBankIds, stageBlockedLedgerIds, coveredBankIds, coveredLedgerIds);
      decisions.push(needs(evaluation.reason, evaluation.bankRecordIds, evaluation.ledgerRecordIds, stage.rule));
    }

    const conflictingProposalIndexes = findConflictingProposalIndexes(proposals);
    for (const index of conflictingProposalIndexes) {
      const proposal = proposals[index]!;
      block(proposal.bankRecordIds, proposal.ledgerRecordIds, stageBlockedBankIds, stageBlockedLedgerIds, coveredBankIds, coveredLedgerIds);
      decisions.push(needs(reasonForRule(stage.rule, "overlap"), proposal.bankRecordIds, proposal.ledgerRecordIds, stage.rule));
    }

    for (const proposal of proposals) {
      if (conflictingProposalIndexes.has(proposals.indexOf(proposal))) continue;
      if (overlaps(proposal.bankRecordIds, stageBlockedBankIds) || overlaps(proposal.ledgerRecordIds, stageBlockedLedgerIds)) {
        block(proposal.bankRecordIds, proposal.ledgerRecordIds, stageBlockedBankIds, stageBlockedLedgerIds, coveredBankIds, coveredLedgerIds);
        decisions.push(needs(reasonForRule(stage.rule, "overlap"), proposal.bankRecordIds, proposal.ledgerRecordIds, stage.rule));
      }
    }

    for (const proposal of proposals) {
      if (conflictingProposalIndexes.has(proposals.indexOf(proposal))) continue;
      if (overlaps(proposal.bankRecordIds, stageBlockedBankIds) || overlaps(proposal.ledgerRecordIds, stageBlockedLedgerIds)) continue;
      commit(proposal, usedRecords);
      decisions.push(normalizeDecision(proposal));
      events.push({ type: "AUTO_RECONCILED", rule: proposal.rule, anchorId: proposal.anchorId, bankRecordIds: [...proposal.bankRecordIds].sort(), ledgerRecordIds: [...proposal.ledgerRecordIds].sort() });
      input.observer?.onDecisionCommitted?.({
        rule: proposal.rule,
        anchorSide: proposal.rule === "R5_MANY_TO_ONE_GROUPED" ? "LEDGER" : "BANK",
        anchorId: proposal.anchorId,
        bankRecordIds: [...proposal.bankRecordIds].sort(),
        ledgerRecordIds: [...proposal.ledgerRecordIds].sort(),
        reasonCode: proposal.reasonCode,
      });
    }

    for (const id of stageBlockedBankIds) blockedBankIds.add(id);
    for (const id of stageBlockedLedgerIds) blockedLedgerIds.add(id);
  }

  const finalBlockedBankIds = new Set([...blockedBankIds, ...coveredBankIds]);
  const finalBlockedLedgerIds = new Set([...blockedLedgerIds, ...coveredLedgerIds]);
  for (const bankId of [...input.records.bankRecords.keys()].sort()) {
    if (!usedRecords.bankRecordIds.has(bankId) && !finalBlockedBankIds.has(bankId)) decisions.push(needs("NO_RULE_MATCH", [bankId], [], undefined));
  }
  for (const ledgerId of [...input.records.ledgerRecords.keys()].sort()) {
    if (!usedRecords.ledgerRecordIds.has(ledgerId) && !finalBlockedLedgerIds.has(ledgerId)) decisions.push(needs("NO_RULE_MATCH", [], [ledgerId], undefined));
  }

  return { decisions, usedRecords, events };
}

function normalizeOneToOneResult(result: { status: "MATCH"; bankRecordId: string; ledgerRecordId: string; reasonCode: AutoReconciledDecision["reasonCode"] } | { status: "NO_MATCH" } | { status: "AMBIGUOUS"; candidateLedgerRecordIds: string[] }, rule: DeterministicRuleId, anchorId: string, ambiguityReason: DeterministicReason): RuleEvaluation | { kind: "NONE" } {
  if (result.status === "MATCH") return { kind: "MATCH", proposal: { ...result, rule, anchorId, bankRecordIds: [result.bankRecordId], ledgerRecordIds: [result.ledgerRecordId] } };
  if (result.status === "AMBIGUOUS") return { kind: "AMBIGUOUS", bankRecordIds: [anchorId], ledgerRecordIds: result.candidateLedgerRecordIds, reason: ambiguityReason };
  return { kind: "NONE" };
}

function cloneUsedRecords(usedRecords?: UsedRecordState): MutableUsedRecordState {
  return { bankRecordIds: new Set(usedRecords?.bankRecordIds), ledgerRecordIds: new Set(usedRecords?.ledgerRecordIds) };
}

function withBlockedRecords(used: UsedRecordState, blockedBankIds: ReadonlySet<string>, blockedLedgerIds: ReadonlySet<string>): MutableUsedRecordState {
  return { bankRecordIds: new Set([...used.bankRecordIds, ...blockedBankIds]), ledgerRecordIds: new Set([...used.ledgerRecordIds, ...blockedLedgerIds]) };
}

function commit(proposal: Proposal, used: MutableUsedRecordState): void {
  for (const id of proposal.bankRecordIds) used.bankRecordIds.add(id);
  for (const id of proposal.ledgerRecordIds) used.ledgerRecordIds.add(id);
}

function normalizeDecision(proposal: Proposal): AutoReconciledDecision {
  return {
    status: "AUTO_RECONCILED",
    rule: proposal.rule,
    bankRecordIds: [...proposal.bankRecordIds].sort(),
    ledgerRecordIds: [...proposal.ledgerRecordIds].sort(),
    reasonCode: proposal.reasonCode,
  };
}

function needs(reason: DeterministicReason, bankRecordIds: readonly string[], ledgerRecordIds: readonly string[], sourceRule: DeterministicRuleId | undefined): NeedsReasoningDecision {
  return { status: "NEEDS_REASONING", reason, bankRecordIds: [...bankRecordIds].sort(), ledgerRecordIds: [...ledgerRecordIds].sort(), ...(sourceRule === undefined ? {} : { sourceRule }) };
}

function block(bankIds: readonly string[], ledgerIds: readonly string[], blockedBanks: Set<string>, blockedLedgers: Set<string>, coveredBanks: Set<string>, coveredLedgers: Set<string>): void {
  for (const id of bankIds) { blockedBanks.add(id); coveredBanks.add(id); }
  for (const id of ledgerIds) { blockedLedgers.add(id); coveredLedgers.add(id); }
}

function overlaps(ids: readonly string[], blocked: ReadonlySet<string>): boolean {
  return ids.some((id) => blocked.has(id));
}

function findConflictingProposalIndexes(proposals: readonly Proposal[]): Set<number> {
  const claims = new Map<string, number[]>();
  proposals.forEach((proposal, index) => {
    for (const id of proposal.bankRecordIds) addClaim(claims, `BANK:${id}`, index);
    for (const id of proposal.ledgerRecordIds) addClaim(claims, `LEDGER:${id}`, index);
  });
  const conflicts = new Set<number>();
  for (const indexes of claims.values()) if (indexes.length > 1) indexes.forEach((index) => conflicts.add(index));
  return conflicts;
}

function addClaim(claims: Map<string, number[]>, key: string, index: number): void {
  const indexes = claims.get(key) ?? [];
  indexes.push(index);
  claims.set(key, indexes);
}

function reasonForRule(rule: DeterministicRuleId, _kind: "overlap"): DeterministicReason {
  return rule === "R4_ONE_TO_MANY_GROUPED" || rule === "R5_MANY_TO_ONE_GROUPED" ? "GROUPING_AMBIGUITY" : "MULTIPLE_CANDIDATES";
}
