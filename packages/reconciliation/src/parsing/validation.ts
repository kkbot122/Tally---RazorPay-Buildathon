import { CsvValidationError, type CsvSource, type CsvValidationIssue } from "./csv-errors.js";

export function requiredText(
  value: string | undefined,
  row: number,
  field: string,
  issues: CsvValidationIssue[],
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    issues.push({ code: "INVALID_FIELD", row, field, message: "Required value is blank" });
    return null;
  }
  return trimmed;
}

export function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

export function strictDate(
  value: string | undefined,
  row: number,
  field: string,
  issues: CsvValidationIssue[],
  optional = false,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0 && optional) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    issues.push({ code: "INVALID_FIELD", row, field, message: "Expected a valid YYYY-MM-DD calendar date" });
    return null;
  }

  const [year, month, day] = trimmed.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (month < 1 || month > 12 || day < 1 || day > (daysInMonth ?? 0)) {
    issues.push({ code: "INVALID_FIELD", row, field, message: "Expected a valid YYYY-MM-DD calendar date" });
    return null;
  }

  return trimmed;
}

export function moneyText(
  value: string | undefined,
  row: number,
  field: string,
  issues: CsvValidationIssue[],
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!/^-?(?:\d+|\d+\.\d{1,2})$/.test(trimmed)) {
    issues.push({
      code: "INVALID_FIELD",
      row,
      field,
      message: "Expected a finite decimal amount with at most 2 decimal places",
    });
    return null;
  }
  return trimmed;
}

export function currencyText(
  value: string | undefined,
  row: number,
  field: string,
  issues: CsvValidationIssue[],
): string | null {
  const trimmed = value?.trim() ?? "";
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    issues.push({ code: "INVALID_FIELD", row, field, message: "Expected a three-letter uppercase currency code" });
    return null;
  }
  return trimmed;
}

export function directionText(
  value: string | undefined,
  row: number,
  field: string,
  issues: CsvValidationIssue[],
): "CREDIT" | "DEBIT" | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed !== "CREDIT" && trimmed !== "DEBIT") {
    issues.push({ code: "INVALID_FIELD", row, field, message: "Expected CREDIT or DEBIT" });
    return null;
  }
  return trimmed;
}

export function throwIfIssues(source: CsvSource, issues: CsvValidationIssue[]): void {
  if (issues.length > 0) {
    throw new CsvValidationError(source, issues);
  }
}
