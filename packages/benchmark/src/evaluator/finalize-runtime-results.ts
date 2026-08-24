import type { FinalReconciliationResult } from "@tally/reconciliation";

import type { RuntimePrimaryAlignment } from "./types.js";

/**
 * Converts truth-blind per-primary runtime results into one case-level result.
 *
 * The runtime owns finalizationOrder. When multiple primaries share a
 * connected relationship, the terminal runtime result wins; ground truth is
 * not consulted. Every selected result must still contain its declared
 * primary, so this function cannot fabricate a relationship.
 */
export function finalizeRuntimeCaseResults(input: {
  results: readonly FinalReconciliationResult[];
  primaryCaseAlignment: readonly RuntimePrimaryAlignment[];
}): FinalReconciliationResult[] {
  const primaryToCase = new Map<string, string>();
  for (const alignment of input.primaryCaseAlignment) {
    const key = `${alignment.side}:${alignment.recordId}`;
    if (primaryToCase.has(key)) throw new Error(`Duplicate runtime primary alignment: ${key}`);
    primaryToCase.set(key, alignment.caseId);
  }

  const grouped = new Map<string, FinalReconciliationResult[]>();
  for (const result of input.results) {
    finalizationOrder(result);
    const primary = parsePrimary(result.caseId);
    const caseId = primaryToCase.get(`${primary.side}:${primary.recordId}`);
    if (caseId === undefined) throw new Error(`Missing runtime primary alignment for ${result.caseId}`);
    if (!containsPrimary(result, primary)) throw new Error(`Runtime result ${result.caseId} does not contain its primary record`);
    const results = grouped.get(caseId) ?? [];
    results.push(result);
    grouped.set(caseId, results);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([caseId, results]) => {
      const ordered = [...results].sort((left, right) => finalizationOrder(left) - finalizationOrder(right));
      const terminal = ordered.at(-1)!;
      if (ordered.length > 1 && finalizationOrder(ordered.at(-2)!) === finalizationOrder(terminal)) {
        throw new Error(`Runtime finalization order is not unique for case ${caseId}`);
      }
      return terminal;
    });
}

function finalizationOrder(result: FinalReconciliationResult): number {
  const order = result.finalizationOrder;
  if (typeof order !== "number" || !Number.isInteger(order) || order < 1) throw new Error(`Invalid finalization order for ${result.caseId}`);
  return order;
}

function parsePrimary(caseId: string): { side: "BANK" | "LEDGER"; recordId: string } {
  const match = caseId.match(/^(BANK|LEDGER):(.+)$/);
  if (match === null) throw new Error(`Runtime result lacks a primary identity: ${caseId}`);
  return { side: match[1] as "BANK" | "LEDGER", recordId: match[2]! };
}

function containsPrimary(result: FinalReconciliationResult, primary: { side: "BANK" | "LEDGER"; recordId: string }): boolean {
  return primary.side === "BANK"
    ? result.bankRecordIds.includes(primary.recordId)
    : result.ledgerRecordIds.includes(primary.recordId);
}
