import { describe, expect, it } from "vitest";
import { buildDemoSales, createPublicDemoHistoricPlan, DEMO_PROFILE_VERSION, samplePaymentMethod } from "@/domain/demo";
import type { Sale } from "@/domain/types";

function groupByMonth(sales: Sale[]): Map<string, Sale[]> {
  const months = new Map<string, Sale[]>();
  for (const sale of sales) {
    const key = sale.saleDate.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), sale]);
  }
  return months;
}

function productCount(sale: Sale): number {
  return Number(sale.serviceContractSold) + Number(sale.tireWheelSold) + Number(sale.gapSold);
}

function workingDaysThrough(month: string, asOfDate: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => index + 1).filter((day) => (
    new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay() !== 0
    && `${month}-${String(day).padStart(2, "0")}` <= asOfDate
  )).length;
}

describe("demonstration data", () => {
  it("keeps its public profile identifier and legacy payment helper stable", () => {
    expect(DEMO_PROFILE_VERSION).toBe("seasonal-2300-front-1200-fi-v1");
    expect(samplePaymentMethod({ id: "legacy-demo", dealerFinanced: true })).toBe("dealer_financed");
    expect(["cash", "outside_financing"]).toContain(samplePaymentMethod({ id: "legacy-demo", dealerFinanced: false }));
    expect(samplePaymentMethod({ id: "legacy-demo", dealerFinanced: undefined })).toBe(samplePaymentMethod({ id: "legacy-demo", dealerFinanced: undefined }));
  });

  it("uses deterministic seasonal volumes instead of bonus-milestone examples", () => {
    const sales = buildDemoSales("2025-08", "2026-09-02", "full-year");
    const months = groupByMonth(sales);
    expect(months.size).toBe(12);
    const winter: number[] = [];
    const summer: number[] = [];
    for (const [month, rows] of months) {
      const calendarMonth = Number(month.slice(5));
      expect(rows.every((sale) => sale.status === "delivered")).toBe(true);
      if ([1, 2, 11, 12].includes(calendarMonth)) {
        expect(rows.length).toBeGreaterThanOrEqual(12);
        expect(rows.length).toBeLessThanOrEqual(18);
        winter.push(rows.length);
      } else if ([5, 6, 7, 8].includes(calendarMonth)) {
        expect(rows.length).toBeGreaterThanOrEqual(18);
        expect(rows.length).toBeLessThanOrEqual(25);
        summer.push(rows.length);
      } else {
        expect(rows.length).toBeGreaterThanOrEqual(16);
        expect(rows.length).toBeLessThanOrEqual(21);
      }
    }
    expect(summer.reduce((sum, count) => sum + count, 0) / summer.length)
      .toBeGreaterThan(winter.reduce((sum, count) => sum + count, 0) / winter.length + 4);
    expect(buildDemoSales("2025-08", "2026-09-02", "full-year")).toEqual(sales);
  });

  it("normalizes complete months to the requested front and product F&I averages", () => {
    const sales = buildDemoSales("2026-09", "2026-09-02", "two-year");
    const completedMonths = [...groupByMonth(sales)].filter(([month]) => month < "2026-09");
    expect(completedMonths).toHaveLength(24);
    for (const [, rows] of completedMonths) {
      expect(rows.reduce((sum, sale) => sum + (sale.frontGrossCents ?? 0), 0)).toBe(rows.length * 230_000);
      expect(rows.reduce((sum, sale) => sum + (sale.fiGrossCents ?? 0), 0)).toBe(rows.length * 120_000);
      expect(rows.every((sale) => Number.isInteger(sale.frontGrossCents) && Number.isInteger(sale.fiGrossCents))).toBe(true);
    }
  });

  it("varies individual gross amounts by month without index-based inflation", () => {
    const months = groupByMonth(buildDemoSales("2025-08", "2026-09-02", "full-year"));
    for (const rows of months.values()) {
      const fronts = rows.map((sale) => sale.frontGrossCents ?? 0);
      expect(fronts.some((value, index) => index > 0 && value < fronts[index - 1])).toBe(true);
      expect(fronts.some((value, index) => index > 0 && value > fronts[index - 1])).toBe(true);
      expect(new Set(fronts).size).toBeGreaterThan(10);
    }
    const all = [...months.values()].flat();
    expect(all.some((sale) => (sale.frontGrossCents ?? 0) < 0)).toBe(true);
    expect(all.some((sale) => (sale.frontGrossCents ?? 0) > 0 && (sale.frontGrossCents ?? 0) <= 40_000)).toBe(true);
    expect(months.get("2025-01")?.[0].frontGrossCents).not.toBe(months.get("2025-02")?.[0].frontGrossCents);
    const splits = all.filter((sale) => sale.unitCreditBasis === 500);
    expect(splits.length).toBeGreaterThanOrEqual(2);
    expect(splits.length).toBeLessThanOrEqual(3);
  });

  it("keeps finance and product penetration plausible without inventing reserve commission", () => {
    const sales = buildDemoSales("2025-08", "2026-09-02", "full-year");
    const financed = sales.filter((sale) => sale.paymentMethod === "dealer_financed");
    const ratio = (rows: Sale[]) => rows.length / sales.length;
    expect(ratio(financed)).toBeGreaterThanOrEqual(0.65);
    expect(ratio(financed)).toBeLessThanOrEqual(0.75);
    expect(ratio(sales.filter((sale) => sale.serviceContractSold))).toBeGreaterThanOrEqual(0.43);
    expect(ratio(sales.filter((sale) => sale.serviceContractSold))).toBeLessThanOrEqual(0.47);
    expect(ratio(sales.filter((sale) => sale.tireWheelSold))).toBeGreaterThanOrEqual(0.08);
    expect(ratio(sales.filter((sale) => sale.tireWheelSold))).toBeLessThanOrEqual(0.12);
    const gapRatio = financed.filter((sale) => sale.gapSold).length / financed.length;
    expect(gapRatio).toBeGreaterThanOrEqual(0.40);
    expect(gapRatio).toBeLessThanOrEqual(0.46);
    expect(new Set(sales.map((sale) => sale.paymentMethod))).toEqual(new Set(["dealer_financed", "cash", "outside_financing"]));
    expect(sales.every((sale) => sale.dealerFinanced === (sale.paymentMethod === "dealer_financed"))).toBe(true);
    expect(sales.filter((sale) => sale.gapSold).every((sale) => sale.paymentMethod === "dealer_financed")).toBe(true);
    expect(sales.filter((sale) => productCount(sale) === 0).every((sale) => sale.fiGrossCents === 0)).toBe(true);
    expect(sales.filter((sale) => productCount(sale) > 0).every((sale) => (sale.fiGrossCents ?? 0) > 0)).toBe(true);
    expect(financed.some((sale) => productCount(sale) === 0 && sale.fiGrossCents === 0)).toBe(true);
    expect(sales.some((sale) => sale.paymentMethod === "cash" && productCount(sale) > 0)).toBe(true);
    expect(sales.some((sale) => productCount(sale) > 1)).toBe(true);
  });

  it("varies monthly financing within an illustrative 70/20/10 two-year payment mix", () => {
    const sales = buildDemoSales("2026-09", "2026-09-03", "two-year");
    for (const [method, lower, upper] of [
      ["dealer_financed", 0.65, 0.75],
      ["cash", 0.17, 0.23],
      ["outside_financing", 0.07, 0.13],
    ] as const) {
      const rate = sales.filter((sale) => sale.paymentMethod === method).length / sales.length;
      expect(rate).toBeGreaterThanOrEqual(lower);
      expect(rate).toBeLessThanOrEqual(upper);
    }
    const fullMonthRates = [...groupByMonth(sales)]
      .filter(([month]) => month < "2026-09")
      .map(([, rows]) => rows.filter((sale) => sale.paymentMethod === "dealer_financed").length / rows.length);
    expect(new Set(fullMonthRates).size).toBeGreaterThan(5);
    expect(Math.max(...fullMonthRates) - Math.min(...fullMonthRates)).toBeGreaterThan(0.05);
  });

  it("prorates the current month over elapsed Mon–Sat days and leaves F&I amounts awaiting", () => {
    const asOfDate = "2026-09-02";
    const sales = buildDemoSales("2026-09", asOfDate, "full-year");
    const current = sales.filter((sale) => sale.saleDate.startsWith("2026-09"));
    const completedMonth = buildDemoSales("2026-09", "2026-09-30", "full-year")
      .filter((sale) => sale.saleDate.startsWith("2026-09"));
    const proportion = workingDaysThrough("2026-09", asOfDate) / workingDaysThrough("2026-09", "2026-09-30");
    expect(current.length).toBeLessThanOrEqual(2);
    expect(Math.abs(current.length - completedMonth.length * proportion)).toBeLessThanOrEqual(1);
    expect(current.every((sale) => sale.status === "delivered" && sale.saleDate <= asOfDate)).toBe(true);
    expect(current.every((sale) => sale.fiGrossCents === null && typeof sale.serviceContractSold === "boolean" && sale.paymentMethod !== undefined)).toBe(true);
    expect(current).toEqual(completedMonth.filter((sale) => sale.saleDate <= asOfDate));
    expect(buildDemoSales("2026-11", "2026-11-01", "two-year").filter((sale) => sale.saleDate.startsWith("2026-11"))).toHaveLength(0);
  });

  it("preserves delivered records as the current month advances", () => {
    const earlier = buildDemoSales("2026-09", "2026-09-02", "two-year");
    const later = buildDemoSales("2025-02", "2026-09-18", "two-year");
    expect(later.filter((sale) => sale.saleDate <= "2026-09-02")).toEqual(earlier);
    expect(later.length).toBeGreaterThan(earlier.length);
  });

  it("keeps delivered dates nonfuture and Sunday-free and only future full-year months pending", () => {
    const asOfDate = "2026-09-02";
    for (const scope of ["full-year", "two-year"] as const) {
      const sales = buildDemoSales("2026-10", asOfDate, scope);
      expect(sales.filter((sale) => sale.status === "delivered").every((sale) => sale.saleDate <= asOfDate)).toBe(true);
      expect(sales.every((sale) => new Date(`${sale.saleDate}T12:00:00Z`).getUTCDay() !== 0)).toBe(true);
      expect(sales.some((sale) => sale.status === "void")).toBe(false);
      expect(new Set(sales.map((sale) => sale.id)).size).toBe(sales.length);
      expect(new Set(sales.map((sale) => sale.stockNumber)).size).toBe(sales.length);
      expect(sales.every((sale) => sale.source === "demo" && /^demo-\d{4}-\d{2}-\d+-(delivered|pending)$/.test(sale.id))).toBe(true);
      if (scope === "full-year") {
        expect(groupByMonth(sales).size).toBe(12);
        expect(sales.filter((sale) => sale.status === "pending").every((sale) => sale.saleDate > asOfDate)).toBe(true);
        expect(sales.filter((sale) => sale.saleDate.startsWith("2026-10")).every((sale) => sale.status === "pending")).toBe(true);
      } else {
        expect(sales.every((sale) => sale.status === "delivered")).toBe(true);
        expect(groupByMonth(sales).size).toBe(25);
        expect(sales).toEqual(buildDemoSales("2025-02", asOfDate, scope));
      }
    }
  });

  it("uses a clearly named fictional plan for historic public demo records", () => {
    expect(createPublicDemoHistoricPlan("2026-09-02")).toMatchObject({
      version: "Sample 2024–26 plan",
      effectiveMonth: "2024-09",
    });
  });
});
