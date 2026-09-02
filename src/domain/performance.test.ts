import { describe, expect, it } from "vitest";
import { calculateMonth, calculateYear, DEFAULT_PAY_PLAN } from "@/domain/commission";
import {
  calculateCommissionRunRate,
  calculateEarningsGoalProgress,
  calculateHigherRateOpportunity,
  calculateMonthlyPerformance,
  calculatePeriodPerformance,
  calculateRollingBaseline,
} from "@/domain/performance";
import type { WorkdayPace } from "@/domain/pacing";
import type { Sale } from "@/domain/types";

function deliveredSale(
  id: string,
  month: string,
  frontGrossCents: number | null,
  fiGrossCents: number | null,
): Sale {
  return {
    id,
    profileId: "primary",
    saleDate: `${month}-05`,
    customerLastName: "Sample",
    stockNumber: id.toUpperCase(),
    vehicleDescription: "Sample vehicle",
    status: "delivered",
    unitCreditBasis: 1_000,
    frontGrossCents,
    fiGrossCents,
    notes: "",
    createdAt: `${month}-05T12:00:00.000Z`,
    updatedAt: `${month}-05T12:00:00.000Z`,
    revision: 1,
  };
}

function pace(projectedDeliveries: number | null, status: WorkdayPace["status"] = "on-pace"): WorkdayPace {
  return {
    status,
    scheduledWorkdays: 24,
    elapsedWorkdays: 12,
    remainingWorkdays: 12,
    daysOff: [],
    projectedDeliveries,
    deliveriesPerElapsedWorkday: projectedDeliveries === null ? null : projectedDeliveries / 24,
    expectedDeliveriesToDate: 7.5,
    deliveriesToGoal: 7,
    requiredPerRemainingWorkday: 7 / 12,
  };
}

