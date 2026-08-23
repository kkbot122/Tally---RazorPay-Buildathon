import { describe, expect, it } from "vitest";

import {
  NormalizationError,
  normalizeCounterpartyForExactComparison,
  normalizeCurrency,
  normalizeDate,
  normalizeOptionalDate,
  normalizeReference,
  parseMoneyToPaise,
} from "./index.js";

describe("mechanical normalization", () => {
  it("normalizes reference casing and formatting without semantic rewriting", () => {
    for (const reference of ["INV881", "INV-881", "INV_881", "INV 881", "inv-881", " INV-881 ", "INV#881"]) {
      expect(normalizeReference(reference)).toBe("INV881");
    }
    expect(normalizeReference(null)).toBeNull();
    expect(normalizeReference("---")).toBeNull();
    expect(normalizeReference("Invoice 881")).not.toBe(normalizeReference("INV881"));
  });

  it("normalizes counterparties conservatively", () => {
    expect(normalizeCounterpartyForExactComparison(" Acme Private Limited ")).toBe("ACME PRIVATE LIMITED");
    expect(normalizeCounterpartyForExactComparison("ACME   PRIVATE   LIMITED")).toBe("ACME PRIVATE LIMITED");
    expect(normalizeCounterpartyForExactComparison("ACME PVT LTD")).not.toBe(
      normalizeCounterpartyForExactComparison("Acme Private Limited"),
    );
    expect(normalizeCounterpartyForExactComparison("   ")).toBeNull();
    expect(normalizeCounterpartyForExactComparison(null)).toBeNull();
  });

  it("normalizes currency mechanically", () => {
    for (const currency of ["INR", "inr", "Inr", " INR "]) {
      expect(normalizeCurrency(currency)).toBe("INR");
    }
    expect(normalizeCurrency("₹")).toBe("₹");
  });

  it("parses exact decimal money into paise without floating point arithmetic", () => {
    const examples: readonly [string, bigint][] = [
      ["0", 0n],
      ["0.00", 0n],
      ["0.50", 50n],
      ["1", 100n],
      ["1.01", 101n],
      ["500", 50000n],
      ["12450.00", 1245000n],
      ["-1", -100n],
      ["-50.25", -5025n],
      ["999999999999.99", 99999999999999n],
    ];

    for (const [amount, expected] of examples) expect(parseMoneyToPaise(amount)).toBe(expected);
  });

  it("rejects invalid direct money calls without rounding", () => {
    for (const amount of ["", "abc", "12.345", "1e5", "₹500", "1,000.00"]) {
      expect(() => parseMoneyToPaise(amount)).toThrowError(NormalizationError);
    }
  });

  it("preserves date-only calendar values and optional absence", () => {
    expect(normalizeDate("2026-08-01")).toBe("2026-08-01");
    expect(normalizeDate("2026-12-31")).toBe("2026-12-31");
    expect(normalizeDate(" 2026-08-01 ")).toBe("2026-08-01");
    expect(normalizeOptionalDate(null)).toBeNull();
    expect(() => normalizeDate("08/01/2026")).toThrowError(NormalizationError);
    expect(() => normalizeDate("2026-02-30")).toThrowError(NormalizationError);
  });
});
