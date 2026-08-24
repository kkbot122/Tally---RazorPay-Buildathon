import type { AgentProposal, ReasoningModelAdapter } from "@tally/reconciliation";

type ReasoningContext = {
  runContext: { asOfDate: string };
  primary: { side: "BANK" | "LEDGER"; record: Record<string, unknown> };
  candidateSet: {
    candidates: Array<{ record: Record<string, unknown>; selectionTier: string; facts: Record<string, unknown> }>;
  };
};

export function createE2EReasoningAdapter(): ReasoningModelAdapter {
  return {
    async generateProposal({ input }) {
      const context = parseContext(input);
      const primaryId = recordId(context.primary.side, context.primary.record);
      const candidates = context.candidateSet.candidates;
      const primaryEvidence = context.primary.side === "BANK"
        ? { bankRecordIds: [primaryId], ledgerRecordIds: [] as string[] }
        : { bankRecordIds: [] as string[], ledgerRecordIds: [primaryId] };

      const evidence = (recordIds: string[], kind: "GROUPING" | "SEMANTIC" | "DETERMINISTIC") => [{
        statement: `The deterministic E2E adapter cites the supplied ${kind.toLowerCase()} record context.`,
        source: "CROSS_RECORD" as const,
        kind,
        recordIds,
      }];

      const maturityDate = stringValue(context.primary.record, "maturityDate");
      if (context.primary.side === "LEDGER" && maturityDate !== undefined && maturityDate > context.runContext.asOfDate) {
        return proposal("TIMING_DIFFERENCE", primaryEvidence.bankRecordIds, primaryEvidence.ledgerRecordIds, evidence([primaryId], "DETERMINISTIC"), "The supplied ledger maturity date is after the as-of date.");
      }

      if (candidates.length === 0) {
        return proposal("INSUFFICIENT_EVIDENCE", primaryEvidence.bankRecordIds, primaryEvidence.ledgerRecordIds, evidence([primaryId], "DETERMINISTIC"), "No compatible candidate was supplied.");
      }

      const candidateIds = candidates.map((candidate) => recordId(context.primary.side === "BANK" ? "LEDGER" : "BANK", candidate.record));
      const relationshipIds = context.primary.side === "BANK"
        ? { bankRecordIds: [primaryId], ledgerRecordIds: candidateIds }
        : { bankRecordIds: candidateIds, ledgerRecordIds: [primaryId] };
      const primaryAmount = moneyToPaise(context.primary.record.amount);
      const candidateAmount = candidates.reduce((total, candidate) => total + moneyToPaise(candidate.record.amount), 0n);
      const isGroupedMatch = candidates.length > 1 && candidates.length <= 3 && primaryAmount === candidateAmount;
      if (candidates.length === 1 && primaryAmount !== candidateAmount) {
        return proposal("DISCREPANCY", relationshipIds.bankRecordIds, relationshipIds.ledgerRecordIds, evidence([...relationshipIds.bankRecordIds, ...relationshipIds.ledgerRecordIds], "SEMANTIC"), "The supplied amounts contradict.");
      }
      if (isGroupedMatch || candidates.length === 1) {
        return proposal(isGroupedMatch ? "MATCH" : "MATCH", relationshipIds.bankRecordIds, relationshipIds.ledgerRecordIds, evidence([...relationshipIds.bankRecordIds, ...relationshipIds.ledgerRecordIds], isGroupedMatch ? "GROUPING" : "SEMANTIC"), "The supplied deterministic context supports this relationship.");
      }

      return proposal("INSUFFICIENT_EVIDENCE", primaryEvidence.bankRecordIds, primaryEvidence.ledgerRecordIds, evidence([primaryId], "DETERMINISTIC"), "Several supplied candidates remain plausible; abstaining is safer than guessing.");
    },
  };
}

function parseContext(input: string): ReasoningContext {
  const serialized = input.split("SUPPLIED REASONING CONTEXT:")[1];
  if (serialized === undefined) throw new Error("E2E adapter could not find reasoning context");
  return JSON.parse(serialized) as ReasoningContext;
}

function recordId(side: "BANK" | "LEDGER", record: Record<string, unknown>): string {
  const key = side === "BANK" ? "bankTxnId" : "ledgerTxnId";
  const value = stringValue(record, key);
  if (value === undefined) throw new Error(`E2E adapter missing ${key}`);
  return value;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function moneyToPaise(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("E2E adapter received an invalid amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function proposal(
  proposedOutcome: AgentProposal["proposedOutcome"],
  bankRecordIds: string[],
  ledgerRecordIds: string[],
  evidence: AgentProposal["evidence"],
  reason: string,
): AgentProposal {
  return {
    proposedOutcome,
    bankRecordIds,
    ledgerRecordIds,
    confidence: proposedOutcome === "MATCH" ? "HIGH" : "LOW",
    evidence,
    conflictingEvidence: [],
    reason,
  };
}
