import { getCommissionGoalForMonth, getDeliveryGoalForMonth } from "@/domain/goals";
import { getMinimumFrontCommissionCents } from "@/domain/payPlan";
import type { ProfileSettings } from "@/domain/types";

export type SettingsNumberField =
  | "monthlyGoal"
  | "monthlyCommissionGoal"
  | "baseFrontRate"
  | "acceleratedFrontRate"
  | "acceleratedThreshold"
  | "fiRate"
  | "mini"
  | `bonusMinimum-${number}`
  | `bonusAmount-${number}`;

export type SettingsNumberText = Partial<Record<SettingsNumberField, string>>;

interface NumberRule {
  scale: 1 | 100;
  minimum: number;
  maximum: number;
  optional?: boolean;
  message: string;
}

function numberRule(field: SettingsNumberField): NumberRule {
  if (field === "monthlyGoal") {
    return { scale: 1, minimum: 1, maximum: 100, message: "Delivery goal must be a whole number from 1 to 100." };
  }
  if (field === "monthlyCommissionGoal") {
    return { scale: 100, minimum: 100, maximum: 100_000_000, optional: true, message: "Commission goal must be blank or between $1 and $1,000,000, with up to two decimal places." };
  }
  if (field === "acceleratedThreshold") {
    return { scale: 1, minimum: 0, maximum: 100, message: "Higher-rate threshold must be a whole number from 0 to 100." };
  }
  if (field === "mini") {
    return { scale: 100, minimum: 0, maximum: 100_000_000, message: "Mini must be between $0 and $1,000,000, with up to two decimal places." };
  }
  if (field.startsWith("bonusMinimum-")) {
    return { scale: 1, minimum: 1, maximum: 100, message: "Bonus delivery minimum must be a whole number from 1 to 100." };
  }
  if (field.startsWith("bonusAmount-")) {
    return { scale: 100, minimum: 0, maximum: 10_000_000, message: "Bonus added must be between $0 and $100,000, with up to two decimal places." };
  }
  const label = field === "baseFrontRate" ? "Base front rate"
    : field === "acceleratedFrontRate" ? "Higher front rate" : "F&I rate";
  return { scale: 100, minimum: 0, maximum: 10_000, message: `${label} must be between 0% and 100%.` };
}

export function parseSettingsNumber(field: SettingsNumberField, text: string):
  | { valid: true; value: number | null; text: string }
  | { valid: false; message: string } {
  const rule = numberRule(field);
  const trimmed = text.trim();
  if (!trimmed && rule.optional) return { valid: true, value: null, text: "" };
  // Do not coerce an empty or half-entered value to zero. Keep it in the editor
  // until it can be validated, and never put NaN in the saved settings schema.
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return { valid: false, message: rule.message };
  }
  const fraction = trimmed.split(".")[1]?.replace(/0+$/, "") ?? "";
  const number = Number(trimmed);
  const value = Math.round(number * rule.scale);
  if (rule.scale === 100 && fraction.length > 2) {
    return { valid: false, message: "Use no more than two decimal places." };
  }
  if (
    !Number.isFinite(number)
    || !Number.isSafeInteger(value)
    || (rule.scale === 1 && (!Number.isInteger(number) || fraction.length > 0))
    || value < rule.minimum
    || value > rule.maximum
  ) return { valid: false, message: rule.message };
  return { valid: true, value, text: String(value / rule.scale) };
}

export function settingsNumberText(
  settings: ProfileSettings,
  field: SettingsNumberField,
  month: string,
): string {
  if (field === "monthlyGoal") return String(getDeliveryGoalForMonth(settings, month));
  if (field === "monthlyCommissionGoal") {
    const goal = getCommissionGoalForMonth(settings, month);
    return goal === null ? "" : String(goal / 100);
  }
  if (field === "baseFrontRate") return String(settings.payPlan.baseFrontRateBps / 100);
  if (field === "acceleratedFrontRate") return String(settings.payPlan.acceleratedFrontRateBps / 100);
  if (field === "fiRate") return String(settings.payPlan.fiRateBps / 100);
  if (field === "mini") return String(getMinimumFrontCommissionCents(settings.payPlan) / 100);
  if (field === "acceleratedThreshold") return String(settings.payPlan.acceleratedThresholdExclusive);
  const index = Number(field.split("-")[1]);
  const tier = settings.payPlan.bonusTiers[index];
  if (!tier) return "";
  return field.startsWith("bonusMinimum-") ? String(tier.minimumDelivered)
    : String((tier.amountCents - (settings.payPlan.bonusTiers[index - 1]?.amountCents ?? 0)) / 100);
}

