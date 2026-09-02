import type { ProfileSettings } from "@/domain/types";

function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
export function getDeliveryGoalForMonth(settings: ProfileSettings, monthKey: string): number {
  const override = settings.deliveryGoalsByMonth?.[monthKey];
  return Number.isInteger(override) && (override ?? 0) > 0
    ? override as number
    : settings.monthlyGoal;
}

export function getCommissionGoalForMonth(
  settings: ProfileSettings,
  monthKey: string,
): number | null {
  if (settings.commissionGoalsByMonth && Object.hasOwn(settings.commissionGoalsByMonth, monthKey)) {
    const override = settings.commissionGoalsByMonth[monthKey];
    return override === null || (Number.isInteger(override) && override >= 0)
      ? override
      : settings.monthlyCommissionGoalCents;
  }
  return settings.monthlyCommissionGoalCents;
}

export function normalizeDeliveryGoalsByMonth(
  value: ProfileSettings["deliveryGoalsByMonth"],
): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([monthKey, goal]) => isMonthKey(monthKey) && Number.isInteger(goal) && goal > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function normalizeCommissionGoalsByMonth(
  value: ProfileSettings["commissionGoalsByMonth"],
): Record<string, number | null> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([monthKey, goal]) => isMonthKey(monthKey) && (goal === null || (Number.isInteger(goal) && goal >= 0)))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
