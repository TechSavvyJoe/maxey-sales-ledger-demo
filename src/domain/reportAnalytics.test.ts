import { describe, expect, it } from "vitest";
import { calculateFrontCommission, calculateMonth, DEFAULT_PAY_PLAN } from "@/domain/commission";
import {
  calculateBundleReportRows,
  calculateFinancingGroupRows,
  calculateMonthReportAnalytics,
  calculatePeriodReportAnalytics,
  calculateProductReportRows,
  calculateReportAnalytics,
  compareReportAnalytics,
} from "@/domain/reportAnalytics";
import type { CalculatedSale, Sale } from "@/domain/types";

function calculatedSale(
  id: string,
  overrides: Partial<Sale> & { countsTowardVolume?: boolean } = {},
): CalculatedSale {
  const countsTowardVolume = overrides.countsTowardVolume ?? true;
  const sale: Sale = {
    id,
    profileId: "primary",
    saleDate: "2026-08-05",
    customerLastName: "Sample",
    stockNumber: id.toUpperCase(),
    vehicleDescription: "Sample vehicle",
    status: "delivered",
    unitCreditBasis: 1_000,
    frontGrossCents: 100_000,
    fiGrossCents: 20_000,
    notes: "",
    createdAt: "2026-08-05T12:00:00.000Z",
    updatedAt: "2026-08-05T12:00:00.000Z",
    revision: 1,
    ...overrides,
  };
  const front = calculateFrontCommission(sale, 3_000, DEFAULT_PAY_PLAN);
  return {
    sale,
    normalizedStock: sale.stockNumber,
    monthKey: sale.saleDate.slice(0, 7),
    countsTowardVolume,
    deliveryOrdinal: countsTowardVolume ? 1 : null,
    milestone: null,
    commissionReady: countsTowardVolume && front.frontCommissionMethod !== "awaiting",
    frontRateBps: 3_000,
    frontCommissionMethod: countsTowardVolume ? front.frontCommissionMethod : "excluded",
    minimumFrontCommissionCents: front.minimumFrontCommissionCents,
    commissionableFrontGrossCents: countsTowardVolume ? front.commissionableFrontGrossCents : 0,
    frontCommissionCents: countsTowardVolume
      ? front.frontCommissionCents
      : 0,
    fiCommissionCents: countsTowardVolume
      ? Math.round((sale.fiGrossCents ?? 0) * 0.2)
      : 0,
    estimatedCommissionCents: countsTowardVolume
      ? front.frontCommissionCents
        + Math.round((sale.fiGrossCents ?? 0) * 0.2)
      : 0,
    flags: [],
  };
}

function rawSale(id: string, month: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id,
    profileId: "primary",
    saleDate: `${month}-05`,
    customerLastName: "Sample",
    stockNumber: id.toUpperCase(),
    vehicleDescription: "Sample vehicle",
    status: "delivered",
    unitCreditBasis: 1_000,
    frontGrossCents: 100_000,
    fiGrossCents: 20_000,
    notes: "",
    createdAt: `${month}-05T12:00:00.000Z`,
    updatedAt: `${month}-05T12:00:00.000Z`,
    revision: 1,
    ...overrides,
  };
}

describe("report population", () => {
  it("separates valid delivered deals, credited units, pending rows, exclusions, and provided deletions", () => {
    const analytics = calculateReportAnalytics([
      calculatedSale("full"),
      calculatedSale("split", { unitCreditBasis: 500 }),
      calculatedSale("pending", { status: "pending", countsTowardVolume: false }),
      calculatedSale("excluded", { countsTowardVolume: false }),
      calculatedSale("deleted", { deletedAt: "2026-08-06T12:00:00.000Z" }),
    ]);

    expect(analytics.population).toEqual({
      analyzedRecordCount: 5,
      activeRecordCount: 4,
      deliveredDealCount: 2,
      creditedUnitsBasis: 1_500,
      creditedUnits: 1.5,
      pendingRecordCount: 1,
      deletedRecordCount: 1,
      excludedDeliveredRecordCount: 1,
    });
  });
});

