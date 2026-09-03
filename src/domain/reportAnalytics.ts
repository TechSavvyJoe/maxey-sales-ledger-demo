import type { CalculatedSale, MonthSummary, Sale } from "@/domain/types";
import { dealerFinancingOutcome, getPaymentMethod } from "@/domain/financing";

export type ProductOutcomeField =
  | "serviceContractSold"
  | "tireWheelSold"
  | "gapSold";

export type ReportProductKey = "serviceContract" | "tireWheel" | "gap";

export interface TrackedProductDefinition {
  key: ReportProductKey;
  label: string;
  field: ProductOutcomeField;
}

export const TRACKED_PRODUCT_DEFINITIONS: readonly TrackedProductDefinition[] = [
  {
    key: "serviceContract",
    label: "Service contract / warranty",
    field: "serviceContractSold",
  },
  {
    key: "tireWheel",
    label: "Tire & Wheel",
    field: "tireWheelSold",
  },
  { key: "gap", label: "GAP", field: "gapSold" },
] as const;

export interface OutcomePenetrationMetric {
  /** Every valid delivered deal is eligible, including legacy records that are not marked. */
  eligibleDealCount: number;
  yesCount: number;
  noCount: number;
  unmarkedCount: number;
  recordedCount: number;
  /** Yes divided by every eligible delivered deal. Null means there are no eligible deals. */
  penetrationRate: number | null;
  /** Recorded outcomes divided by every eligible delivered deal. */
  trackingCompletionRate: number | null;
}

export interface ThresholdPenetrationMetric {
  eligibleDealCount: number;
  qualifyingDealCount: number;
  confirmedNotQualifyingDealCount: number;
  undeterminedDealCount: number;
  /** Qualifying deals divided by every eligible delivered deal. */
  penetrationRate: number | null;
}

export interface ExactProductMix {
  noProducts: number;
  serviceContractOnly: number;
  tireWheelOnly: number;
  gapOnly: number;
  serviceContractAndTireWheel: number;
  serviceContractAndGap: number;
  tireWheelAndGap: number;
  allThreeProducts: number;
  /** Records with at least one unmarked product cannot be assigned an exact mix. */
  incompleteTracking: number;
}

export interface ProductPortfolioAnalytics {
  serviceContract: OutcomePenetrationMetric;
  tireWheel: OutcomePenetrationMetric;
  gap: OutcomePenetrationMetric;
  totalProductUnitsSold: number;
  averageProductsPerDeliveredDeal: number | null;
  fullyTrackedDealCount: number;
  incompletelyTrackedDealCount: number;
  anyProduct: ThresholdPenetrationMetric;
  twoOrMoreProducts: ThresholdPenetrationMetric;
  allThreeProducts: ThresholdPenetrationMetric;
  /** A deal is counted only when all three product outcomes are explicitly No. */
  confirmedNoProductDealCount: number;
  /** Inclusive pair counts; an all-three deal appears in each applicable pair. */
  inclusivePairCounts: {
    serviceContractAndTireWheel: number;
    serviceContractAndGap: number;
    tireWheelAndGap: number;
  };
  exactMix: ExactProductMix;
}

export interface ProductReportRow extends TrackedProductDefinition {
  eligibleDealCount: number;
  soldCount: number;
  noCount: number;
  recordedCount: number;
  unmarkedCount: number;
  penetrationRate: number | null;
  trackingCompletionRate: number | null;
  /** Total F&I gross on matching deals; overlapping product rows must not be summed. */
  cohortTotalFiGrossCents: number;
  cohortFiGrossEnteredCount: number;
  averageCohortTotalFiGrossPerMatchingDealCents: number | null;
  positiveFiGrossDealCount: number;
}

export type BundleReportKey =
  | "serviceContractAndTireWheel"
  | "serviceContractAndGap"
  | "tireWheelAndGap"
  | "allThreeProducts";

export interface BundleReportRow {
  key: BundleReportKey;
  label: string;
  productFields: ProductOutcomeField[];
  dealCount: number;
  eligibleDealCount: number;
  penetrationRate: number | null;
  /** Total F&I gross on matching deals; inclusive bundle rows overlap. */
  cohortTotalFiGrossCents: number;
  cohortFiGrossEnteredCount: number;
  averageCohortTotalFiGrossPerMatchingDealCents: number | null;
}

export type FinancingGroupKey = "dealerFinanced" | "cash" | "outsideFinancing" | "notDealerFinanced" | "unmarked";

