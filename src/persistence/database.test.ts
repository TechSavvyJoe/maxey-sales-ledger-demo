import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import { buildDemoSales, createPublicDemoHistoricPlan } from "@/domain/demo";
import { getPayPlanSchedule } from "@/domain/payPlan";
import type { Sale } from "@/domain/types";
import {
  db,
  importSales,
  initializeDatabase,
  initializePublishedDemo,
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

  it("repairs malformed legacy actual-paid values so the workspace remains backup-safe", async () => {
    const settings = await initializeDatabase();
    await db.settings.put({
      ...settings,
      actualPaidByMonth: {
        "2026-08": 123_456,
        "2026-09": 100_000_001,
        "2026-10": -100_000_001,
        invalid: 100,
      },
    } as unknown as typeof settings);

    expect((await initializeDatabase()).actualPaidByMonth).toEqual({ "2026-08": 123_456 });
  });

  it("rejects invalid actual-paid values before they reach browser storage", async () => {
    const settings = await initializeDatabase();
    for (const actualPaidByMonth of [
      { "2026-08": 12.5 },
      { "2026-08": Number.POSITIVE_INFINITY },
      { "2026-08": 100_000_001 },
      { invalid: 100 },
    ]) {
      await expect(persistSettings({
        ...settings,
        actualPaidByMonth,
      } as unknown as typeof settings)).rejects.toThrow(/Actual-paid amounts/);
    }

    expect((await db.settings.get("primary"))?.actualPaidByMonth).toEqual({});
    expect(await db.auditEvents.where("action").equals("settings.updated").count()).toBe(0);
  });

  it("rejects unsafe direct sale numbers while preserving an explicit zero unit credit", async () => {
    await initializeDatabase();

    await expect(persistSale({ ...sampleSale, unitCreditBasis: 0 }, true)).resolves.toBeUndefined();
    await expect(persistSale({
      ...sampleSale,
      id: "fractional-credit",
      unitCreditBasis: 500.5,
    }, true)).rejects.toThrow(/Sale unit credit/);
    await expect(persistSale({
      ...sampleSale,
      id: "non-finite-gross",
      frontGrossCents: Number.POSITIVE_INFINITY,
    }, true)).rejects.toThrow(/Front gross/);

    expect(await db.sales.get(sampleSale.id)).toMatchObject({ unitCreditBasis: 0 });
    expect(await db.sales.get("fractional-credit")).toBeUndefined();
    expect(await db.sales.get("non-finite-gross")).toBeUndefined();
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

  it("moves active legacy void records to Recently deleted during initialization", async () => {
    await initializeDatabase();
    const legacyVoid = {
      ...sampleSale,
      id: "legacy-void-active",
      stockNumber: "VOID-ARCHIVE",
      status: "void" as const,
      source: "json-restore" as const,
    };
    await db.sales.put(legacyVoid);

    await initializeDatabase();

    const archived = await db.sales.get(legacyVoid.id);
    expect(archived).toMatchObject({ status: "void", deletedAt: expect.any(String), revision: 2 });
    expect((await db.auditEvents.where("action").equals("sale.deleted").toArray()).at(-1)?.summary)
      .toMatch(/Moved 1 older undelivered sale to Recently deleted/);
  });

  it("restores a legacy void record as Pending and rejects new void sales", async () => {
    await initializeDatabase();
    const legacyVoid = {
      ...sampleSale,
      id: "legacy-void-restore",
      stockNumber: "VOID-RESTORE",
      status: "void" as const,
      deletedAt: "2026-08-21T12:00:00.000Z",
      source: "json-restore" as const,
    };
    await db.sales.put(legacyVoid);

    const restored = await restoreSale(legacyVoid);
    expect(restored).toMatchObject({ status: "pending", revision: 2 });
    expect(restored.deletedAt).toBeUndefined();
    await expect(persistSale({ ...sampleSale, id: "new-void", status: "void" }, true))
      .rejects.toThrow("Undelivered sales are not saved. Delete the record instead.");
  });

  it("archives legacy void records while restoring a backup", async () => {
    const settings = await initializeDatabase();
    const legacyVoid = {
      ...sampleSale,
      id: "backup-void",
      stockNumber: "VOID-BACKUP",
      status: "void" as const,
      source: "json-restore" as const,
    };

    await replaceDatabaseFromBackup(settings, [legacyVoid], []);

    expect(await db.sales.get(legacyVoid.id)).toMatchObject({
      status: "void",
      deletedAt: expect.any(String),
    });
    expect((await db.auditEvents.where("action").equals("sale.deleted").toArray()).at(-1)?.summary)
      .toMatch(/Moved 1 older undelivered sale to Recently deleted during backup restore/);
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

  it("automatically populates a fresh published demo with the two-year history", async () => {
    expect(await initializePublishedDemo("2026-09-02")).toBe(true);

    const data = await loadTrackerData();
    expect(data.sales).toHaveLength(481);
    expect(data.sales.every((sale) => sale.source === "demo" && !sale.deletedAt)).toBe(true);
    expect(data.sales.map((sale) => sale.saleDate).sort()[0]).toMatch(/^2024-09-/);
    expect(data.sales.every((sale) => sale.saleDate <= "2026-09-02")).toBe(true);
    expect(getPayPlanSchedule(data.settings).map((plan) => plan.version)).toContain("Sample 2024–26 plan");
    expect(data.auditEvents.filter((event) => event.action === "demo.loaded")).toHaveLength(1);
  });

  it("seeds once when two tabs initialize together and preserves later demo edits on reload", async () => {
    const initializations = await Promise.all([
      initializePublishedDemo("2026-09-02"),
      initializePublishedDemo("2026-09-02"),
    ]);
    expect(initializations.sort()).toEqual([false, true]);
    const before = await loadTrackerData();
    expect(before.sales).toHaveLength(481);
    expect(before.auditEvents.filter((event) => event.action === "demo.loaded")).toHaveLength(1);

    const edited = { ...before.sales[0], notes: "My walkthrough example", revision: 2 };
    await persistSale(edited, false);
    const snapshot = await loadBackupSnapshot();

    expect(await initializePublishedDemo("2026-10-02")).toBe(false);
    expect(await loadBackupSnapshot()).toEqual(snapshot);
  });

  it("populates an untouched workspace after simple period or page navigation", async () => {
    const settings = await initializeDatabase();
    await updateSelectedContext(settings, { selectedMonth: "2026-08", selectedView: "sales" });

    expect(await initializePublishedDemo("2026-09-02")).toBe(true);
    expect(await db.settings.get("primary")).toMatchObject({
      selectedMonth: "2026-08",
      selectedView: "sales",
    });
    expect(await db.sales.count()).toBe(481);
  });

  it.each([undefined, "2026-08-21T12:00:00.000Z"])(
    "keeps existing manual sales out of automatic demo initialization (deletedAt: %s)",
    async (deletedAt) => {
      await initializeDatabase();
      const manual = { ...sampleSale, source: "manual" as const, deletedAt };
      await db.sales.put(manual);
      const snapshot = await loadBackupSnapshot();

      expect(await initializePublishedDemo("2026-09-02")).toBe(false);
      expect(await loadBackupSnapshot()).toEqual(snapshot);
    },
  );

  it("preserves an empty workspace with personalized settings even without activity history", async () => {
    const defaults = await initializeDatabase();
    await db.settings.put({
      ...defaults,
      salespersonName: "Sample User",
      monthlyGoal: 22,
      daysOffByMonth: { "2026-09": ["2026-09-04"] },
      payPlan: { ...defaults.payPlan, version: "Personal plan", fiRateBps: 1_500 },
      payPlanHistory: [{ ...defaults.payPlan, version: "Personal plan", fiRateBps: 1_500 }],
    });
    const snapshot = await loadBackupSnapshot();

    expect(await initializePublishedDemo("2026-09-02")).toBe(false);
    expect(await loadBackupSnapshot()).toEqual(snapshot);
  });

  it.each([null, 0, 123_456])(
    "preserves payroll entries in an otherwise empty workspace (amount: %s)",
    async (amount) => {
      const defaults = await initializeDatabase();
      await db.settings.put({ ...defaults, actualPaidByMonth: { "2026-08": amount } });
      const snapshot = await loadBackupSnapshot();

      expect(await initializePublishedDemo("2026-09-02")).toBe(false);
      expect(await loadBackupSnapshot()).toEqual(snapshot);
    },
  );

  it("does not undo an explicit demo removal when no sale rows remain", async () => {
    await initializeDatabase();
    await removeDemoSales();
    const snapshot = await loadBackupSnapshot();
    expect(snapshot.sales).toHaveLength(0);
    expect(snapshot.auditEvents[0]?.action).toBe("demo.removed");

    expect(await initializePublishedDemo("2026-09-02")).toBe(false);
    expect(await loadBackupSnapshot()).toEqual(snapshot);
  });

  it("leaves removed demonstration sales in Recently deleted on reload", async () => {
    await initializePublishedDemo("2026-09-02");
    expect(await removeDemoSales()).toBe(481);
    const snapshot = await loadBackupSnapshot();

    expect(await initializePublishedDemo("2026-09-02")).toBe(false);
    expect(await loadBackupSnapshot()).toEqual(snapshot);
    expect(snapshot.sales.every((sale) => Boolean(sale.deletedAt))).toBe(true);
  });

  it("synchronizes the two-year public demo without touching manual records", async () => {
    await initializeDatabase();
    const asOfDate = "2026-09-02";
    const oldDemo = buildDemoSales("2026-09", asOfDate, "full-year");
    const twoYearDemo = buildDemoSales("2026-09", asOfDate, "two-year");

    expect(await loadDemoSales(oldDemo)).toEqual({ added: 235, restored: 0, alreadyPresent: 0 });
    expect(await loadDemoSales(twoYearDemo, {
      historicDemoPlan: createPublicDemoHistoricPlan(asOfDate),
    })).toEqual({ added: 306, restored: 0, alreadyPresent: 175 });

    const activeDemo = (await db.sales.where("profileId").equals("primary").toArray())
      .filter((sale) => sale.source === "demo" && !sale.deletedAt);
    expect(activeDemo).toHaveLength(481);
    expect(activeDemo.every((sale) => sale.saleDate <= asOfDate)).toBe(true);
    expect((await db.sales.where("profileId").equals("primary").toArray())
      .filter((sale) => sale.source === "demo" && sale.deletedAt)).toHaveLength(60);

    const settings = await initializeDatabase();
    expect(getPayPlanSchedule(settings).some((plan) => plan.version === "Sample 2024–26 plan")).toBe(true);
    expect(await removeDemoSales()).toBe(481);
    const afterRemoval = await initializeDatabase();
    expect(getPayPlanSchedule(afterRemoval).some((plan) => plan.version === "Sample 2024–26 plan")).toBe(false);
  });

  it("keeps a two-year fictional demo out of workspaces with real records", async () => {
    await initializeDatabase();
    await persistSale({ ...sampleSale, id: "manual-before-demo", source: "manual" }, true);
    const asOfDate = "2026-09-02";

    await expect(loadDemoSales(
      buildDemoSales("2026-09", asOfDate, "two-year"),
      { historicDemoPlan: createPublicDemoHistoricPlan(asOfDate) },
    )).rejects.toThrow("Use a clean demo workspace before loading the two-year demonstration.");
    const manualAfterRejectedDemo = await db.sales.get("manual-before-demo");
    expect(manualAfterRejectedDemo).toMatchObject({ source: "manual" });
    expect(manualAfterRejectedDemo).not.toHaveProperty("deletedAt");
  });

  it("rejects an entire demonstration batch when any year is outside pay-plan coverage", async () => {
    await initializeDatabase();
    const uncovered = { ...sampleSale, id: "uncovered-demo", saleDate: "2025-12-10", stockNumber: "DEMO-OLD" };

    await expect(loadDemoSales([sampleSale, uncovered])).rejects.toThrow(/No pay plan covers 2025-12/);
    expect(await db.sales.count()).toBe(0);
  });
});
