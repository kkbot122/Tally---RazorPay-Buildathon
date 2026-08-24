import { describe, expect, it } from "vitest";

import { formatPaise } from "./format-paise";

describe("formatPaise", () => {
  it("formats positive exact paise without floating point conversion", () => {
    expect(formatPaise("5000")).toBe("5,000 paise");
  });

  it("preserves a negative sign", () => {
    expect(formatPaise("-5000")).toBe("−5,000 paise");
  });

  it("supports arbitrary precision integer strings", () => {
    expect(formatPaise("123456789012345678901")).toBe("123,456,789,012,345,678,901 paise");
  });
});
