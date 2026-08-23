import type { BenchmarkCase, BenchmarkCaseCategory } from "./types.js";
import { BENCHMARK_AS_OF_DATE } from "./types.js";
import { cents, chooseEntity, createEvent, dateAfter, emptyTruth, makeBank, makeLedger, money, type GeneratorContext } from "./helpers.js";

type CaseBuilder = (context: GeneratorContext, caseId: string) => BenchmarkCase;

function oneToOne(
  context: GeneratorContext,
  caseId: string,
  category: BenchmarkCaseCategory,
  expectedOutcome: BenchmarkCase["expectedOutcome"],
  reasonCode: BenchmarkCase["reasonCode"],
  bankOverrides: Parameters<typeof makeBank>[2] = {},
  ledgerOverrides: Parameters<typeof makeLedger>[2] = {},
  notes?: string,
): BenchmarkCase {
  const event = createEvent(context);
  const bank = [makeBank(context, event, bankOverrides)];
  const ledger = [makeLedger(context, event, ledgerOverrides)];
  return { caseId, category, expectedOutcome, reasonCode, bankTransactions: bank, ledgerTransactions: ledger, truth: emptyTruth(event, bank, ledger), notes };
}

const exact: CaseBuilder = (context, caseId) => oneToOne(context, caseId, "EXACT", "RECONCILED", "EXACT_MATCH");

const normalizedReference: CaseBuilder = (context, caseId) => {
  const event = createEvent(context);
  const number = event.canonicalReference.replace("INV", "");
  const bank = [makeBank(context, event, { reference: `INV-${number}` })];
  const ledger = [makeLedger(context, event, { reference: event.canonicalReference })];
  return { caseId, category: "NORMALIZED_REFERENCE", expectedOutcome: "RECONCILED", reasonCode: "NORMALIZED_REFERENCE_MATCH", bankTransactions: bank, ledgerTransactions: ledger, truth: emptyTruth(event, bank, ledger) };
};

const strongContext: CaseBuilder = (context, caseId) => oneToOne(context, caseId, "STRONG_CONTEXT", "RECONCILED", "COUNTERPARTY_MATCH", { reference: null }, { reference: null });

const semantic: CaseBuilder = (context, caseId) => {
  const entity = chooseEntity(context);
  const event = createEvent(context, entity);
  const number = event.canonicalReference.replace("INV", "");
  const bank = [makeBank(context, event, {
    reference: `INV-${number}`,
    counterparty: entity.variants[0] ?? entity.canonicalName,
    description: `NEFT ${entity.variants[0] ?? entity.canonicalName}, ${event.canonicalReference}`,
  })];
  const ledger = [makeLedger(context, event, {
    reference: `Invoice ${number}`,
    counterparty: entity.canonicalName,
    description: `Receipt against invoice #${number}`,
  })];
  return { caseId, category: "SEMANTIC", expectedOutcome: "RECONCILED", reasonCode: "MULTI_EVIDENCE_MATCH", bankTransactions: bank, ledgerTransactions: ledger, truth: emptyTruth(event, bank, ledger), notes: "Relationship is grounded in the canonical synthetic entity and invoice event, not one exact text field." };
};

const timing: CaseBuilder = (context, caseId) => {
  const event = { ...createEvent(context), baseDate: "2026-09-28" };
  const expectedDate = dateAfter(event.baseDate, 4);
  const ledger = [makeLedger(context, event, { maturityDate: expectedDate, reference: null, counterparty: null, batchId: null })];
  return {
    caseId,
    category: "TIMING",
    expectedOutcome: "EXPLAINED_OUTSTANDING",
    reasonCode: "TIMING_DIFFERENCE",
    bankTransactions: [],
    ledgerTransactions: ledger,
    truth: { ...emptyTruth(event, [], ledger), timingEvidence: { asOfDate: BENCHMARK_AS_OF_DATE, accountingDate: event.baseDate, expectedDate } },
    notes: "The ledger record has explicit future maturity evidence and no bank counterpart in the current window.",
  };
};

