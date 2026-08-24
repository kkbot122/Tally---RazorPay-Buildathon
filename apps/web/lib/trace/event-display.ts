import type { TraceEvent, TraceEventType } from "@tally/contracts";

export type TraceStage = "Run" | "Normalize" | "Rules" | "Candidates" | "Agent" | "Verifier" | "Outcome";

export type TraceEventMeta = {
  label: string;
  stage: TraceStage;
  stageClassName: string;
};

export const TRACE_EVENT_META: Record<TraceEventType, TraceEventMeta> = {
  RUN_STARTED: { label: "Run started", stage: "Run", stageClassName: "bg-tally-surface-subtle text-tally-ink-secondary" },
  CASE_STARTED: { label: "Case started", stage: "Run", stageClassName: "bg-tally-surface-subtle text-tally-ink-secondary" },
  TRANSACTION_NORMALIZED: { label: "Transaction normalized", stage: "Normalize", stageClassName: "bg-tally-accent-soft text-tally-accent" },
  RULE_EVALUATED: { label: "Rule evaluated", stage: "Rules", stageClassName: "bg-tally-surface-subtle text-tally-ink-secondary" },
  RULE_PASSED: { label: "Rule produced proposal", stage: "Rules", stageClassName: "bg-tally-accent-soft text-tally-accent" },
  RULE_FAILED: { label: "Rule did not match", stage: "Rules", stageClassName: "bg-tally-surface-subtle text-tally-ink-secondary" },
  AUTO_RECONCILED: { label: "Auto-reconciled", stage: "Rules", stageClassName: "bg-tally-success-soft text-tally-success" },
  CANDIDATES_GENERATED: { label: "Candidates generated", stage: "Candidates", stageClassName: "bg-tally-accent-soft text-tally-accent" },
  AGENT_STARTED: { label: "Agent reasoning started", stage: "Agent", stageClassName: "bg-tally-surface-subtle text-tally-ink-secondary" },
  AGENT_PROPOSED: { label: "Agent proposal", stage: "Agent", stageClassName: "bg-tally-warning-soft text-tally-warning" },
  VERIFICATION_CHECKED: { label: "Verification checked", stage: "Verifier", stageClassName: "bg-tally-surface-subtle text-tally-ink-secondary" },
  CASE_FINALIZED: { label: "Case finalized", stage: "Outcome", stageClassName: "bg-tally-surface-subtle text-tally-ink-secondary" },
  RUN_COMPLETED: { label: "Run completed", stage: "Run", stageClassName: "bg-tally-success-soft text-tally-success" },
};

const ruleLabels: Record<string, string> = {
  R1_EXACT_REFERENCE: "Exact reference",
  R2_NORMALIZED_REFERENCE: "Normalized reference",
  R3_STRONG_CONTEXT: "Strong context",
  R4_ONE_TO_MANY_GROUPED: "One bank → many ledger",
  R5_MANY_TO_ONE_GROUPED: "Many bank → one ledger",
};

export function traceMeta(event: TraceEvent): TraceEventMeta {
  if (event.type !== "CASE_FINALIZED") return TRACE_EVENT_META[event.type];
  const outcome = stringValue(payloadOf(event), "outcome");
  if (outcome === "RECONCILED") return { ...TRACE_EVENT_META.CASE_FINALIZED, stageClassName: "bg-tally-success-soft text-tally-success" };
  if (outcome === "DISCREPANCY") return { ...TRACE_EVENT_META.CASE_FINALIZED, stageClassName: "bg-tally-danger-soft text-tally-danger" };
  if (outcome === "EXPLAINED_OUTSTANDING" || outcome === "UNRESOLVED") return { ...TRACE_EVENT_META.CASE_FINALIZED, stageClassName: "bg-tally-warning-soft text-tally-warning" };
  return TRACE_EVENT_META.CASE_FINALIZED;
}

export function payloadOf(event: TraceEvent): Record<string, unknown> {
  return event.payload ?? event.metadata ?? {};
}

