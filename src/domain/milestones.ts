import { calculateFrontCommission, getPotentialBonus } from "@/domain/commission";
import type { MonthSummary, PayPlan } from "@/domain/types";

export interface NextEarningsMilestone {
  deliveryCount: number;
  deliveriesNeeded: number;
  unlocksHigherRate: boolean;
  frontRateBps: number;
  bonusAddedCents: number;
  /** Uplift on currently recorded sales only; future sale earnings are unknown. */
  recordedRetroactiveCents: number;
  missingFrontGrossCount: number;
}

/** Uses the selected month's effective plan, not the latest plan by default. */
export function getNextEarningsMilestone(
  summary: MonthSummary,
  payPlan: PayPlan,
): NextEarningsMilestone | null {
  const higherRateAt = payPlan.acceleratedThresholdExclusive + 1;
  const higherRateIsReward = payPlan.acceleratedFrontRateBps > payPlan.baseFrontRateBps;
  const targets = payPlan.bonusTiers.filter((tier) =>
    tier.minimumDelivered > summary.deliveredCount
    && tier.amountCents > getPotentialBonus(tier.minimumDelivered - 1, payPlan.bonusTiers),
  ).map((tier) => tier.minimumDelivered);
  if (higherRateIsReward && higherRateAt > summary.deliveredCount) targets.push(higherRateAt);
  if (targets.length === 0) return null;
  const deliveryCount = Math.min(...targets);
  const unlocksHigherRate = higherRateIsReward && deliveryCount === higherRateAt;
  const recordedSales = unlocksHigherRate
    ? summary.calculatedSales.filter((item) => item.countsTowardVolume).map((item) => item.sale) : [];
  return {
    deliveryCount,
    deliveriesNeeded: deliveryCount - summary.deliveredCount,
    unlocksHigherRate,
    frontRateBps: unlocksHigherRate ? payPlan.acceleratedFrontRateBps : summary.frontRateBps,
    bonusAddedCents: getPotentialBonus(deliveryCount, payPlan.bonusTiers)
      - getPotentialBonus(deliveryCount - 1, payPlan.bonusTiers),
    recordedRetroactiveCents: recordedSales.reduce((sum, sale) => sum
      + calculateFrontCommission(sale, payPlan.acceleratedFrontRateBps, payPlan).frontCommissionCents
      - calculateFrontCommission(sale, payPlan.baseFrontRateBps, payPlan).frontCommissionCents, 0),
    missingFrontGrossCount: recordedSales.filter((sale) =>
      sale.frontGrossCents === null && sale.frontCommissionOverrideCents == null).length,
  };
}
