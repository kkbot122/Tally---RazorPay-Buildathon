import { AgentProposalSchema, type AgentProposal } from "./proposal-schema.js";
import type { ReasoningModelInput } from "./types.js";

export type ReasoningBatchItem = ReasoningModelInput & { componentId: string };
export type ReasoningBatchProposal = { componentId: string; proposal: AgentProposal };

export interface ReasoningBatchAdapter {
  generateBatchProposal(input: { items: readonly ReasoningBatchItem[]; signal?: AbortSignal; onProviderRequestStart?: () => void }): Promise<unknown>;
}

/** Validate the provider's component envelope before any component is finalized. */
export function parseReasoningBatchResponse(response: unknown, expectedComponentIds: readonly string[]): ReasoningBatchProposal[] {
  if (!Array.isArray(response)) throw new Error("Reasoning batch response must be an array.");
  const expected = new Set(expectedComponentIds);
  const seen = new Set<string>();
  const parsed: ReasoningBatchProposal[] = [];
  for (const item of response) {
    if (item === null || typeof item !== "object" || typeof (item as { componentId?: unknown }).componentId !== "string") {
      throw new Error("Reasoning batch response contains a malformed component.");
    }
    const componentId = (item as { componentId: string }).componentId;
    if (!expected.has(componentId)) throw new Error(`Reasoning batch returned an unknown component: ${componentId}`);
    if (seen.has(componentId)) throw new Error(`Reasoning batch returned duplicate component: ${componentId}`);
    const proposal = AgentProposalSchema.safeParse((item as { proposal?: unknown }).proposal);
    if (!proposal.success) throw new Error(`Reasoning batch proposal is invalid for component: ${componentId}`);
    seen.add(componentId);
    parsed.push({ componentId, proposal: proposal.data });
  }
  if (seen.size !== expected.size) throw new Error("Reasoning batch response omitted one or more components.");
  return parsed;
}

export function assertBatchSize(items: readonly unknown[], maximum = 3): void {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 5) throw new Error("maximum batch size must be between 1 and 5");
  if (items.length > maximum) throw new Error(`reasoning batch exceeds the maximum of ${maximum} components`);
}
