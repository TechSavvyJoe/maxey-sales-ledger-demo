import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import { createDefaultSettings } from "@/persistence/localDatabase";
import type { Sale } from "@/domain/types";
import { calculateSalesHistory, matchesSaleSearch } from "./salesHistory";

function makeSale(id: string, saleDate: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id, profileId: "primary", saleDate, customerLastName: `Example ${id}`, stockNumber: `TEST-${id}`,
    vehicleDescription: "2023 Ford Escape", status: "delivered", unitCreditBasis: 1000,
    frontGrossCents: 200_000, fiGrossCents: 100_000, notes: "", revision: 1,
    createdAt: `${saleDate}T12:00:00.000Z`, updatedAt: `${saleDate}T12:00:00.000Z`, ...overrides,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T18:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("sales history calculation scope", () => {
  it("preserves each month's pay plan, retro threshold, Mini, F&I and milestone when history is combined", () => {
    const oldPlan = { ...DEFAULT_PAY_PLAN, effectiveMonth: "2025-01", acceleratedThresholdExclusive: 9,
      baseFrontRateBps: 2000, acceleratedFrontRateBps: 3000, fiRateBps: 1000, minimumFrontCommissionCents: 20_000,
      bonusTiers: [{ minimumDelivered: 10, amountCents: 50_000 }] };
    const currentPlan = { ...DEFAULT_PAY_PLAN, effectiveMonth: "2026-09", acceleratedThresholdExclusive: 9,
      baseFrontRateBps: 4000, acceleratedFrontRateBps: 5000, fiRateBps: 2500, minimumFrontCommissionCents: 40_000 };
    const settings = { ...createDefaultSettings(), selectedMonth: "2026-09", payPlan: currentPlan,
      payPlanHistory: [oldPlan, currentPlan] };
    const older = Array.from({ length: 10 }, (_, index) => makeSale(`older-${index}`, `2026-08-${String(index + 1).padStart(2, "0")}`));
    older[1] = { ...older[1], frontGrossCents: 0, unitCreditBasis: 500 };
    older[2] = { ...older[2], frontCommissionOverrideCents: 77_000 };
    const newer = makeSale("newer", "2026-09-01");
    const results = calculateSalesHistory([...older, newer], settings, "all-months");
    expect(results).toHaveLength(11);
    expect(results.find((item) => item.sale.id === "older-0")).toMatchObject({
      monthKey: "2026-08", frontRateBps: 3000, frontCommissionCents: 60_000,
      fiCommissionCents: 10_000, estimatedCommissionCents: 70_000,
    });
    expect(results.find((item) => item.sale.id === "older-1")).toMatchObject({
      frontCommissionMethod: "mini", minimumFrontCommissionCents: 10_000, frontCommissionCents: 10_000,
    });
    expect(results.find((item) => item.sale.id === "older-2")).toMatchObject({
      frontCommissionMethod: "manual", frontCommissionCents: 77_000,
    });
    expect(results.find((item) => item.sale.id === "older-9")?.milestone).toMatchObject({
      deliveryOrdinal: 10, unlocksHigherRate: true, bonusAddedCents: 50_000,
    });
    expect(results.find((item) => item.sale.id === "newer")).toMatchObject({
      monthKey: "2026-09", frontRateBps: 4000, frontCommissionCents: 80_000,
      minimumFrontCommissionCents: 40_000, fiCommissionCents: 25_000, estimatedCommissionCents: 105_000,
    });
    expect(calculateSalesHistory([...older, newer], settings, "month").map((item) => item.sale.id)).toEqual(["newer"]);
  });

  it("keeps cross-month duplicate stock review and excludes deleted records", () => {
    const first = makeSale("first", "2026-08-01", { stockNumber: "TEST-DUPLICATE" });
    const second = makeSale("second", "2026-09-01", { stockNumber: "TEST-DUPLICATE" });
    const deleted = makeSale("deleted", "2026-08-03", { deletedAt: "2026-09-03T10:00:00Z" });
    const results = calculateSalesHistory([first, second, deleted], createDefaultSettings(), "all-months");
    expect(results).toHaveLength(2);
    for (const item of results) {
      expect(item.countsTowardVolume).toBe(false);
      expect(item.flags).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate-stock" })]));
    }
  });

  it("keeps records older than the saved pay plan findable without inventing a commission", () => {
    const old = makeSale("old-plan-missing", "2025-01-01");
    const [item] = calculateSalesHistory([old], createDefaultSettings(), "all-months");
    expect(item.sale).toBe(old);
    expect(item.calculationUnavailable).toBe("Add a pay plan for this month in Settings");
    expect(item.commissionReady).toBe(false);
    expect(item.milestone).toBeNull();
  });

  it("searches customer, vehicle and stock case-insensitively with surrounding spaces", () => {
    const sale = makeSale("older-stock", "2026-01-01", { customerLastName: "Example Longname", vehicleDescription: "2021 Ford Explorer Platinum" });
    for (const query of ["longname", " EXPLORER PLATINUM ", "test-older-stock", " "]) {
      expect(matchesSaleSearch(sale, query)).toBe(true);
    }
    expect(matchesSaleSearch(sale, "not present")).toBe(false);
  });
});
