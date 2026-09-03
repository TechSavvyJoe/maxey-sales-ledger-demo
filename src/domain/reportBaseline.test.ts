import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import { calculatePersonalReportBaseline } from "@/domain/reportBaseline";
import type { Sale } from "@/domain/types";

const plans = [{ ...DEFAULT_PAY_PLAN, effectiveMonth: "2025-01" }];
function sale(id: string, month: string, sold = false, fiGrossCents = 0): Sale {
  return {
    id, profileId: "primary", saleDate: `${month}-05`, customerLastName: "Example",
    stockNumber: id, vehicleDescription: "Demo vehicle", status: "delivered", unitCreditBasis: 500,
    frontGrossCents: 100_000, fiGrossCents, serviceContractSold: sold, tireWheelSold: false,
    gapSold: false, dealerFinanced: false, notes: "", createdAt: `${month}-05T12:00:00Z`,
    updatedAt: `${month}-05T12:00:00Z`, revision: 1,
  };
}

describe("personal report baseline", () => {
  it("pools deals over the prior three complete calendar months rather than averaging monthly rates", () => {
    const result = calculatePersonalReportBaseline([
      sale("May1", "2026-05", true, 100_000),
      sale("June1", "2026-06"), sale("June2", "2026-06"), sale("June3", "2026-06"),
      sale("TooOld", "2026-04", true, 900_000), sale("Current", "2026-08", true, 900_000),
    ], "2026-08", plans, "recent", "2026-09");
    expect(result.monthKeys).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(result.analytics?.population.deliveredDealCount).toBe(4);
    expect(result.analytics?.products.serviceContract.penetrationRate).toBe(0.25);
    expect(result.analytics?.gross.fi.averagePerDeliveredDealCents).toBe(25_000);
    expect(result.analytics?.population.creditedUnits).toBe(2);
  });

  it("crosses year boundaries and excludes the active month", () => {
    const result = calculatePersonalReportBaseline([sale("Dec", "2025-12"), sale("Jan", "2026-01")], "2026-01", plans, "recent", "2026-01");
    expect(result.monthKeys).toEqual(["2025-10", "2025-11", "2025-12"]);
    expect(result.analytics?.population.deliveredDealCount).toBe(1);
    expect(result.label).toContain("Oct 2025–Dec 2025");
  });

  it("compares year-to-date with the same months of the previous year", () => {
    const result = calculatePersonalReportBaseline([
      sale("PriorJan", "2025-01"), sale("PriorAug", "2025-08"),
      sale("PriorSep", "2025-09"), sale("CurrentAug", "2026-08"),
    ], "2026-08", plans, "year", "2026-09");
    expect(result.monthKeys).toHaveLength(8);
    expect(result.analytics?.population.deliveredDealCount).toBe(2);
    expect(result.label).toContain("same months last year");
  });

  it("does not manufacture a baseline for no history or future reports", () => {
    expect(calculatePersonalReportBaseline([], "2026-08", plans, "recent", "2026-09").analytics).toBeNull();
    expect(calculatePersonalReportBaseline([sale("Aug", "2026-08")], "2026-10", plans, "recent", "2026-09").analytics).toBeNull();
    const limited = calculatePersonalReportBaseline([sale("Prior", "2025-12")], "2026-01", [DEFAULT_PAY_PLAN], "recent", "2026-09");
    expect(limited.analytics).toBeNull();
    expect(limited.label).toBe("No earlier covered months");
  });
});
