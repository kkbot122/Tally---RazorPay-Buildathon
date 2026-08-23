import { describe, expect, it } from "vitest";

import { CsvValidationError } from "./csv-errors.js";
import { parseBankCsv } from "./parse-bank-csv.js";
import { parseLedgerCsv } from "./parse-ledger-csv.js";

const bankHeaders = "bank_txn_id,booking_date,value_date,amount,currency,direction,reference,counterparty,description,batch_id";
const ledgerHeaders = "ledger_txn_id,accounting_date,maturity_date,amount,currency,direction,reference,counterparty,description,source,batch_id";

function validationError(parse: () => unknown): CsvValidationError {
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(CsvValidationError);
    return error as CsvValidationError;
  }
  throw new Error("Expected CSV validation to fail");
}

describe("parseBankCsv", () => {
  it("parses complete rows, trims safe whitespace, and preserves raw amounts and references", () => {
    const [transaction] = parseBankCsv(
      `${bankHeaders}\nB001,2026-08-23,2026-08-23,12450.00,INR,CREDIT, INV-881 , ACME PVT LTD ,"Payment for invoice 881, August batch",batch-1\n`,
    );

    expect(transaction).toEqual({
      bankTxnId: "B001",
      bookingDate: "2026-08-23",
      valueDate: "2026-08-23",
      amount: "12450.00",
      currency: "INR",
      direction: "CREDIT",
      reference: "INV-881",
      counterparty: "ACME PVT LTD",
      description: "Payment for invoice 881, August batch",
      batchId: "batch-1",
    });
  });

  it("represents blank optional evidence fields as null and ignores blank trailing rows", () => {
    const transactions = parseBankCsv(`${bankHeaders}\nB001,2026-08-23,2026-08-23,0.50,INR,DEBIT,,,,\n\n`);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      reference: null,
      counterparty: null,
      description: null,
      batchId: null,
    });
  });

  it("accepts headers with surrounding whitespace but rejects missing and unexpected headers", () => {
    expect(parseBankCsv(` ${bankHeaders.replaceAll(",", " , ")} \nB001,2026-08-23,2026-08-23,500,INR,CREDIT,,,,`)).toHaveLength(1);

    const missing = validationError(() => parseBankCsv(bankHeaders.replace("value_date,", "") + "\nB001,2026-08-23,500,INR,CREDIT,,,,"));
    expect(missing.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MISSING_REQUIRED_COLUMN", field: "value_date" }),
    ]));

    const unexpected = validationError(() => parseBankCsv(`${bankHeaders},secret_match_id\nB001,2026-08-23,2026-08-23,500,INR,CREDIT,,,,,secret`));
    expect(unexpected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNEXPECTED_COLUMN", field: "secret_match_id" }),
    ]));
  });

  it("rejects duplicate headers, duplicate IDs, invalid amounts, dates, directions, and blank required fields", () => {
    const duplicateHeader = validationError(() => parseBankCsv(`${bankHeaders},amount\nB001,2026-08-23,2026-08-23,500,INR,CREDIT,,,,,500`));
    expect(duplicateHeader.issues[0]?.code).toBe("INVALID_HEADERS");

    const duplicateId = validationError(() => parseBankCsv(`${bankHeaders}\nB001,2026-08-23,2026-08-23,500,INR,CREDIT,,,,\nB001,2026-08-23,2026-08-23,500,INR,CREDIT,,,,`));
    expect(duplicateId.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_TRANSACTION_ID", row: 3, field: "bank_txn_id" }),
    ]));

    for (const amount of ["abc", "12.345", "1e5"]) {
      const error = validationError(() => parseBankCsv(`${bankHeaders}\nB001,2026-08-23,2026-08-23,${amount},INR,CREDIT,,,,`));
      expect(error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_FIELD", row: 2, field: "amount" }),
      ]));
    }

    const invalidDate = validationError(() => parseBankCsv(`${bankHeaders}\nB001,2026-02-29,23/08/2026,500,INR,CREDIT,,,,`));
    expect(invalidDate.issues.filter((issue) => issue.field === "booking_date" || issue.field === "value_date")).toHaveLength(2);

    const invalidDirection = validationError(() => parseBankCsv(`${bankHeaders}\nB001,2026-08-23,2026-08-23,500,INR,RECEIPT,,,,`));
    expect(invalidDirection.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "direction", row: 2 }),
    ]));

    const blankRequired = validationError(() => parseBankCsv(`${bankHeaders}\n,2026-08-23,2026-08-23,,INR,CREDIT,,,,`));
    expect(blankRequired.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "bank_txn_id" }),
      expect.objectContaining({ field: "amount" }),
    ]));
  });

  it("wraps malformed quoting as an actionable parser error", () => {
    const error = validationError(() => parseBankCsv(`${bankHeaders}\nB001,2026-08-23,2026-08-23,500,INR,CREDIT,,ACME,"unterminated,batch-1`));
    expect(error.source).toBe("BANK");
    expect(error.issues[0]).toMatchObject({ code: "MALFORMED_CSV" });
  });
});

describe("parseLedgerCsv", () => {
  it("parses complete rows and allows missing maturity and evidence fields", () => {
    const [transaction] = parseLedgerCsv(
      `${ledgerHeaders}\nL001,2026-08-23,,500,INR,DEBIT, INV-881 , ACME PVT LTD ,"Ledger, payment",ERP,batch-1\n`,
    );

    expect(transaction).toEqual({
      ledgerTxnId: "L001",
      accountingDate: "2026-08-23",
      maturityDate: null,
      amount: "500",
      currency: "INR",
      direction: "DEBIT",
      reference: "INV-881",
      counterparty: "ACME PVT LTD",
      description: "Ledger, payment",
      source: "ERP",
      batchId: "batch-1",
    });

    const [missingEvidence] = parseLedgerCsv(`${ledgerHeaders}\nL002,2026-08-23,,500,INR,CREDIT,,,,ERP,`);
    expect(missingEvidence).toMatchObject({
      maturityDate: null,
      reference: null,
      counterparty: null,
      description: null,
      batchId: null,
    });
  });

  it("rejects invalid dates, amounts, duplicate IDs, missing source, and invalid direction", () => {
    const invalidDate = validationError(() => parseLedgerCsv(`${ledgerHeaders}\nL001,2026-02-29,2026-02-30,500,INR,CREDIT,,,,ERP,`));
    expect(invalidDate.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "accounting_date" }),
      expect.objectContaining({ field: "maturity_date" }),
    ]));

    const invalidAmount = validationError(() => parseLedgerCsv(`${ledgerHeaders}\nL001,2026-08-23,,12.345,INR,CREDIT,,,,ERP,`));
    expect(invalidAmount.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "amount", row: 2 }),
    ]));

    const duplicateId = validationError(() => parseLedgerCsv(`${ledgerHeaders}\nL001,2026-08-23,,500,INR,CREDIT,,,,ERP,\nL001,2026-08-23,,500,INR,CREDIT,,,,ERP,`));
    expect(duplicateId.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_TRANSACTION_ID", field: "ledger_txn_id", row: 3 }),
    ]));

    const missingSource = validationError(() => parseLedgerCsv(`${ledgerHeaders}\nL001,2026-08-23,,500,INR,CREDIT,,,,,`));
    expect(missingSource.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "source" }),
    ]));

    const invalidDirection = validationError(() => parseLedgerCsv(`${ledgerHeaders}\nL001,2026-08-23,,500,INR,OUTFLOW,,,,ERP,`));
    expect(invalidDirection.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "direction" }),
    ]));
  });
});
