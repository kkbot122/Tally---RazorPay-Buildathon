import { normalizeDate } from "../normalization/index.js";

const MILLISECONDS_PER_DAY = 86_400_000;

export function differenceInCalendarDays(leftDate: string, rightDate: string): number {
  const left = toUtcMilliseconds(leftDate);
  const right = toUtcMilliseconds(rightDate);
  return Math.round((left - right) / MILLISECONDS_PER_DAY);
}

function toUtcMilliseconds(date: string): number {
  const normalized = normalizeDate(date);
  const [year, month, day] = normalized.split("-").map(Number);
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year!, month! - 1, day!);
  return value.getTime();
}
