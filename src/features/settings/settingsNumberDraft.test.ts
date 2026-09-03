import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import type { ProfileSettings } from "@/domain/types";
import {
  applySettingsNumber,
  createBonusRowIdentity,
  hasUnfinishedSettingsNumbers,
  parseSettingsNumber,
  settingsNumberText,
  type SettingsNumberField,
} from "./settingsNumberDraft";

function profile(): ProfileSettings {
  return {
    id: "primary",
    salespersonName: "Sample",
    storeName: "Bob Maxey Ford of Howell",
    monthlyGoal: 20,
    monthlyCommissionGoalCents: 750_000,
    deliveryGoalsByMonth: {},
    commissionGoalsByMonth: {},
    daysOffByMonth: {},
    selectedMonth: "2026-09",
    selectedView: "settings",
    actualPaidByMonth: {},
    payPlan: structuredClone(DEFAULT_PAY_PLAN),
    payPlanHistory: [structuredClone(DEFAULT_PAY_PLAN)],
    onboardingDismissed: true,
    lastBackupAt: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

describe("settings numeric editing", () => {
  it.each<SettingsNumberField>([
    "monthlyGoal", "baseFrontRate", "acceleratedFrontRate", "acceleratedThreshold",
    "fiRate", "mini", "bonusMinimum-0", "bonusAmount-0",
  ])("does not coerce an empty required %s field to zero", (field) => {
    expect(parseSettingsNumber(field, "").valid).toBe(false);
    expect(parseSettingsNumber(field, " ").valid).toBe(false);
  });

  it.each([".", "-", "+", "1e2", "Infinity", "NaN", "12x", "1.2.3"])(
    "keeps incomplete or non-decimal text %s invalid instead of storing it",
    (text) => expect(parseSettingsNumber("monthlyCommissionGoal", text).valid).toBe(false),
  );

  it.each<[SettingsNumberField, string, number, string]>([
    ["monthlyGoal", "00025", 25, "25"],
    ["baseFrontRate", "030.50", 3050, "30.5"],
    ["acceleratedFrontRate", "035.", 3500, "35"],
    ["fiRate", ".50", 50, "0.5"],
    ["mini", "00300.50", 30050, "300.5"],
    ["acceleratedThreshold", "00010", 10, "10"],
    ["bonusMinimum-0", "011.0", 11, "11"],
    ["bonusAmount-0", "00375.50", 37550, "375.5"],
    ["monthlyCommissionGoal", "009000.50", 900050, "9000.5"],
    ["monthlyCommissionGoal", "1.2300", 123, "1.23"],
  ])("normalizes %s %s only at an explicit editing boundary", (field, text, value, normalized) => {
    expect(parseSettingsNumber(field, text)).toEqual({ valid: true, value, text: normalized });
  });

  it("distinguishes an optional blank commission goal from explicit invalid zero", () => {
    expect(parseSettingsNumber("monthlyCommissionGoal", "")).toEqual({ valid: true, value: null, text: "" });
    expect(parseSettingsNumber("monthlyCommissionGoal", "0").valid).toBe(false);
    expect(parseSettingsNumber("bonusAmount-0", "0")).toEqual({ valid: true, value: 0, text: "0" });
    expect(parseSettingsNumber("baseFrontRate", "0")).toEqual({ valid: true, value: 0, text: "0" });
    expect(parseSettingsNumber("acceleratedThreshold", "0")).toEqual({ valid: true, value: 0, text: "0" });
    expect(parseSettingsNumber("mini", "0")).toEqual({ valid: true, value: 0, text: "0" });
  });

  it.each<[SettingsNumberField, string]>([
    ["monthlyGoal", "1.5"], ["monthlyGoal", "0"], ["monthlyGoal", "101"],
    ["monthlyGoal", "1.0000000000000000000000001"],
    ["baseFrontRate", "100.01"], ["fiRate", "-0.1"], ["fiRate", "1.001"],
    ["monthlyCommissionGoal", "1000000.01"], ["bonusAmount-0", "100000.01"],
    ["bonusMinimum-0", "0"], ["acceleratedThreshold", "-1"],
    ["bonusAmount-0", "99999999999999999999999"],
    ["mini", "-1"], ["mini", "1000000.01"], ["mini", "300.001"],
  ])("rejects invalid range or precision for %s %s", (field, text) => {
    expect(parseSettingsNumber(field, text).valid).toBe(false);
  });

  it("marks unfinished and unnormalized text dirty even if the numeric preview is unchanged", () => {
    const settings = profile();
    expect(hasUnfinishedSettingsNumbers(settings, { baseFrontRate: "" }, "2026-09")).toBe(true);
    expect(hasUnfinishedSettingsNumbers(settings, { baseFrontRate: "030" }, "2026-09")).toBe(true);
    expect(hasUnfinishedSettingsNumbers(settings, { baseFrontRate: "30" }, "2026-09")).toBe(false);
    expect(settingsNumberText(settings, "monthlyCommissionGoal", "2026-09")).toBe("7500");
  });

  it("restores the original inherited goal when an edit is reverted, without leaving a new override", () => {
    const baseline = profile();
    const changed = applySettingsNumber(baseline, "monthlyGoal", 2, "2026-09", baseline);
    expect(changed.deliveryGoalsByMonth?.["2026-09"]).toBe(2);
    const reverted = applySettingsNumber(changed, "monthlyGoal", 20, "2026-09", baseline);
    expect(reverted.deliveryGoalsByMonth).toEqual({});
    const blank = applySettingsNumber(baseline, "monthlyCommissionGoal", null, "2026-09", baseline);
    expect(blank.commissionGoalsByMonth?.["2026-09"]).toBeNull();
    const restored = applySettingsNumber(blank, "monthlyCommissionGoal", 750_000, "2026-09", baseline);
    expect(restored.commissionGoalsByMonth).toEqual({});
  });

  it("keeps an existing goal override when a numeric edit returns to its saved value", () => {
    const baseline = profile();
    baseline.deliveryGoalsByMonth = { "2026-09": 25 };
    baseline.commissionGoalsByMonth = { "2026-09": null };
    const changed = applySettingsNumber(baseline, "monthlyGoal", 2, "2026-09", baseline);
    expect(applySettingsNumber(changed, "monthlyGoal", 25, "2026-09", baseline).deliveryGoalsByMonth).toEqual(baseline.deliveryGoalsByMonth);
    const changedMoney = applySettingsNumber(baseline, "monthlyCommissionGoal", 100, "2026-09", baseline);
    expect(applySettingsNumber(changedMoney, "monthlyCommissionGoal", null, "2026-09", baseline).commissionGoalsByMonth).toEqual(baseline.commissionGoalsByMonth);
  });

  it("updates one added bonus while preserving every subsequent milestone increment", () => {
    const original = profile();
    const changed = applySettingsNumber(original, "bonusAmount-0", 37_550, "2026-09");
    expect(changed.payPlan.bonusTiers[0].amountCents).toBe(37_550);
    for (let index = 1; index < original.payPlan.bonusTiers.length; index++) {
      expect(settingsNumberText(changed, `bonusAmount-${index}`, "2026-09"))
        .toBe(settingsNumberText(original, `bonusAmount-${index}`, "2026-09"));
    }
    expect(original.payPlan.bonusTiers[0].amountCents).toBe(30_000);
  });

  it("does not change the stored pay-plan schema or business rules", () => {
    const original = profile();
    const updated = applySettingsNumber(original, "fiRate", 2050, "2026-09");
    expect(updated.payPlan.fiRateBps).toBe(2050);
    expect(updated.payPlan.baseFrontRateBps).toBe(3000);
    expect(updated.payPlan.acceleratedThresholdExclusive).toBe(10);
    expect(updated.payPlan.bonusTiers).toEqual(original.payPlan.bonusTiers);
    expect(JSON.parse(JSON.stringify(updated))).toEqual(updated);
  });

  it("edits Mini in cents without changing rates, history, or other settings", () => {
    const original = profile();
    delete original.payPlan.minimumFrontCommissionCents;
    expect(settingsNumberText(original, "mini", "2026-09")).toBe("300");
    const updated = applySettingsNumber(original, "mini", 45_050, "2026-09");
    expect(updated.payPlan.minimumFrontCommissionCents).toBe(45_050);
    expect(settingsNumberText(updated, "mini", "2026-09")).toBe("450.5");
    expect(updated.payPlanHistory).toEqual(original.payPlanHistory);
    expect(updated.payPlan.baseFrontRateBps).toBe(original.payPlan.baseFrontRateBps);
    expect(updated.payPlan.fiRateBps).toBe(original.payPlan.fiRateBps);
    expect(original.payPlan.minimumFrontCommissionCents).toBeUndefined();
    expect(hasUnfinishedSettingsNumbers(updated, { mini: "" }, "2026-09")).toBe(true);
    expect(hasUnfinishedSettingsNumbers(updated, { mini: "450.5" }, "2026-09")).toBe(false);
  });

  it("preserves row identity through edited values, insertion, removal, and reordering", () => {
    const original = profile();
    const identity = createBonusRowIdentity();
    const keys = original.payPlan.bonusTiers.map(identity.key);
    const edited = applySettingsNumber(original, "bonusMinimum-0", 12, "2026-09");
    identity.edited(original.payPlan.bonusTiers, edited.payPlan.bonusTiers);
    expect(edited.payPlan.bonusTiers.map(identity.key)).toEqual(keys);
    const inserted = { minimumDelivered: 40, amountCents: 900_000 };
    const reordered = [edited.payPlan.bonusTiers[2], inserted, edited.payPlan.bonusTiers[0]];
    expect(reordered.map(identity.key)).toEqual([keys[2], identity.key(inserted), keys[0]]);
    expect(identity.key(inserted)).not.toBe(keys[1]);
  });

  it("preserves row identity when an unrelated save refreshes equivalent cloned tiers", () => {
    const original = profile();
    const identity = createBonusRowIdentity();
    identity.snapshot(original.payPlan.bonusTiers);
    const keys = original.payPlan.bonusTiers.map(identity.key);

    const refreshed = structuredClone(original);
    refreshed.salespersonName = "Updated elsewhere";
    identity.snapshot(refreshed.payPlan.bonusTiers);
    expect(refreshed.payPlan.bonusTiers.map(identity.key)).toEqual(keys);

    const edited = applySettingsNumber(refreshed, "bonusMinimum-0", 12, "2026-09");
    identity.edited(refreshed.payPlan.bonusTiers, edited.payPlan.bonusTiers);
    identity.snapshot(edited.payPlan.bonusTiers);
    const afterSave = structuredClone(edited);
    identity.snapshot(afterSave.payPlan.bonusTiers);
    expect(afterSave.payPlan.bonusTiers.map(identity.key)).toEqual(keys);
  });
});
