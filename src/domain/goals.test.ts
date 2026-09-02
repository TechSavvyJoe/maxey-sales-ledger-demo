import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import {
  getCommissionGoalForMonth,
  getDeliveryGoalForMonth,
  normalizeCommissionGoalsByMonth,
  normalizeDeliveryGoalsByMonth,
} from "@/domain/goals";
import type { ProfileSettings } from "@/domain/types";

function settings(): ProfileSettings {
  return {
    id: "primary",
    salespersonName: "Sample",
    storeName: "Bob Maxey Ford of Howell",
    monthlyGoal: 15,
    monthlyCommissionGoalCents: 500_000,
    deliveryGoalsByMonth: { "2026-08": 20 },
    commissionGoalsByMonth: { "2026-08": 700_000, "2026-09": null },
    daysOffByMonth: {},
    selectedMonth: "2026-08",
    selectedView: "dashboard",
    actualPaidByMonth: {},
    payPlan: DEFAULT_PAY_PLAN,
    payPlanHistory: [DEFAULT_PAY_PLAN],
    onboardingDismissed: false,
    lastBackupAt: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}

describe("month-specific goals", () => {
  it("uses a saved month override without changing the profile default", () => {
    const profile = settings();
    expect(getDeliveryGoalForMonth(profile, "2026-08")).toBe(20);
    expect(getDeliveryGoalForMonth(profile, "2026-07")).toBe(15);
    expect(getCommissionGoalForMonth(profile, "2026-08")).toBe(700_000);
    expect(getCommissionGoalForMonth(profile, "2026-07")).toBe(500_000);
  });

  it("supports explicitly turning off the commission goal for one month", () => {
    expect(getCommissionGoalForMonth(settings(), "2026-09")).toBeNull();
  });

  it("drops malformed goal-map entries", () => {
    expect(normalizeDeliveryGoalsByMonth({
      "2026-08": 20,
      "bad": 22,
      "2026-13": 5,
      "2026-09": 0,
    })).toEqual({ "2026-08": 20 });
    expect(normalizeCommissionGoalsByMonth({
      "2026-08": 500_000,
      "2026-09": null,
      "bad": 3,
      "2026-10": -1,
    })).toEqual({ "2026-08": 500_000, "2026-09": null });
  });
});
