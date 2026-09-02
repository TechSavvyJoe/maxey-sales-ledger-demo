import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import type { Sale } from "@/domain/types";
import {
  db,
  importSales,
  initializeDatabase,
  loadBackupSnapshot,
  loadDemoSales,
  loadTrackerData,
  persistSale,
  persistSettings,
  recordBackupExport,
  removeDemoSales,
  replaceDatabaseFromBackup,
  softDeleteSale,
  restoreSale,
  updateSelectedContext,
} from "@/persistence/database";
import { SaleWriteConflictError } from "@/persistence/errors";

const sampleSale: Sale = {
  id: "db-test-sale",
  profileId: "primary",
  saleDate: "2026-08-10",
  customerLastName: "Sample",
  stockNumber: "DB-001",
  vehicleDescription: "Sample vehicle",
  status: "delivered",
  unitCreditBasis: 1_000,
  frontGrossCents: 200_000,
  fiGrossCents: 50_000,
  notes: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  revision: 1,
  source: "demo",
};

describe("local database", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("creates default settings and persists a sale with audit history", async () => {
    const settings = await initializeDatabase();
    expect(settings.daysOffByMonth).toEqual({});
    expect(settings.monthlyCommissionGoalCents).toBeNull();
    expect(settings.deliveryGoalsByMonth).toEqual({});
    expect(settings.commissionGoalsByMonth).toEqual({});
    expect(settings.payPlan.baseFrontRateBps).toBe(3_000);
    expect(settings.payPlan.bonusTiers).toHaveLength(6);
    expect(settings.payPlan.bonusTiers.at(-1)).toEqual({ minimumDelivered: 35, amountCents: 810_000 });
    await persistSale(sampleSale, true);
    const data = await loadTrackerData();
    expect(data.sales).toHaveLength(1);
    expect(data.auditEvents.some((event) => event.action === "sale.created")).toBe(true);
  });

  it("captures settings, sales, and activity together for a recovery backup", async () => {
    const settings = await initializeDatabase();
    await persistSettings({ ...settings, salespersonName: "Backup User" });
    await persistSale(sampleSale, true);

    const snapshot = await loadBackupSnapshot();
    expect(snapshot.settings.salespersonName).toBe("Backup User");
    expect(snapshot.sales).toEqual([sampleSale]);
    expect(snapshot.auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["settings.updated", "sale.created"]),
    );
  });

  it("rejects a stale sale editor without losing the newer committed fields or audit accuracy", async () => {
    await initializeDatabase();
    await persistSale(sampleSale, true);
    const editorA = structuredClone((await db.sales.get(sampleSale.id))!);
    const editorB = structuredClone(editorA);

    await persistSale(
      {
        ...editorA,
        frontGrossCents: 325_000,
        updatedAt: "2026-08-10T12:05:00.000Z",
        revision: editorA.revision + 1,
      },
      false,
      { revision: editorA.revision, updatedAt: editorA.updatedAt },
    );

    await expect(
      persistSale(
        {
          ...editorB,
          fiGrossCents: 125_000,
          updatedAt: "2026-08-10T12:06:00.000Z",
          revision: editorB.revision + 1,
        },
        false,
        { revision: editorB.revision, updatedAt: editorB.updatedAt },
      ),
    ).rejects.toBeInstanceOf(SaleWriteConflictError);

    expect(await db.sales.get(sampleSale.id)).toMatchObject({
      frontGrossCents: 325_000,
      fiGrossCents: 50_000,
      revision: 2,
    });
    const updates = await db.auditEvents.where("action").equals("sale.updated").toArray();
    expect(updates).toHaveLength(1);
    expect(updates[0]?.details).toMatchObject({ revision: 2 });
  });

  it("rejects an edit when its timestamp token is stale even if the revision matches", async () => {
    await initializeDatabase();
    await persistSale(sampleSale, true);
    await db.sales.update(sampleSale.id, { updatedAt: "2026-08-10T12:01:00.000Z" });

    await expect(
      persistSale(
        { ...sampleSale, frontGrossCents: 300_000, revision: 2 },
        false,
        { revision: 1, updatedAt: sampleSale.updatedAt },
      ),
    ).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect((await db.sales.get(sampleSale.id))?.frontGrossCents).toBe(200_000);
  });

  it("records a manual backup without overwriting newer settings from another tab", async () => {
    const stale = await initializeDatabase();
    await persistSettings({ ...stale, salespersonName: "Newest Name", monthlyGoal: 22 });

    const recorded = await recordBackupExport(stale);
    expect(recorded.salespersonName).toBe("Newest Name");
    expect(recorded.monthlyGoal).toBe(22);
    expect(recorded.lastBackupAt).toBeTruthy();
    expect((await db.settings.get("primary"))?.salespersonName).toBe("Newest Name");
  });

  it("patches selected context without clobbering newer durable settings", async () => {
    const stale = await initializeDatabase();
    await persistSettings({ ...stale, salespersonName: "Newest Name", monthlyGoal: 22 });

    const returned = await updateSelectedContext(stale, {
      selectedMonth: "2026-09",
      selectedView: "reports",
    });
    const stored = await db.settings.get("primary");
    expect(returned).toMatchObject({
      salespersonName: "Newest Name",
      monthlyGoal: 22,
      selectedMonth: "2026-09",
      selectedView: "reports",
    });
    expect(stored).toMatchObject(returned);
  });

  it("migrates missing or malformed work-schedule data without changing the database schema", async () => {
    const settings = await initializeDatabase();
    const legacy = structuredClone(settings) as unknown as Omit<typeof settings, "daysOffByMonth"> & {
      daysOffByMonth?: unknown;
    };
    delete legacy.daysOffByMonth;
    await db.settings.put(legacy as typeof settings);
    expect((await initializeDatabase()).daysOffByMonth).toEqual({});

    await db.settings.put({
      ...(await initializeDatabase()),
      daysOffByMonth: {
        "2026-08": ["2026-08-20", "2026-08-09", "2026-08-05", "2026-08-05"],
        invalid: ["2026-08-06"],
      },
    });
    expect((await initializeDatabase()).daysOffByMonth).toEqual({
      "2026-08": ["2026-08-05", "2026-08-20"],
    });
  });

  it("migrates an optional commission goal and preserves a valid saved goal", async () => {
    const settings = await initializeDatabase();
    const legacy = structuredClone(settings) as unknown as Omit<typeof settings, "monthlyCommissionGoalCents"> & {
      monthlyCommissionGoalCents?: unknown;
    };
    delete legacy.monthlyCommissionGoalCents;
    await db.settings.put(legacy as typeof settings);
    expect((await initializeDatabase()).monthlyCommissionGoalCents).toBeNull();

    await persistSettings({
      ...(await initializeDatabase()),
      monthlyCommissionGoalCents: 750_000,
    });
    expect((await initializeDatabase()).monthlyCommissionGoalCents).toBe(750_000);
  });

  it("normalizes month-specific goal maps from browser storage", async () => {
    const settings = await initializeDatabase();
    await db.settings.put({
      ...settings,
      deliveryGoalsByMonth: {
        "2026-08": 20,
        "2026-13": 22,
        "2026-09": 0,
      },
      commissionGoalsByMonth: {
        "2026-08": 750_000,
        "2026-09": null,
        "bad": 100,
        "2026-10": -10,
      },
    });

    const normalized = await initializeDatabase();
    expect(normalized.deliveryGoalsByMonth).toEqual({ "2026-08": 20 });
    expect(normalized.commissionGoalsByMonth).toEqual({
      "2026-08": 750_000,
      "2026-09": null,
    });
  });

  it("removes malformed actual-paid values so the workspace remains backup-safe", async () => {
    const settings = await initializeDatabase();
    await persistSettings({
      ...settings,
      actualPaidByMonth: {
        "2026-08": 123_456,
        "2026-09": 100_000_001,
        "2026-10": -100_000_001,
        invalid: 100,
      },
    });

    expect((await initializeDatabase()).actualPaidByMonth).toEqual({ "2026-08": 123_456 });
  });

  it("records the before-and-after pay-plan rules in local activity", async () => {
    const settings = await initializeDatabase();
    const changedPlan = {
      ...settings.payPlan,
      version: "September plan",
      effectiveMonth: "2026-09",
      baseFrontRateBps: 3_100,
      fiRateBps: 2_100,
    };
    await persistSettings({
      ...settings,
      payPlan: changedPlan,
      payPlanHistory: [...settings.payPlanHistory, changedPlan],
    });

    const event = (await db.auditEvents.where("action").equals("settings.updated").toArray()).at(-1);
    expect(event?.summary).toContain("September plan");
    expect(event?.details).toMatchObject({
      payPlanChanged: true,
      priorPlan: DEFAULT_PAY_PLAN.version,
      newPlan: "September plan",
      priorBaseRateBps: 3_000,
      newBaseRateBps: 3_100,
      priorFiRateBps: 2_000,
      newFiRateBps: 2_100,
    });
  });

  it("migrates only the exact untouched legacy bonus default", async () => {
    const settings = await initializeDatabase();
    const legacyPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "Howell-used-sales-2026-draft-1",
      bonusTiers: [
        { minimumDelivered: 11, amountCents: 30_000 },
        { minimumDelivered: 15, amountCents: 75_000 },
        { minimumDelivered: 20, amountCents: 110_000 },
        { minimumDelivered: 25, amountCents: 150_000 },
        { minimumDelivered: 30, amountCents: 200_000 },
      ],
      bonusesConfirmed: true,
      confirmationSource: "Legacy metadata",
      confirmedAt: "2026-08-01T12:00:00.000Z",
    };
    await db.settings.put({ ...settings, payPlan: legacyPlan, payPlanHistory: [legacyPlan] });

    const migrated = await initializeDatabase();
    expect(migrated.payPlan.version).toBe(DEFAULT_PAY_PLAN.version);
    expect(migrated.payPlan.bonusTiers.at(-1)).toEqual({ minimumDelivered: 35, amountCents: 810_000 });
    expect("bonusesConfirmed" in migrated.payPlan).toBe(false);
  });

  it("preserves customized legacy calculations while replacing the technical plan name", async () => {
    const settings = await initializeDatabase();
    const oldTiers = [
      { minimumDelivered: 11, amountCents: 30_000 },
      { minimumDelivered: 15, amountCents: 75_000 },
      { minimumDelivered: 20, amountCents: 110_000 },
      { minimumDelivered: 25, amountCents: 150_000 },
      { minimumDelivered: 30, amountCents: 200_000 },
    ];
    const customizedLegacy = {
      ...DEFAULT_PAY_PLAN,
      version: "Howell-used-sales-2026-draft-1",
      bonusTiers: oldTiers.map((tier, index) => index === 1 ? { ...tier, amountCents: 80_000 } : tier),
    };
    await db.settings.put({ ...settings, payPlan: customizedLegacy, payPlanHistory: [customizedLegacy] });
    expect((await initializeDatabase()).payPlan).toEqual({
      ...customizedLegacy,
      version: DEFAULT_PAY_PLAN.version,
    });
  });

  it.each([
    "Howell-used-sales-2026-user-reported-2",
    "Howell-used-sales-2026-cumulative-3",
  ])("replaces the %s technical plan name without changing its calculations", async (version) => {
    const settings = await initializeDatabase();
    const interimPlan = {
      ...DEFAULT_PAY_PLAN,
      version,
    };
    await db.settings.put({ ...settings, payPlan: interimPlan, payPlanHistory: [interimPlan] });

    const migrated = await initializeDatabase();
    expect(migrated.payPlan).toEqual(DEFAULT_PAY_PLAN);
  });

  it("preserves every customized calculation while replacing an interim technical name", async () => {
    const settings = await initializeDatabase();
    const customizedInterimPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "Howell-used-sales-2026-cumulative-3",
      effectiveMonth: "2025-12",
      baseFrontRateBps: 2_900,
      acceleratedFrontRateBps: 3_600,
      acceleratedThresholdExclusive: 12,
      fiRateBps: 2_100,
      bonusTiers: DEFAULT_PAY_PLAN.bonusTiers.map((tier, index) =>
        index === 2 ? { minimumDelivered: 21, amountCents: tier.amountCents + 5_000 } : tier,
      ),
    };
    await db.settings.put({
      ...settings,
      payPlan: customizedInterimPlan,
      payPlanHistory: [customizedInterimPlan],
    });

    const migrated = await initializeDatabase();
    expect(migrated.payPlan).toEqual({
      ...customizedInterimPlan,
      version: DEFAULT_PAY_PLAN.version,
    });
    expect((await initializeDatabase()).payPlan).toEqual(migrated.payPlan);
  });

  it("keeps user-created plan names and historical values while cleaning a current technical name", async () => {
    const settings = await initializeDatabase();
    const historicalPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "My 2025 plan",
      effectiveMonth: "2025-01",
      baseFrontRateBps: 2_800,
    };
    const currentPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "Howell-used-sales-2026-user-reported-2",
      fiRateBps: 2_100,
    };
    await db.settings.put({
      ...settings,
      payPlan: currentPlan,
      payPlanHistory: [historicalPlan, currentPlan],
    });

    const migrated = await initializeDatabase();
    expect(migrated.payPlanHistory).toEqual([
      historicalPlan,
      { ...currentPlan, version: DEFAULT_PAY_PLAN.version },
    ]);
    expect(migrated.payPlan).toEqual({ ...currentPlan, version: DEFAULT_PAY_PLAN.version });
  });

  it("soft deletes and restores without losing the sale", async () => {
    await initializeDatabase();
    await persistSale(sampleSale, true);
    const deleted = await softDeleteSale(sampleSale);
    expect(deleted.deletedAt).toBeTruthy();
    const restored = await restoreSale(deleted);
    expect(restored.deletedAt).toBeUndefined();
    expect((await db.sales.get(sampleSale.id))?.revision).toBe(3);
  });

  it("restores a full workspace without changing each sale's original source", async () => {
    const settings = await initializeDatabase();
    settings.salespersonName = "Restored User";
    settings.daysOffByMonth = { "2026-08": ["2026-08-05"] };
    await replaceDatabaseFromBackup(settings, [sampleSale], []);

    const data = await loadTrackerData();
    expect(data.settings.salespersonName).toBe("Restored User");
    expect(data.settings.daysOffByMonth).toEqual({ "2026-08": ["2026-08-05"] });
    expect(data.settings.payPlanHistory).toHaveLength(1);
    expect(data.sales).toHaveLength(1);
    expect(data.sales[0]?.source).toBe("demo");
    expect(data.auditEvents.some((event) => event.action === "restore.completed")).toBe(true);
  });

  it("blocks uncovered sales until an older pay-plan version is added", async () => {
    const settings = await initializeDatabase();
    const historicalSale = {
      ...sampleSale,
      id: "historical-sale",
      stockNumber: "HIST-001",
      saleDate: "2025-12-10",
    };

    await expect(persistSale(historicalSale, true)).rejects.toThrow(
      /Add an older pay plan beginning 2025-12 or earlier/,
    );
    expect(await db.sales.count()).toBe(0);

    const historicalPlan = {
      ...DEFAULT_PAY_PLAN,
      version: "2025 historical plan",
      effectiveMonth: "2025-01",
    };
    await persistSettings({
      ...settings,
      payPlanHistory: [...settings.payPlanHistory, historicalPlan],
    });
    await persistSale(historicalSale, true);
    expect(await db.sales.get(historicalSale.id)).toMatchObject({ stockNumber: "HIST-001" });
  });

  it("rejects an entire direct import batch when any sale lacks pay-plan coverage", async () => {
    await initializeDatabase();
    const uncovered = {
      ...sampleSale,
      id: "uncovered-import",
      stockNumber: "OLD-IMPORT",
      saleDate: "2025-12-10",
    };
    await expect(importSales([sampleSale, uncovered], "test import")).rejects.toThrow(
      /No pay plan covers 2025-12/,
    );
    expect(await db.sales.count()).toBe(0);
  });

  it("keeps manual edits and soft deletion intact when the same workbook is imported again", async () => {
    await initializeDatabase();
    const imported = {
      ...sampleSale,
      id: "legacy-repeat-row",
      source: "legacy-xlsx" as const,
      sourceReference: "legacy.xlsx · Enter Sales!4",
    };
    expect(await importSales([imported], "legacy.xlsx")).toEqual({ added: 1, alreadyPresent: 0 });

    const firstSaved = (await db.sales.get(imported.id))!;
    await persistSale(
      {
        ...firstSaved,
        frontGrossCents: 345_600,
        notes: "Manual correction stays here.",
        updatedAt: "2026-08-11T12:00:00.000Z",
        revision: firstSaved.revision + 1,
      },
      false,
      { revision: firstSaved.revision, updatedAt: firstSaved.updatedAt },
    );
    const manuallyEdited = (await db.sales.get(imported.id))!;
    const deleted = await softDeleteSale(manuallyEdited);

    expect(await importSales([{ ...imported, frontGrossCents: 1, notes: "Workbook value" }], "legacy.xlsx"))
      .toEqual({ added: 0, alreadyPresent: 1 });
    expect(await db.sales.get(imported.id)).toMatchObject({
      frontGrossCents: 345_600,
      notes: "Manual correction stays here.",
      deletedAt: deleted.deletedAt,
      revision: deleted.revision,
    });
  });

  it("restores removed demonstration rows without ever changing manual rows", async () => {
    await initializeDatabase();
    const demo = { ...sampleSale, id: "reloadable-demo", stockNumber: "DEMO-RELOAD" };
    const manual = { ...sampleSale, id: "protected-manual", stockNumber: "MANUAL-KEEP", source: "manual" as const };

    expect(await loadDemoSales([demo])).toEqual({ added: 1, restored: 0, alreadyPresent: 0 });
    await persistSale(manual, true);
    expect(await removeDemoSales()).toBe(1);
    expect((await db.sales.get(demo.id))?.deletedAt).toBeTruthy();

    expect(await loadDemoSales([demo, { ...demo, id: manual.id, stockNumber: "DEMO-COLLISION" }]))
      .toEqual({ added: 0, restored: 1, alreadyPresent: 1 });
    expect(await db.sales.get(demo.id)).toMatchObject({ deletedAt: undefined, source: "demo", stockNumber: "DEMO-RELOAD" });
    expect(await db.sales.get(manual.id)).toMatchObject({ source: "manual", stockNumber: "MANUAL-KEEP" });
    expect(await loadDemoSales([demo])).toEqual({ added: 0, restored: 0, alreadyPresent: 1 });
    expect((await loadTrackerData()).auditEvents.some((event) => event.action === "demo.loaded")).toBe(true);
  });

  it("rejects an entire demonstration batch when any year is outside pay-plan coverage", async () => {
    await initializeDatabase();
    const uncovered = { ...sampleSale, id: "uncovered-demo", saleDate: "2025-12-10", stockNumber: "DEMO-OLD" };

    await expect(loadDemoSales([sampleSale, uncovered])).rejects.toThrow(/No pay plan covers 2025-12/);
    expect(await db.sales.count()).toBe(0);
  });
});
