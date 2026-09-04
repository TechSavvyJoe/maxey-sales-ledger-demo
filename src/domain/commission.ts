import { isValidDateOnly, monthKeyFromDate, todayDateOnly } from "@/domain/date";
import { multiplyCentsByBps } from "@/domain/money";
import { getMinimumFrontCommissionCents, getPayPlanForMonth, hasPayPlanCoverage } from "@/domain/payPlan";
import type {
  BonusTier,
  CalculatedSale,
  MonthSummary,
  PayPlan,
  Sale,
  SaleReviewFlag,
} from "@/domain/types";

export const DEFAULT_PAY_PLAN: PayPlan = {
  version: "Howell Used Sales Plan 2026",
  effectiveMonth: "2026-01",
  baseFrontRateBps: 3_000,
  acceleratedFrontRateBps: 3_500,
  acceleratedThresholdExclusive: 10,
  fiRateBps: 2_000,
  minimumFrontCommissionCents: 30_000,
  bonusTiers: [
    { minimumDelivered: 11, amountCents: 30_000 },
    { minimumDelivered: 15, amountCents: 110_000 },
    { minimumDelivered: 20, amountCents: 210_000 },
    { minimumDelivered: 25, amountCents: 360_000 },
    { minimumDelivered: 30, amountCents: 560_000 },
    { minimumDelivered: 35, amountCents: 810_000 },
  ],
};

export function normalizeStock(stockNumber: string): string {
  return stockNumber.trim().toLocaleUpperCase("en-US");
}

export function getDeliveredStockCounts(sales: Sale[]): Map<string, number> {
  return deliveredStockCountsAsOf(sales, todayDateOnly());
}