describe("product, bundle, and financing analytics", () => {
  const portfolio = [
    calculatedSale("a", {
      fiGrossCents: 100_000,
      serviceContractSold: true,
      tireWheelSold: true,
      gapSold: true,
      dealerFinanced: true,
    }),
    calculatedSale("b", {
      unitCreditBasis: 500,
      fiGrossCents: 50_000,
      serviceContractSold: true,
      tireWheelSold: false,
      gapSold: false,
      dealerFinanced: true,
    }),
    calculatedSale("c", {
      fiGrossCents: 30_000,
      serviceContractSold: false,
      tireWheelSold: true,
      gapSold: true,
      dealerFinanced: false,
    }),
    calculatedSale("d", {
      fiGrossCents: 0,
      serviceContractSold: false,
      tireWheelSold: false,
      gapSold: false,
      dealerFinanced: false,
    }),
    calculatedSale("legacy", {
      fiGrossCents: null,
    }),
  ];

  it("uses every valid delivered deal as the explicit penetration denominator", () => {
    const analytics = calculateReportAnalytics(portfolio);
    expect(analytics.population).toMatchObject({
      deliveredDealCount: 5,
      creditedUnits: 4.5,
    });
    expect(analytics.products.serviceContract).toEqual({
      eligibleDealCount: 5,
      yesCount: 2,
      noCount: 2,
      unmarkedCount: 1,
      recordedCount: 4,
      penetrationRate: 0.4,
      trackingCompletionRate: 0.8,
    });
    expect(analytics.finance.dealerFinance).toMatchObject({
      eligibleDealCount: 5,
      yesCount: 2,
      noCount: 2,
      unmarkedCount: 1,
      penetrationRate: 0.4,
    });
  });

  it("calculates product mix without turning legacy unknowns into No", () => {
    const products = calculateReportAnalytics(portfolio).products;
    expect(products).toMatchObject({
      totalProductUnitsSold: 6,
      averageProductsPerDeliveredDeal: 1.2,
      fullyTrackedDealCount: 4,
      incompletelyTrackedDealCount: 1,
      confirmedNoProductDealCount: 1,
      anyProduct: {
        qualifyingDealCount: 3,
        confirmedNotQualifyingDealCount: 1,
        undeterminedDealCount: 1,
        penetrationRate: 0.6,
      },
      twoOrMoreProducts: {
        qualifyingDealCount: 2,
        confirmedNotQualifyingDealCount: 2,
        undeterminedDealCount: 1,
        penetrationRate: 0.4,
      },
      allThreeProducts: {
        qualifyingDealCount: 1,
        confirmedNotQualifyingDealCount: 3,
        undeterminedDealCount: 1,
        penetrationRate: 0.2,
      },
      inclusivePairCounts: {
        serviceContractAndTireWheel: 1,
        serviceContractAndGap: 1,
        tireWheelAndGap: 2,
      },
      exactMix: {
        noProducts: 1,
        serviceContractOnly: 1,
        tireWheelOnly: 0,
        gapOnly: 0,
        serviceContractAndTireWheel: 0,
        serviceContractAndGap: 0,
        tireWheelAndGap: 1,
        allThreeProducts: 1,
        incompleteTracking: 1,
      },
    });
  });

  it("keeps overlapping deal-level F&I gross cohorts explicitly non-additive", () => {
    const rows = calculateProductReportRows(portfolio);
    expect(rows.map((row) => row.label)).toEqual([
      "Service contract / warranty",
      "Tire & Wheel",
      "GAP",
    ]);
    expect(rows[0]).toMatchObject({
      key: "serviceContract",
      soldCount: 2,
      cohortTotalFiGrossCents: 150_000,
      averageCohortTotalFiGrossPerMatchingDealCents: 75_000,
    });
    expect(rows[1]).toMatchObject({
      soldCount: 2,
      cohortTotalFiGrossCents: 130_000,
    });
    expect(rows[2]).toMatchObject({
      soldCount: 2,
      cohortTotalFiGrossCents: 130_000,
    });
    expect(rows.reduce((total, row) => total + row.cohortTotalFiGrossCents, 0)).toBe(410_000);
    expect(calculateReportAnalytics(portfolio).gross.fi.totalCents).toBe(180_000);
  });

  it("returns inclusive bundle cohorts with count, penetration, gross, and average", () => {
    const rows = calculateBundleReportRows(portfolio);
    expect(rows.find((row) => row.key === "tireWheelAndGap")).toMatchObject({
      dealCount: 2,
      eligibleDealCount: 5,
      penetrationRate: 0.4,
      cohortTotalFiGrossCents: 130_000,
      cohortFiGrossEnteredCount: 2,
      averageCohortTotalFiGrossPerMatchingDealCents: 65_000,
    });
    expect(rows.find((row) => row.key === "allThreeProducts")).toMatchObject({
      dealCount: 1,
      cohortTotalFiGrossCents: 100_000,
    });
  });

  it("groups dealer financed, not dealer financed, and unmarked deals without guessing", () => {
    const rows = calculateFinancingGroupRows(portfolio);
    expect(rows.map((row) => [row.key, row.dealCount])).toEqual([
      ["dealerFinanced", 2],
      ["cash", 0],
      ["outsideFinancing", 0],
      ["notDealerFinanced", 2],
      ["unmarked", 1],
    ]);
    expect(rows[0]).toMatchObject({
      eligibleDealCount: 5,
      shareOfDeliveredDealsRate: 0.4,
      fiGrossCents: 150_000,
      averageFiGrossPerDealCents: 75_000,
      fiGrossEnteredCount: 2,
      fiGrossMissingCount: 0,
    });
    expect(rows.find((row) => row.key === "unmarked")).toMatchObject({
      shareOfDeliveredDealsRate: 0.2,
      fiGrossCents: 0,
      averageFiGrossPerDealCents: null,
      fiGrossEnteredCount: 0,
      fiGrossMissingCount: 1,
    });
  });

  it("reports cash and outside financing separately while preserving legacy unknowns", () => {
    const analytics = calculateReportAnalytics([
      calculatedSale("dealer", { paymentMethod: "dealer_financed", dealerFinanced: false, gapSold: true, unitCreditBasis: 500 }),
      calculatedSale("cash", { paymentMethod: "cash", dealerFinanced: true, gapSold: true }),
      calculatedSale("outside", { paymentMethod: "outside_financing", dealerFinanced: true, gapSold: true }),
      calculatedSale("legacy-dealer", { dealerFinanced: true, gapSold: false }),
      calculatedSale("legacy-no", { dealerFinanced: false, gapSold: false }),
      calculatedSale("unmarked"),
    ]);
    expect(analytics.financingRows.map((row) => [row.key, row.dealCount])).toEqual([
      ["dealerFinanced", 2],
      ["cash", 1],
      ["outsideFinancing", 1],
      ["notDealerFinanced", 1],
      ["unmarked", 1],
    ]);
    expect(analytics.financingRows.reduce((total, row) => total + row.dealCount, 0)).toBe(6);
    expect(analytics.financingRows.reduce((total, row) => total + row.fiGrossCents, 0)).toBe(analytics.gross.fi.totalCents);
    expect(analytics.finance.dealerFinance).toMatchObject({
      eligibleDealCount: 6,
      yesCount: 2,
      noCount: 3,
      unmarkedCount: 1,
      penetrationRate: 1 / 3,
    });
    expect(analytics.products.gap.penetrationRate).toBe(0.5);
    expect(analytics.finance.gapOnDealerFinanced).toMatchObject({ eligibleDealCount: 2, yesCount: 1, penetrationRate: 0.5 });
    expect(analytics.finance.segments.cash.dealCount).toBe(1);
    expect(analytics.finance.segments.outsideFinancing.dealCount).toBe(1);
    expect(analytics.finance.segments.notDealerFinanced.dealCount).toBe(1);
    expect(analytics.quality).toMatchObject({ recordedFinanceOutcomeCount: 5, unmarkedFinanceOutcomeCount: 1 });
  });

  it("keeps dealer-financed GAP penetration distinct from the all-sales rate", () => {
    const analytics = calculateReportAnalytics([
      calculatedSale("financed-yes", { dealerFinanced: true, gapSold: true, unitCreditBasis: 500 }),
      calculatedSale("financed-no", { dealerFinanced: true, gapSold: false }),
      calculatedSale("financed-unmarked", { dealerFinanced: true }),
      calculatedSale("outside-yes", { dealerFinanced: false, gapSold: true }),
      calculatedSale("financing-unmarked", { gapSold: true }),
      calculatedSale("excluded", { dealerFinanced: true, gapSold: true, countsTowardVolume: false }),
    ]);
    expect(analytics.products.gap.penetrationRate).toBe(3 / 5);
    expect(analytics.finance.gapOnDealerFinanced).toEqual({
      eligibleDealCount: 3,
      yesCount: 1,
      noCount: 1,
      unmarkedCount: 1,
      recordedCount: 2,
      penetrationRate: 1 / 3,
      trackingCompletionRate: 2 / 3,
    });
    expect(calculateReportAnalytics([
      calculatedSale("outside-only", { dealerFinanced: false, gapSold: true }),
    ]).finance.gapOnDealerFinanced.penetrationRate).toBeNull();
  });

  it("exposes reporting-completeness counts separately from sales outcomes", () => {
    expect(calculateReportAnalytics(portfolio).quality).toEqual({
      eligibleDealCount: 5,
      fullyTrackedProductDealCount: 4,
      incompletelyTrackedProductDealCount: 1,
      fullyTrackedAllOutcomesDealCount: 4,
      dealsWithAnyUnmarkedOutcomeCount: 1,
      recordedProductOutcomeCount: 12,
      unmarkedProductOutcomeCount: 3,
      recordedFinanceOutcomeCount: 4,
      unmarkedFinanceOutcomeCount: 1,
      frontGrossEnteredCount: 5,
      frontGrossMissingCount: 0,
      frontCommissionMissingCount: 0,
      fiGrossEnteredCount: 4,
      fiGrossMissingCount: 1,
    });
  });
});