export interface FinancingGroupReportRow extends ProductAttachmentSegment {
  key: FinancingGroupKey;
  label: string;
  eligibleDealCount: number;
  shareOfDeliveredDealsRate: number | null;
}

export interface AmountCoverageMetric {
  eligibleDealCount: number;
  enteredCount: number;
  missingCount: number;
  positiveCount: number;
  zeroCount: number;
  negativeCount: number;
  totalCents: number;
  /** Recorded total divided by all delivered deals; null until an amount is entered. */
  averagePerDeliveredDealCents: number | null;
  /** Total divided only by deals with an entered amount. */
  averagePerEnteredDealCents: number | null;
  /** Positive entered amounts divided by all eligible delivered deals. */
  positiveAmountPenetrationRate: number | null;
}

export interface ProductAttachmentSegment {
  dealCount: number;
  creditedUnitsBasis: number;
  creditedUnits: number;
  fiGrossCents: number;
  fiGrossEnteredCount: number;
  fiGrossMissingCount: number;
  averageFiGrossPerDealCents: number | null;
  positiveFiGrossDealCount: number;
  products: ProductPortfolioAnalytics;
}

export interface ReportPopulationAnalytics {
  /** Number of CalculatedSale records provided to this analysis call. */
  analyzedRecordCount: number;
  activeRecordCount: number;
  deliveredDealCount: number;
  creditedUnitsBasis: number;
  creditedUnits: number;
  pendingRecordCount: number;
  /** Deleted records are visible only when the caller includes them in calculatedSales. */
  deletedRecordCount: number;
  /** Active Delivered records that fail the commission engine's valid-delivery rules. */
  excludedDeliveredRecordCount: number;
}

export interface ReportGrossAnalytics {
  front: AmountCoverageMetric;
  fi: AmountCoverageMetric;
  totalGrossCents: number;
  averageTotalGrossPerDeliveredDealCents: number | null;
  bothAmountsEnteredDealCount: number;
  /** F&I share of combined recorded gross. Null when combined gross is not positive. */
  fiShareOfTotalGrossRate: number | null;
  /** Cohorts are descriptive; they do not attribute total F&I gross to an individual product. */
  byProductAttachment: {
    anyProduct: ProductAttachmentSegment;
    confirmedNoProduct: ProductAttachmentSegment;
    productOutcomeUndetermined: ProductAttachmentSegment;
  };
}

export interface ReportFinanceAnalytics {
  dealerFinance: OutcomePenetrationMetric;
  /** GAP Yes divided by dealer-financed delivered deals; not every GAP-eligible deal. */
  gapOnDealerFinanced: OutcomePenetrationMetric;
  segments: {
    dealerFinanced: ProductAttachmentSegment;
    cash: ProductAttachmentSegment;
    outsideFinancing: ProductAttachmentSegment;
    /** Legacy No answer without enough detail to classify cash versus outside financing. */
    notDealerFinanced: ProductAttachmentSegment;
    financeOutcomeUnmarked: ProductAttachmentSegment;
  };
}

export interface ReportCommissionAnalytics {
  frontCommissionCents: number;
  fiCommissionCents: number;
  coreCommissionCents: number;
  bonusIncludedCents: number;
  estimatedCommissionCents: number;
  /** Allocated F&I commission per delivered deal; null when all F&I gross is missing. */
  averageFiCommissionPerDeliveredDealCents: number | null;
  averageCoreCommissionPerDeliveredDealCents: number | null;
  averageEstimatedCommissionPerDeliveredDealCents: number | null;
  actualPaidCents: number | null;
  actualPaidPeriodCount: number;
  reconciledEstimatedCommissionCents: number | null;
  payrollVarianceCents: number | null;
}

export interface ReportDataQualityAnalytics {
  eligibleDealCount: number;
  fullyTrackedProductDealCount: number;
  incompletelyTrackedProductDealCount: number;
  fullyTrackedAllOutcomesDealCount: number;
  dealsWithAnyUnmarkedOutcomeCount: number;
  recordedProductOutcomeCount: number;
  unmarkedProductOutcomeCount: number;
  recordedFinanceOutcomeCount: number;
  unmarkedFinanceOutcomeCount: number;
  frontGrossEnteredCount: number;
  frontGrossMissingCount: number;
  fiGrossEnteredCount: number;
  fiGrossMissingCount: number;
}

