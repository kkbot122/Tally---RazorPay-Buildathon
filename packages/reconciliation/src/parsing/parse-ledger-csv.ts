import { CsvValidationError, type CsvValidationIssue } from "./csv-errors.js";
import { parseCsvRows } from "./parse-csv.js";
import type { ParsedLedgerTransaction } from "./types.js";
import {
  currencyText,
  directionText,
  moneyText,
  optionalText,
  requiredText,
  strictDate,
} from "./validation.js";

export const LEDGER_CSV_HEADERS = [
  "ledger_txn_id",
  "accounting_date",
  "maturity_date",
  "amount",
  "currency",
  "direction",
  "reference",
  "counterparty",
  "description",
  "source",
  "batch_id",
] as const;

export function parseLedgerCsv(csvText: string): ParsedLedgerTransaction[] {
  const rows = parseCsvRows(csvText, { source: "LEDGER", headers: LEDGER_CSV_HEADERS });
  const transactions: ParsedLedgerTransaction[] = [];
  const seenIds = new Set<string>();
  const issues: CsvValidationIssue[] = [];

  for (const row of rows) {
    const rowNumber = row.info.lines;
    const ledgerTxnId = requiredText(row.record.ledger_txn_id, rowNumber, "ledger_txn_id", issues);
    const accountingDate = strictDate(row.record.accounting_date, rowNumber, "accounting_date", issues);
    const maturityDate = strictDate(row.record.maturity_date, rowNumber, "maturity_date", issues, true);
    const amount = moneyText(row.record.amount, rowNumber, "amount", issues);
    const currency = currencyText(row.record.currency, rowNumber, "currency", issues);
    const direction = directionText(row.record.direction, rowNumber, "direction", issues);
    const source = requiredText(row.record.source, rowNumber, "source", issues);

    if (ledgerTxnId !== null) {
      if (seenIds.has(ledgerTxnId)) {
        issues.push({
          code: "DUPLICATE_TRANSACTION_ID",
          row: rowNumber,
          field: "ledger_txn_id",
          message: `Duplicate ledger transaction ID "${ledgerTxnId}"`,
        });
      }
      seenIds.add(ledgerTxnId);
    }

    if (
      ledgerTxnId !== null &&
      accountingDate !== null &&
      amount !== null &&
      currency !== null &&
      direction !== null &&
      source !== null
    ) {
      transactions.push({
        ledgerTxnId,
        accountingDate,
        maturityDate,
        amount,
        currency,
        direction,
        reference: optionalText(row.record.reference),
        counterparty: optionalText(row.record.counterparty),
        description: optionalText(row.record.description),
        source,
        batchId: optionalText(row.record.batch_id),
      });
    }
  }

  if (issues.length > 0) {
    throw new CsvValidationError("LEDGER", issues);
  }
  return transactions;
}
