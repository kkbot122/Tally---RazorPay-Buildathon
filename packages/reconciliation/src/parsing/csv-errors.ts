export type CsvSource = "BANK" | "LEDGER";

export type CsvValidationIssue = {
  row?: number;
  field?: string;
  code:
    | "INVALID_HEADERS"
    | "MISSING_REQUIRED_COLUMN"
    | "UNEXPECTED_COLUMN"
    | "MALFORMED_CSV"
    | "INVALID_FIELD"
    | "DUPLICATE_TRANSACTION_ID";
  message: string;
};

export class CsvValidationError extends Error {
  readonly source: CsvSource;
  readonly issues: CsvValidationIssue[];

  constructor(source: CsvSource, issues: CsvValidationIssue[]) {
    super(`${source} CSV validation failed with ${issues.length} issue(s)`);
    this.name = "CsvValidationError";
    this.source = source;
    this.issues = issues;
  }
}
