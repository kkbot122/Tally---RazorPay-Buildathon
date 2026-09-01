export type ReasoningComponent = {
  componentId?: string;
  caseId: string;
  bankRecordIds: readonly string[];
  ledgerRecordIds: readonly string[];
  candidateCount: number;
  snapshot: Record<string, unknown>;
  candidateSnapshot: Record<string, unknown>;
};

/**
 * Keep every overlap-connected component in one work item. Components in
 * separate groups have no record (including candidate) in common and may run
 * concurrently on different workers.
 */
export function partitionReasoningComponents(
  components: readonly ReasoningComponent[],
  options: { maxItemsPerBatch?: number; maxCandidates?: number } = {},
): ReasoningComponent[][] {
  const maxItems = options.maxItemsPerBatch ?? 3;
  const maxCandidates = options.maxCandidates ?? 12;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 5) throw new Error("maxItemsPerBatch must be between 1 and 5");
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error("maxCandidates must be positive");
  const groups: ReasoningComponent[][] = [];
  for (const component of components) {
    // A large retrieval is still durable work. The candidate generator is
    // responsible for bounding the supplied shortlist; dropping the component
    // here would silently omit a financial case from the run.
    const ids = recordKeys(component);
    const matching = groups.filter((group) => group.some((other) => intersects(ids, recordKeys(other))));
    if (matching.length === 0) groups.push([component]);
    else {
      const group = matching[0]!;
      group.push(component);
      for (const duplicate of matching.slice(1)) group.push(...duplicate.splice(0));
    }
  }
  // Pack independent groups back into provider-sized work items. An overlap
  // group is never split: it must share one in-process reservation set.
  const batches: ReasoningComponent[][] = [];
  for (const group of groups) {
    const batch = batches.find((candidate) => candidate.length + group.length <= maxItems);
    if (batch === undefined) batches.push([...group]); else batch.push(...group);
  }
  return batches;
}

function recordKeys(component: ReasoningComponent): Set<string> {
  return new Set([...component.bankRecordIds.map((id) => `B:${id}`), ...component.ledgerRecordIds.map((id) => `L:${id}`)]);
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((id) => right.has(id));
}
