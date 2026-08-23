import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyExactReferenceRule,
  applyNormalizedReferenceRule,
  applyStrongContextRule,
  applyOneToManyGroupedRule,
  applyManyToOneGroupedRule,
  runDeterministicReconciliation,
  generateCandidates,
  buildReconciliationReasoningInput,
  verifyMatchProposal,
  checkPairCompatibility,
  createRecordLookup,
  emptyUsedRecordState,
  normalizeCounterpartyForExactComparison,
  normalizeReference,
  parseBankCsv,
  parseLedgerCsv,
} from "@tally/reconciliation";
import { describe, expect, it } from "vitest";

import { buildDevFixture, DEV_FIXTURE_COMPOSITION } from "./index.js";
import { BANK_HEADERS, DEV_FIXTURE_AS_OF_DATE, GROUND_TRUTH_HEADERS, LEDGER_HEADERS } from "./types.js";

const fixtureDirectory = resolve(process.cwd(), "../../data/dev");

describe("20-case development fixture", () => {
  it("has the exact requested composition and all four outcomes", () => {
    const fixture = buildDevFixture();
    const counts = new Map<string, number>();
    for (const benchmarkCase of fixture.cases) counts.set(benchmarkCase.category, (counts.get(benchmarkCase.category) ?? 0) + 1);

    expect(counts).toEqual(new Map([
      ["EXACT", 3], ["NORMALIZED_REFERENCE", 2], ["STRONG_CONTEXT", 2], ["SEMANTIC", 2],
      ["TIMING", 2], ["GROUPED_ONE_TO_MANY", 2], ["GROUPED_MANY_TO_ONE", 2], ["DISCREPANCY", 2],
      ["AMBIGUOUS", 2], ["NO_CANDIDATE", 1],
    ]));
    expect(new Set(fixture.cases.map((benchmarkCase) => benchmarkCase.expectedOutcome))).toEqual(
      new Set(["RECONCILED", "EXPLAINED_OUTSTANDING", "DISCREPANCY", "UNRESOLVED"]),
    );
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_ONE_TO_MANY").map((benchmarkCase) => benchmarkCase.ledgerTransactions.length)).toEqual([2, 3]);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "GROUPED_MANY_TO_ONE").map((benchmarkCase) => benchmarkCase.bankTransactions.length)).toEqual([2, 3]);
    expect(DEV_FIXTURE_COMPOSITION).toHaveLength(20);
    expect(fixture.asOfDate).toBe(DEV_FIXTURE_AS_OF_DATE);
    expect(fixture.cases.filter((benchmarkCase) => benchmarkCase.category === "TIMING").every((benchmarkCase) => benchmarkCase.truth.timingEvidence?.expectedDate! > fixture.asOfDate)).toBe(true);
  });

  it("round-trips generated CSV through T006 and uses exact headers", () => {
    const fixture = buildDevFixture();
    const bank = parseBankCsv(fixture.bankCsv);
    const ledger = parseLedgerCsv(fixture.ledgerCsv);

    expect(fixture.bankCsv.split("\n")[0]).toBe(BANK_HEADERS.join(","));
    expect(fixture.ledgerCsv.split("\n")[0]).toBe(LEDGER_HEADERS.join(","));
    expect(fixture.groundTruthCsv.split("\n")[0]).toBe(GROUND_TRUTH_HEADERS.join(","));
    expect(bank).toHaveLength(fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions).length);
    expect(ledger).toHaveLength(fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions).length);
    expect(bank.some((record) => record.description?.includes(","))).toBe(true);
  });

  it("is deterministic and fixture files do not drift from the generator", () => {
    const first = buildDevFixture();
    const second = buildDevFixture();
    expect(second).toEqual(first);
    expect(first.bankCsv).toBe(readFileSync(resolve(fixtureDirectory, "bank_transactions.csv"), "utf8"));
    expect(first.ledgerCsv).toBe(readFileSync(resolve(fixtureDirectory, "ledger_transactions.csv"), "utf8"));
    expect(first.groundTruthCsv).toBe(readFileSync(resolve(fixtureDirectory, "ground_truth.csv"), "utf8"));
  });

  it("shuffles bank and ledger rows independently and keeps IDs opaque", () => {
    const fixture = buildDevFixture();
    const caseBankOrder = fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions.map((record) => record.bankTxnId));
    const caseLedgerOrder = fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions.map((record) => record.ledgerTxnId));
    const generatedBankOrder = parseBankCsv(fixture.bankCsv).map((record) => record.bankTxnId);
    const generatedLedgerOrder = parseLedgerCsv(fixture.ledgerCsv).map((record) => record.ledgerTxnId);

    expect(generatedBankOrder).not.toEqual(caseBankOrder);
    expect(generatedLedgerOrder).not.toEqual(caseLedgerOrder);
    expect(generatedBankOrder[0]).not.toBe(caseBankOrder[0]);
    expect(fixture.bankCsv).not.toContain("case_id");
    expect(fixture.ledgerCsv).not.toContain("expected_outcome");

    const bankNumbers = caseBankOrder.map((id) => Number(id.slice(1)));
    const ledgerNumbers = caseLedgerOrder.map((id) => Number(id.slice(1)));
    expect(bankNumbers).not.toEqual(ledgerNumbers);
    expect(new Set(bankNumbers.map((value, index) => value - (ledgerNumbers[index] ?? 0))).size).toBeGreaterThan(1);
  });

  it("preserves the normalization boundary across benchmark categories", () => {
    const fixture = buildDevFixture();
    const normalizedReference = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "NORMALIZED_REFERENCE")!;
    const strongContext = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "STRONG_CONTEXT")!;
    const semantic = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "SEMANTIC")!;

    expect(normalizeReference(normalizedReference.bankTransactions[0]!.reference)).toBe(
      normalizeReference(normalizedReference.ledgerTransactions[0]!.reference),
    );
    expect(normalizeCounterpartyForExactComparison(strongContext.bankTransactions[0]!.counterparty)).toBe(
      normalizeCounterpartyForExactComparison(strongContext.ledgerTransactions[0]!.counterparty),
    );
    expect(normalizeReference(semantic.bankTransactions[0]!.reference)).not.toBe(
      normalizeReference(semantic.ledgerTransactions[0]!.reference),
    );
    expect(normalizeCounterpartyForExactComparison(semantic.bankTransactions[0]!.counterparty)).not.toBe(
      normalizeCounterpartyForExactComparison(semantic.ledgerTransactions[0]!.counterparty),
    );
  });

  it("keeps hard compatibility separate from future matching decisions", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const unused = emptyUsedRecordState();
    const discrepancy = fixture.cases.find((benchmarkCase) => benchmarkCase.reasonCode === "AMOUNT_DISCREPANCY")!;
    const conflicting = fixture.cases.find((benchmarkCase) => benchmarkCase.reasonCode === "CONFLICTING_RECORDS")!;
    const semantic = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "SEMANTIC")!;
    const strongContext = fixture.cases.find((benchmarkCase) => benchmarkCase.category === "STRONG_CONTEXT")!;

    expect(checkPairCompatibility({
      bankRecordId: discrepancy.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: discrepancy.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
    expect(conflicting.bankTransactions[0]!.direction).toBe(conflicting.ledgerTransactions[0]!.direction);
    expect(conflicting.bankTransactions[0]!.amount).toBe(conflicting.ledgerTransactions[0]!.amount);
    expect(checkPairCompatibility({
      bankRecordId: conflicting.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: conflicting.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
    expect(checkPairCompatibility({
      bankRecordId: semantic.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: semantic.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
    expect(strongContext.bankTransactions[0]!.reference).toBeNull();
    expect(checkPairCompatibility({
      bankRecordId: strongContext.bankTransactions[0]!.bankTxnId,
      ledgerRecordId: strongContext.ledgerTransactions[0]!.ledgerTxnId,
      records,
      usedRecords: unused,
    }).compatible).toBe(true);
  });

  it("applies R1 across the full fixture without collapsing later categories", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (benchmarkCase: (typeof fixture.cases)[number]) => applyExactReferenceRule({
      bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
      records,
      usedRecords,
    });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "EXACT")) {
      expect(apply(benchmarkCase)).toEqual({
        status: "MATCH",
        bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
        ledgerRecordId: benchmarkCase.truth.ledgerRecordIds[0],
        reasonCode: "EXACT_MATCH",
      });
    }
    for (const category of ["NORMALIZED_REFERENCE", "STRONG_CONTEXT", "SEMANTIC", "DISCREPANCY", "AMBIGUOUS"] as const) {
      for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === category)) {
        expect(apply(benchmarkCase)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R2 across the full fixture with explicit rule ownership", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (bankRecordId: string) => applyNormalizedReferenceRule({ bankRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "NORMALIZED_REFERENCE")) {
      expect(apply(benchmarkCase.bankTransactions[0]!.bankTxnId)).toEqual({
        status: "MATCH",
        bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
        ledgerRecordId: benchmarkCase.truth.ledgerRecordIds[0],
        reasonCode: "NORMALIZED_REFERENCE_MATCH",
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "NORMALIZED_REFERENCE")) {
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(apply(bankRecord.bankTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R3 across the full fixture with explicit rule ownership", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (bankRecordId: string) => applyStrongContextRule({ bankRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "STRONG_CONTEXT")) {
      expect(apply(benchmarkCase.bankTransactions[0]!.bankTxnId)).toEqual({
        status: "MATCH",
        bankRecordId: benchmarkCase.bankTransactions[0]!.bankTxnId,
        ledgerRecordId: benchmarkCase.truth.ledgerRecordIds[0],
        reasonCode: "COUNTERPARTY_MATCH",
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "AMBIGUOUS")) {
      expect(apply(benchmarkCase.bankTransactions[0]!.bankTxnId)).toEqual({
        status: "AMBIGUOUS",
        candidateLedgerRecordIds: [...benchmarkCase.ledgerTransactions.map((record) => record.ledgerTxnId)].sort(),
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "STRONG_CONTEXT" && candidate.category !== "AMBIGUOUS")) {
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(apply(bankRecord.bankTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R4 only to grouped one-bank-to-many-ledger cases", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (bankRecordId: string) => applyOneToManyGroupedRule({ bankRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "GROUPED_ONE_TO_MANY")) {
      const bankRecordId = benchmarkCase.bankTransactions[0]!.bankTxnId;
      expect(applyExactReferenceRule({ bankRecordId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      expect(applyNormalizedReferenceRule({ bankRecordId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      expect(applyStrongContextRule({ bankRecordId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      expect(apply(bankRecordId)).toEqual({
        status: "MATCH",
        bankRecordId,
        ledgerRecordIds: [...benchmarkCase.truth.ledgerRecordIds].sort(),
        reasonCode: "GROUPED_MATCH",
      });
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "GROUPED_ONE_TO_MANY")) {
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(apply(bankRecord.bankTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("applies R5 only to grouped many-bank-to-one-ledger cases", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const usedRecords = emptyUsedRecordState();
    const apply = (ledgerRecordId: string) => applyManyToOneGroupedRule({ ledgerRecordId, records, usedRecords });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "GROUPED_MANY_TO_ONE")) {
      const ledgerRecordId = benchmarkCase.ledgerTransactions[0]!.ledgerTxnId;
      expect(apply(ledgerRecordId)).toEqual({
        status: "MATCH",
        bankRecordIds: [...benchmarkCase.truth.bankRecordIds].sort(),
        ledgerRecordId,
        reasonCode: "GROUPED_MATCH",
      });
      for (const bankRecord of benchmarkCase.bankTransactions) {
        expect(applyExactReferenceRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
        expect(applyNormalizedReferenceRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
        expect(applyStrongContextRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
        expect(applyOneToManyGroupedRule({ bankRecordId: bankRecord.bankTxnId, records, usedRecords })).toEqual({ status: "NO_MATCH" });
      }
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category !== "GROUPED_MANY_TO_ONE")) {
      for (const ledgerRecord of benchmarkCase.ledgerTransactions) {
        expect(apply(ledgerRecord.ledgerTxnId)).toEqual({ status: "NO_MATCH" });
      }
    }
  });

  it("runs the full deterministic ladder and auto-reconciles only the 11 safe cases", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const result = runDeterministicReconciliation({ records });
    const auto = result.decisions.filter((decision) => decision.status === "AUTO_RECONCILED");

    expect(auto).toHaveLength(11);
    expect(new Map(auto.map((decision) => [decision.rule, (auto.filter((candidate) => candidate.rule === decision.rule).length)]) )).toEqual(new Map([
      ["R1_EXACT_REFERENCE", 3], ["R2_NORMALIZED_REFERENCE", 2], ["R3_STRONG_CONTEXT", 2],
      ["R4_ONE_TO_MANY_GROUPED", 2], ["R5_MANY_TO_ONE_GROUPED", 2],
    ]));
    expect(new Map(auto.map((decision) => [decision.reasonCode, auto.filter((candidate) => candidate.reasonCode === decision.reasonCode).length]))).toEqual(new Map([
      ["EXACT_MATCH", 3], ["NORMALIZED_REFERENCE_MATCH", 2], ["COUNTERPARTY_MATCH", 2], ["GROUPED_MATCH", 4],
    ]));

    const truthCases = fixture.cases.filter((benchmarkCase) => ["EXACT", "NORMALIZED_REFERENCE", "STRONG_CONTEXT", "GROUPED_ONE_TO_MANY", "GROUPED_MANY_TO_ONE"].includes(benchmarkCase.category));
    for (const decision of auto) {
      expect(truthCases.some((benchmarkCase) =>
        [...decision.bankRecordIds].sort().join("|") === [...benchmarkCase.truth.bankRecordIds].sort().join("|")
        && [...decision.ledgerRecordIds].sort().join("|") === [...benchmarkCase.truth.ledgerRecordIds].sort().join("|")
        && decision.reasonCode === benchmarkCase.reasonCode,
      )).toBe(true);
    }

    const usedBanks = new Set(auto.flatMap((decision) => decision.bankRecordIds));
    const usedLedgers = new Set(auto.flatMap((decision) => decision.ledgerRecordIds));
    expect(usedBanks.size).toBe(auto.flatMap((decision) => decision.bankRecordIds).length);
    expect(usedLedgers.size).toBe(auto.flatMap((decision) => decision.ledgerRecordIds).length);
    expect(result.usedRecords.bankRecordIds).toEqual(usedBanks);
    expect(result.usedRecords.ledgerRecordIds).toEqual(usedLedgers);
    expect(result.decisions.filter((decision) => decision.status === "NEEDS_REASONING").length).toBeGreaterThan(0);
  });

  it("generates bounded reasoning candidates with full-fixture recall", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const deterministic = runDeterministicReconciliation({ records });
    const candidateSetFor = (benchmarkCase: (typeof fixture.cases)[number], side: "BANK" | "LEDGER" = "BANK", requiredCandidateIds?: string[]) => generateCandidates({
      primary: side === "BANK"
        ? { side, recordId: benchmarkCase.bankTransactions[0]!.bankTxnId }
        : { side, recordId: benchmarkCase.ledgerTransactions[0]!.ledgerTxnId },
      records,
      usedRecords: deterministic.usedRecords,
      requiredCandidateIds,
    });

    for (const category of ["SEMANTIC", "DISCREPANCY"] as const) {
      for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === category)) {
        const result = candidateSetFor(benchmarkCase);
        expect(result.candidates.map((candidate) => candidate.recordId)).toContain(benchmarkCase.truth.ledgerRecordIds[0]);
      }
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "AMBIGUOUS")) {
      const decision = deterministic.decisions.find((candidate) =>
        candidate.status === "NEEDS_REASONING"
        && candidate.bankRecordIds.includes(benchmarkCase.bankTransactions[0]!.bankTxnId),
      );
      expect(decision?.status).toBe("NEEDS_REASONING");
      const result = candidateSetFor(benchmarkCase, "BANK", decision?.status === "NEEDS_REASONING" ? decision.ledgerRecordIds : undefined);
      expect(result.candidates.map((candidate) => candidate.recordId)).toEqual(
        expect.arrayContaining(benchmarkCase.truth.plausibleLedgerRecordIds ?? benchmarkCase.truth.ledgerRecordIds),
      );
    }

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "TIMING")) {
      expect(candidateSetFor(benchmarkCase, "LEDGER").candidates).toEqual([]);
    }
    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "NO_CANDIDATE")) {
      expect(candidateSetFor(benchmarkCase).candidates).toEqual([]);
    }
  });

  it("builds T019 prompts from runtime reasoning context across difficult fixture cases", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const deterministic = runDeterministicReconciliation({ records });
    const promptFor = (benchmarkCase: (typeof fixture.cases)[number], side: "BANK" | "LEDGER", requiredCandidateIds?: string[]) => {
      const primary = side === "BANK"
        ? { side: "BANK" as const, record: benchmarkCase.bankTransactions[0]! }
        : { side: "LEDGER" as const, record: benchmarkCase.ledgerTransactions[0]! };
      const candidateSet = generateCandidates({
        primary: side === "BANK"
          ? { side, recordId: benchmarkCase.bankTransactions[0]!.bankTxnId }
          : { side, recordId: benchmarkCase.ledgerTransactions[0]!.ledgerTxnId },
        records,
        usedRecords: deterministic.usedRecords,
        requiredCandidateIds,
      });
      return buildReconciliationReasoningInput({
        primary,
        candidateSet,
        records,
        runContext: { asOfDate: fixture.asOfDate },
      }).input;
    };

    const semantic = fixture.cases.find((candidate) => candidate.category === "SEMANTIC")!;
    const semanticPrompt = promptFor(semantic, "BANK");
    expect(semanticPrompt).toContain(semantic.truth.ledgerRecordIds[0]!);
    expect(semanticPrompt).toContain(semantic.bankTransactions[0]!.description!);
    expect(semanticPrompt).toContain('"normalizedReferenceEqual":false');
    expect(semanticPrompt).not.toContain('"category":"SEMANTIC"');

    const discrepancy = fixture.cases.find((candidate) => candidate.reasonCode === "AMOUNT_DISCREPANCY")!;
    const discrepancyPrompt = promptFor(discrepancy, "BANK");
    expect(discrepancyPrompt).toContain(discrepancy.truth.ledgerRecordIds[0]!);
    expect(discrepancyPrompt).toContain('"exactAmount":false');
    expect(discrepancyPrompt).toContain("amountDeltaPaise");
    expect(discrepancyPrompt).not.toContain('"expectedOutcome":"DISCREPANCY"');

    const ambiguous = fixture.cases.find((candidate) => candidate.category === "AMBIGUOUS")!;
    const ambiguousDecision = deterministic.decisions.find((decision) =>
      decision.status === "NEEDS_REASONING" && decision.bankRecordIds.includes(ambiguous.bankTransactions[0]!.bankTxnId),
    );
    const ambiguousPrompt = promptFor(ambiguous, "BANK", ambiguousDecision?.status === "NEEDS_REASONING" ? ambiguousDecision.ledgerRecordIds : undefined);
    for (const ledgerRecord of ambiguous.ledgerTransactions) expect(ambiguousPrompt).toContain(ledgerRecord.ledgerTxnId);
    expect(ambiguousPrompt).toContain("Do not choose the first or lowest-ID candidate");

    const timing = fixture.cases.find((candidate) => candidate.category === "TIMING")!;
    const timingPrompt = promptFor(timing, "LEDGER");
    expect(timingPrompt).toContain(timing.ledgerTransactions[0]!.maturityDate!);
    expect(timingPrompt).toContain(fixture.asOfDate);
    expect(timingPrompt).toContain("For TIMING_DIFFERENCE, cite supplied timing evidence");
    expect(timingPrompt).not.toContain('"expectedOutcome":"EXPLAINED_OUTSTANDING"');
  });

  it("applies T020 safety checks to semantic, discrepancy, and conflicting fixture proposals", () => {
    const fixture = buildDevFixture();
    const records = createRecordLookup(
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.bankTransactions),
      fixture.cases.flatMap((benchmarkCase) => benchmarkCase.ledgerTransactions),
    );
    const deterministic = runDeterministicReconciliation({ records });
    const evidenceFor = (bankRecordId: string, ledgerRecordIds: string[]) => [{
      statement: "The supplied records contain related transaction evidence.",
      source: "CROSS_RECORD" as const,
      recordIds: [bankRecordId, ...ledgerRecordIds],
    }];
    const candidateSetFor = (benchmarkCase: (typeof fixture.cases)[number]) => generateCandidates({
      primary: { side: "BANK", recordId: benchmarkCase.bankTransactions[0]!.bankTxnId },
      records,
      usedRecords: deterministic.usedRecords,
    });

    for (const benchmarkCase of fixture.cases.filter((candidate) => candidate.category === "SEMANTIC")) {
      const bankRecordId = benchmarkCase.bankTransactions[0]!.bankTxnId;
      const ledgerRecordIds = [benchmarkCase.truth.ledgerRecordIds[0]!];
      const result = verifyMatchProposal({
        proposal: {
          proposedOutcome: "MATCH",
          bankRecordIds: [bankRecordId],
          ledgerRecordIds,
          confidence: "HIGH",
          evidence: evidenceFor(bankRecordId, ledgerRecordIds),
          conflictingEvidence: [],
          reason: "The supplied semantic evidence supports the relationship.",
        },
        primary: { side: "BANK", recordId: bankRecordId },
        candidateSet: candidateSetFor(benchmarkCase),
        records,
        usedRecords: deterministic.usedRecords,
      });
      expect(result.status).toBe("VERIFIED");
    }

    const amountDiscrepancy = fixture.cases.find((candidate) => candidate.reasonCode === "AMOUNT_DISCREPANCY")!;
    const discrepancyBankId = amountDiscrepancy.bankTransactions[0]!.bankTxnId;
    const discrepancyLedgerId = amountDiscrepancy.truth.ledgerRecordIds[0]!;
    const discrepancyResult = verifyMatchProposal({
      proposal: {
        proposedOutcome: "MATCH",
        bankRecordIds: [discrepancyBankId],
        ledgerRecordIds: [discrepancyLedgerId],
        confidence: "HIGH",
        evidence: evidenceFor(discrepancyBankId, [discrepancyLedgerId]),
        conflictingEvidence: [],
        reason: "A persuasive but incorrect match proposal.",
      },
      primary: { side: "BANK", recordId: discrepancyBankId },
      candidateSet: candidateSetFor(amountDiscrepancy),
      records,
      usedRecords: deterministic.usedRecords,
    });
    expect(discrepancyResult.status).toBe("REJECTED");
    expect(discrepancyResult.status === "REJECTED" && discrepancyResult.failures.map((failure) => failure.code)).toContain("AMOUNT_MISMATCH");

    const conflicting = fixture.cases.find((candidate) => candidate.reasonCode === "CONFLICTING_RECORDS")!;
    const conflictingBankId = conflicting.bankTransactions[0]!.bankTxnId;
    const conflictingLedgerId = conflicting.truth.ledgerRecordIds[0]!;
    const conflictingResult = verifyMatchProposal({
      proposal: {
        proposedOutcome: "MATCH",
        bankRecordIds: [conflictingBankId],
        ledgerRecordIds: [conflictingLedgerId],
        confidence: "HIGH",
        evidence: evidenceFor(conflictingBankId, [conflictingLedgerId]),
        conflictingEvidence: [{ statement: "The supplied records contain contradictory reference evidence.", source: "CROSS_RECORD", recordIds: [conflictingBankId, conflictingLedgerId] }],
        reason: "The records are related but contradictory.",
      },
      primary: { side: "BANK", recordId: conflictingBankId },
      candidateSet: candidateSetFor(conflicting),
      records,
      usedRecords: deterministic.usedRecords,
    });
    expect(conflictingResult.status).toBe("REJECTED");
    expect(conflictingResult.status === "REJECTED" && conflictingResult.failures.map((failure) => failure.code)).toContain("CONFLICTING_EVIDENCE");
  });
});