export interface ReportAnalytics {
  population: ReportPopulationAnalytics;
  products: ProductPortfolioAnalytics;
  productRows: ProductReportRow[];
  bundleRows: BundleReportRow[];
  finance: ReportFinanceAnalytics;
  financingRows: FinancingGroupReportRow[];
  gross: ReportGrossAnalytics;
  commission: ReportCommissionAnalytics;
  quality: ReportDataQualityAnalytics;
}

export interface ReportAnalyticsOptions {
  bonusIncludedCents?: number;
  /** Use a period engine total when it includes bonuses or other period-level logic. */
  estimatedCommissionCents?: number;
  actualPaidCents?: number | null;
  actualPaidPeriodCount?: number;
  /** Estimate for only the periods that have an Actual paid value. */
  reconciledEstimatedCommissionCents?: number | null;
}

export type ComparisonDirection = "up" | "down" | "flat" | "not-comparable";

export interface ReportMetricComparison {
  current: number | null;
  previous: number | null;
  absoluteChange: number | null;
  /** Relative change as a ratio. Null when the prior value is zero or either value is absent. */
  relativeChangeRate: number | null;
  direction: ComparisonDirection;
}

export interface ReportRateComparison extends ReportMetricComparison {
  /** Current rate minus previous rate, expressed in percentage points. */
  percentagePointChange: number | null;
}

export interface ReportAnalyticsComparison {
  deliveredDeals: ReportMetricComparison;
  creditedUnits: ReportMetricComparison;
  frontGrossCents: ReportMetricComparison;
  fiGrossCents: ReportMetricComparison;
  totalGrossCents: ReportMetricComparison;
  frontGrossPerDealCents: ReportMetricComparison;
  fiGrossPerDealCents: ReportMetricComparison;
  totalGrossPerDealCents: ReportMetricComparison;
  estimatedCommissionCents: ReportMetricComparison;
  estimatedCommissionPerDealCents: ReportMetricComparison;
  serviceContractPenetrationRate: ReportRateComparison;
  tireWheelPenetrationRate: ReportRateComparison;
  gapPenetrationRate: ReportRateComparison;
  dealerFinancePenetrationRate: ReportRateComparison;
  anyProductPenetrationRate: ReportRateComparison;
  productsPerDeal: ReportMetricComparison;
}

const PRODUCT_FIELDS: ProductOutcomeField[] = TRACKED_PRODUCT_DEFINITIONS.map(
  (definition) => definition.field,
);

function average(total: number, count: number): number | null {
  return count > 0 ? Math.round(total / count) : null;
}

function eligibleDelivered(items: CalculatedSale[]): CalculatedSale[] {
  return items.filter(
    (item) =>
      !item.sale.deletedAt
      && item.sale.status === "delivered"
      && item.countsTowardVolume,
  );
}

function outcomeMetric(
  deals: CalculatedSale[],
  field: ProductOutcomeField | "dealerFinanced",
): OutcomePenetrationMetric {
  const eligibleDealCount = deals.length;
  const outcomes = deals.map((item) => field === "dealerFinanced"
    ? dealerFinancingOutcome(item.sale) : item.sale[field]);
  const yesCount = outcomes.filter((outcome) => outcome === true).length;
  const noCount = outcomes.filter((outcome) => outcome === false).length;
  const recordedCount = yesCount + noCount;
  return {
    eligibleDealCount,
    yesCount,
    noCount,
    unmarkedCount: eligibleDealCount - recordedCount,
    recordedCount,
    penetrationRate: eligibleDealCount > 0 ? yesCount / eligibleDealCount : null,
    trackingCompletionRate: eligibleDealCount > 0 ? recordedCount / eligibleDealCount : null,
  };
}

function thresholdMetric(
  deals: CalculatedSale[],
  minimumProducts: number,
): ThresholdPenetrationMetric {
  let qualifyingDealCount = 0;
  let confirmedNotQualifyingDealCount = 0;
  let undeterminedDealCount = 0;

  for (const item of deals) {
    const outcomes = PRODUCT_FIELDS.map((field) => item.sale[field]);
    const yesCount = outcomes.filter((value) => value === true).length;
    const unmarkedCount = outcomes.filter((value) => typeof value !== "boolean").length;
    if (yesCount >= minimumProducts) {
      qualifyingDealCount += 1;
    } else if (yesCount + unmarkedCount < minimumProducts) {
      confirmedNotQualifyingDealCount += 1;
    } else {
      undeterminedDealCount += 1;
    }
  }

  return {
    eligibleDealCount: deals.length,
    qualifyingDealCount,
    confirmedNotQualifyingDealCount,
    undeterminedDealCount,
    penetrationRate: deals.length > 0 ? qualifyingDealCount / deals.length : null,
  };
}