describe("gross and commission analytics", () => {
  it("distinguishes missing money from an entered zero in PVR and F&I earning yield", () => {
    const missing = calculateReportAnalytics([
      calculatedSale("missing", {
        frontGrossCents: null,
        fiGrossCents: null,
        serviceContractSold: true,
        tireWheelSold: true,
        dealerFinanced: true,
      }),
    ]);
    expect(missing.gross.fi.totalCents).toBe(0);
    expect(missing.gross.fi.averagePerDeliveredDealCents).toBeNull();
    expect(missing.gross.front.averagePerDeliveredDealCents).toBeNull();
    expect(missing.gross.averageTotalGrossPerDeliveredDealCents).toBeNull();
    expect(missing.commission.averageFiCommissionPerDeliveredDealCents).toBeNull();
    expect(missing.financingRows[0].averageFiGrossPerDealCents).toBeNull();
    expect(missing.productRows[0].averageCohortTotalFiGrossPerMatchingDealCents).toBeNull();
    expect(missing.bundleRows[0].averageCohortTotalFiGrossPerMatchingDealCents).toBeNull();

    const zero = calculateReportAnalytics([calculatedSale("zero", { fiGrossCents: 0 })]);
    expect(zero.gross.fi.averagePerDeliveredDealCents).toBe(0);
    expect(zero.commission.averageFiCommissionPerDeliveredDealCents).toBe(0);
  });

  it("uses every delivered deal for recorded PVR and allocated F&I commission per sale", () => {
    const analytics = calculateReportAnalytics([
      calculatedSale("earned", { fiGrossCents: 120_000, unitCreditBasis: 500 }),
      calculatedSale("zero", { fiGrossCents: 0 }),
      calculatedSale("not-entered", { fiGrossCents: null }),
    ]);
    expect(analytics.population.creditedUnits).toBe(2.5);
    expect(analytics.gross.fi.averagePerDeliveredDealCents).toBe(40_000);
    expect(analytics.gross.fi.enteredCount).toBe(2);
    expect(analytics.commission.averageFiCommissionPerDeliveredDealCents).toBe(8_000);
    expect(calculateReportAnalytics([]).commission.averageFiCommissionPerDeliveredDealCents).toBeNull();
  });

  it("keeps missing, zero, positive, and negative gross values distinct", () => {
    const analytics = calculateReportAnalytics([
      calculatedSale("missing", { frontGrossCents: null, fiGrossCents: null }),
      calculatedSale("zero", { frontGrossCents: 0, fiGrossCents: 0 }),
      calculatedSale("positive", { frontGrossCents: 100_000, fiGrossCents: 50_000 }),
      calculatedSale("negative", { frontGrossCents: -20_000, fiGrossCents: -10_000 }),
    ]);
    expect(analytics.gross.front).toMatchObject({
      eligibleDealCount: 4,
      enteredCount: 3,
      missingCount: 1,
      positiveCount: 1,
      zeroCount: 1,
      negativeCount: 1,
      totalCents: 80_000,
      averagePerDeliveredDealCents: 20_000,
      averagePerEnteredDealCents: 26_667,
      positiveAmountPenetrationRate: 0.25,
    });
    expect(analytics.gross.fi).toMatchObject({
      totalCents: 40_000,
      averagePerDeliveredDealCents: 10_000,
      averagePerEnteredDealCents: 13_333,
    });
    expect(analytics.gross).toMatchObject({
      totalGrossCents: 120_000,
      averageTotalGrossPerDeliveredDealCents: 30_000,
      bothAmountsEnteredDealCount: 3,
      fiShareOfTotalGrossRate: 1 / 3,
    });
  });

  it("returns null ratios and averages for a zero-deal denominator", () => {
    const analytics = calculateReportAnalytics([]);
    expect(analytics.products.serviceContract.penetrationRate).toBeNull();
    expect(analytics.products.averageProductsPerDeliveredDeal).toBeNull();
    expect(analytics.finance.dealerFinance.penetrationRate).toBeNull();
    expect(analytics.gross.front.averagePerDeliveredDealCents).toBeNull();
    expect(analytics.gross.fiShareOfTotalGrossRate).toBeNull();
    expect(analytics.commission.averageEstimatedCommissionPerDeliveredDealCents).toBeNull();
    expect(analytics.productRows.every((row) => row.penetrationRate === null)).toBe(true);
    expect(analytics.financingRows.every((row) => row.shareOfDeliveredDealsRate === null)).toBe(true);
  });

  it("uses monthly bonus and actual-paid totals without changing core commission", () => {
    const sales = Array.from({ length: 11 }, (_, index) =>
      rawSale(`bonus-${index}`, "2026-08"),
    );
    const withoutActual = calculateMonth(sales, "2026-08", DEFAULT_PAY_PLAN);
    const summary = calculateMonth(
      sales,
      "2026-08",
      DEFAULT_PAY_PLAN,
      withoutActual.estimatedCommissionCents + 12_345,
    );
    const analytics = calculateMonthReportAnalytics(summary);
    expect(analytics.commission).toMatchObject({
      frontCommissionCents: summary.frontCommissionCents,
      fiCommissionCents: summary.fiCommissionCents,
      coreCommissionCents: summary.coreCommissionCents,
      bonusIncludedCents: 30_000,
      estimatedCommissionCents: summary.estimatedCommissionCents,
      actualPaidCents: summary.estimatedCommissionCents + 12_345,
      actualPaidPeriodCount: 1,
      reconciledEstimatedCommissionCents: summary.estimatedCommissionCents,
      payrollVarianceCents: 12_345,
    });
  });

  it("reconciles only period months that have an actual-paid value", () => {
    const januaryBase = calculateMonth(
      [rawSale("jan", "2026-01")],
      "2026-01",
      DEFAULT_PAY_PLAN,
    );
    const january = calculateMonth(
      [rawSale("jan", "2026-01")],
      "2026-01",
      DEFAULT_PAY_PLAN,
      januaryBase.estimatedCommissionCents + 1_000,
    );
    const february = calculateMonth(
      [rawSale("feb", "2026-02")],
      "2026-02",
      DEFAULT_PAY_PLAN,
    );
    const period = calculatePeriodReportAnalytics([january, february]);
    expect(period.commission).toMatchObject({
      actualPaidCents: january.actualPaidCents,
      actualPaidPeriodCount: 1,
      reconciledEstimatedCommissionCents: january.estimatedCommissionCents,
      payrollVarianceCents: 1_000,
      estimatedCommissionCents:
        january.estimatedCommissionCents + february.estimatedCommissionCents,
    });
  });
});