function deliveredStockCountsAsOf(sales: Sale[], today: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sale of sales) {
    // Only a valid, already-delivered record may make another sale a duplicate.
    // A malformed or future backup row should stay reviewable without suppressing
    // a legitimate delivered sale with the same stock number.
    if (
      sale.deletedAt
      || sale.status !== "delivered"
      || !isValidDateOnly(sale.saleDate)
      || sale.saleDate > today
    ) continue;
    const key = normalizeStock(sale.stockNumber);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function getPotentialBonus(deliveredCount: number, tiers: BonusTier[]): number {
  return getBonusMilestone(deliveredCount, tiers)?.amountCents ?? 0;
}

export function getBonusMilestone(deliveredCount: number, tiers: BonusTier[]) {
  let previousAmountCents = 0;
  let qualifyingMilestone: (BonusTier & { addedAmountCents: number }) | null = null;
  for (const tier of [...tiers].sort((a, b) => a.minimumDelivered - b.minimumDelivered)) {
    const milestone = {
      ...tier,
      addedAmountCents: tier.amountCents - previousAmountCents,
    };
    if (deliveredCount >= tier.minimumDelivered) qualifyingMilestone = milestone;
    previousAmountCents = tier.amountCents;
  }
  return qualifyingMilestone;
}

export function getNextBonusMilestone(deliveredCount: number, tiers: BonusTier[]) {
  let previousAmountCents = 0;
  for (const tier of [...tiers].sort((a, b) => a.minimumDelivered - b.minimumDelivered)) {
    const milestone = {
      ...tier,
      addedAmountCents: tier.amountCents - previousAmountCents,
    };
    if (deliveredCount < tier.minimumDelivered) return milestone;
    previousAmountCents = tier.amountCents;
  }
  return null;
}

function allocateRateAcrossSales(
  sales: Sale[],
  amountSelector: (sale: Sale) => number,
  basisPoints: number,
): Map<string, number> {
  const allocation = new Map<string, number>();
  if (sales.length === 0) return allocation;

  const totalAmount = sales.reduce((sum, sale) => sum + amountSelector(sale), 0);
  const expectedTotal = multiplyCentsByBps(totalAmount, basisPoints);
  let allocatedTotal = 0;

  sales.forEach((sale, index) => {
    const isLast = index === sales.length - 1;
    const amount = isLast
      ? expectedTotal - allocatedTotal
      : multiplyCentsByBps(amountSelector(sale), basisPoints);
    allocation.set(sale.id, amount);
    allocatedTotal += amount;
  });

  return allocation;
}

/**
 * Pay is resolved per sale before summing the month: losses never offset another
 * sale's pay, and a mini or manual amount is not percentage-bearing gross.
 * Entered gross already represents this salesperson's gross share. Only the
 * full-deal mini is prorated by deal credit; a manual amount is personal pay.
 */
export function calculateFrontCommission(
  sale: Pick<Sale, "frontGrossCents" | "frontCommissionOverrideCents" | "unitCreditBasis">,
  frontRateBps: number,
  payPlan: PayPlan,
): Pick<CalculatedSale, "frontCommissionCents" | "frontCommissionMethod" | "minimumFrontCommissionCents" | "commissionableFrontGrossCents"> {
  const minimumFrontCommissionCents = multiplyCentsByBps(
    getMinimumFrontCommissionCents(payPlan), sale.unitCreditBasis * 10,
  );
  const commissionableFrontGrossCents = Math.max(sale.frontGrossCents ?? 0, 0);
  const shared = { minimumFrontCommissionCents, commissionableFrontGrossCents };
  if (sale.frontCommissionOverrideCents !== null && sale.frontCommissionOverrideCents !== undefined) {
    return { ...shared, frontCommissionCents: sale.frontCommissionOverrideCents, frontCommissionMethod: "manual" };
  }
  if (sale.frontGrossCents === null) {
    return { ...shared, frontCommissionCents: 0, frontCommissionMethod: "awaiting" };
  }
  const percentageCents = multiplyCentsByBps(commissionableFrontGrossCents, frontRateBps);
  const isMini = minimumFrontCommissionCents > 0 && percentageCents <= minimumFrontCommissionCents;
  return {
    ...shared,
    frontCommissionCents: Math.max(minimumFrontCommissionCents, percentageCents),
    frontCommissionMethod: isMini ? "mini" : "percentage",
  };
}

function reviewFlagsForSale(
  sale: Sale,
  deliveredStockCounts: Map<string, number>,
  today: string,
): SaleReviewFlag[] {
  const flags: SaleReviewFlag[] = [];
  const stockKey = normalizeStock(sale.stockNumber);

  if (!isValidDateOnly(sale.saleDate)) {
    flags.push({ code: "invalid-date", label: "Invalid date", severity: "error" });
  }
  if (sale.status === "delivered" && !stockKey) {
    flags.push({ code: "missing-stock", label: "Stock number required", severity: "error" });
  }
  if (sale.status === "delivered" && stockKey && (deliveredStockCounts.get(stockKey) ?? 0) > 1) {
    flags.push({
      code: "duplicate-stock",
      label: "Duplicate delivered stock",
      severity: "error",
    });
  }
  if (sale.status === "delivered" && sale.frontGrossCents === null
    && sale.frontCommissionOverrideCents == null) {
    flags.push({
      code: "missing-front-gross",
      label: "Front gross not entered",
      severity: "warning",
    });
  }
  // Zero/negative front gross is an ordinary Mini deal, not a correction or error.
  if ((sale.fiGrossCents ?? 0) < 0) {
    flags.push({ code: "negative-gross", label: "Negative F&I correction", severity: "warning" });
  }
  if (sale.status === "delivered" && sale.saleDate > today) {
    flags.push({
      code: "future-delivery",
      label: "Delivery date is in the future",
      severity: "warning",
    });
  }
  return flags;
}

export function calculateMonth(
  allSales: Sale[],
  monthKey: string,
  payPlanOrSchedule: PayPlan | PayPlan[],
  actualPaidCents: number | null = null,
): MonthSummary {
  return calculatePreparedMonth(
    prepareSalesForCalculation(allSales),
    monthKey,
    payPlanOrSchedule,
    actualPaidCents,
  );
}

function prepareSalesForCalculation(allSales: Sale[]) {
  // One consistent date and duplicate index for the whole calculation. Annual
  // reports share this snapshot across months, including cross-year duplicates.
  const today = todayDateOnly();
  const activeSales = allSales.filter((sale) => !sale.deletedAt);
  return {
    activeSales,
    deliveredStockCounts: deliveredStockCountsAsOf(activeSales, today),
    today,
  };
}

function calculatePreparedMonth(
  { activeSales, deliveredStockCounts, today }: ReturnType<typeof prepareSalesForCalculation>,
  monthKey: string,
  payPlanOrSchedule: PayPlan | PayPlan[],
  actualPaidCents: number | null,
): MonthSummary {
  const payPlan = getPayPlanForMonth(payPlanOrSchedule, monthKey);
  const monthSales = activeSales
    .filter((sale) => monthKeyFromDate(sale.saleDate) === monthKey)
    .sort((a, b) => a.saleDate.localeCompare(b.saleDate)
      || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const countableDelivered = monthSales.filter((sale) => {
    const key = normalizeStock(sale.stockNumber);
    return (
      sale.status === "delivered" &&
      isValidDateOnly(sale.saleDate) &&
      sale.saleDate <= today &&
      Boolean(key) &&
      deliveredStockCounts.get(key) === 1
    );
  });
  const deliveryOrdinals = new Map(countableDelivered.map((sale, index) => [sale.id, index + 1]));

  const deliveredCount = countableDelivered.length;
  const frontRateBps =
    deliveredCount > payPlan.acceleratedThresholdExclusive
      ? payPlan.acceleratedFrontRateBps
      : payPlan.baseFrontRateBps;

  const fiAllocations = allocateRateAcrossSales(
    countableDelivered,
    (sale) => sale.fiGrossCents ?? 0,
    payPlan.fiRateBps,
  );

  const calculatedSales: CalculatedSale[] = monthSales.map((sale) => {
    const key = normalizeStock(sale.stockNumber);
    const flags = reviewFlagsForSale(sale, deliveredStockCounts, today);
    const deliveryOrdinal = deliveryOrdinals.get(sale.id) ?? null;
    const countsTowardVolume = deliveryOrdinal !== null;
    const front = calculateFrontCommission(sale, frontRateBps, payPlan);
    const frontCommissionCents = countsTowardVolume ? front.frontCommissionCents : 0;
    const fiCommissionCents = countsTowardVolume ? (fiAllocations.get(sale.id) ?? 0) : 0;
    return {
      sale,
      normalizedStock: key,
      monthKey,
      countsTowardVolume,
      deliveryOrdinal,
      milestone: null,
      commissionReady: countsTowardVolume && front.frontCommissionMethod !== "awaiting",
      frontRateBps,
      frontCommissionCents,
      frontCommissionMethod: countsTowardVolume ? front.frontCommissionMethod : "excluded",
      minimumFrontCommissionCents: front.minimumFrontCommissionCents,
      commissionableFrontGrossCents: countsTowardVolume ? front.commissionableFrontGrossCents : 0,
      fiCommissionCents,
      estimatedCommissionCents: frontCommissionCents + fiCommissionCents,
      flags,
    };
  });

  // Attribute rewards to the delivery that crossed the threshold. The triggering
  // sale already receives its own higher-rate commission above, so only the rate
  // increase on EARLIER sales is unlocked here. These figures never feed totals.
  for (const item of calculatedSales) {
    const ordinal = item.deliveryOrdinal;
    if (ordinal === null) continue;
    const unlocksHigherRate = ordinal === payPlan.acceleratedThresholdExclusive + 1
      && payPlan.acceleratedFrontRateBps > payPlan.baseFrontRateBps;
    const bonusAddedCents = getPotentialBonus(ordinal, payPlan.bonusTiers)
      - getPotentialBonus(ordinal - 1, payPlan.bonusTiers);
    if (!unlocksHigherRate && bonusAddedCents <= 0) continue;
    const priorSales = unlocksHigherRate ? countableDelivered.slice(0, ordinal - 1) : [];
    const priorSalesRetroactiveCents = priorSales.reduce((sum, sale) => sum
      + calculateFrontCommission(sale, payPlan.acceleratedFrontRateBps, payPlan).frontCommissionCents
      - calculateFrontCommission(sale, payPlan.baseFrontRateBps, payPlan).frontCommissionCents, 0);
    const missingPriorFrontGrossCount = priorSales.filter((sale) =>
      sale.frontGrossCents === null && sale.frontCommissionOverrideCents == null).length;
    const extraEarningsUnlockedCents = priorSalesRetroactiveCents + bonusAddedCents;
    item.milestone = {
      deliveryOrdinal: ordinal,
      unlocksHigherRate,
      frontRateBps: item.frontRateBps,
      priorSalesRetroactiveCents,
      bonusAddedCents,
      extraEarningsUnlockedCents,
      totalMilestoneImpactCents: item.estimatedCommissionCents + extraEarningsUnlockedCents,
      missingPriorFrontGrossCount,
      isPartial: !item.commissionReady || item.sale.fiGrossCents === null || missingPriorFrontGrossCount > 0,
    };
  }

  const frontGrossCents = countableDelivered.reduce(
    (sum, sale) => sum + (sale.frontGrossCents ?? 0),
    0,
  );
  const fiGrossCents = countableDelivered.reduce(
    (sum, sale) => sum + (sale.fiGrossCents ?? 0),
    0,
  );
  const frontCommissionCents = calculatedSales.reduce((sum, item) => sum + item.frontCommissionCents, 0);
  const commissionableFrontGrossCents = calculatedSales.reduce((sum, item) => sum + item.commissionableFrontGrossCents, 0);
  const fiCommissionCents = multiplyCentsByBps(fiGrossCents, payPlan.fiRateBps);
  const coreCommissionCents = frontCommissionCents + fiCommissionCents;
  const potentialBonusCents = getPotentialBonus(deliveredCount, payPlan.bonusTiers);
  const bonusIncludedCents = potentialBonusCents;
  const estimatedCommissionCents = coreCommissionCents + bonusIncludedCents;
  const payrollVarianceCents =
    actualPaidCents === null ? null : actualPaidCents - estimatedCommissionCents;
  const duplicateGroupCount = new Set(
    monthSales
      .filter((sale) => {
        const key = normalizeStock(sale.stockNumber);
        return sale.status === "delivered" && key && (deliveredStockCounts.get(key) ?? 0) > 1;
      })
      .map((sale) => normalizeStock(sale.stockNumber)),
  ).size;
  const reviewCount = calculatedSales.filter((sale) => sale.flags.length > 0).length;
  const pendingCount = monthSales.filter((sale) => sale.status === "pending").length;
  const creditedUnitsBasis = countableDelivered.reduce(
    (sum, sale) => sum + sale.unitCreditBasis,
    0,
  );
  const retroactiveUpliftCents =
    frontRateBps === payPlan.acceleratedFrontRateBps
      ? countableDelivered.reduce((sum, sale) => sum
        + calculateFrontCommission(sale, frontRateBps, payPlan).frontCommissionCents
        - calculateFrontCommission(sale, payPlan.baseFrontRateBps, payPlan).frontCommissionCents, 0)
      : 0;

  return {
    monthKey,
    payPlanVersion: payPlan.version,
    payPlanEffectiveMonth: payPlan.effectiveMonth,
    deliveredCount,
    creditedUnitsBasis,
    pendingCount,
    frontRateBps,
    frontGrossCents,
    commissionableFrontGrossCents,
    minimumFrontCommissionCents: getMinimumFrontCommissionCents(payPlan),
    miniDealCount: calculatedSales.filter((item) => item.frontCommissionMethod === "mini").length,
    manualFrontCommissionCount: calculatedSales.filter((item) => item.frontCommissionMethod === "manual").length,
    fiGrossCents,
    frontCommissionCents,
    fiCommissionCents,
    coreCommissionCents,
    potentialBonusCents,
    bonusIncludedCents,
    estimatedCommissionCents,
    actualPaidCents,
    payrollVarianceCents,
    duplicateGroupCount,
    reviewCount,
    retroactiveUpliftCents,
    calculatedSales,
  };
}

export function calculateYear(
  allSales: Sale[],
  year: number,
  payPlanOrSchedule: PayPlan | PayPlan[],
  actualPaidByMonth: Record<string, number | null>,
): MonthSummary[] {
  const preparedSales = prepareSalesForCalculation(allSales);
  return Array.from(
    { length: 12 },
    (_, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
  )
    .filter((monthKey) => hasPayPlanCoverage(payPlanOrSchedule, monthKey))
    .map((monthKey) =>
      calculatePreparedMonth(preparedSales, monthKey, payPlanOrSchedule, actualPaidByMonth[monthKey] ?? null),
    );
}
