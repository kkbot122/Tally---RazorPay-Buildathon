import type { ParsedBankTransaction, ParsedLedgerTransaction } from "@tally/reconciliation";

import { SYNTHETIC_ENTITIES, type SyntheticEntity } from "./entities.js";
import { createIdFactory } from "./ids.js";
import type { RandomSource } from "./random.js";
import type { TrueFinancialEvent } from "./types.js";

export type GeneratorContext = {
  random: RandomSource;
  ids: ReturnType<typeof createIdFactory>;
};

export function chooseEntity(context: GeneratorContext): SyntheticEntity {
  return context.random.pick(SYNTHETIC_ENTITIES);
}

export function createEvent(context: GeneratorContext, entity = chooseEntity(context)): TrueFinancialEvent {
  const amountCents = context.random.pick([500_000, 995_000, 1_000_000, 1_245_000, 2_500_000]);
  const invoiceNumber = context.random.integer(100, 999);
  const dayOffset = context.random.integer(0, 60);
  return {
    amount: money(amountCents),
    currency: "INR",
    direction: context.random.pick(["CREDIT", "DEBIT"] as const),
    counterpartyEntityId: entity.id,
    canonicalReference: `INV${invoiceNumber}`,
    baseDate: dateFromOffset(dayOffset),
  };
}

export function money(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function cents(amount: string): number {
  const [whole, fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function dateFromOffset(offset: number): string {
  const date = new Date(Date.UTC(2026, 7, 1 + offset));
  return date.toISOString().slice(0, 10);
}

export function dateAfter(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function makeBank(
  context: GeneratorContext,
  event: TrueFinancialEvent,
  overrides: Partial<ParsedBankTransaction> = {},
): ParsedBankTransaction {
  return {
    bankTxnId: context.ids.nextBankId(),
    bookingDate: event.baseDate,
    valueDate: event.baseDate,
    amount: event.amount,
    currency: event.currency,
    direction: event.direction,
    reference: event.canonicalReference,
    counterparty: "Synthetic Counterparty",
    description: "Synthetic bank transaction",
    batchId: "BATCH-001",
    ...overrides,
  };
}

export function makeLedger(
  context: GeneratorContext,
  event: TrueFinancialEvent,
  overrides: Partial<ParsedLedgerTransaction> = {},
): ParsedLedgerTransaction {
  return {
    ledgerTxnId: context.ids.nextLedgerId(),
    accountingDate: event.baseDate,
    maturityDate: event.baseDate,
    amount: event.amount,
    currency: event.currency,
    direction: event.direction,
    reference: event.canonicalReference,
    counterparty: "Synthetic Counterparty",
    description: "Synthetic ledger transaction",
    source: "Synthetic ERP",
    batchId: "BATCH-001",
    ...overrides,
  };
}

export function emptyTruth(event: TrueFinancialEvent, bank: ParsedBankTransaction[], ledger: ParsedLedgerTransaction[]) {
  return {
    bankRecordIds: bank.map((record) => record.bankTxnId),
    ledgerRecordIds: ledger.map((record) => record.ledgerTxnId),
    financialEvent: event,
  };
}
