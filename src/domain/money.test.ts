import { describe, expect, it } from "vitest";
import { formatCurrencyInput, parseCurrencyToCents } from "./money";

describe("money entry", () => {
  it.each([
    ["", null, ""], ["  ", null, ""], ["0", 0, "0.00"],
    ["000350", 35_000, "350.00"], [".50", 50, "0.50"],
    ["-.50", -50, "-0.50"], ["$1,250.05", 125_005, "1250.05"],
    ["15.", 1_500, "15.00"], ["-125.20", -12_520, "-125.20"],
  ])("parses and normalizes %j without confusing empty with zero", (text, cents, formatted) => {
    expect(parseCurrencyToCents(text)).toBe(cents);
    expect(formatCurrencyInput(cents)).toBe(formatted);
  });

  it.each(["-", ".", "-.", "1.234", "1e3", "0x10", "Infinity", "oops", "99999999999999999"])(
    "rejects incomplete or invalid money %j rather than silently saving it", (text) => {
      expect(parseCurrencyToCents(text)).toBeNaN();
    },
  );
});
