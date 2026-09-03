import { describe, expect, it } from "vitest";
import { attentionSummary, getAttentionRecords } from "@/domain/attention";
import type { CalculatedSale, Sale } from "@/domain/types";

function calculated(
  id: string,
  status: Sale["status"],
  saleDate: string,
  flags: CalculatedSale["flags"] = [],
): CalculatedSale {
  return {
    sale: {
      id,
      profileId: "primary",
      saleDate,
      customerLastName: "Sample",
      stockNumber: `STK-${id}`,
      vehicleDescription: "Vehicle",
      status,
      unitCreditBasis: 1_000,
      frontGrossCents: 100_000,
      fiGrossCents: 20_000,
      notes: "",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
      revision: 1,
    },
    normalizedStock: `STK-${id}`,
    monthKey: "2026-08",
    countsTowardVolume: status === "delivered" && flags.length === 0,
    commissionReady: flags.length === 0,
    frontRateBps: 3_000,
    frontCommissionCents: 30_000,
    frontCommissionMethod: "percentage",
    minimumFrontCommissionCents: 30_000,
    commissionableFrontGrossCents: 100_000,
    fiCommissionCents: 4_000,
    estimatedCommissionCents: 34_000,
    flags,
  };
}

describe("canonical attention records", () => {
  it("includes calculation issues and overdue pending follow-up in one record count", () => {
    const records = getAttentionRecords([
      calculated("one", "pending", "2026-08-02", [{
        code: "missing-stock",
        label: "Stock number is required",
        severity: "error",
      }]),
      calculated("two", "delivered", "2026-08-10"),
    ], "2026-08-15");

    expect(records).toHaveLength(1);
    expect(records[0].reasons.map((reason) => reason.kind)).toEqual([
      "calculation",
      "pending-follow-up",
    ]);
    expect(records[0].ageDays).toBe(13);
    expect(attentionSummary(records[0])).toBe("Stock number is required +1");
  });

  it("does not flag a pending record dated today or in the future", () => {
    expect(getAttentionRecords([
      calculated("today", "pending", "2026-08-15"),
      calculated("future", "pending", "2026-08-16"),
    ], "2026-08-15")).toEqual([]);
  });

  it("sorts errors before warnings and older pending follow-up first", () => {
    const records = getAttentionRecords([
      calculated("newer", "pending", "2026-08-12"),
      calculated("error", "delivered", "2026-08-13", [{
        code: "duplicate-stock",
        label: "Duplicate stock",
        severity: "error",
      }]),
      calculated("older", "pending", "2026-08-02"),
    ], "2026-08-15");
    expect(records.map((record) => record.sale.id)).toEqual(["error", "older", "newer"]);
  });
});
