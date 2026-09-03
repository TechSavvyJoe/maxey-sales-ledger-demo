import { describe, expect, it } from "vitest";
import {
  calculateFiPenetration,
  calculateWeeklyPerformance,
  getStoreWeeksForMonth,
} from "@/domain/weeklyPerformance";
import type { CalculatedSale, MonthSummary, Sale } from "@/domain/types";

type FiFields = {
  serviceContractSold?: boolean;
  tireWheelSold?: boolean;
  gapSold?: boolean;
  dealerFinanced?: boolean;
};

function calculatedSale({
  id,
  date,
  unitCreditBasis = 1_000,
  frontGrossCents = 100_000,
  fiGrossCents = 20_000,
  estimatedCommissionCents = 34_000,
  countsTowardVolume = true,
  ...fiFields
}: {
  id: string;
  date: string;
  unitCreditBasis?: number;
  frontGrossCents?: number | null;
  fiGrossCents?: number | null;
  estimatedCommissionCents?: number;
  countsTowardVolume?: boolean;
} & FiFields): CalculatedSale {
  const sale: Sale & FiFields = {
    id,
    profileId: "primary",
    saleDate: date,
    customerLastName: "Sample",
    stockNumber: id.toUpperCase(),
    vehicleDescription: "Sample vehicle",
    status: "delivered",
    unitCreditBasis,
    frontGrossCents,
    fiGrossCents,
    notes: "",
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    revision: 1,
    ...fiFields,
  };
  return {
    sale,
    normalizedStock: sale.stockNumber,
    monthKey: date.slice(0, 7),
    countsTowardVolume,
    commissionReady: countsTowardVolume,
    frontRateBps: 3_000,
    frontCommissionMethod: "percentage",
    minimumFrontCommissionCents: 30_000 * unitCreditBasis / 1_000,
    commissionableFrontGrossCents: Math.max(frontGrossCents ?? 0, 0),
    frontCommissionCents: Math.round((frontGrossCents ?? 0) * 0.3),
    fiCommissionCents: Math.round((fiGrossCents ?? 0) * 0.2),
    estimatedCommissionCents,
    flags: [],
  };
}

function summary(monthKey: string, calculatedSales: CalculatedSale[]): MonthSummary {
  const valid = calculatedSales.filter((item) => item.countsTowardVolume);
  return {
    monthKey,
    payPlanVersion: "Test plan",
    payPlanEffectiveMonth: "2026-01",
    deliveredCount: valid.length,
    creditedUnitsBasis: valid.reduce((total, item) => total + item.sale.unitCreditBasis, 0),
    pendingCount: 0,
    frontRateBps: 3_000,
    frontGrossCents: valid.reduce((total, item) => total + (item.sale.frontGrossCents ?? 0), 0),
    commissionableFrontGrossCents: valid.reduce((total, item) => total + item.commissionableFrontGrossCents, 0),
    minimumFrontCommissionCents: 30_000,
    miniDealCount: 0,
    manualFrontCommissionCount: 0,
    fiGrossCents: valid.reduce((total, item) => total + (item.sale.fiGrossCents ?? 0), 0),
    frontCommissionCents: valid.reduce((total, item) => total + item.frontCommissionCents, 0),
    fiCommissionCents: valid.reduce((total, item) => total + item.fiCommissionCents, 0),
    coreCommissionCents: valid.reduce((total, item) => total + item.estimatedCommissionCents, 0),
    potentialBonusCents: 0,
    bonusIncludedCents: 0,
    estimatedCommissionCents: valid.reduce((total, item) => total + item.estimatedCommissionCents, 0),
    actualPaidCents: null,
    payrollVarianceCents: null,
    duplicateGroupCount: 0,
    reviewCount: 0,
    retroactiveUpliftCents: 0,
    calculatedSales,
  };
}

describe("store week calendar", () => {
  it("uses Monday-Saturday weeks, omits Sundays, and honors month boundaries", () => {
    const weeks = getStoreWeeksForMonth("2026-08");
    expect(weeks.map((week) => [week.startDate, week.endDate])).toEqual([
      ["2026-08-01", "2026-08-01"],
      ["2026-08-03", "2026-08-08"],
      ["2026-08-10", "2026-08-15"],
      ["2026-08-17", "2026-08-22"],
      ["2026-08-24", "2026-08-29"],
      ["2026-08-31", "2026-08-31"],
    ]);
    expect(weeks.flatMap((week) => week.openDates)).not.toContain("2026-08-02");
    expect(weeks[0]).toMatchObject({
      id: "2026-07-27",
      closedSundayDate: "2026-08-02",
    });
  });

  it("starts a midweek month inside that month instead of leaking prior-month dates", () => {
    const [first] = getStoreWeeksForMonth("2026-09");
    expect(first).toMatchObject({
      id: "2026-08-31",
      startDate: "2026-09-01",
      endDate: "2026-09-05",
    });
    expect(first?.openDates.every((date) => date.startsWith("2026-09-"))).toBe(true);
  });
});

