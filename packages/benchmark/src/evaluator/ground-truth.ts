import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FinalOutcomeSchema, ReasonCodeSchema } from "@tally/contracts";
import { parseCsvRows } from "@tally/reconciliation";

import type { GroundTruthRow, RuntimePrimaryAlignment } from "./types.js";

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

const frozenBenchmarkPath = (fileName: string) => fileURLToPath(new URL(`../../../../data/benchmark/${fileName}`, import.meta.url));

export function loadFrozenGroundTruth(path = frozenBenchmarkPath("ground_truth.csv")): GroundTruthRow[] {
  return parseGroundTruthCsv(readFileSync(path, "utf8"));
}

export function loadFrozenPrimaryCaseAlignment(path = frozenBenchmarkPath("primary_case_alignment.json")): RuntimePrimaryAlignment[] {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value)) throw new Error("Frozen primary alignment must be an array");
  return validatePrimaryCaseAlignment(value);
}

export function validatePrimaryCaseAlignment(value: readonly unknown[]): RuntimePrimaryAlignment[] {
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new Error(`Invalid frozen primary alignment entry ${index}`);
    const candidate = entry as Record<string, unknown>;
    if ((candidate.side !== "BANK" && candidate.side !== "LEDGER") || typeof candidate.recordId !== "string" || candidate.recordId.trim() === "" || typeof candidate.caseId !== "string" || candidate.caseId.trim() === "") {
      throw new Error(`Invalid frozen primary alignment entry ${index}`);
    }
    const alignment = candidate as unknown as RuntimePrimaryAlignment;
    const key = `${alignment.side}:${alignment.recordId}`;
    if (seen.has(key)) throw new Error(`Duplicate frozen primary alignment ${key}`);
    seen.add(key);
    return alignment;
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
