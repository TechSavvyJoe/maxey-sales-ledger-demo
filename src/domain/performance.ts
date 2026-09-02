import { getPotentialBonus } from "@/domain/commission";
import { multiplyCentsByBps } from "@/domain/money";
import type { WorkdayPace } from "@/domain/pacing";
import type { MonthSummary, PayPlan } from "@/domain/types";

export interface MonthlyPerformance {
  deliveredCount: number;
  frontGrossPerDeliveryCents: number | null;
  fiGrossPerDeliveryCents: number | null;
  totalGrossPerDeliveryCents: number | null;
  coreCommissionPerDeliveryCents: number | null;
  estimatedCommissionPerDeliveryCents: number | null;
  fiAmountEnteredCount: number;
  positiveFiGrossCount: number;
  missingFrontGrossCount: number;
}

export interface PeriodPerformance extends MonthlyPerformance {
  monthCount: number;
  frontGrossCents: number;
  fiGrossCents: number;
  coreCommissionCents: number;
  estimatedCommissionCents: number;
  actualPaidCents: number;
  actualPaidMonthCount: number;
  reconciledEstimateCents: number;
  payrollVarianceCents: number | null;
}

export interface CommissionProjectionScenario {
  deliveredCount: number;
  frontGrossCents: number;
  fiGrossCents: number;
  frontRateBps: number;
  frontCommissionCents: number;
  fiCommissionCents: number;
  bonusCents: number;
  estimatedCommissionCents: number;
}

export interface CommissionRunRate {
  projectedDeliveries: number;
  low: CommissionProjectionScenario;
  high: CommissionProjectionScenario;
}

export interface HigherRateOpportunity {
  deliveriesRemaining: number;
  recordedGrossUpliftCents: number;
  isEarned: boolean;
}

export type EarningsGoalStatus =
  | "reached"
  | "on-pace"
  | "within-range"
  | "behind"
  | "not-started"
  | "complete";

export interface EarningsGoalProgress {
  goalCents: number;
  status: EarningsGoalStatus;
  progressPercent: number;
  remainingCents: number;
  requiredPerRemainingWorkdayCents: number | null;
}

function averageCents(totalCents: number, deliveredCount: number): number | null {
  return deliveredCount > 0 ? Math.round(totalCents / deliveredCount) : null;
}

export function calculateMonthlyPerformance(summary: MonthSummary): MonthlyPerformance {
  const validSales = summary.calculatedSales.filter((item) => item.countsTowardVolume);
  return {
    deliveredCount: summary.deliveredCount,
    frontGrossPerDeliveryCents: averageCents(summary.frontGrossCents, summary.deliveredCount),
    fiGrossPerDeliveryCents: averageCents(summary.fiGrossCents, summary.deliveredCount),
    totalGrossPerDeliveryCents: averageCents(
      summary.frontGrossCents + summary.fiGrossCents,
      summary.deliveredCount,
    ),
    coreCommissionPerDeliveryCents: averageCents(
      summary.coreCommissionCents,
      summary.deliveredCount,
    ),
    estimatedCommissionPerDeliveryCents: averageCents(
      summary.estimatedCommissionCents,
      summary.deliveredCount,
    ),
    fiAmountEnteredCount: validSales.filter((item) => item.sale.fiGrossCents !== null).length,
    positiveFiGrossCount: validSales.filter((item) => (item.sale.fiGrossCents ?? 0) > 0).length,
    missingFrontGrossCount: validSales.filter((item) => item.sale.frontGrossCents === null).length,
  };
}

export function calculatePeriodPerformance(
  months: MonthSummary[],
  throughMonth: string,
): PeriodPerformance {
  const included = months.filter((month) => month.monthKey <= throughMonth);
  const combined = included.reduce(
    (totals, month) => {
      totals.deliveredCount += month.deliveredCount;
      totals.frontGrossCents += month.frontGrossCents;
      totals.fiGrossCents += month.fiGrossCents;
      totals.coreCommissionCents += month.coreCommissionCents;
      totals.estimatedCommissionCents += month.estimatedCommissionCents;
      totals.fiAmountEnteredCount += month.calculatedSales.filter(
        (item) => item.countsTowardVolume && item.sale.fiGrossCents !== null,
      ).length;
      totals.positiveFiGrossCount += month.calculatedSales.filter(
        (item) => item.countsTowardVolume && (item.sale.fiGrossCents ?? 0) > 0,
      ).length;
      totals.missingFrontGrossCount += month.calculatedSales.filter(
        (item) => item.countsTowardVolume && item.sale.frontGrossCents === null,
      ).length;
      if (month.actualPaidCents !== null) {
        totals.actualPaidCents += month.actualPaidCents;
        totals.actualPaidMonthCount += 1;
        totals.reconciledEstimateCents += month.estimatedCommissionCents;
      }
      return totals;
    },
    {
      deliveredCount: 0,
      frontGrossCents: 0,
      fiGrossCents: 0,
      coreCommissionCents: 0,
      estimatedCommissionCents: 0,
      fiAmountEnteredCount: 0,
      positiveFiGrossCount: 0,
      missingFrontGrossCount: 0,
      actualPaidCents: 0,
      actualPaidMonthCount: 0,
      reconciledEstimateCents: 0,
    },
  );

  return {
    ...combined,
    monthCount: included.length,
    frontGrossPerDeliveryCents: averageCents(
      combined.frontGrossCents,
      combined.deliveredCount,
    ),
    fiGrossPerDeliveryCents: averageCents(combined.fiGrossCents, combined.deliveredCount),
    totalGrossPerDeliveryCents: averageCents(
      combined.frontGrossCents + combined.fiGrossCents,
      combined.deliveredCount,
    ),
    coreCommissionPerDeliveryCents: averageCents(
      combined.coreCommissionCents,
      combined.deliveredCount,
    ),
    estimatedCommissionPerDeliveryCents: averageCents(
      combined.estimatedCommissionCents,
      combined.deliveredCount,
    ),
    payrollVarianceCents:
      combined.actualPaidMonthCount > 0
        ? combined.actualPaidCents - combined.reconciledEstimateCents
        : null,
  };
}

