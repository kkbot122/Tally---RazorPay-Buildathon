import { FinalOutcomeSchema, ReasonCodeSchema } from "@tally/contracts";
import { parseCsvRows } from "@tally/reconciliation";

import type { GroundTruthRow } from "./types.js";

export const GROUND_TRUTH_HEADERS = [
  "case_id",
  "bank_record_ids",
  "ledger_record_ids",
  "expected_outcome",
  "reason_code",
  "notes",
] as const;

export function parseGroundTruthCsv(csvText: string): GroundTruthRow[] {
  const rows = parseCsvRows(csvText, { source: "benchmark-ground-truth", headers: GROUND_TRUTH_HEADERS });

  const seenCaseIds = new Set<string>();
  return rows.map((row) => {
    const caseId = required(row.record.case_id, `ground-truth row ${row.info.lines} case_id`);
    if (seenCaseIds.has(caseId)) throw new Error(`Duplicate ground-truth case ID: ${caseId}`);
    seenCaseIds.add(caseId);
    const expectedOutcome = row.record.expected_outcome?.trim();
    const reasonCode = row.record.reason_code?.trim();
    if (!FinalOutcomeSchema.safeParse(expectedOutcome).success) throw new Error(`Invalid expected outcome for ${caseId}: ${expectedOutcome}`);
    if (!ReasonCodeSchema.safeParse(reasonCode).success) throw new Error(`Invalid reason code for ${caseId}: ${reasonCode}`);
    return {
      caseId,
      bankRecordIds: pipeIds(row.record.bank_record_ids, caseId, "bank_record_ids"),
      ledgerRecordIds: pipeIds(row.record.ledger_record_ids, caseId, "ledger_record_ids"),
      expectedOutcome: expectedOutcome as GroundTruthRow["expectedOutcome"],
      reasonCode: reasonCode as GroundTruthRow["reasonCode"],
      notes: row.record.notes?.trim() ?? "",
    };
  });
}

function pipeIds(value: string | undefined, caseId: string, field: string): string[] {
  if (value === undefined || value.trim() === "") return [];
  const ids = value.split("|").map((id) => id.trim());
  if (ids.some((id) => id.length === 0)) throw new Error(`Malformed ${field} list for ${caseId}: empty ID segment`);
  return ids;
}

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) throw new Error(`${field} must be non-empty`);
  return normalized;
}