describe("performance analytics", () => {
  it("uses null averages for an empty month", () => {
    const performance = calculateMonthlyPerformance(calculateMonth([], "2026-08", DEFAULT_PAY_PLAN));
    expect(performance).toMatchObject({
      deliveredCount: 0,
      frontGrossPerDeliveryCents: null,
      fiGrossPerDeliveryCents: null,
      totalGrossPerDeliveryCents: null,
      coreCommissionPerDeliveryCents: null,
      estimatedCommissionPerDeliveryCents: null,
    });
  });

  it("keeps missing, zero, positive, and negative F&I amounts distinct", () => {
    const sales = [
      deliveredSale("a", "2026-08", null, null),
      deliveredSale("b", "2026-08", 100_000, 0),
      deliveredSale("c", "2026-08", 200_000, 50_000),
      deliveredSale("d", "2026-08", 300_000, -10_000),
    ];
    const performance = calculateMonthlyPerformance(calculateMonth(sales, "2026-08", DEFAULT_PAY_PLAN));
    expect(performance).toMatchObject({
      deliveredCount: 4,
      frontGrossPerDeliveryCents: 150_000,
      fiGrossPerDeliveryCents: 10_000,
      fiAmountEnteredCount: 3,
      positiveFiGrossCount: 1,
      missingFrontGrossCount: 1,
    });
  });

  it("calculates weighted period performance and reconciles only entered payroll months", () => {
    const sales = [
      deliveredSale("j1", "2026-01", 100_000, 0),
      deliveredSale("f1", "2026-02", 300_000, 60_000),
      deliveredSale("f2", "2026-02", 300_000, 60_000),
    ];
    const months = calculateYear(sales, 2026, DEFAULT_PAY_PLAN, {
      "2026-01": 50_000,
      "2026-02": null,
    });
    const period = calculatePeriodPerformance(months, "2026-02");
    expect(period.deliveredCount).toBe(3);
    expect(period.frontGrossPerDeliveryCents).toBe(233_333);
    expect(period.actualPaidMonthCount).toBe(1);
    expect(period.reconciledEstimateCents).toBe(months[0]!.estimatedCommissionCents);
    expect(period.payrollVarianceCents).toBe(50_000 - months[0]!.estimatedCommissionCents);
  });

  it("builds a rolling baseline from the months before the selected month", () => {
    const months = calculateYear([
      deliveredSale("m1", "2026-05", 100_000, 0),
      deliveredSale("j1", "2026-06", 200_000, 0),
      deliveredSale("j2", "2026-07", 300_000, 0),
      deliveredSale("a1", "2026-08", 900_000, 0),
    ], 2026, DEFAULT_PAY_PLAN, {});
    const baseline = calculateRollingBaseline(months, "2026-08", 3);
    expect(baseline.monthCount).toBe(3);
    expect(baseline.deliveredCount).toBe(3);
    expect(baseline.frontGrossPerDeliveryCents).toBe(200_000);
  });

  it("projects a range across the more-than-10 threshold and cumulative bonus", () => {
    const sales = Array.from({ length: 10 }, (_, index) =>
      deliveredSale(`s${index}`, "2026-08", 200_000, 50_000),
    );
    const summary = calculateMonth(sales, "2026-08", DEFAULT_PAY_PLAN);
    const runRate = calculateCommissionRunRate(summary, pace(10.6), DEFAULT_PAY_PLAN);
    expect(runRate?.low).toMatchObject({
      deliveredCount: 10,
      frontRateBps: 3_000,
      bonusCents: 0,
      estimatedCommissionCents: summary.estimatedCommissionCents,
    });
    expect(runRate?.high.deliveredCount).toBe(11);
    expect(runRate?.high.frontRateBps).toBe(3_500);
    expect(runRate?.high.bonusCents).toBe(30_000);
    expect(runRate!.high.estimatedCommissionCents).toBeGreaterThan(runRate!.low.estimatedCommissionCents);
  });

  it("shows the exact higher-rate opportunity on gross already recorded", () => {
    const sales = Array.from({ length: 10 }, (_, index) =>
      deliveredSale(`o${index}`, "2026-08", 200_000, 0),
    );
    const summary = calculateMonth(sales, "2026-08", DEFAULT_PAY_PLAN);
    expect(calculateHigherRateOpportunity(summary, DEFAULT_PAY_PLAN)).toEqual({
      deliveriesRemaining: 1,
      recordedGrossUpliftCents: 100_000,
      isEarned: false,
    });
  });

  it("does not invent a run rate before the first valid delivery", () => {
    const summary = calculateMonth([], "2026-08", DEFAULT_PAY_PLAN);
    expect(calculateCommissionRunRate(summary, pace(null, "not-started"), DEFAULT_PAY_PLAN)).toBeNull();
  });

  it("does not describe a closed month as an active projection", () => {
    const summary = calculateMonth(
      [deliveredSale("closed", "2026-08", 200_000, 50_000)],
      "2026-08",
      DEFAULT_PAY_PLAN,
    );
    expect(calculateCommissionRunRate(summary, pace(1, "complete"), DEFAULT_PAY_PLAN)).toBeNull();
  });

  it("evaluates an optional earnings goal against the projection range", () => {
    const sales = Array.from({ length: 10 }, (_, index) =>
      deliveredSale(`g${index}`, "2026-08", 200_000, 50_000),
    );
    const summary = calculateMonth(sales, "2026-08", DEFAULT_PAY_PLAN);
    const runRate = calculateCommissionRunRate(summary, pace(10.6), DEFAULT_PAY_PLAN)!;
    const goal = calculateEarningsGoalProgress({
      currentEstimatedCommissionCents: summary.estimatedCommissionCents,
      goalCents: runRate.high.estimatedCommissionCents,
      remainingWorkdays: 12,
      paceStatus: "on-pace",
      runRate,
    });
    expect(goal?.status).toBe("within-range");
    expect(goal?.remainingCents).toBeGreaterThan(0);
    expect(goal?.requiredPerRemainingWorkdayCents).toBeGreaterThan(0);
  });
});
