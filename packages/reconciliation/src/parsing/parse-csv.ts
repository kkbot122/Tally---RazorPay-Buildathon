import { parse } from "csv-parse/sync";

import { CsvValidationError, type CsvSource, type CsvValidationIssue } from "./csv-errors.js";

type CsvRow = Record<string, string>;

type ParsedCsvRow = {
  record: CsvRow;
  info: {
    lines: number;
  };
};

type ParseCsvOptions = {
  source: CsvSource;
  headers: readonly string[];
};

function headerIssues(headers: string[], expectedHeaders: readonly string[]): CsvValidationIssue[] {
  const trimmedHeaders = headers.map((header) => header.trim());
  const issues: CsvValidationIssue[] = [];
  const expected = new Set(expectedHeaders);
  const seen = new Set<string>();

  for (const header of trimmedHeaders) {
    if (seen.has(header)) {
      issues.push({
        code: "INVALID_HEADERS",
        field: header,
        message: `Duplicate column "${header}"`,
      });
    }
    seen.add(header);

    if (!expected.has(header)) {
      issues.push({
        code: "UNEXPECTED_COLUMN",
        field: header,
        message: `Unexpected column "${header}"`,
      });
    }
  }

  for (const expectedHeader of expectedHeaders) {
    if (!seen.has(expectedHeader)) {
      issues.push({
        code: "MISSING_REQUIRED_COLUMN",
        field: expectedHeader,
        message: `Missing column "${expectedHeader}"`,
      });
    }
  }

  return issues;
}

export function parseCsvRows(text: string, options: ParseCsvOptions): ParsedCsvRow[] {
  try {
    return parse(text, {
      bom: true,
      columns: (headers: string[]) => {
        const issues = headerIssues(headers, options.headers);
        if (issues.length > 0) {
          throw new CsvValidationError(options.source, issues);
        }
        return headers.map((header) => header.trim());
      },
      info: true,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: false,
    }) as ParsedCsvRow[];
  } catch (error) {
    if (error instanceof CsvValidationError) {
      throw error;
    }

    const parserError = error as { code?: string; lines?: number; message?: string };
    throw new CsvValidationError(options.source, [
      {
        code: "MALFORMED_CSV",
        row: typeof parserError.lines === "number" ? parserError.lines : undefined,
        message: parserError.message ?? "Malformed CSV syntax",
      },
    ]);
  }
}
