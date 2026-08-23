import { CsvValidationError, type CsvValidationIssue } from "./csv-errors.js";
import { parseCsvRows } from "./parse-csv.js";
import type { ParsedBankTransaction } from "./types.js";
import {
  currencyText,
  directionText,
  moneyText,
  optionalText,
  requiredText,
  strictDate,
} from "./validation.js";

export const BANK_CSV_HEADERS = [
  "bank_txn_id",
  "booking_date",
  "value_date",
  "amount",
  "currency",
  "direction",
  "reference",
  "counterparty",
  "description",
  "batch_id",
] as const;

export function parseBankCsv(csvText: string): ParsedBankTransaction[] {
  const rows = parseCsvRows(csvText, { source: "BANK", headers: BANK_CSV_HEADERS });
  const transactions: ParsedBankTransaction[] = [];
  const seenIds = new Set<string>();
  const issues: CsvValidationIssue[] = [];

  for (const row of rows) {
    const rowNumber = row.info.lines;
    const bankTxnId = requiredText(row.record.bank_txn_id, rowNumber, "bank_txn_id", issues);
    const bookingDate = strictDate(row.record.booking_date, rowNumber, "booking_date", issues);
    const valueDate = strictDate(row.record.value_date, rowNumber, "value_date", issues);
    const amount = moneyText(row.record.amount, rowNumber, "amount", issues);
    const currency = currencyText(row.record.currency, rowNumber, "currency", issues);
    const direction = directionText(row.record.direction, rowNumber, "direction", issues);

    if (bankTxnId !== null) {
      if (seenIds.has(bankTxnId)) {
        issues.push({
          code: "DUPLICATE_TRANSACTION_ID",
          row: rowNumber,
          field: "bank_txn_id",
          message: `Duplicate bank transaction ID "${bankTxnId}"`,
        });
      }
      seenIds.add(bankTxnId);
    }

    if (
      bankTxnId !== null &&
      bookingDate !== null &&
      valueDate !== null &&
      amount !== null &&
      currency !== null &&
      direction !== null
    ) {
      transactions.push({
        bankTxnId,
        bookingDate,
        valueDate,
        amount,
        currency,
        direction,
        reference: optionalText(row.record.reference),
        counterparty: optionalText(row.record.counterparty),
        description: optionalText(row.record.description),
        batchId: optionalText(row.record.batch_id),
      });
    }
  }

  if (issues.length > 0) {
    throw new CsvValidationError("BANK", issues);
  }
  return transactions;
}