export function stringValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanValue(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

export function stringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function readableCode(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function ruleLabel(value: string): string {
  return ruleLabels[value] ?? readableCode(value);
}

export function eventSummary(event: TraceEvent): string {
  const payload = payloadOf(event);
  switch (event.type) {
    case "RUN_STARTED": {
      const bankCount = numberValue(payload, "bankRecordCount");
      const ledgerCount = numberValue(payload, "ledgerRecordCount");
      const counts = bankCount !== undefined && ledgerCount !== undefined ? ` · ${bankCount} bank / ${ledgerCount} ledger records` : "";
      return `Runtime started${stringValue(payload, "asOfDate") ? ` · as of ${stringValue(payload, "asOfDate")}` : ""}${counts}`;
    }
    case "RUN_COMPLETED":
      return `${numberValue(payload, "casesProcessed") ?? "Recorded"} cases processed`;
    case "CASE_STARTED":
      return `Primary ${stringValue(payload, "primarySide") ?? "record"} ${stringValue(payload, "primaryRecordId") ?? "not recorded"}`;
    case "TRANSACTION_NORMALIZED":
      return `${stringValue(payload, "side") ?? "Record"} ${stringValue(payload, "recordId") ?? "not recorded"} normalized`;
    case "RULE_EVALUATED":
      return `${ruleLabel(stringValue(payload, "rule") ?? "Rule")} evaluated on ${stringValue(payload, "anchorRecordId") ?? "the anchor record"}`;
    case "RULE_PASSED":
      return `${ruleLabel(stringValue(payload, "rule") ?? "Rule")} produced a successful MATCH proposal`;
    case "RULE_FAILED":
      return `${ruleLabel(stringValue(payload, "rule") ?? "Rule")} · ${readableCode(stringValue(payload, "reason") ?? "no match")}`;
    case "AUTO_RECONCILED":
      return `${ruleLabel(stringValue(payload, "rule") ?? "Rule")} committed ${readableCode(stringValue(payload, "reasonCode") ?? "reconciliation")}`;
    case "CANDIDATES_GENERATED": {
      const count = numberValue(payload, "totalEligibleCandidates") ?? stringArray(payload, "candidateRecordIds").length;
      return `${count} eligible candidate${count === 1 ? "" : "s"} generated${booleanValue(payload, "truncated") ? " · list truncated" : ""}`;
    }
    case "AGENT_STARTED":
      return `Bounded reasoning started with ${numberValue(payload, "candidateCount") ?? 0} candidate${numberValue(payload, "candidateCount") === 1 ? "" : "s"}`;
    case "AGENT_PROPOSED":
      return `${readableCode(stringValue(payload, "proposedOutcome") ?? "proposal")} · ${stringValue(payload, "confidence") ?? "confidence not recorded"}`;
    case "VERIFICATION_CHECKED": {
      const result = payload.result;
      if (result === null || typeof result !== "object") return "Verification result recorded";
      const resultRecord = result as Record<string, unknown>;
      const status = typeof resultRecord.status === "string" ? resultRecord.status : "result recorded";
      if (status === "VERIFIED" && typeof resultRecord.outcome === "string") return `Verified · ${readableCode(resultRecord.outcome)}`;
      return status === "REJECTED" ? "Verification rejected" : readableCode(status);
    }
    case "CASE_FINALIZED":
      return `${readableCode(stringValue(payload, "outcome") ?? "outcome not recorded")} · ${readableCode(stringValue(payload, "reasonCode") ?? "reason not recorded")}`;
  }
}

export function caseOptions(events: readonly TraceEvent[]): string[] {
  return Array.from(new Set(events.map((event) => event.caseId).filter((caseId): caseId is string => caseId !== null)));
}

export function eventMatches(event: TraceEvent, selectedCase: string, selectedStage: TraceStage | "ALL"): boolean {
  const caseMatches = selectedCase === "ALL" || event.caseId === selectedCase || event.caseId === null;
  const stageMatches = selectedStage === "ALL" || traceMeta(event).stage === selectedStage;
  return caseMatches && stageMatches;
}

export function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value);
  } catch {
    return "Structured value";
  }
}

export function recordIdsFor(event: TraceEvent, side: "bankRecordIds" | "ledgerRecordIds" | "candidateRecordIds"): string[] {
  return stringArray(payloadOf(event), side);
}

export function proposalEvidence(event: TraceEvent, key: "evidence" | "conflictingEvidence"): Array<Record<string, unknown>> {
  const value = payloadOf(event)[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}