function exactProductMix(deals: CalculatedSale[]): ExactProductMix {
  const result: ExactProductMix = {
    noProducts: 0,
    serviceContractOnly: 0,
    tireWheelOnly: 0,
    gapOnly: 0,
    serviceContractAndTireWheel: 0,
    serviceContractAndGap: 0,
    tireWheelAndGap: 0,
    allThreeProducts: 0,
    incompleteTracking: 0,
  };

  for (const item of deals) {
    const service = item.sale.serviceContractSold;
    const tireWheel = item.sale.tireWheelSold;
    const gap = item.sale.gapSold;
    if ([service, tireWheel, gap].some((value) => typeof value !== "boolean")) {
      result.incompleteTracking += 1;
      continue;
    }
    const signature = `${service ? 1 : 0}${tireWheel ? 1 : 0}${gap ? 1 : 0}`;
    const key = {
      "000": "noProducts",
      "100": "serviceContractOnly",
      "010": "tireWheelOnly",
      "001": "gapOnly",
      "110": "serviceContractAndTireWheel",
      "101": "serviceContractAndGap",
      "011": "tireWheelAndGap",
      "111": "allThreeProducts",
    }[signature] as keyof Omit<ExactProductMix, "incompleteTracking">;
    result[key] += 1;
  }
  return result;
}

function calculateProductPortfolio(deals: CalculatedSale[]): ProductPortfolioAnalytics {
  const totalProductUnitsSold = deals.reduce(
    (total, item) =>
      total + PRODUCT_FIELDS.filter((field) => item.sale[field] === true).length,
    0,
  );
  const fullyTrackedDealCount = deals.filter((item) =>
    PRODUCT_FIELDS.every((field) => typeof item.sale[field] === "boolean"),
  ).length;
  return {
    serviceContract: outcomeMetric(deals, "serviceContractSold"),
    tireWheel: outcomeMetric(deals, "tireWheelSold"),
    gap: outcomeMetric(deals, "gapSold"),
    totalProductUnitsSold,
    averageProductsPerDeliveredDeal:
      deals.length > 0 ? totalProductUnitsSold / deals.length : null,
    fullyTrackedDealCount,
    incompletelyTrackedDealCount: deals.length - fullyTrackedDealCount,
    anyProduct: thresholdMetric(deals, 1),
    twoOrMoreProducts: thresholdMetric(deals, 2),
    allThreeProducts: thresholdMetric(deals, 3),
    confirmedNoProductDealCount: deals.filter((item) =>
      PRODUCT_FIELDS.every((field) => item.sale[field] === false),
    ).length,
    inclusivePairCounts: {
      serviceContractAndTireWheel: deals.filter(
        (item) => item.sale.serviceContractSold === true && item.sale.tireWheelSold === true,
      ).length,
      serviceContractAndGap: deals.filter(
        (item) => item.sale.serviceContractSold === true && item.sale.gapSold === true,
      ).length,
      tireWheelAndGap: deals.filter(
        (item) => item.sale.tireWheelSold === true && item.sale.gapSold === true,
      ).length,
    },
    exactMix: exactProductMix(deals),
  };
}

function amountCoverage(
  deals: CalculatedSale[],
  selector: (sale: Sale) => number | null,
): AmountCoverageMetric {
  const amounts = deals.map((item) => selector(item.sale));
  const entered = amounts.filter((amount): amount is number => amount !== null);
  const totalCents = entered.reduce((total, amount) => total + amount, 0);
  return {
    eligibleDealCount: deals.length,
    enteredCount: entered.length,
    missingCount: deals.length - entered.length,
    positiveCount: entered.filter((amount) => amount > 0).length,
    zeroCount: entered.filter((amount) => amount === 0).length,
    negativeCount: entered.filter((amount) => amount < 0).length,
    totalCents,
    averagePerDeliveredDealCents: entered.length > 0 ? average(totalCents, deals.length) : null,
    averagePerEnteredDealCents: average(totalCents, entered.length),
    positiveAmountPenetrationRate:
      deals.length > 0 ? entered.filter((amount) => amount > 0).length / deals.length : null,
  };
}

