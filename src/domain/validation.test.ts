import { describe, expect, it } from "vitest";
import { validateSaleForm, type SaleFormValues } from "@/domain/validation";

const validDeliveredSale: SaleFormValues = {
  status: "delivered",
  saleDate: "2026-08-10",
  customerLastName: "Sample",
  stockNumber: "VALID-001",
  vehicleDescription: "2023 Ford Escape",
  unitCredit: "1",
  frontGross: "2500",
  fiGross: "500",
  notes: "",
};

describe("sale validation", () => {
  it("requires an entered deal-credit value instead of silently saving a blank as zero", () => {
    expect(validateSaleForm({ ...validDeliveredSale, unitCredit: "" }).unitCredit)
      .toBe("Enter deal credit between 0 and 2.");
    expect(validateSaleForm({ ...validDeliveredSale, unitCredit: "0" }).unitCredit).toBeUndefined();
  });

  it.each([".5", "0.5", "00.500", "0.125", "1.", "2"])("accepts decimal deal credit %j", (unitCredit) => {
    expect(validateSaleForm({ ...validDeliveredSale, unitCredit }).unitCredit).toBeUndefined();
  });

  it.each([".", "-", "0x1", "1e0", "0.1234", "2.1"])("rejects invalid or silently rounded deal credit %j", (unitCredit) => {
    expect(validateSaleForm({ ...validDeliveredSale, unitCredit }).unitCredit).toBeDefined();
  });
});