describe("weekly performance and goal requirements", () => {
  it("calculates actual weekly production, half-deal credit, gross, and core commission", () => {
    const result = calculateWeeklyPerformance({
      summary: summary("2026-08", [
        calculatedSale({ id: "full", date: "2026-08-10", estimatedCommissionCents: 34_000 }),
        calculatedSale({
          id: "half",
          date: "2026-08-12",
          unitCreditBasis: 500,
          frontGrossCents: 200_000,
          fiGrossCents: 50_000,
          estimatedCommissionCents: 70_000,
        }),
      ]),
      monthlyGoal: 15,
      daysOff: [],
      todayDate: "2026-08-15",
    });
    const current = result.weeks.find((week) => week.state === "current");
    expect(current).toMatchObject({
      startDate: "2026-08-10",
      deliveredCount: 2,
      creditedUnitsBasis: 1_500,
      creditedUnits: 1.5,
      frontGrossCents: 300_000,
      fiGrossCents: 70_000,
      estimatedCoreCommissionCents: 104_000,
      elapsedWorkdays: 6,
      remainingWorkdays: 0,
    });
  });

  it("turns a monthly goal into current-week and remaining-month requirements", () => {
    const records = Array.from({ length: 5 }, (_, index) =>
      calculatedSale({ id: `d${index}`, date: `2026-08-${String(3 + index * 2).padStart(2, "0")}` }),
    );
    const result = calculateWeeklyPerformance({
      summary: summary("2026-08", records),
      monthlyGoal: 15,
      daysOff: ["2026-08-05"],
      todayDate: "2026-08-15",
    });
    expect(result.goal).toMatchObject({
      monthlyGoal: 15,
      deliveredToDate: 5,
      scheduledWorkdays: 25,
      elapsedWorkdays: 12,
      remainingWorkdays: 13,
      currentWeekTarget: 8,
      neededByEndOfCurrentWeek: 3,
      remainingToGoal: 10,
      remainingAfterCurrentWeekTarget: 7,
    });
    expect(result.goal.requiredPerRemainingWorkday).toBeCloseTo(10 / 13);
    expect(result.goal.expectedDeliveriesToDate).toBeCloseTo(7.2);
    expect(result.goal.status).toBe("behind");
  });

  it("excludes days off from weekly pace and preserves them on the owning week", () => {
    const result = calculateWeeklyPerformance({
      summary: summary("2026-08", [calculatedSale({ id: "one", date: "2026-08-10" })]),
      monthlyGoal: 10,
      daysOff: ["2026-08-11", "2026-08-15", "2026-08-16"],
      todayDate: "2026-08-15",
    });
    const current = result.weeks.find((week) => week.state === "current");
    expect(current).toMatchObject({
      daysOff: ["2026-08-11", "2026-08-15"],
      scheduledWorkdays: 4,
      elapsedWorkdays: 4,
      remainingWorkdays: 0,
    });
    expect(result.daysOff).toEqual(["2026-08-11", "2026-08-15"]);
  });

  it("treats Sunday as the closed end of the current store week", () => {
    const result = calculateWeeklyPerformance({
      summary: summary("2026-08", [calculatedSale({ id: "one", date: "2026-08-15" })]),
      monthlyGoal: 15,
      daysOff: [],
      todayDate: "2026-08-16",
    });
    const current = result.weeks.find((week) => week.state === "current");
    expect(current).toMatchObject({
      startDate: "2026-08-10",
      endDate: "2026-08-15",
      closedSundayDate: "2026-08-16",
      elapsedWorkdays: 6,
      remainingWorkdays: 0,
    });
  });

  it("labels past and future weeks without forecasting sales", () => {
    const past = calculateWeeklyPerformance({
      summary: summary("2026-07", [calculatedSale({ id: "past", date: "2026-07-06" })]),
      monthlyGoal: 15,
      daysOff: [],
      todayDate: "2026-08-15",
    });
    expect(past.weeks.every((week) => week.state === "past")).toBe(true);
    expect(past.goal).toMatchObject({
      status: "complete",
      remainingWorkdays: 0,
      requiredPerRemainingWorkday: null,
      neededByEndOfCurrentWeek: null,
    });

    const future = calculateWeeklyPerformance({
      summary: summary("2026-09", []),
      monthlyGoal: 15,
      daysOff: [],
      todayDate: "2026-08-15",
    });
    expect(future.weeks.every((week) => week.state === "future")).toBe(true);
    expect(future.goal).toMatchObject({
      status: "future",
      deliveredToDate: 0,
      expectedDeliveriesToDate: 0,
      neededByEndOfCurrentWeek: null,
    });
    expect(future.weeks.every((week) => week.deliveredCount === 0)).toBe(true);
  });

  it("handles zero deliveries without false rates or run rates", () => {
    const result = calculateWeeklyPerformance({
      summary: summary("2026-08", []),
      monthlyGoal: 15,
      daysOff: [],
      todayDate: "2026-08-01",
    });
    expect(result.monthToDate).toMatchObject({
      deliveredCount: 0,
      creditedUnits: 0,
      estimatedCoreCommissionCents: 0,
    });
    expect(result.monthToDate.fi.serviceContract.rate).toBeNull();
    expect(result.monthToDate.fi.averageFiGrossPerDeliveredCents).toBeNull();
    expect(result.goal.deliveriesPerElapsedWorkday).toBe(0);
    expect(result.goal.status).toBe("behind");
  });

  it("does not assign a Sunday delivery to a Monday-Saturday performance row", () => {
    const result = calculateWeeklyPerformance({
      summary: summary("2026-08", [
        calculatedSale({ id: "sunday", date: "2026-08-16" }),
      ]),
      monthlyGoal: 15,
      daysOff: [],
      todayDate: "2026-08-16",
    });
    expect(result.sundayDeliveryCount).toBe(1);
    expect(result.monthToDate.deliveredCount).toBe(1);
    expect(result.weeks.reduce((total, week) => total + week.deliveredCount, 0)).toBe(0);
  });
});