function productSegment(deals: CalculatedSale[]): ProductAttachmentSegment {
  const fiGrossCents = deals.reduce((total, item) => total + (item.sale.fiGrossCents ?? 0), 0);
  const fiGrossEnteredCount = deals.filter((item) => item.sale.fiGrossCents !== null).length;
  const creditedUnitsBasis = deals.reduce(
    (total, item) => total + item.sale.unitCreditBasis,
    0,
  );
  return {
    dealCount: deals.length,
    creditedUnitsBasis,
    creditedUnits: creditedUnitsBasis / 1_000,
    fiGrossCents,
    fiGrossEnteredCount,
    fiGrossMissingCount: deals.length - fiGrossEnteredCount,
    averageFiGrossPerDealCents: fiGrossEnteredCount > 0 ? average(fiGrossCents, deals.length) : null,
    positiveFiGrossDealCount: deals.filter((item) => (item.sale.fiGrossCents ?? 0) > 0).length,
    products: calculateProductPortfolio(deals),
  };
}

/**
 * Product rows use deal-level total F&I gross. The same deal can appear in more
 * than one row, so row gross must not be summed or described as product revenue.
 */
export function calculateProductReportRows(
  calculatedSales: CalculatedSale[],
): ProductReportRow[] {
  const deals = eligibleDelivered(calculatedSales);
  return TRACKED_PRODUCT_DEFINITIONS.map((definition) => {
    const outcome = outcomeMetric(deals, definition.field);
    const matchingDeals = deals.filter((item) => item.sale[definition.field] === true);
    const cohortTotalFiGrossCents = matchingDeals.reduce(
      (total, item) => total + (item.sale.fiGrossCents ?? 0),
      0,
    );
    const cohortFiGrossEnteredCount = matchingDeals.filter(
      (item) => item.sale.fiGrossCents !== null,
    ).length;
    return {
      ...definition,
      eligibleDealCount: outcome.eligibleDealCount,
      soldCount: outcome.yesCount,
      noCount: outcome.noCount,
      recordedCount: outcome.recordedCount,
      unmarkedCount: outcome.unmarkedCount,
      penetrationRate: outcome.penetrationRate,
      trackingCompletionRate: outcome.trackingCompletionRate,
      cohortTotalFiGrossCents,
      cohortFiGrossEnteredCount,
      averageCohortTotalFiGrossPerMatchingDealCents: cohortFiGrossEnteredCount > 0 ? average(
        cohortTotalFiGrossCents,
        matchingDeals.length,
      ) : null,
      positiveFiGrossDealCount: matchingDeals.filter(
        (item) => (item.sale.fiGrossCents ?? 0) > 0,
      ).length,
    };
  });
}

const BUNDLE_DEFINITIONS: Array<{
  key: BundleReportKey;
  label: string;
  productFields: ProductOutcomeField[];
}> = [
  {
    key: "serviceContractAndTireWheel",
    label: "Service contract + Tire & Wheel",
    productFields: ["serviceContractSold", "tireWheelSold"],
  },
  {
    key: "serviceContractAndGap",
    label: "Service contract + GAP",
    productFields: ["serviceContractSold", "gapSold"],
  },
  {
    key: "tireWheelAndGap",
    label: "Tire & Wheel + GAP",
    productFields: ["tireWheelSold", "gapSold"],
  },
  {
    key: "allThreeProducts",
    label: "All three products",
    productFields: PRODUCT_FIELDS,
  },
];

/**
 * Bundle rows are inclusive. An all-three deal also appears in every two-product
 * row, and its total deal-level F&I gross appears in each matching row.
 */
export function calculateBundleReportRows(
  calculatedSales: CalculatedSale[],
): BundleReportRow[] {
  const deals = eligibleDelivered(calculatedSales);
  return BUNDLE_DEFINITIONS.map((definition) => {
    const matchingDeals = deals.filter((item) =>
      definition.productFields.every((field) => item.sale[field] === true),
    );
    const cohortTotalFiGrossCents = matchingDeals.reduce(
      (total, item) => total + (item.sale.fiGrossCents ?? 0),
      0,
    );
    const cohortFiGrossEnteredCount = matchingDeals.filter(
      (item) => item.sale.fiGrossCents !== null,
    ).length;
    return {
      ...definition,
      productFields: [...definition.productFields],
      dealCount: matchingDeals.length,
      eligibleDealCount: deals.length,
      penetrationRate: deals.length > 0 ? matchingDeals.length / deals.length : null,
      cohortTotalFiGrossCents,
      cohortFiGrossEnteredCount,
      averageCohortTotalFiGrossPerMatchingDealCents: cohortFiGrossEnteredCount > 0 ? average(
        cohortTotalFiGrossCents,
        matchingDeals.length,
      ) : null,
    };
  });
}

