import { describe, expect, it } from "vitest";
import { createDefaultSettings } from "@/persistence/localDatabase";
import { comparableSettingsDraft, rebaseSettingsAfterSave, type LocalSettingsDraft } from "./settingsAutosave";

describe("settings autosave acknowledgements", () => {
  it("keeps text entered during the save and uses the committed version for the next write", () => {
    const base = createDefaultSettings();
    const submitted = { ...base, salespersonName: "First edit" };
    const current: LocalSettingsDraft = {
      baseValue: base, baseComparable: comparableSettingsDraft(base),
      value: { ...submitted, salespersonName: "Still typing", monthlyGoal: 23 },
      numberText: { mini: "30", monthlyGoal: "023" },
    };
    const committed = { ...submitted, updatedAt: "2026-09-03T12:00:00.001Z" };
    const next = rebaseSettingsAfterSave(current, submitted, committed);
    expect(next.value.salespersonName).toBe("Still typing");
    expect(next.value.monthlyGoal).toBe(23);
    expect(next.value.updatedAt).toBe(committed.updatedAt);
    expect(next.baseComparable).toBe(comparableSettingsDraft(committed));
    expect(next.numberText).toEqual(current.numberText);
  });

  it("uses canonical acknowledged values for fields not changed while saving", () => {
    const base = createDefaultSettings();
    const submitted = { ...base, salespersonName: " Name " };
    const current = { baseValue: base, baseComparable: comparableSettingsDraft(base), value: submitted, numberText: {} };
    const committed = { ...submitted, salespersonName: "Name", updatedAt: "2026-09-03T12:00:00.001Z" };
    const next = rebaseSettingsAfterSave(current, submitted, committed);
    expect(comparableSettingsDraft(next.value)).toBe(next.baseComparable);
    expect(next.value.salespersonName).toBe("Name");
  });

  it("does not let a draft overwrite server-owned history or payroll", () => {
    const base = createDefaultSettings();
    const current = { baseValue: base, baseComparable: comparableSettingsDraft(base), value: { ...base, storeName: "Edited store" }, numberText: {} };
    const committed = { ...base, actualPaidByMonth: { "2026-08": 100000 }, lastBackupAt: "2026-09-03T12:00:00.000Z" };
    const next = rebaseSettingsAfterSave(current, base, committed);
    expect(next.value.actualPaidByMonth).toEqual(committed.actualPaidByMonth);
    expect(next.value.lastBackupAt).toBe(committed.lastBackupAt);
    expect(next.value.storeName).toBe("Edited store");
  });
});
