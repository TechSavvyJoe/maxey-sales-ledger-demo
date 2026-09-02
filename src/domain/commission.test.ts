import { describe, expect, it } from "vitest";
import { calculateMonth, calculateYear, DEFAULT_PAY_PLAN, getPotentialBonus } from "@/domain/commission";
import { multiplyCentsByBps } from "@/domain/money";
import type { Sale, SaleStatus } from "@/domain/types";

function sale(
  index: number,
  {
    month = "2026-08",
    status = "delivered",
    front = 100_000,
    fi = 10_000,
    stock = `${month}-STK-${index}`,
    unit = 1_000,
  }: {
    month?: string;
    status?: SaleStatus;
    front?: number | null;
    fi?: number | null;
    stock?: string;
    unit?: number;
  } = {},
): Sale {
  return {
    id: `${month}-${index}-${status}`,
    profileId: "primary",
    saleDate: `${month}-${String(Math.min(index + 1, 28)).padStart(2, "0")}`,
    customerLastName: "Sample",
    stockNumber: stock,
    vehicleDescription: "Sample vehicle",
    status,
    unitCreditBasis: unit,
    frontGrossCents: front,
    fiGrossCents: fi,
    notes: "",
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    revision: 1,
    source: "demo",
  };
}

describe("commission engine", () => {
  it("calculates a basic delivered sale at 30% front and 20% F&I", () => {
    const result = calculateMonth(
      [sale(1, { front: 100_000, fi: 50_000 })],
      "2026-08",
      DEFAULT_PAY_PLAN,
    );
    expect(result.deliveredCount).toBe(1);
    expect(result.frontRateBps).toBe(3_000);
    expect(result.frontCommissionCents).toBe(30_000);
    expect(result.fiCommissionCents).toBe(10_000);
    expect(result.estimatedCommissionCents).toBe(40_000);
  });

  it("keeps exactly 10 valid deliveries at 30%", () => {
    const result = calculateMonth(
      Array.from({ length: 10 }, (_, index) => sale(index)),
      "2026-08",
      DEFAULT_PAY_PLAN,
    );
    expect(result.deliveredCount).toBe(10);
    expect(result.frontRateBps).toBe(3_000);
    expect(result.frontCommissionCents).toBe(300_000);
    expect(result.fiCommissionCents).toBe(20_000);
    expect(result.estimatedCommissionCents).toBe(320_000);
  });

  it("applies 35% retroactively after more than 10 valid deliveries", () => {
    const firstTen = Array.from({ length: 10 }, (_, index) => sale(index));
    const result = calculateMonth(
      [...firstTen, sale(10, { front: 200_000, fi: 50_000 })],
      "2026-08",
      DEFAULT_PAY_PLAN,
    );
    expect(result.deliveredCount).toBe(11);
    expect(result.frontRateBps).toBe(3_500);
    expect(result.frontGrossCents).toBe(1_200_000);
    expect(result.fiGrossCents).toBe(150_000);
    expect(result.frontCommissionCents).toBe(420_000);
    expect(result.fiCommissionCents).toBe(30_000);
    expect(result.estimatedCommissionCents).toBe(480_000);
    expect(result.retroactiveUpliftCents).toBe(60_000);
    expect(result.calculatedSales.every((item) => item.frontRateBps === 3_500)).toBe(true);
  });

  it("does not let a pending or legacy void record trigger the higher rate", () => {
    const firstTen = Array.from({ length: 10 }, (_, index) => sale(index));
    for (const status of ["pending", "void"] as const) {
      const result = calculateMonth(
        [...firstTen, sale(10, { status, front: 200_000, fi: 50_000 })],
        "2026-08",
        DEFAULT_PAY_PLAN,
      );
      expect(result.deliveredCount).toBe(10);
      expect(result.frontRateBps).toBe(3_000);
      expect(result.estimatedCommissionCents).toBe(320_000);
    }
  });

  it("flags and excludes a future-dated Delivered record", () => {
    const future = sale(1, { month: "2099-01", front: 100_000, fi: 50_000 });
    const result = calculateMonth([future], "2099-01", DEFAULT_PAY_PLAN);
    expect(result.deliveredCount).toBe(0);
    expect(result.estimatedCommissionCents).toBe(0);
    expect(result.calculatedSales[0]?.flags.some((flag) => flag.code === "future-delivery")).toBe(true);
  });

  it("does not let a future duplicate suppress a valid delivered sale", () => {
    const valid = sale(1, { stock: "SHARED-001" });
    const future = sale(1, { month: "2099-01", stock: " shared-001 " });
    const result = calculateMonth([valid, future], "2026-08", DEFAULT_PAY_PLAN);

    expect(result.deliveredCount).toBe(1);
    expect(result.frontGrossCents).toBe(100_000);
    expect(result.duplicateGroupCount).toBe(0);
    expect(result.calculatedSales[0]?.flags.some((flag) => flag.code === "duplicate-stock")).toBe(false);
  });

  it("does not let an invalid-date duplicate suppress a valid delivered sale", () => {
    const valid = sale(1, { stock: "SHARED-INVALID" });
    const malformed = {
      ...sale(2, { stock: " shared-invalid " }),
      saleDate: "2026-08-32",
    };
    const result = calculateMonth([valid, malformed], "2026-08", DEFAULT_PAY_PLAN);

    expect(result.deliveredCount).toBe(1);
    expect(result.frontGrossCents).toBe(100_000);
    expect(result.duplicateGroupCount).toBe(0);
    expect(result.calculatedSales.find((item) => item.sale.id === valid.id)?.flags
      .some((flag) => flag.code === "duplicate-stock")).toBe(false);
    expect(result.calculatedSales.find((item) => item.sale.id === malformed.id)?.flags
      .some((flag) => flag.code === "invalid-date")).toBe(true);
  });

  it("excludes every delivered record in a duplicate stock group", () => {
    const distinct = Array.from({ length: 11 }, (_, index) => sale(index));
    const duplicate = sale(20, { stock: "2026-08-stk-0", front: 100_000, fi: 10_000 });
    const result = calculateMonth([...distinct, duplicate], "2026-08", DEFAULT_PAY_PLAN);
    expect(result.deliveredCount).toBe(10);
    expect(result.frontRateBps).toBe(3_000);
    expect(result.frontGrossCents).toBe(1_000_000);
    expect(result.fiGrossCents).toBe(100_000);
    expect(result.estimatedCommissionCents).toBe(320_000);
    expect(result.calculatedSales.filter((item) => item.flags.some((flag) => flag.code === "duplicate-stock"))).toHaveLength(2);
  });

  it("reports duplicate groups only when they affect the selected month", () => {
    const january = sale(1, { month: "2026-01", stock: " CROSS-1 " });
    const february = sale(1, { month: "2026-02", stock: "cross-1" });
    expect(calculateMonth([january, february], "2026-01", DEFAULT_PAY_PLAN).duplicateGroupCount).toBe(1);
    expect(calculateMonth([january, february], "2026-03", DEFAULT_PAY_PLAN).duplicateGroupCount).toBe(0);
  });

  it("ignores a soft-deleted duplicate", () => {
    const active = sale(1, { stock: "KEEP-1" });
    const deleted = { ...sale(2, { stock: " keep-1 " }), deletedAt: "2026-08-20T12:00:00.000Z" };
    const result = calculateMonth([active, deleted], "2026-08", DEFAULT_PAY_PLAN);
    expect(result.deliveredCount).toBe(1);
    expect(result.duplicateGroupCount).toBe(0);
  });

  it("uses effective-dated plans for historical calculations", () => {
    const januaryPlan = { ...DEFAULT_PAY_PLAN, version: "Jan plan", effectiveMonth: "2026-01" };
    const augustPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "Aug plan",
      effectiveMonth: "2026-08",
      baseFrontRateBps: 3_200,
    };
    const januaryResult = calculateMonth(
      [sale(1, { month: "2026-01", front: 100_000, fi: 0 })],
      "2026-01",
      [januaryPlan, augustPlan],
    );
    const augustResult = calculateMonth(
      [sale(1, { month: "2026-08", front: 100_000, fi: 0 })],
      "2026-08",
      [januaryPlan, augustPlan],
    );
    expect(januaryResult.frontCommissionCents).toBe(30_000);
    expect(januaryResult.payPlanVersion).toBe("Jan plan");
    expect(augustResult.frontCommissionCents).toBe(32_000);
    expect(augustResult.payPlanVersion).toBe("Aug plan");
  });

  it("refuses to calculate a month before the earliest pay plan", () => {
    const januaryPlan = { ...DEFAULT_PAY_PLAN, version: "Jan plan", effectiveMonth: "2026-01" };
    expect(() =>
      calculateMonth(
        [sale(1, { month: "2025-12", front: 100_000, fi: 0 })],
        "2025-12",
        [januaryPlan],
      ),
    ).toThrow(/No pay plan covers 2025-12/);
  });

  it("tracks half-deal credit without multiplying gross or commission", () => {
    const result = calculateMonth(
      [sale(1, { unit: 500, front: 100_000, fi: 10_000 })],
      "2026-08",
      DEFAULT_PAY_PLAN,
    );
    expect(result.deliveredCount).toBe(1);
    expect(result.creditedUnitsBasis).toBe(500);
    expect(result.estimatedCommissionCents).toBe(32_000);
  });

  it("resets the threshold at each calendar month boundary", () => {
    const january = Array.from({ length: 10 }, (_, index) => sale(index, { month: "2026-01" }));
    const february = sale(1, { month: "2026-02", front: 200_000, fi: 50_000 });
    expect(calculateMonth([...january, february], "2026-01", DEFAULT_PAY_PLAN).estimatedCommissionCents).toBe(320_000);
    expect(calculateMonth([...january, february], "2026-02", DEFAULT_PAY_PLAN).estimatedCommissionCents).toBe(70_000);
  });

  it("includes the cumulative bonus in estimated commission", () => {
    const eleven = Array.from({ length: 11 }, (_, index) => sale(index));
    const result = calculateMonth(eleven, "2026-08", DEFAULT_PAY_PLAN);
    expect(result.potentialBonusCents).toBe(30_000);
    expect(result.bonusIncludedCents).toBe(30_000);
    expect(result.estimatedCommissionCents).toBe(result.coreCommissionCents + 30_000);
  });

  it("uses cumulative milestone bonus totals at every boundary", () => {
    const cases: Array<[number, number]> = [
      [10, 0], [11, 30_000], [14, 30_000], [15, 110_000], [19, 110_000],
      [20, 210_000], [24, 210_000], [25, 360_000], [29, 360_000],
      [30, 560_000], [34, 560_000], [35, 810_000], [40, 810_000],
    ];
    for (const [delivered, expected] of cases) {
      expect(getPotentialBonus(delivered, DEFAULT_PAY_PLAN.bonusTiers)).toBe(expected);
    }
  });

  it("includes the full cumulative total at 35", () => {
    const records = Array.from({ length: 35 }, (_, index) => sale(index));
    const result = calculateMonth(records, "2026-08", DEFAULT_PAY_PLAN);
    expect(result.potentialBonusCents).toBe(810_000);
    expect(result.bonusIncludedCents).toBe(810_000);
    expect(result.estimatedCommissionCents).toBe(result.coreCommissionCents + 810_000);
  });

  it("rounds integer cents half away from zero", () => {
    expect(multiplyCentsByBps(123_456, 3_000)).toBe(37_037);
    expect(multiplyCentsByBps(78_901, 2_000)).toBe(15_780);
    expect(multiplyCentsByBps(123_456, 3_500)).toBe(43_210);
    expect(multiplyCentsByBps(-100_005, 3_000)).toBe(-30_002);
  });

  it("reconciles per-sale allocation to aggregate monthly totals", () => {
    const records = [
      sale(1, { front: 1, fi: 1 }),
      sale(2, { front: 1, fi: 1 }),
      sale(3, { front: 1, fi: 1 }),
    ];
    const result = calculateMonth(records, "2026-08", DEFAULT_PAY_PLAN);
    expect(result.calculatedSales.reduce((sum, item) => sum + item.frontCommissionCents, 0)).toBe(result.frontCommissionCents);
    expect(result.calculatedSales.reduce((sum, item) => sum + item.fiCommissionCents, 0)).toBe(result.fiCommissionCents);
  });

  it("matches the verified yearly fixture", () => {
    const records = [
      sale(1, { month: "2026-01", front: 100_000, fi: 0 }),
      ...Array.from({ length: 2 }, (_, index) => sale(index, { month: "2026-02", front: 200_000, fi: 50_000 })),
      ...Array.from({ length: 11 }, (_, index) =>
        sale(index, {
          month: "2026-03",
          front: index === 10 ? 200_000 : 100_000,
          fi: index === 10 ? 50_000 : 10_000,
        }),
      ),
    ];
    const year = calculateYear(records, 2026, DEFAULT_PAY_PLAN, {});
    expect(year.reduce((sum, month) => sum + month.deliveredCount, 0)).toBe(14);
    expect(year.reduce((sum, month) => sum + month.frontGrossCents, 0)).toBe(1_700_000);
    expect(year.reduce((sum, month) => sum + month.fiGrossCents, 0)).toBe(250_000);
    expect(year.reduce((sum, month) => sum + month.frontCommissionCents, 0)).toBe(570_000);
    expect(year.reduce((sum, month) => sum + month.fiCommissionCents, 0)).toBe(50_000);
    expect(year.reduce((sum, month) => sum + month.estimatedCommissionCents, 0)).toBe(650_000);
  });

  it("omits uncovered months instead of applying a future plan in a partial-coverage year", () => {
    const decemberPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "December 2025 plan",
      effectiveMonth: "2025-12",
    };
    const year = calculateYear([], 2025, [decemberPlan], {});
    expect(year.map((month) => month.monthKey)).toEqual(["2025-12"]);
  });

  it("preserves global duplicate rules and refreshes them between annual calculations", () => {
    const previousYear = sale(1, { month: "2025-12", stock: "REUSED" });
    const deletedPreviousYear = {
      ...sale(2, { month: "2025-12", stock: "DELETED" }),
      deletedAt: "2026-01-01T12:00:00.000Z",
    };
    const records = [
      previousYear,
      sale(1, { month: "2026-01", stock: " reused " }),
      sale(2, { month: "2026-01", stock: "SAFE" }),
      sale(1, { month: "2099-01", stock: "SAFE" }),
      { ...sale(1, { month: "2026-02", stock: "SAFE" }), saleDate: "2026-02-30" },
      deletedPreviousYear,
      sale(1, { month: "2026-07", stock: "DELETED" }),
    ];
    const julyPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "July plan",
      effectiveMonth: "2026-07",
      baseFrontRateBps: 4_000,
      acceleratedFrontRateBps: 4_500,
    };
    const plans = [DEFAULT_PAY_PLAN, julyPlan];
    const actualPaid = { "2026-01": 33_000 };
    const firstYear = calculateYear(records, 2026, plans, actualPaid);

    expect(firstYear[0].deliveredCount).toBe(1);
    expect(firstYear[0].duplicateGroupCount).toBe(1);
    expect(firstYear[0].payrollVarianceCents).toBe(1_000);
    expect(firstYear[6].estimatedCommissionCents).toBe(42_000);
    for (const month of firstYear) {
      expect(month).toEqual(calculateMonth(
        records,
        month.monthKey,
        plans,
        month.monthKey === "2026-01" ? actualPaid["2026-01"] : null,
      ));
    }

    previousYear.deletedAt = "2026-09-02T12:00:00.000Z";
    const refreshedYear = calculateYear(records, 2026, plans, actualPaid);
    expect(refreshedYear[0].deliveredCount).toBe(2);
    expect(refreshedYear[0].duplicateGroupCount).toBe(0);
    expect(refreshedYear[0].estimatedCommissionCents).toBe(64_000);
  });
});
