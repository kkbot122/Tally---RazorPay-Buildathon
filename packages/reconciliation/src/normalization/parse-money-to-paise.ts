import { NormalizationError } from "./errors.js";

const MONEY_PATTERN = /^-?(?:\d+|\d+\.\d{1,2})$/;

export function parseMoneyToPaise(amount: string): bigint {
  const normalized = amount.trim();
  if (!MONEY_PATTERN.test(normalized)) {
    throw new NormalizationError("INVALID_MONEY", `Expected a decimal amount with at most 2 decimal places, received "${amount}"`);
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -paise : paise;
}
