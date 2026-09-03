import type { PayPlan, ProfileSettings } from "@/domain/types";

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const DEFAULT_MINIMUM_FRONT_COMMISSION_CENTS = 30_000;

export function getMinimumFrontCommissionCents(payPlan: PayPlan): number {
  return payPlan.minimumFrontCommissionCents ?? DEFAULT_MINIMUM_FRONT_COMMISSION_CENTS;
}

export interface PayPlanValidationResult {
  valid: boolean;
  issues: string[];
}

function validInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function validatePayPlan(payPlan: PayPlan): PayPlanValidationResult {
  const issues: string[] = [];
  if (!payPlan.version.trim() || payPlan.version.trim().length > 120) {
    issues.push("Plan name is required and must be 120 characters or fewer.");
  }
  if (!MONTH_KEY_PATTERN.test(payPlan.effectiveMonth)) {
    issues.push("Effective month must be a valid month.");
  }
  if (!validInteger(payPlan.baseFrontRateBps, 0, 10_000)) {
    issues.push("Base front rate must be between 0% and 100%.");
  }
  if (!validInteger(payPlan.acceleratedFrontRateBps, 0, 10_000)) {
    issues.push("Higher front rate must be between 0% and 100%.");
  } else if (payPlan.acceleratedFrontRateBps < payPlan.baseFrontRateBps) {
    issues.push("Higher front rate cannot be lower than the base front rate.");
  }
  if (!validInteger(payPlan.acceleratedThresholdExclusive, 0, 100)) {
    issues.push("Higher-rate threshold must be a whole number from 0 to 100.");
  }
  if (!validInteger(payPlan.fiRateBps, 0, 10_000)) {
    issues.push("F&I rate must be between 0% and 100%.");
  }
  if (!validInteger(payPlan.minimumFrontCommissionCents === undefined
    ? DEFAULT_MINIMUM_FRONT_COMMISSION_CENTS : payPlan.minimumFrontCommissionCents, 0, 100_000_000)) {
    issues.push("Mini must be between $0 and $1,000,000, with no more than two decimal places.");
  }
  if (payPlan.bonusTiers.length > 20) {
    issues.push("Use no more than 20 bonus tiers.");
  }

  let previousMinimum = -1;
  let previousAmount = -1;
  payPlan.bonusTiers.forEach((tier, index) => {
    if (!validInteger(tier.minimumDelivered, 1, 100)) {
      issues.push(`Bonus tier ${index + 1} delivery minimum must be a whole number from 1 to 100.`);
    }
    if (!validInteger(tier.amountCents, 0, 10_000_000)) {
      issues.push(`Bonus tier ${index + 1} must be between $0 and $100,000.`);
    }
    if (tier.minimumDelivered <= previousMinimum) {
      issues.push("Bonus delivery thresholds must be unique and in ascending order.");
    }
    if (tier.amountCents < previousAmount) {
      issues.push("Bonus amounts cannot decrease at a higher delivery tier.");
    }
    previousMinimum = tier.minimumDelivered;
    previousAmount = tier.amountCents;
  });

  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function assertValidPayPlan(payPlan: PayPlan): void {
  const result = validatePayPlan(payPlan);
  if (!result.valid) throw new Error(`Invalid pay plan: ${result.issues[0]}`);
}

export function upsertPayPlan(schedule: PayPlan[], payPlan: PayPlan): PayPlan[] {
  const byEffectiveMonth = new Map<string, PayPlan>();
  for (const existing of schedule) byEffectiveMonth.set(existing.effectiveMonth, existing);
  byEffectiveMonth.set(payPlan.effectiveMonth, payPlan);
  return [...byEffectiveMonth.values()].sort((a, b) =>
    a.effectiveMonth.localeCompare(b.effectiveMonth),
  );
}

export function getPayPlanSchedule(
  settings: Pick<ProfileSettings, "payPlan" | "payPlanHistory">,
): PayPlan[] {
  return upsertPayPlan(settings.payPlanHistory ?? [], settings.payPlan);
}

function sortedSchedule(payPlanOrSchedule: PayPlan | PayPlan[]): PayPlan[] {
  const schedule = Array.isArray(payPlanOrSchedule)
    ? [...payPlanOrSchedule].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth))
    : [payPlanOrSchedule];
  if (schedule.length === 0) throw new Error("At least one pay plan is required.");
  return schedule;
}

export function getEarliestPayPlanMonth(payPlanOrSchedule: PayPlan | PayPlan[]): string {
  return sortedSchedule(payPlanOrSchedule)[0].effectiveMonth;
}

export function hasPayPlanCoverage(
  payPlanOrSchedule: PayPlan | PayPlan[],
  monthKey: string,
): boolean {
  if (!MONTH_KEY_PATTERN.test(monthKey)) return false;
  return sortedSchedule(payPlanOrSchedule).some((plan) => plan.effectiveMonth <= monthKey);
}

export function payPlanCoverageMessage(
  payPlanOrSchedule: PayPlan | PayPlan[],
  monthKey: string,
): string {
  const earliestMonth = getEarliestPayPlanMonth(payPlanOrSchedule);
  return `No pay plan covers ${monthKey}. Add an older pay plan beginning ${monthKey} or earlier in Settings. The current plan begins ${earliestMonth}.`;
}

export function getPayPlanForMonth(
  payPlanOrSchedule: PayPlan | PayPlan[],
  monthKey: string,
): PayPlan {
  const schedule = sortedSchedule(payPlanOrSchedule);
  const applicable = schedule.filter((plan) => plan.effectiveMonth <= monthKey).at(-1);
  if (!applicable) throw new Error(payPlanCoverageMessage(schedule, monthKey));
  assertValidPayPlan(applicable);
  return applicable;
}

export function payPlanStructureChanged(previous: PayPlan, next: PayPlan): boolean {
  return JSON.stringify({
    version: previous.version,
    effectiveMonth: previous.effectiveMonth,
    baseFrontRateBps: previous.baseFrontRateBps,
    acceleratedFrontRateBps: previous.acceleratedFrontRateBps,
    acceleratedThresholdExclusive: previous.acceleratedThresholdExclusive,
    fiRateBps: previous.fiRateBps,
    minimumFrontCommissionCents: getMinimumFrontCommissionCents(previous),
    bonusTiers: previous.bonusTiers,
  }) !== JSON.stringify({
    version: next.version,
    effectiveMonth: next.effectiveMonth,
    baseFrontRateBps: next.baseFrontRateBps,
    acceleratedFrontRateBps: next.acceleratedFrontRateBps,
    acceleratedThresholdExclusive: next.acceleratedThresholdExclusive,
    fiRateBps: next.fiRateBps,
    minimumFrontCommissionCents: getMinimumFrontCommissionCents(next),
    bonusTiers: next.bonusTiers,
  });
}