export function applySettingsNumber(
  settings: ProfileSettings,
  field: SettingsNumberField,
  value: number | null,
  month: string,
  baseline?: ProfileSettings,
): ProfileSettings {
  if (field === "monthlyCommissionGoal") {
    const goals = { ...settings.commissionGoalsByMonth, [month]: value };
    if (baseline && value === getCommissionGoalForMonth(baseline, month)) {
      if (Object.hasOwn(baseline.commissionGoalsByMonth ?? {}, month)) goals[month] = baseline.commissionGoalsByMonth![month];
      else delete goals[month];
    }
    return { ...settings, commissionGoalsByMonth: goals };
  }
  if (value === null) return settings;
  if (field === "monthlyGoal") {
    const goals = { ...settings.deliveryGoalsByMonth, [month]: value };
    if (baseline && value === getDeliveryGoalForMonth(baseline, month)) {
      if (Object.hasOwn(baseline.deliveryGoalsByMonth ?? {}, month)) goals[month] = baseline.deliveryGoalsByMonth![month];
      else delete goals[month];
    }
    return { ...settings, deliveryGoalsByMonth: goals };
  }
  const planField = field === "baseFrontRate" ? "baseFrontRateBps"
    : field === "acceleratedFrontRate" ? "acceleratedFrontRateBps"
      : field === "acceleratedThreshold" ? "acceleratedThresholdExclusive"
        : field === "fiRate" ? "fiRateBps"
          : field === "mini" ? "minimumFrontCommissionCents" : null;
  if (planField) return { ...settings, payPlan: { ...settings.payPlan, [planField]: value } };
  const index = Number(field.split("-")[1]);
  const tiers = settings.payPlan.bonusTiers;
  if (!tiers[index]) return settings;
  const currentIncrement = tiers[index].amountCents - (tiers[index - 1]?.amountCents ?? 0);
  const difference = value - currentIncrement;
  const bonusTiers = tiers.map((tier, tierIndex) => {
    if (field.startsWith("bonusMinimum-")) {
      return tierIndex === index ? { ...tier, minimumDelivered: value } : tier;
    }
    // Changing one milestone's added bonus must preserve all later increments.
    return tierIndex >= index ? { ...tier, amountCents: tier.amountCents + difference } : tier;
  });
  return { ...settings, payPlan: { ...settings.payPlan, bonusTiers } };
}

export function hasUnfinishedSettingsNumbers(
  settings: ProfileSettings,
  text: SettingsNumberText,
  month: string,
): boolean {
  return Object.entries(text).some(([field, value]) => (
    value !== settingsNumberText(settings, field as SettingsNumberField, month)
  ));
}

/** Identity is kept outside the numeric schema and transferred only for edits.
 * Inserted/removed rows retain the IDs of surviving tier objects, not positions. */
export function createBonusRowIdentity() {
  type Tier = ProfileSettings["payPlan"]["bonusTiers"][number];
  const identities = new WeakMap<Tier, string>();
  let previousSnapshot: Tier[] | null = null;
  let sequence = 0;
  function key(tier: Tier): string {
    let id = identities.get(tier);
    if (!id) {
      id = `bonus-row-${++sequence}`;
      identities.set(tier, id);
    }
    return id;
  }
  return {
    key,
    snapshot(next: Tier[]) {
      if (previousSnapshot === next) return;
      const previous = previousSnapshot;
      // Browser reads clone every tier, including after an unrelated profile
      // or payroll save. Equivalent snapshots represent the same visible rows.
      // Transfer their UI identities before React reconciles focused inputs.
      if (previous && previous.length === next.length
        && next.every((tier, index) => (
          tier.minimumDelivered === previous[index].minimumDelivered
          && tier.amountCents === previous[index].amountCents
        ))) {
        next.forEach((tier, index) => {
          if (!identities.has(tier)) identities.set(tier, key(previous[index]));
        });
      }
      previousSnapshot = next;
    },
    edited(previous: Tier[], next: Tier[]) {
      next.forEach((tier, index) => {
        if (previous[index]) identities.set(tier, key(previous[index]));
      });
    },
  };
}