export function calculateRollingBaseline(
  months: MonthSummary[],
  throughMonth: string,
  windowSize = 3,
): PeriodPerformance {
  const baselineMonths = months
    .filter((month) => month.monthKey < throughMonth)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .slice(-Math.max(1, windowSize));
  return calculatePeriodPerformance(
    baselineMonths,
    baselineMonths.at(-1)?.monthKey ?? "0000-00",
  );
}

function scenarioForDeliveredCount(
  summary: MonthSummary,
  payPlan: PayPlan,
  deliveredCount: number,
): CommissionProjectionScenario {
  const safeCount = Math.max(deliveredCount, summary.deliveredCount);
  const additionalDeliveries = safeCount - summary.deliveredCount;
  const averageFrontGrossCents = summary.frontGrossCents / summary.deliveredCount;
  const averageFiGrossCents = summary.fiGrossCents / summary.deliveredCount;
  const frontGrossCents = summary.frontGrossCents
    + Math.round(averageFrontGrossCents * additionalDeliveries);
  const fiGrossCents = summary.fiGrossCents
    + Math.round(averageFiGrossCents * additionalDeliveries);
  const frontRateBps = safeCount > payPlan.acceleratedThresholdExclusive
    ? payPlan.acceleratedFrontRateBps
    : payPlan.baseFrontRateBps;
  const frontCommissionCents = multiplyCentsByBps(frontGrossCents, frontRateBps);
  const fiCommissionCents = multiplyCentsByBps(fiGrossCents, payPlan.fiRateBps);
  const bonusCents = getPotentialBonus(safeCount, payPlan.bonusTiers);
  return {
    deliveredCount: safeCount,
    frontGrossCents,
    fiGrossCents,
    frontRateBps,
    frontCommissionCents,
    fiCommissionCents,
    bonusCents,
    estimatedCommissionCents: frontCommissionCents + fiCommissionCents + bonusCents,
  };
}

export function calculateCommissionRunRate(
  summary: MonthSummary,
  pace: WorkdayPace,
  payPlan: PayPlan,
): CommissionRunRate | null {
  if (
    summary.deliveredCount === 0
    || pace.projectedDeliveries === null
    || pace.status === "complete"
    || pace.status === "future"
    || pace.status === "not-started"
    || pace.status === "no-workdays"
  ) return null;

  const projectedDeliveries = Math.max(summary.deliveredCount, pace.projectedDeliveries);
  const lowCount = Math.max(summary.deliveredCount, Math.floor(projectedDeliveries));
  const highCount = Math.max(summary.deliveredCount, Math.ceil(projectedDeliveries));
  return {
    projectedDeliveries,
    low: scenarioForDeliveredCount(summary, payPlan, lowCount),
    high: scenarioForDeliveredCount(summary, payPlan, highCount),
  };
}

export function calculateHigherRateOpportunity(
  summary: MonthSummary,
  payPlan: PayPlan,
): HigherRateOpportunity {
  const isEarned = summary.deliveredCount > payPlan.acceleratedThresholdExclusive;
  return {
    deliveriesRemaining: Math.max(
      payPlan.acceleratedThresholdExclusive + 1 - summary.deliveredCount,
      0,
    ),
    recordedGrossUpliftCents: isEarned
      ? summary.retroactiveUpliftCents
      : multiplyCentsByBps(
          summary.frontGrossCents,
          Math.max(payPlan.acceleratedFrontRateBps - payPlan.baseFrontRateBps, 0),
        ),
    isEarned,
  };
}

export function calculateEarningsGoalProgress({
  currentEstimatedCommissionCents,
  goalCents,
  remainingWorkdays,
  paceStatus,
  runRate,
}: {
  currentEstimatedCommissionCents: number;
  goalCents: number | null;
  remainingWorkdays: number;
  paceStatus: WorkdayPace["status"];
  runRate: CommissionRunRate | null;
}): EarningsGoalProgress | null {
  if (goalCents === null || goalCents < 100) return null;
  const remainingCents = Math.max(goalCents - currentEstimatedCommissionCents, 0);
  const requiredPerRemainingWorkdayCents = remainingCents === 0
    ? 0
    : remainingWorkdays > 0
      ? Math.ceil(remainingCents / remainingWorkdays)
      : null;

  let status: EarningsGoalStatus;
  if (remainingCents === 0) status = "reached";
  else if (paceStatus === "complete") status = "complete";
  else if (!runRate) status = "not-started";
  else if (runRate.low.estimatedCommissionCents >= goalCents) status = "on-pace";
  else if (runRate.high.estimatedCommissionCents >= goalCents) status = "within-range";
  else status = "behind";

  return {
    goalCents,
    status,
    progressPercent: Math.min(100, (currentEstimatedCommissionCents / goalCents) * 100),
    remainingCents,
    requiredPerRemainingWorkdayCents,
  };
}
