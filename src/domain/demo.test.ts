import { describe, expect, it } from "vitest";
import { buildDemoSales, createPublicDemoHistoricPlan } from "@/domain/demo";

describe("demonstration data", () => {
  it("keeps current-month delivered examples on or before the as-of date", () => {
    const asOfDate = "2026-09-02";
    const sales = buildDemoSales("2026-09", asOfDate, "full-year");
    const currentMonth = sales.filter((sale) => sale.saleDate.startsWith("2026-09"));

    expect(currentMonth.filter((sale) => sale.status === "delivered")).toHaveLength(12);
    expect(currentMonth.filter((sale) => sale.status === "delivered").every((sale) => sale.saleDate <= asOfDate)).toBe(true);
    expect(currentMonth.filter((sale) => sale.status === "pending")).toHaveLength(1);
  });

  it("keeps future-month examples pending while preserving valid earlier samples", () => {
    const asOfDate = "2026-09-02";
    const sales = buildDemoSales("2026-10", asOfDate, "full-year");

    expect(sales.filter((sale) => sale.saleDate.startsWith("2026-10")).every((sale) => sale.status === "pending")).toBe(true);
    expect(sales.filter((sale) => sale.status === "delivered").every((sale) => sale.saleDate <= asOfDate)).toBe(true);
  });

  it("creates a complete selected-year walkthrough with future records kept pending", () => {
    const asOfDate = "2026-09-02";
    const sales = buildDemoSales("2026-09", asOfDate, "full-year");

    expect(new Set(sales.map((sale) => sale.saleDate.slice(0, 7)))).toEqual(new Set([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
    ]));
    expect(new Set(sales.map((sale) => sale.id)).size).toBe(sales.length);
    expect(new Set(sales.map((sale) => sale.stockNumber)).size).toBe(sales.length);
    expect(sales.filter((sale) => sale.saleDate.startsWith("2026-07") && sale.status === "delivered")).toHaveLength(35);
    expect(sales.filter((sale) => sale.saleDate > asOfDate).every((sale) => sale.status === "pending")).toBe(true);
    expect(sales.filter((sale) => sale.status === "delivered").every((sale) => (
      new Date(`${sale.saleDate}T12:00:00.000Z`).getUTCDay() !== 0
    ))).toBe(true);
    for (const key of ["serviceContractSold", "tireWheelSold", "gapSold", "dealerFinanced"] as const) {
      expect(sales.some((sale) => sale.status === "delivered" && sale[key])).toBe(true);
      expect(sales.some((sale) => sale.status === "delivered" && !sale[key])).toBe(true);
    }
  });

  it("builds one stable two-year public walkthrough through today", () => {
    const asOfDate = "2026-09-02";
    const sales = buildDemoSales("2026-09", asOfDate, "two-year");
    const otherSelectedMonth = buildDemoSales("2025-02", asOfDate, "two-year");

    expect(sales).toHaveLength(481);
    expect(sales.filter((sale) => sale.status === "delivered")).toHaveLength(480);
    expect(sales.filter((sale) => sale.status === "pending")).toHaveLength(1);
    expect(sales.filter((sale) => sale.status === "void")).toHaveLength(0);
    expect(sales.every((sale) => sale.saleDate <= asOfDate)).toBe(true);
    expect(sales.filter((sale) => sale.status === "pending").every((sale) => sale.saleDate === asOfDate)).toBe(true);
    expect(new Set(sales.map((sale) => sale.saleDate.slice(0, 7)))).toEqual(new Set([
      "2024-09", "2024-10", "2024-11", "2024-12",
      "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
      "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09",
    ]));
    expect(new Set(sales.map((sale) => sale.id)).size).toBe(sales.length);
    expect(new Set(sales.map((sale) => sale.stockNumber)).size).toBe(sales.length);
    expect(sales.filter((sale) => sale.status === "delivered").every((sale) => (
      new Date(`${sale.saleDate}T12:00:00.000Z`).getUTCDay() !== 0
    ))).toBe(true);
    expect(otherSelectedMonth).toEqual(sales);
  });

  it("uses a clearly named fictional plan for the public demo's historic records", () => {
    expect(createPublicDemoHistoricPlan("2026-09-02")).toMatchObject({
      version: "Sample 2024–26 plan",
      effectiveMonth: "2024-09",
    });
  });
});