describe("F&I penetration", () => {
  it("tracks product and dealer-finance penetration among valid delivered deals", () => {
    const sales = [
      calculatedSale({
        id: "a",
        date: "2026-08-03",
        serviceContractSold: true,
        tireWheelSold: true,
        gapSold: false,
        dealerFinanced: true,
      }),
      calculatedSale({
        id: "b",
        date: "2026-08-04",
        serviceContractSold: false,
        tireWheelSold: true,
        gapSold: true,
        dealerFinanced: true,
      }),
      calculatedSale({
        id: "c",
        date: "2026-08-05",
        fiGrossCents: null,
        serviceContractSold: true,
      }),
      calculatedSale({
        id: "excluded",
        date: "2026-08-06",
        countsTowardVolume: false,
        serviceContractSold: true,
        tireWheelSold: true,
        gapSold: true,
        dealerFinanced: true,
      }),
    ];
    const fi = calculateFiPenetration(sales);
    expect(fi).toMatchObject({
      eligibleDealCount: 3,
      fiGrossEnteredCount: 2,
      positiveFiGrossCount: 2,
      totalFiGrossCents: 40_000,
      averageFiGrossPerDeliveredCents: 13_333,
      serviceContract: {
        soldCount: 2,
        eligibleDealCount: 3,
        recordedCount: 3,
        unrecordedCount: 0,
      },
      tireWheel: {
        soldCount: 2,
        recordedCount: 2,
        unrecordedCount: 1,
      },
      gap: {
        soldCount: 1,
        recordedCount: 2,
        unrecordedCount: 1,
      },
      dealerFinanced: {
        soldCount: 2,
        recordedCount: 2,
        unrecordedCount: 1,
      },
    });
    expect(fi.serviceContract.rate).toBeCloseTo(2 / 3);
    expect(fi.tireWheel.rate).toBeCloseTo(2 / 3);
    expect(fi.gap.rate).toBeCloseTo(1 / 3);
    expect(fi.dealerFinanced.rate).toBeCloseTo(2 / 3);
  });

  it("uses delivered deals, not credited units, as the penetration denominator", () => {
    const fi = calculateFiPenetration([
      calculatedSale({
        id: "half",
        date: "2026-08-03",
        unitCreditBasis: 500,
        serviceContractSold: true,
      }),
    ]);
    expect(fi.eligibleDealCount).toBe(1);
    expect(fi.serviceContract).toMatchObject({ soldCount: 1, eligibleDealCount: 1, rate: 1 });
  });

  it("returns null penetration and average gross when there are no eligible deals", () => {
    const fi = calculateFiPenetration([]);
    expect(fi.eligibleDealCount).toBe(0);
    expect(fi.serviceContract.rate).toBeNull();
    expect(fi.tireWheel.rate).toBeNull();
    expect(fi.gap.rate).toBeNull();
    expect(fi.dealerFinanced.rate).toBeNull();
    expect(fi.averageFiGrossPerDeliveredCents).toBeNull();
  });
});
