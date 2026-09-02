import { isValidDateOnly, monthKeyFromDate, todayDateOnly } from "@/domain/date";
import { multiplyCentsByBps } from "@/domain/money";
import { getPayPlanForMonth, hasPayPlanCoverage } from "@/domain/payPlan";
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
  const counts = new Map<string, number>();
  const today = todayDateOnly();
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

function reviewFlagsForSale(
  sale: Sale,
  deliveredStockCounts: Map<string, number>,
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
  if (sale.status === "delivered" && sale.frontGrossCents === null) {
    flags.push({
      code: "missing-front-gross",
      label: "Front gross not entered",
      severity: "warning",
    });
  }
  if (sale.status === "delivered" && sale.frontGrossCents === 0) {
    flags.push({
      code: "zero-front-gross",
      label: "Front gross is zero",
      severity: "warning",
    });
  }
  if ((sale.frontGrossCents ?? 0) < 0 || (sale.fiGrossCents ?? 0) < 0) {
    flags.push({ code: "negative-gross", label: "Negative correction", severity: "warning" });
  }
  if (sale.status === "delivered" && sale.saleDate > todayDateOnly()) {
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
  const payPlan = getPayPlanForMonth(payPlanOrSchedule, monthKey);
  const activeSales = allSales.filter((sale) => !sale.deletedAt);
  const deliveredStockCounts = getDeliveredStockCounts(activeSales);
  const monthSales = activeSales
    .filter((sale) => monthKeyFromDate(sale.saleDate) === monthKey)
    .sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.createdAt.localeCompare(b.createdAt));

  const countableDelivered = monthSales.filter((sale) => {
    const key = normalizeStock(sale.stockNumber);
    return (
      sale.status === "delivered" &&
      isValidDateOnly(sale.saleDate) &&
      sale.saleDate <= todayDateOnly() &&
      Boolean(key) &&
      deliveredStockCounts.get(key) === 1
    );
  });

  const deliveredCount = countableDelivered.length;
  const frontRateBps =
    deliveredCount > payPlan.acceleratedThresholdExclusive
      ? payPlan.acceleratedFrontRateBps
      : payPlan.baseFrontRateBps;

  const frontAllocations = allocateRateAcrossSales(
    countableDelivered,
    (sale) => sale.frontGrossCents ?? 0,
    frontRateBps,
  );
  const fiAllocations = allocateRateAcrossSales(
    countableDelivered,
    (sale) => sale.fiGrossCents ?? 0,
    payPlan.fiRateBps,
  );

  const calculatedSales: CalculatedSale[] = monthSales.map((sale) => {
    const key = normalizeStock(sale.stockNumber);
    const flags = reviewFlagsForSale(sale, deliveredStockCounts);
    const countsTowardVolume = countableDelivered.some((item) => item.id === sale.id);
    const frontCommissionCents = countsTowardVolume ? (frontAllocations.get(sale.id) ?? 0) : 0;
    const fiCommissionCents = countsTowardVolume ? (fiAllocations.get(sale.id) ?? 0) : 0;
    return {
      sale,
      normalizedStock: key,
      monthKey,
      countsTowardVolume,
      commissionReady: countsTowardVolume && sale.frontGrossCents !== null,
      frontRateBps,
      frontCommissionCents,
      fiCommissionCents,
      estimatedCommissionCents: frontCommissionCents + fiCommissionCents,
      flags,
    };
  });

  const frontGrossCents = countableDelivered.reduce(
    (sum, sale) => sum + (sale.frontGrossCents ?? 0),
    0,
  );
  const fiGrossCents = countableDelivered.reduce(
    (sum, sale) => sum + (sale.fiGrossCents ?? 0),
    0,
  );
  const frontCommissionCents = multiplyCentsByBps(frontGrossCents, frontRateBps);
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
  const voidCount = monthSales.filter((sale) => sale.status === "void").length;
  const creditedUnitsBasis = countableDelivered.reduce(
    (sum, sale) => sum + sale.unitCreditBasis,
    0,
  );
  const retroactiveUpliftCents =
    frontRateBps === payPlan.acceleratedFrontRateBps
      ? frontCommissionCents - multiplyCentsByBps(frontGrossCents, payPlan.baseFrontRateBps)
      : 0;

  return {
    monthKey,
    payPlanVersion: payPlan.version,
    payPlanEffectiveMonth: payPlan.effectiveMonth,
    deliveredCount,
    creditedUnitsBasis,
    pendingCount,
    voidCount,
    frontRateBps,
    frontGrossCents,
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
  return Array.from(
    { length: 12 },
    (_, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
  )
    .filter((monthKey) => hasPayPlanCoverage(payPlanOrSchedule, monthKey))
    .map((monthKey) =>
      calculateMonth(allSales, monthKey, payPlanOrSchedule, actualPaidByMonth[monthKey] ?? null),
    );
}
