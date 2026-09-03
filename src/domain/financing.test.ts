import { describe, expect, it } from "vitest";
import {
  dealerFinancingOutcome,
  getPaymentMethod,
  normalizeSaleFinancing,
  paymentMethodLabel,
} from "@/domain/financing";
import type { Sale } from "@/domain/types";

function sale(overrides: Partial<Sale>): Sale {
  return {
    id: "sample",
    profileId: "primary",
    saleDate: "2026-08-05",
    customerLastName: "Sample",
    stockNumber: "SAMPLE",
    vehicleDescription: "Sample vehicle",
    status: "delivered",
    unitCreditBasis: 1_000,
    frontGrossCents: null,
    fiGrossCents: null,
    notes: "",
    createdAt: "2026-08-05T12:00:00.000Z",
    updatedAt: "2026-08-05T12:00:00.000Z",
    revision: 1,
    ...overrides,
  };
}

describe("payment method compatibility", () => {
  it.each([
    [{ paymentMethod: "dealer_financed", dealerFinanced: false }, "dealer_financed", true, "Dealership financing"],
    [{ paymentMethod: "cash", dealerFinanced: true }, "cash", false, "Cash"],
    [{ paymentMethod: "outside_financing", dealerFinanced: true }, "outside_financing", false, "Outside financing"],
    [{ dealerFinanced: true }, "dealer_financed", true, "Dealership financing"],
    [{ dealerFinanced: false }, "not_dealer_financed", false, "Cash / outside not specified"],
    [{}, "unmarked", undefined, "Not marked"],
  ] as const)("resolves %o without guessing a missing payment method", (input, method, financed, label) => {
    expect(getPaymentMethod(input)).toBe(method);
    expect(dealerFinancingOutcome(input)).toBe(financed);
    expect(paymentMethodLabel(input)).toBe(label);
  });

  it("normalizes conflicting compatibility fields without mutating the saved record", () => {
    const original = Object.freeze({ ...sale({ paymentMethod: "cash", dealerFinanced: true }), extra: "preserved" });
    expect(normalizeSaleFinancing(original)).toEqual({ ...original, dealerFinanced: false });
    expect(original.dealerFinanced).toBe(true);
    expect(normalizeSaleFinancing(sale({ paymentMethod: "dealer_financed" })).dealerFinanced).toBe(true);
    expect(normalizeSaleFinancing(sale({ paymentMethod: "outside_financing" })).dealerFinanced).toBe(false);
  });

  it("leaves already normalized and unresolved legacy records unchanged", () => {
    const normalized = sale({ paymentMethod: "cash", dealerFinanced: false });
    const unresolved = sale({ dealerFinanced: false });
    const unknown = sale({});
    expect(normalizeSaleFinancing(normalized)).toBe(normalized);
    expect(normalizeSaleFinancing(unresolved)).toBe(unresolved);
    expect(normalizeSaleFinancing(unresolved).paymentMethod).toBeUndefined();
    expect(normalizeSaleFinancing(unknown)).toBe(unknown);
  });
});