export function calculateFinancingGroupRows(
  calculatedSales: CalculatedSale[],
): FinancingGroupReportRow[] {
  const deals = eligibleDelivered(calculatedSales);
  const groups: Array<{
    key: FinancingGroupKey;
    label: string;
    matches: (sale: Sale) => boolean;
  }> = [
    { key: "dealerFinanced", label: "Dealership financing", matches: (sale) => getPaymentMethod(sale) === "dealer_financed" },
    { key: "cash", label: "Cash", matches: (sale) => getPaymentMethod(sale) === "cash" },
    { key: "outsideFinancing", label: "Outside financing", matches: (sale) => getPaymentMethod(sale) === "outside_financing" },
    {
      key: "notDealerFinanced",
      label: "Cash / outside not specified",
      matches: (sale) => getPaymentMethod(sale) === "not_dealer_financed",
    },
    {
      key: "unmarked",
      label: "Not marked",
      matches: (sale) => getPaymentMethod(sale) === "unmarked",
    },
  ];
  return groups.map((group) => {
    const matchingDeals = deals.filter((item) => group.matches(item.sale));
    return {
      key: group.key,
      label: group.label,
      eligibleDealCount: deals.length,
      shareOfDeliveredDealsRate:
        deals.length > 0 ? matchingDeals.length / deals.length : null,
      ...productSegment(matchingDeals),
    };
  });
}

/**
 * Builds a reusable reporting model from calculated sales. Product penetration
 * always uses valid delivered deals, not credited units, as its denominator.
 * Cohort total F&I gross is descriptive deal-level money; product cohorts
 * overlap and therefore are never additive.
 */