function grouped(context: GeneratorContext, caseId: string, manyOn: "BANK" | "LEDGER"): BenchmarkCase {
  const event = createEvent(context);
  const targetCents = cents(event.amount);
  const first = Math.floor(targetCents * 0.4);
  const groupSize = Number.parseInt(caseId.slice(1), 10) % 2 === 0 ? 2 : 3;
  const parts = groupSize === 2
    ? [first, targetCents - first]
    : [first, Math.floor(targetCents * 0.35), targetCents - first - Math.floor(targetCents * 0.35)];
  const groupReference = `BATCH-${event.canonicalReference}`;
  if (manyOn === "LEDGER") {
    const bank = [makeBank(context, event, { reference: groupReference, batchId: groupReference })];
    const ledger = parts.map((part, index) => makeLedger(context, event, { amount: money(part), reference: `${groupReference}-${index + 1}`, batchId: groupReference }));
    return { caseId, category: "GROUPED_ONE_TO_MANY", expectedOutcome: "RECONCILED", reasonCode: "GROUPED_MATCH", bankTransactions: bank, ledgerTransactions: ledger, truth: emptyTruth(event, bank, ledger) };
  }
  const bank = parts.map((part, index) => makeBank(context, event, { amount: money(part), reference: `${groupReference}-${index + 1}`, batchId: groupReference }));
  const ledger = [makeLedger(context, event, { reference: groupReference, batchId: groupReference })];
  return { caseId, category: "GROUPED_MANY_TO_ONE", expectedOutcome: "RECONCILED", reasonCode: "GROUPED_MATCH", bankTransactions: bank, ledgerTransactions: ledger, truth: emptyTruth(event, bank, ledger) };
}

const groupedOneToMany: CaseBuilder = (context, caseId) => grouped(context, caseId, "LEDGER");
const groupedManyToOne: CaseBuilder = (context, caseId) => grouped(context, caseId, "BANK");

const discrepancy: CaseBuilder = (context, caseId) => {
  const event = createEvent(context);
  if (Number.parseInt(caseId.replace(/\D/g, ""), 10) % 2 === 0) {
    const bank = [makeBank(context, event, { amount: money(cents(event.amount) - 5_000) })];
    const ledger = [makeLedger(context, event)];
    return { caseId, category: "DISCREPANCY", expectedOutcome: "DISCREPANCY", reasonCode: "AMOUNT_DISCREPANCY", bankTransactions: bank, ledgerTransactions: ledger, truth: emptyTruth(event, bank, ledger), notes: "Related references and entities are present, but the amounts contradict without an explanatory record." };
  }
  const entity = chooseEntity(context);
  const conflictingEvent = createEvent(context, entity);
  const number = conflictingEvent.canonicalReference.replace("INV", "");
  const bank = [makeBank(context, conflictingEvent, {
    reference: `INV-${number}`,
    counterparty: entity.variants[0] ?? entity.canonicalName,
    description: `Payment for invoice ${number}`,
  })];
  const ledger = [makeLedger(context, conflictingEvent, {
    reference: `INV-${Number(number) + 1}`,
    counterparty: entity.canonicalName,
    description: `Receipt against invoice ${number}`,
  })];
  return { caseId, category: "DISCREPANCY", expectedOutcome: "DISCREPANCY", reasonCode: "CONFLICTING_RECORDS", bankTransactions: bank, ledgerTransactions: ledger, truth: emptyTruth(conflictingEvent, bank, ledger), notes: "The records retain compatible amount, currency, and direction evidence but conflict across their reference, counterparty, and descriptions." };
};

const ambiguous: CaseBuilder = (context, caseId) => {
  const event = createEvent(context);
  const bank = [makeBank(context, event, { reference: null, counterparty: "Ambiguous Synthetic Entity", description: null })];
  const ledger = [
    makeLedger(context, event, { reference: null, counterparty: "Ambiguous Synthetic Entity", description: null }),
    makeLedger(context, event, { reference: null, counterparty: "Ambiguous Synthetic Entity", description: null }),
  ];
  return { caseId, category: "AMBIGUOUS", expectedOutcome: "UNRESOLVED", reasonCode: "MULTIPLE_PLAUSIBLE_CANDIDATES", bankTransactions: bank, ledgerTransactions: ledger, truth: { ...emptyTruth(event, bank, []), plausibleLedgerRecordIds: ledger.map((record) => record.ledgerTxnId) }, notes: "Both ledger records expose identical observable evidence; no unique counterpart is truth-selected." };
};

const noCandidate: CaseBuilder = (context, caseId) => {
  const event = createEvent(context);
  const bank = [makeBank(context, event, { reference: "XYZ991", counterparty: null, description: null, batchId: null })];
  return { caseId, category: "NO_CANDIDATE", expectedOutcome: "UNRESOLVED", reasonCode: "NO_CANDIDATE", bankTransactions: bank, ledgerTransactions: [], truth: emptyTruth(event, bank, []), notes: "No compatible ledger representation is generated for this event." };
};

export const CASE_BUILDERS: Record<BenchmarkCaseCategory, CaseBuilder> = {
  EXACT: exact,
  NORMALIZED_REFERENCE: normalizedReference,
  STRONG_CONTEXT: strongContext,
  SEMANTIC: semantic,
  TIMING: timing,
  GROUPED_ONE_TO_MANY: groupedOneToMany,
  GROUPED_MANY_TO_ONE: groupedManyToOne,
  DISCREPANCY: discrepancy,
  AMBIGUOUS: ambiguous,
  NO_CANDIDATE: noCandidate,
};
