import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createRecordLookup,
  emptyUsedRecordState,
  generateCandidates,
  runDeterministicReconciliation,
  parseBankCsv,
  parseLedgerCsv,
  verifyMatchProposal,
} from "@tally/reconciliation";
import { describe, expect, it } from "vitest";

import { buildBenchmarkFixture, serializePrimaryCaseAlignment } from "./index.js";
import { BENCHMARK_AS_OF_DATE } from "../generator/index.js";
import { validateBenchmarkFixture } from "./validate-benchmark.js";

const artifactDirectory = resolve(process.cwd(), "../../data/benchmark");

describe("frozen 100-case benchmark", () => {
  it("matches the frozen artifacts byte-for-byte", () => {
    const fixture = buildBenchmarkFixture();
    validateBenchmarkFixture(fixture);
    expect(fixture.bankCsv).toBe(readFileSync(resolve(artifactDirectory, "bank_transactions.csv"), "utf8"));
    expect(fixture.ledgerCsv).toBe(readFileSync(resolve(artifactDirectory, "ledger_transactions.csv"), "utf8"));
    expect(fixture.groundTruthCsv).toBe(readFileSync(resolve(artifactDirectory, "ground_truth.csv"), "utf8"));
    expect(serializePrimaryCaseAlignment(fixture.cases)).toBe(readFileSync(resolve(artifactDirectory, "primary_case_alignment.json"), "utf8"));
  });

  it("has truth-free runtime inputs, intact truth relationships, and exact group coverage", () => {
    const fixture = buildBenchmarkFixture();
    const bank = parseBankCsv(fixture.bankCsv);
    const ledger = parseLedgerCsv(fixture.ledgerCsv);
    expect(bank).toHaveLength(fixture.cases.reduce((count, benchmarkCase) => count + benchmarkCase.bankTransactions.length, 0));
    expect(ledger).toHaveLength(fixture.cases.reduce((count, benchmarkCase) => count + benchmarkCase.ledgerTransactions.length, 0));
    expect(fixture.cases).toHaveLength(100);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_ONE_TO_MANY")).toHaveLength(8);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_MANY_TO_ONE")).toHaveLength(7);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_ONE_TO_MANY").every((benchmarkCase) => [2, 3].includes(benchmarkCase.ledgerTransactions.length))).toBe(true);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_MANY_TO_ONE").every((benchmarkCase) => [2, 3].includes(benchmarkCase.bankTransactions.length))).toBe(true);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "TIMING").every((benchmarkCase) => benchmarkCase.ledgerTransactions[0]!.maturityDate! > BENCHMARK_AS_OF_DATE)).toBe(true);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.reasonCode === "AMOUNT_DISCREPANCY")).toHaveLength(5);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.reasonCode === "CONFLICTING_RECORDS")).toHaveLength(3);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.reasonCode === "DUPLICATE_USAGE")).toHaveLength(2);
    expect(bank[0]).not.toHaveProperty("caseId");
    expect(ledger[0]).not.toHaveProperty("expectedOutcome");
  });

  it("produces exactly 55 safe deterministic reconciliations with no truth access", () => {
    const fixture = buildBenchmarkFixture();
    const records = createRecordLookup(
      parseBankCsv(fixture.bankCsv),
      parseLedgerCsv(fixture.ledgerCsv),
    );
    const result = runDeterministicReconciliation({ records });
    const automatic = result.decisions.filter((decision) => decision.status === "AUTO_RECONCILED");
    expect(automatic).toHaveLength(55);
    expect(new Set(automatic.map((decision) => decision.rule))).toEqual(new Set([
      "R1_EXACT_REFERENCE", "R2_NORMALIZED_REFERENCE", "R3_STRONG_CONTEXT", "R4_ONE_TO_MANY_GROUPED", "R5_MANY_TO_ONE_GROUPED",
    ]));
    expect(automatic.every((decision) => fixture.cases.some((benchmarkCase) =>
      benchmarkCase.expectedOutcome === "RECONCILED"
      && decision.bankRecordIds.every((id) => benchmarkCase.truth.bankRecordIds.includes(id))
      && decision.ledgerRecordIds.every((id) => benchmarkCase.truth.ledgerRecordIds.includes(id)),
    ))).toBe(true);
  });

  it("keeps semantic and discrepancy counterparts retrievable and no-candidate cases empty globally", () => {
    const fixture = buildBenchmarkFixture();
    const records = createRecordLookup(parseBankCsv(fixture.bankCsv), parseLedgerCsv(fixture.ledgerCsv));
    const deterministic = runDeterministicReconciliation({ records });
    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "SEMANTIC" || candidate.reasonCode === "AMOUNT_DISCREPANCY" || candidate.reasonCode === "CONFLICTING_RECORDS")) {
      const bankId = benchmarkCase.bankTransactions[0]!.bankTxnId;
      const candidates = generateCandidates({
        primary: { side: "BANK", recordId: bankId },
        records,
        usedRecords: deterministic.usedRecords,
      });
      expect(candidates.candidates.map((candidate) => candidate.recordId)).toEqual(expect.arrayContaining(benchmarkCase.truth.ledgerRecordIds));
    }
    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "NO_CANDIDATE")) {
      const candidates = generateCandidates({ primary: { side: "BANK", recordId: benchmarkCase.bankTransactions[0]!.bankTxnId }, records, usedRecords: deterministic.usedRecords });
      expect(candidates.candidates).toHaveLength(0);
    }
    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "AMBIGUOUS")) {
      const candidates = generateCandidates({ primary: { side: "BANK", recordId: benchmarkCase.bankTransactions[0]!.bankTxnId }, records, usedRecords: deterministic.usedRecords });
      expect(candidates.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("models duplicate usage as a real used-record conflict", () => {
    const fixture = buildBenchmarkFixture();
    const duplicate = fixture.cases.find((benchmarkCase) => benchmarkCase.reasonCode === "DUPLICATE_USAGE")!;
    const records = createRecordLookup(parseBankCsv(fixture.bankCsv), parseLedgerCsv(fixture.ledgerCsv));
    const firstBankId = duplicate.bankTransactions[0]!.bankTxnId;
    const secondBankId = duplicate.bankTransactions[1]!.bankTxnId;
    const ledgerId = duplicate.truth.ledgerRecordIds[0]!;
    const candidateSet = generateCandidates({
      primary: { side: "BANK", recordId: firstBankId },
      records,
      usedRecords: emptyUsedRecordState(),
    });
    expect(candidateSet.candidates.map((candidate) => candidate.recordId)).toContain(ledgerId);
    const proposal = (bankRecordId: string) => ({
      proposedOutcome: "MATCH" as const,
      bankRecordIds: [bankRecordId],
      ledgerRecordIds: [ledgerId],
      confidence: "HIGH" as const,
      evidence: [{ statement: "The records support the same payment.", source: "CROSS_RECORD" as const, kind: "SEMANTIC" as const, recordIds: [bankRecordId, ledgerId] }],
      conflictingEvidence: [],
      reason: "The records support the same payment.",
    });
    expect(verifyMatchProposal({
      proposal: proposal(firstBankId),
      primary: { side: "BANK", recordId: firstBankId },
      candidateSet,
      records,
      usedRecords: emptyUsedRecordState(),
    })).toMatchObject({ status: "VERIFIED" });
    const used = { bankRecordIds: new Set<string>([firstBankId]), ledgerRecordIds: new Set<string>([ledgerId]) };
    const conflict = verifyMatchProposal({
      proposal: proposal(secondBankId),
      primary: { side: "BANK", recordId: secondBankId },
      candidateSet: generateCandidates({ primary: { side: "BANK", recordId: secondBankId }, records, usedRecords: emptyUsedRecordState() }),
      records,
      usedRecords: used,
    });
    expect(conflict.status).toBe("REJECTED");
    expect(conflict.status === "REJECTED" ? conflict.failures.map((failure) => failure.code) : []).toContain("RECORD_ALREADY_USED");
  });
});