export function calculateReportAnalytics(
  calculatedSales: CalculatedSale[],
  options: ReportAnalyticsOptions = {},
): ReportAnalytics {
  const deals = eligibleDelivered(calculatedSales);
  const activeItems = calculatedSales.filter((item) => !item.sale.deletedAt);
  const creditedUnitsBasis = deals.reduce(
    (total, item) => total + item.sale.unitCreditBasis,
    0,
  );
  const products = calculateProductPortfolio(deals);
  const productRows = calculateProductReportRows(deals);
  const bundleRows = calculateBundleReportRows(deals);
  const financingRows = calculateFinancingGroupRows(deals);
  const dealerFinance = outcomeMetric(deals, "dealerFinanced");
  const front = amountCoverage(deals, (sale) => sale.frontGrossCents);
  const fi = amountCoverage(deals, (sale) => sale.fiGrossCents);
  const totalGrossCents = front.totalCents + fi.totalCents;
  const frontCommissionCents = deals.reduce(
    (total, item) => total + item.frontCommissionCents,
    0,
  );
  const fiCommissionCents = deals.reduce(
    (total, item) => total + item.fiCommissionCents,
    0,
  );
  const coreCommissionCents = frontCommissionCents + fiCommissionCents;
  const bonusIncludedCents = options.bonusIncludedCents ?? 0;
  const estimatedCommissionCents =
    options.estimatedCommissionCents ?? coreCommissionCents + bonusIncludedCents;
  const actualPaidCents = options.actualPaidCents ?? null;
  const reconciledEstimatedCommissionCents =
    options.reconciledEstimatedCommissionCents
    ?? (actualPaidCents === null ? null : estimatedCommissionCents);

  const anyProductDeals = deals.filter((item) =>
    PRODUCT_FIELDS.some((field) => item.sale[field] === true),
  );
  const confirmedNoProductDeals = deals.filter((item) =>
    PRODUCT_FIELDS.every((field) => item.sale[field] === false),
  );
  const undeterminedProductDeals = deals.filter(
    (item) =>
      !PRODUCT_FIELDS.some((field) => item.sale[field] === true)
      && PRODUCT_FIELDS.some((field) => typeof item.sale[field] !== "boolean"),
  );

  return {
    population: {
      analyzedRecordCount: calculatedSales.length,
      activeRecordCount: activeItems.length,
      deliveredDealCount: deals.length,
      creditedUnitsBasis,
      creditedUnits: creditedUnitsBasis / 1_000,
      pendingRecordCount: activeItems.filter((item) => item.sale.status === "pending").length,
      deletedRecordCount: calculatedSales.length - activeItems.length,
      excludedDeliveredRecordCount: activeItems.filter(
        (item) => item.sale.status === "delivered" && !item.countsTowardVolume,
      ).length,
    },
    products,
    productRows,
    bundleRows,
    finance: {
      dealerFinance,
      gapOnDealerFinanced: outcomeMetric(
        deals.filter((item) => dealerFinancingOutcome(item.sale) === true),
        "gapSold",
      ),
      segments: {
        dealerFinanced: productSegment(
          deals.filter((item) => getPaymentMethod(item.sale) === "dealer_financed"),
        ),
        cash: productSegment(
          deals.filter((item) => getPaymentMethod(item.sale) === "cash"),
        ),
        outsideFinancing: productSegment(
          deals.filter((item) => getPaymentMethod(item.sale) === "outside_financing"),
        ),
        notDealerFinanced: productSegment(
          deals.filter((item) => getPaymentMethod(item.sale) === "not_dealer_financed"),
        ),
        financeOutcomeUnmarked: productSegment(
          deals.filter((item) => getPaymentMethod(item.sale) === "unmarked"),
        ),
      },
    },
    financingRows,
    gross: {
      front,
      fi,
      totalGrossCents,
      averageTotalGrossPerDeliveredDealCents: front.enteredCount + fi.enteredCount > 0
        ? average(totalGrossCents, deals.length) : null,
      bothAmountsEnteredDealCount: deals.filter(
        (item) => item.sale.frontGrossCents !== null && item.sale.fiGrossCents !== null,
      ).length,
      fiShareOfTotalGrossRate: totalGrossCents > 0 ? fi.totalCents / totalGrossCents : null,
      byProductAttachment: {
        anyProduct: productSegment(anyProductDeals),
        confirmedNoProduct: productSegment(confirmedNoProductDeals),
        productOutcomeUndetermined: productSegment(undeterminedProductDeals),
      },
    },
    commission: {
      frontCommissionCents,
      fiCommissionCents,
      coreCommissionCents,
      bonusIncludedCents,
      estimatedCommissionCents,
      averageFiCommissionPerDeliveredDealCents: fi.enteredCount > 0
        ? average(fiCommissionCents, deals.length) : null,
      averageCoreCommissionPerDeliveredDealCents: average(coreCommissionCents, deals.length),
      averageEstimatedCommissionPerDeliveredDealCents: average(
        estimatedCommissionCents,
        deals.length,
      ),
      actualPaidCents,
      actualPaidPeriodCount: options.actualPaidPeriodCount ?? (actualPaidCents === null ? 0 : 1),
      reconciledEstimatedCommissionCents,
      payrollVarianceCents:
        actualPaidCents === null || reconciledEstimatedCommissionCents === null
          ? null
          : actualPaidCents - reconciledEstimatedCommissionCents,
    },
    quality: {
      eligibleDealCount: deals.length,
      fullyTrackedProductDealCount: products.fullyTrackedDealCount,
      incompletelyTrackedProductDealCount: products.incompletelyTrackedDealCount,
      fullyTrackedAllOutcomesDealCount: deals.filter((item) =>
        typeof dealerFinancingOutcome(item.sale) === "boolean" && PRODUCT_FIELDS.every(
          (field) => typeof item.sale[field] === "boolean",
        ),
      ).length,
      dealsWithAnyUnmarkedOutcomeCount: deals.filter((item) =>
        typeof dealerFinancingOutcome(item.sale) !== "boolean" || PRODUCT_FIELDS.some(
          (field) => typeof item.sale[field] !== "boolean",
        ),
      ).length,
      recordedProductOutcomeCount: productRows.reduce(
        (total, row) => total + row.recordedCount,
        0,
      ),
      unmarkedProductOutcomeCount: productRows.reduce(
        (total, row) => total + row.unmarkedCount,
        0,
      ),
      recordedFinanceOutcomeCount: dealerFinance.recordedCount,
      unmarkedFinanceOutcomeCount: dealerFinance.unmarkedCount,
      frontGrossEnteredCount: front.enteredCount,
      frontGrossMissingCount: front.missingCount,
      fiGrossEnteredCount: fi.enteredCount,
      fiGrossMissingCount: fi.missingCount,
    },
  };
}

export function calculateMonthReportAnalytics(summary: MonthSummary): ReportAnalytics {
  return calculateReportAnalytics(summary.calculatedSales, {
    bonusIncludedCents: summary.bonusIncludedCents,
    estimatedCommissionCents: summary.estimatedCommissionCents,
    actualPaidCents: summary.actualPaidCents,
    actualPaidPeriodCount: summary.actualPaidCents === null ? 0 : 1,
    reconciledEstimatedCommissionCents:
      summary.actualPaidCents === null ? null : summary.estimatedCommissionCents,
  });
}

