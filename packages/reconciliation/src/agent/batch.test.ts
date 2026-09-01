import { describe, expect, it } from "vitest";
import { parseReasoningBatchResponse } from "./batch.js";

const proposal = { proposedOutcome: "INSUFFICIENT_EVIDENCE", bankRecordIds: ["B1"], ledgerRecordIds: [], confidence: "LOW", evidence: [{ statement: "No safe relationship", source: "DETERMINISTIC", kind: "DETERMINISTIC", recordIds: ["B1"] }], conflictingEvidence: [], reason: "Insufficient evidence" } as const;

describe("reasoning batch envelope", () => {
  it("requires exactly one valid proposal per component", () => {
    expect(parseReasoningBatchResponse([{ componentId: "c1", proposal }], ["c1"])[0]?.componentId).toBe("c1");
    expect(() => parseReasoningBatchResponse([], ["c1"])).toThrow(/omitted/);
    expect(() => parseReasoningBatchResponse([{ componentId: "c1", proposal }, { componentId: "c1", proposal }], ["c1"])).toThrow(/duplicate/);
    expect(() => parseReasoningBatchResponse([{ componentId: "c2", proposal }], ["c1"])).toThrow(/unknown/);
  });
});
