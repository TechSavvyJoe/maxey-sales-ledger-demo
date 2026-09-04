import type { ProfileSettings } from "@/domain/types";
import { normalizeDaysOffByMonth } from "@/domain/pacing";
import type { SettingsNumberText } from "./settingsNumberDraft";

export interface LocalSettingsDraft {
  value: ProfileSettings;
  baseValue: ProfileSettings;
  baseComparable: string;
  numberText: SettingsNumberText;
}

const editableKeys = [
  "salespersonName", "storeName", "monthlyGoal", "monthlyCommissionGoalCents",
  "deliveryGoalsByMonth", "commissionGoalsByMonth", "daysOffByMonth", "payPlan",
] as const;

export function comparableSettingsDraft(settings: ProfileSettings): string {
  return JSON.stringify({
    salespersonName: settings.salespersonName,
    storeName: settings.storeName,
    monthlyGoal: settings.monthlyGoal,
    monthlyCommissionGoalCents: settings.monthlyCommissionGoalCents,
    deliveryGoalsByMonth: Object.fromEntries(Object.entries(settings.deliveryGoalsByMonth ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    commissionGoalsByMonth: Object.fromEntries(Object.entries(settings.commissionGoalsByMonth ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    daysOffByMonth: normalizeDaysOffByMonth(settings.daysOffByMonth),
    payPlan: settings.payPlan,
  });
}

/** Rebase only this editor's in-flight changes onto its exact committed ack. */
export function rebaseSettingsAfterSave(
  current: LocalSettingsDraft,
  submitted: ProfileSettings,
  committed: ProfileSettings,
): LocalSettingsDraft {
  const changes = Object.fromEntries(editableKeys
    .filter((key) => JSON.stringify(current.value[key]) !== JSON.stringify(submitted[key]))
    .map((key) => [key, current.value[key]]));
  return {
    value: { ...committed, ...changes },
    baseValue: committed,
    baseComparable: comparableSettingsDraft(committed),
    // Never reset the caret or replace a half-entered number on a network ack.
    numberText: current.numberText,
  };
}