export function calculatePeriodReportAnalytics(summaries: MonthSummary[]): ReportAnalytics {
  const reconciledMonths = summaries.filter((summary) => summary.actualPaidCents !== null);
  return calculateReportAnalytics(summaries.flatMap((summary) => summary.calculatedSales), {
    bonusIncludedCents: summaries.reduce(
      (total, summary) => total + summary.bonusIncludedCents,
      0,
    ),
    estimatedCommissionCents: summaries.reduce(
      (total, summary) => total + summary.estimatedCommissionCents,
      0,
    ),
    actualPaidCents:
      reconciledMonths.length === 0
        ? null
        : reconciledMonths.reduce(
          (total, summary) => total + (summary.actualPaidCents ?? 0),
          0,
        ),
    actualPaidPeriodCount: reconciledMonths.length,
    reconciledEstimatedCommissionCents:
      reconciledMonths.length === 0
        ? null
        : reconciledMonths.reduce(
          (total, summary) => total + summary.estimatedCommissionCents,
          0,
        ),
  });
}

function compareMetric(current: number | null, previous: number | null): ReportMetricComparison {
  if (current === null || previous === null) {
    return {
      current,
      previous,
      absoluteChange: null,
      relativeChangeRate: null,
      direction: "not-comparable",
    };
  }
  const absoluteChange = current - previous;
  return {
    current,
    previous,
    absoluteChange,
    relativeChangeRate: previous === 0 ? null : absoluteChange / Math.abs(previous),
    direction: absoluteChange === 0 ? "flat" : absoluteChange > 0 ? "up" : "down",
  };
}

function compareRate(current: number | null, previous: number | null): ReportRateComparison {
  const comparison = compareMetric(current, previous);
  return {
    ...comparison,
    percentagePointChange:
      comparison.absoluteChange === null ? null : comparison.absoluteChange * 100,
  };
}

/** Compares recorded period results; it does not forecast an incomplete period. */
export function compareReportAnalytics(
  current: ReportAnalytics,
  previous: ReportAnalytics,
): ReportAnalyticsComparison {
  return {
    deliveredDeals: compareMetric(
      current.population.deliveredDealCount,
      previous.population.deliveredDealCount,
    ),
    creditedUnits: compareMetric(
      current.population.creditedUnits,
      previous.population.creditedUnits,
    ),
    frontGrossCents: compareMetric(current.gross.front.totalCents, previous.gross.front.totalCents),
    fiGrossCents: compareMetric(current.gross.fi.totalCents, previous.gross.fi.totalCents),
    totalGrossCents: compareMetric(current.gross.totalGrossCents, previous.gross.totalGrossCents),
    frontGrossPerDealCents: compareMetric(
      current.gross.front.averagePerDeliveredDealCents,
      previous.gross.front.averagePerDeliveredDealCents,
    ),
    fiGrossPerDealCents: compareMetric(
      current.gross.fi.averagePerDeliveredDealCents,
      previous.gross.fi.averagePerDeliveredDealCents,
    ),
    totalGrossPerDealCents: compareMetric(
      current.gross.averageTotalGrossPerDeliveredDealCents,
      previous.gross.averageTotalGrossPerDeliveredDealCents,
    ),
    estimatedCommissionCents: compareMetric(
      current.commission.estimatedCommissionCents,
      previous.commission.estimatedCommissionCents,
    ),
    estimatedCommissionPerDealCents: compareMetric(
      current.commission.averageEstimatedCommissionPerDeliveredDealCents,
      previous.commission.averageEstimatedCommissionPerDeliveredDealCents,
    ),
    serviceContractPenetrationRate: compareRate(
      current.products.serviceContract.penetrationRate,
      previous.products.serviceContract.penetrationRate,
    ),
    tireWheelPenetrationRate: compareRate(
      current.products.tireWheel.penetrationRate,
      previous.products.tireWheel.penetrationRate,
    ),
    gapPenetrationRate: compareRate(
      current.products.gap.penetrationRate,
      previous.products.gap.penetrationRate,
    ),
    dealerFinancePenetrationRate: compareRate(
      current.finance.dealerFinance.penetrationRate,
      previous.finance.dealerFinance.penetrationRate,
    ),
    anyProductPenetrationRate: compareRate(
      current.products.anyProduct.penetrationRate,
      previous.products.anyProduct.penetrationRate,
    ),
    productsPerDeal: compareMetric(
      current.products.averageProductsPerDeliveredDeal,
      previous.products.averageProductsPerDeliveredDeal,
    ),
  };
}
