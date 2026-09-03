import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateMonth } from "@/domain/commission";
import { getMinimumFrontCommissionCents, getPayPlanSchedule } from "@/domain/payPlan";
import type { Sale } from "@/domain/types";
import {
  db, initializeDatabase, loadTrackerData, persistSale, persistSettings,
  importSales, replaceDatabaseFromBackup,
} from "@/persistence/database";
import { SaleWriteConflictError } from "@/persistence/errors";

const sale: Sale = {
  id: "mini-test", profileId: "primary", saleDate: "2026-08-10",
  customerLastName: "Example", stockNumber: "MINI-1", vehicleDescription: "Example vehicle",
  status: "delivered", unitCreditBasis: 500, frontGrossCents: -31_661, fiGrossCents: 60_000,
  notes: "", createdAt: "2026-08-10T12:00:00Z", updatedAt: "2026-08-10T12:00:00Z",
  revision: 1, source: "manual",
};

describe("mini and manual commission persistence", () => {
  beforeEach(async () => { await db.delete(); await db.open(); });
  afterEach(async () => { await db.delete(); });

  it("saves, revises, and clears a personal override with an auditable history", async () => {
    await initializeDatabase();
    await persistSale({ ...sale, frontCommissionOverrideCents: 50_000 }, true);
    let stored = (await db.sales.get(sale.id))!;
    expect(stored).toMatchObject({ frontCommissionOverrideCents: 50_000, frontGrossCents: -31_661, unitCreditBasis: 500 });
    await persistSale({ ...stored, frontCommissionOverrideCents: 65_000, revision: 2 }, false, stored);
    stored = (await db.sales.get(sale.id))!;
    expect(stored).toMatchObject({ frontCommissionOverrideCents: 65_000, revision: 2 });
    await persistSale({ ...stored, frontCommissionOverrideCents: null, revision: 3 }, false, stored);
    const result = await loadTrackerData();
    expect(result.sales[0]).toMatchObject({ frontCommissionOverrideCents: null, revision: 3, frontGrossCents: -31_661 });
    expect(result.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "sale.created", details: expect.objectContaining({ newFrontCommissionOverrideCents: 50_000 }) }),
      expect.objectContaining({ action: "sale.updated", details: expect.objectContaining({ priorFrontCommissionOverrideCents: 50_000, newFrontCommissionOverrideCents: 65_000 }) }),
      expect.objectContaining({ action: "sale.updated", details: expect.objectContaining({ priorFrontCommissionOverrideCents: 65_000, newFrontCommissionOverrideCents: null }) }),
    ]));
    const summary = calculateMonth(result.sales, "2026-08", getPayPlanSchedule(result.settings));
    expect(summary.frontGrossCents).toBe(-31_661);
    expect(summary.frontCommissionCents).toBe(15_000);
  });

  it("does not let an outdated tab overwrite a newly saved spiff", async () => {
    await initializeDatabase();
    await persistSale(sale, true);
    await persistSale({ ...sale, revision: 2, frontCommissionOverrideCents: 50_000 }, false, sale);
    await expect(persistSale({ ...sale, revision: 2, frontCommissionOverrideCents: null }, false, sale))
      .rejects.toBeInstanceOf(SaleWriteConflictError);
    expect((await db.sales.get(sale.id))?.frontCommissionOverrideCents).toBe(50_000);
  });

  it.each([-1, 0.1, Number.NaN, Infinity, 100_000_001, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid manual amount %s before any record or audit write", async (amount) => {
      const settings = await initializeDatabase();
      const invalid = { ...sale, frontCommissionOverrideCents: amount };
      await expect(persistSale(invalid, true)).rejects.toThrow(/Manual front commission/);
      await expect(importSales([invalid], "bad.xlsx")).rejects.toThrow(/Manual front commission/);
      await expect(replaceDatabaseFromBackup(settings, [invalid], [])).rejects.toThrow(/Manual front commission/);
      expect(await db.sales.count()).toBe(0);
      expect(await db.auditEvents.count()).toBe(0);
    },
  );

  it("preserves explicit zero and maximum manual payouts", async () => {
    await initializeDatabase();
    await persistSale({ ...sale, frontCommissionOverrideCents: 0 }, true);
    await persistSale({ ...sale, id: "maximum", stockNumber: "MAX", frontCommissionOverrideCents: 100_000_000 }, true);
    expect((await db.sales.get(sale.id))?.frontCommissionOverrideCents).toBe(0);
    expect((await db.sales.get("maximum"))?.frontCommissionOverrideCents).toBe(100_000_000);
  });

  it("applies the legacy $300 mini without changing signed gross, goals, payroll, or plan history", async () => {
    const settings = await initializeDatabase();
    const { minimumFrontCommissionCents: _mini, ...oldPlan } = settings.payPlan;
    const old = { ...oldPlan, version: "My preserved plan", effectiveMonth: "2025-01", fiRateBps: 1_500 };
    const current = { ...oldPlan, version: "My current plan" };
    await db.settings.put({ ...settings, payPlan: current, payPlanHistory: [old, current], monthlyGoal: 23, actualPaidByMonth: { "2026-08": 222_222 } });
    await db.sales.put(sale);
    const restored = await loadTrackerData();
    expect(restored.sales).toEqual([sale]);
    expect(restored.settings.monthlyGoal).toBe(23);
    expect(restored.settings.actualPaidByMonth).toEqual({ "2026-08": 222_222 });
    expect(restored.settings.payPlanHistory.map(getMinimumFrontCommissionCents)).toEqual([30_000, 30_000]);
    expect(restored.settings.payPlanHistory.map((plan) => plan.version)).toEqual([old.version, current.version]);
    expect(calculateMonth(restored.sales, "2026-08", getPayPlanSchedule(restored.settings)).frontCommissionCents).toBe(15_000);
  });

  it.each([0, 45_000])("preserves and audits a custom Mini of %s cents", async (mini) => {
    const settings = await initializeDatabase();
    const plan = { ...settings.payPlan, minimumFrontCommissionCents: mini };
    await persistSettings({ ...settings, payPlan: plan, payPlanHistory: [plan] });
    const restored = await loadTrackerData();
    expect(restored.settings.payPlan.minimumFrontCommissionCents).toBe(mini);
    expect(restored.auditEvents).toContainEqual(expect.objectContaining({
      action: "settings.updated", details: expect.objectContaining({
        payPlanChanged: true, priorMinimumFrontCommissionCents: 30_000, newMinimumFrontCommissionCents: mini,
      }),
    }));
  });

  it.each([-1, 0.5, Number.NaN, Infinity, 100_000_001])("rejects invalid Mini %s before replacing settings", async (mini) => {
    const settings = await initializeDatabase();
    const plan = { ...settings.payPlan, minimumFrontCommissionCents: mini };
    await expect(persistSettings({ ...settings, payPlan: plan, payPlanHistory: [plan] })).rejects.toThrow(/Invalid pay plan/);
    expect((await db.settings.get("primary"))?.payPlan).toEqual(settings.payPlan);
  });

  it.each(["Howell Used Sales Plan 2026", "Howell-used-sales-2026-cumulative-3"])("does not treat a malformed null Mini in %s as an omitted legacy setting", async (version) => {
    const settings = await initializeDatabase();
    const plan = { ...settings.payPlan, version, minimumFrontCommissionCents: null as unknown as number };
    await expect(persistSettings({ ...settings, payPlan: plan, payPlanHistory: [plan] })).rejects.toThrow(/Invalid pay plan/);
    expect((await db.settings.get("primary"))?.payPlan).toEqual(settings.payPlan);
  });
});
