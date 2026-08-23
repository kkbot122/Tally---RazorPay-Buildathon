import { NormalizationError } from "./errors.js";

export function normalizeDate(date: string): string {
  const normalized = date.trim();
  if (!isCalendarDate(normalized)) {
    throw new NormalizationError("INVALID_DATE", `Expected a valid YYYY-MM-DD calendar date, received "${date}"`);
  }
  return normalized;
}

export function normalizeOptionalDate(date: string | null): string | null {
  return date === null ? null : normalizeDate(date);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}
