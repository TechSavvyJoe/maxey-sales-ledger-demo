import { describe, expect, it } from "vitest";
import { calculateFrontCommission, calculateMonth, calculateYear, DEFAULT_PAY_PLAN } from "@/domain/commission";
import { calculateCommissionRunRate, calculateHigherRateOpportunity, calculateMonthlyPerformance } from "@/domain/performance";
import { getMinimumFrontCommissionCents, payPlanStructureChanged, validatePayPlan } from "@/domain/payPlan";
import { calculateMonthReportAnalytics, calculatePeriodReportAnalytics } from "@/domain/reportAnalytics";
import { getAttentionRecords } from "@/domain/attention";
import { calculateWorkdayPace } from "@/domain/pacing";
import type { Sale } from "@/domain/types";

function sale(id: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id, profileId: "primary", saleDate: "2026-08-03", customerLastName: "Example",
    stockNumber: id, vehicleDescription: "Fictional vehicle", status: "delivered",
    unitCreditBasis: 1_000, frontGrossCents: -31_661, fiGrossCents: null, notes: "",
    createdAt: "2026-08-03T12:00:00Z", updatedAt: "2026-08-03T12:00:00Z", revision: 1,
    ...overrides,
  };
}

describe("Mini and personal manual front commission", () => {
  it.each([-100_000, -31_661, 0, 1, 50_000, 99_999, 100_000])("pays the $300 Mini for %s cents front gross at 30%%", (frontGrossCents) => {
    const result = calculateMonth([sale("mini", { frontGrossCents })], "2026-08", DEFAULT_PAY_PLAN);
    expect(result.frontCommissionCents).toBe(30_000);
    expect(result.frontGrossCents).toBe(frontGrossCents);
    expect(result.calculatedSales[0].frontCommissionMethod).toBe("mini");
    expect(getAttentionRecords(result.calculatedSales, "2026-08-15")).toEqual([]);
  });

  it("never lets a loss reduce another deal's pay or commissionable gross", () => {
    const result = calculateMonth([sale("loss"), sale("profit", { frontGrossCents: 200_000, fiGrossCents: 60_000 })], "2026-08", DEFAULT_PAY_PLAN);
    expect(result.frontGrossCents).toBe(168_339);
    expect(result.commissionableFrontGrossCents).toBe(200_000);
    expect(result.frontCommissionCents).toBe(90_000);
    expect(result.fiCommissionCents).toBe(12_000);
    expect(result.estimatedCommissionCents).toBe(102_000);
  });

  it("prorates only the Mini for split credit, not already-entered gross or manual pay", () => {
    const half = sale("half", { unitCreditBasis: 500 });
    expect(calculateFrontCommission(half, 3_000, DEFAULT_PAY_PLAN).frontCommissionCents).toBe(15_000);
    expect(calculateFrontCommission({ ...half, frontGrossCents: 100_000 }, 3_000, DEFAULT_PAY_PLAN).frontCommissionCents).toBe(30_000);
    expect(calculateFrontCommission({ ...half, frontCommissionOverrideCents: 50_000 }, 3_000, DEFAULT_PAY_PLAN).frontCommissionCents).toBe(50_000);
    expect(calculateFrontCommission({ ...half, unitCreditBasis: 250 }, 3_000, DEFAULT_PAY_PLAN).frontCommissionCents).toBe(7_500);
  });

  it.each([0, 1, 10_000, 50_000, 100_000_000])("honors exact personal override %s regardless of gross, floor, and rate", (frontCommissionOverrideCents) => {
    const record = sale("manual", { frontCommissionOverrideCents, fiGrossCents: 60_000 });
    for (const frontGrossCents of [-100_000, 0, 900_000, null]) {
      for (const rate of [3_000, 3_500]) {
        const front = calculateFrontCommission({ ...record, frontGrossCents }, rate, DEFAULT_PAY_PLAN);
        expect(front.frontCommissionCents).toBe(frontCommissionOverrideCents);
        expect(front.frontCommissionMethod).toBe("manual");
      }
    }
    expect(calculateMonth([record], "2026-08", DEFAULT_PAY_PLAN).fiCommissionCents).toBe(12_000);
  });

  it("clearing an override returns to automatic Mini or percentage pay", () => {
    expect(calculateFrontCommission(sale("reset", { frontCommissionOverrideCents: null }), 3_000, DEFAULT_PAY_PLAN).frontCommissionCents).toBe(30_000);
    expect(calculateFrontCommission(sale("reset", { frontCommissionOverrideCents: null, frontGrossCents: 200_000 }), 3_000, DEFAULT_PAY_PLAN).frontCommissionCents).toBe(60_000);
  });

  it("keeps missing gross distinct from zero and permits known manual pay without inventing gross", () => {
    const summary = calculateMonth([sale("awaiting", { frontGrossCents: null }), sale("manual", { frontGrossCents: null, frontCommissionOverrideCents: 50_000 })], "2026-08", DEFAULT_PAY_PLAN);
    expect(summary.frontGrossCents).toBe(0);
    expect(summary.frontCommissionCents).toBe(50_000);
    expect(summary.calculatedSales.map((item) => item.commissionReady)).toEqual([false, true]);
    const performance = calculateMonthlyPerformance(summary);
    expect(performance.missingFrontGrossCount).toBe(2);
    expect(performance.missingFrontCommissionCount).toBe(1);
    const report = calculateMonthReportAnalytics(summary);
    expect(report.quality.frontGrossMissingCount).toBe(2);
    expect(report.quality.frontCommissionMissingCount).toBe(1);
    expect(summary.calculatedSales[1].flags).toEqual([]);
  });

  it("re-rates percentage sales but not unchanged Minis or fixed manual payouts", () => {
    const records = [sale("loss"), sale("threshold", { frontGrossCents: 90_000 }), sale("manual", { frontGrossCents: 500_000, frontCommissionOverrideCents: 50_000 }),
      ...Array.from({ length: 7 }, (_, i) => sale(`normal-${i}`, { frontGrossCents: 200_000 }))];
    const ten = calculateMonth(records, "2026-08", DEFAULT_PAY_PLAN);
    const eleven = calculateMonth([...records, sale("eleventh")], "2026-08", DEFAULT_PAY_PLAN);
    expect(eleven.frontRateBps).toBe(3_500);
    expect(eleven.retroactiveUpliftCents).toBe(71_500);
    expect(calculateHigherRateOpportunity(ten, DEFAULT_PAY_PLAN).recordedGrossUpliftCents).toBe(71_500);
    expect(eleven.frontCommissionCents).toBe(ten.frontCommissionCents + 30_000 + 71_500);
    expect(eleven.bonusIncludedCents).toBe(30_000);
  });

  it("does not pay Minis or overrides on excluded, pending, or deleted records", () => {
    const records = [sale("pending", { status: "pending", frontCommissionOverrideCents: 99_999 }),
      sale("deleted", { deletedAt: "2026-08-04T00:00:00Z" }),
      sale("dup1", { stockNumber: "duplicate", frontCommissionOverrideCents: 50_000 }),
      sale("dup2", { stockNumber: "duplicate" })];
    const result = calculateMonth(records, "2026-08", DEFAULT_PAY_PLAN);
    expect(result.deliveredCount).toBe(0);
    expect(result.frontCommissionCents).toBe(0);
    expect(result.calculatedSales.every((item) => item.frontCommissionMethod === "excluded")).toBe(true);
  });

  it("uses configurable and effective-dated Minis, retaining legacy default and explicit zero", () => {
    const legacy = { ...DEFAULT_PAY_PLAN, minimumFrontCommissionCents: undefined };
    expect(getMinimumFrontCommissionCents(legacy)).toBe(30_000);
    expect(payPlanStructureChanged(legacy, DEFAULT_PAY_PLAN)).toBe(false);
    const custom = { ...DEFAULT_PAY_PLAN, effectiveMonth: "2026-08", minimumFrontCommissionCents: 40_000 };
    expect(payPlanStructureChanged(DEFAULT_PAY_PLAN, custom)).toBe(true);
    const plans = [legacy, custom];
    const july = sale("july", { saleDate: "2026-07-01" });
    expect(calculateMonth([july], "2026-07", plans).frontCommissionCents).toBe(30_000);
    expect(calculateMonth([sale("august")], "2026-08", plans).frontCommissionCents).toBe(40_000);
    expect(calculateMonth([sale("zero")], "2026-08", { ...custom, minimumFrontCommissionCents: 0 }).frontCommissionCents).toBe(0);
  });

  it.each([-1, 1.5, NaN, Infinity, 100_000_001])("rejects invalid Mini %s", (minimumFrontCommissionCents) => {
    expect(validatePayPlan({ ...DEFAULT_PAY_PLAN, minimumFrontCommissionCents }).valid).toBe(false);
  });

  it("keeps month, year, reports and payroll reconciled to per-sale payouts", () => {
    const records = [sale("loss"), sale("split", { unitCreditBasis: 500 }), sale("manual", { frontCommissionOverrideCents: 50_001 })];
    const summary = calculateMonth(records, "2026-08", DEFAULT_PAY_PLAN, 95_001);
    const year = calculateYear(records, 2026, DEFAULT_PAY_PLAN, { "2026-08": 95_001 });
    const analytics = calculatePeriodReportAnalytics(year);
    expect(summary.frontCommissionCents).toBe(95_001);
    expect(summary.payrollVarianceCents).toBe(0);
    expect(analytics.commission.frontCommissionCents).toBe(95_001);
    expect(analytics.commission.miniDealCount).toBe(2);
    expect(analytics.commission.manualFrontCommissionCount).toBe(1);
    expect(analytics.gross.front.totalCents).toBe(-94_983);
    expect(analytics.commission.commissionableFrontGrossCents).toBe(0);
  });

  it("projects Minis without turning negative gross into negative income, or repeating a spiff", () => {
    const summary = calculateMonth([sale("loss"), sale("spiff", { frontCommissionOverrideCents: 100_000 })], "2026-08", DEFAULT_PAY_PLAN);
    const pace = calculateWorkdayPace({ monthKey: "2026-08", deliveredCount: 2, monthlyGoal: 20, daysOff: [], todayDate: "2026-08-03" });
    const projected = calculateCommissionRunRate(summary, { ...pace, projectedDeliveries: 4 }, DEFAULT_PAY_PLAN)!;
    expect(projected.low.frontGrossCents).toBe(-126_644);
    expect(projected.low.frontCommissionCents).toBe(190_000); // existing $1,300 + two ordinary $300 Minis
    expect(projected.high.frontCommissionCents).toBe(190_000);
    expect(calculateHigherRateOpportunity(summary, DEFAULT_PAY_PLAN).recordedGrossUpliftCents).toBe(0);
  });
});
