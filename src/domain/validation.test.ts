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
});