describe("recorded-period comparisons", () => {
  it("returns absolute and relative changes when both values have a valid basis", () => {
    const previous = calculateReportAnalytics([
      calculatedSale("previous", {
        frontGrossCents: 100_000,
        fiGrossCents: 20_000,
        serviceContractSold: false,
      }),
    ]);
    const current = calculateReportAnalytics([
      calculatedSale("current-1", {
        frontGrossCents: 100_000,
        fiGrossCents: 20_000,
        serviceContractSold: true,
      }),
      calculatedSale("current-2", {
        frontGrossCents: 100_000,
        fiGrossCents: 20_000,
        serviceContractSold: false,
      }),
    ]);
    const comparison = compareReportAnalytics(current, previous);
    expect(comparison.deliveredDeals).toEqual({
      current: 2,
      previous: 1,
      absoluteChange: 1,
      relativeChangeRate: 1,
      direction: "up",
    });
    expect(comparison.frontGrossPerDealCents).toMatchObject({
      current: 100_000,
      previous: 100_000,
      absoluteChange: 0,
      relativeChangeRate: 0,
      direction: "flat",
    });
    expect(comparison.serviceContractPenetrationRate).toMatchObject({
      current: 0.5,
      previous: 0,
      absoluteChange: 0.5,
      percentagePointChange: 50,
      relativeChangeRate: null,
      direction: "up",
    });
  });

  it("does not invent a trend when either period has no eligible denominator", () => {
    const comparison = compareReportAnalytics(
      calculateReportAnalytics([calculatedSale("current", { gapSold: true })]),
      calculateReportAnalytics([]),
    );
    expect(comparison.gapPenetrationRate).toEqual({
      current: 1,
      previous: null,
      absoluteChange: null,
      percentagePointChange: null,
      relativeChangeRate: null,
      direction: "not-comparable",
    });
    expect(comparison.fiGrossPerDealCents.direction).toBe("not-comparable");
  });
});
