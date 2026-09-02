import Dexie, { type EntityTable } from "dexie";
import { currentMonthKey, monthKeyFromDate } from "@/domain/date";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import {
  normalizeCommissionGoalsByMonth,
  normalizeDeliveryGoalsByMonth,
} from "@/domain/goals";
import { normalizeDaysOffByMonth } from "@/domain/pacing";
import {
  assertValidPayPlan,
  getEarliestPayPlanMonth,
  getPayPlanSchedule,
  hasPayPlanCoverage,
  payPlanCoverageMessage,
} from "@/domain/payPlan";
import type { AuditEvent, PayPlan, ProfileSettings, Sale } from "@/domain/types";
import { SaleWriteConflictError, type SaleVersionToken } from "@/persistence/errors";

const PROFILE_ID = "primary";
const MAX_CURRENCY_CENTS = 100_000_000;

interface LegacyBonusGateFields {
  bonusesConfirmed: boolean;
  confirmationSource: string;
  confirmedAt: string | null;
}

const LEGACY_DEFAULT_PAY_PLAN: PayPlan = {
  version: "Howell-used-sales-2026-draft-1",
  effectiveMonth: "2026-01",
  baseFrontRateBps: 3_000,
  acceleratedFrontRateBps: 3_500,
  acceleratedThresholdExclusive: 10,
  fiRateBps: 2_000,
  bonusTiers: [
    { minimumDelivered: 11, amountCents: 30_000 },
    { minimumDelivered: 15, amountCents: 75_000 },
    { minimumDelivered: 20, amountCents: 110_000 },
    { minimumDelivered: 25, amountCents: 150_000 },
    { minimumDelivered: 30, amountCents: 200_000 },
  ],
};

const INTERIM_CUMULATIVE_DEFAULT_PAY_PLAN: PayPlan = {
  ...structuredClone(DEFAULT_PAY_PLAN),
  version: "Howell-used-sales-2026-user-reported-2",
};

const TECHNICAL_CUMULATIVE_DEFAULT_PAY_PLAN: PayPlan = {
  ...structuredClone(DEFAULT_PAY_PLAN),
  version: "Howell-used-sales-2026-cumulative-3",
};

const TECHNICAL_DEFAULT_PLAN_NAMES = new Set([
  LEGACY_DEFAULT_PAY_PLAN.version,
  INTERIM_CUMULATIVE_DEFAULT_PAY_PLAN.version,
  TECHNICAL_CUMULATIVE_DEFAULT_PAY_PLAN.version,
]);

function payPlanCalculationFingerprint(payPlan: PayPlan): string {
  return JSON.stringify({
    version: payPlan.version,
    effectiveMonth: payPlan.effectiveMonth,
    baseFrontRateBps: payPlan.baseFrontRateBps,
    acceleratedFrontRateBps: payPlan.acceleratedFrontRateBps,
    acceleratedThresholdExclusive: payPlan.acceleratedThresholdExclusive,
    fiRateBps: payPlan.fiRateBps,
    bonusTiers: payPlan.bonusTiers,
  });
}

function removeLegacyBonusGateFields(payPlan: PayPlan): PayPlan {
  const {
    bonusesConfirmed: _bonusesConfirmed,
    confirmationSource: _confirmationSource,
    confirmedAt: _confirmedAt,
    ...currentPayPlan
  } = payPlan as PayPlan & Partial<LegacyBonusGateFields>;
  return currentPayPlan;
}

function migrateUnchangedLegacyDefaultPayPlan(payPlan: PayPlan): PayPlan {
  const fingerprint = payPlanCalculationFingerprint(payPlan);
  if (
    fingerprint === payPlanCalculationFingerprint(LEGACY_DEFAULT_PAY_PLAN)
    || fingerprint === payPlanCalculationFingerprint(INTERIM_CUMULATIVE_DEFAULT_PAY_PLAN)
    || fingerprint === payPlanCalculationFingerprint(TECHNICAL_CUMULATIVE_DEFAULT_PAY_PLAN)
  ) return structuredClone(DEFAULT_PAY_PLAN);

  const currentPayPlan = removeLegacyBonusGateFields(payPlan);
  return TECHNICAL_DEFAULT_PLAN_NAMES.has(currentPayPlan.version)
    ? { ...currentPayPlan, version: DEFAULT_PAY_PLAN.version }
    : currentPayPlan;
}

function normalizeMonthlyCommissionGoal(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= MAX_CURRENCY_CENTS
    ? Number(value)
    : null;
}

function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Removes malformed legacy values rather than retaining settings that cannot be backed up. */
function normalizeActualPaidByMonth(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([monthKey, amount]) => (
        isMonthKey(monthKey)
        && (amount === null || (
          typeof amount === "number"
          && Number.isSafeInteger(amount)
          && Math.abs(amount) <= MAX_CURRENCY_CENTS
        ))
      ))
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, number | null>;
}

class SalesTrackerDatabase extends Dexie {
  sales!: EntityTable<Sale, "id">;
  settings!: EntityTable<ProfileSettings, "id">;
  auditEvents!: EntityTable<AuditEvent, "id">;

  constructor() {
    super("maxey-sales-command-center");
    this.version(1).stores({
      sales: "id, profileId, saleDate, status, stockNumber, updatedAt, deletedAt",
      settings: "id, updatedAt",
      auditEvents: "++id, profileId, action, occurredAt, entityId",
    });
  }
}

export const db = new SalesTrackerDatabase();

function assertSaleHasPayPlanCoverage(sale: Sale, schedule: PayPlan[]): void {
  const monthKey = monthKeyFromDate(sale.saleDate);
  if (!monthKey) throw new Error(`Sale ${sale.stockNumber || sale.id} has an invalid date.`);
  if (!hasPayPlanCoverage(schedule, monthKey)) {
    throw new Error(payPlanCoverageMessage(schedule, monthKey));
  }
}

async function getStoredPayPlanSchedule(): Promise<PayPlan[]> {
  const settings = await db.settings.get(PROFILE_ID);
  if (!settings) throw new Error("Sales settings are not initialized.");
  return getPayPlanSchedule(settings);
}

export function createDefaultSettings(now = new Date()): ProfileSettings {
  const timestamp = now.toISOString();
  const payPlan = structuredClone(DEFAULT_PAY_PLAN);
  return {
    id: PROFILE_ID,
    salespersonName: "",
    storeName: "Bob Maxey Ford of Howell",
    monthlyGoal: 15,
    monthlyCommissionGoalCents: null,
    deliveryGoalsByMonth: {},
    commissionGoalsByMonth: {},
    daysOffByMonth: {},
    selectedMonth: currentMonthKey(now),
    selectedView: "dashboard",
    actualPaidByMonth: {},
    payPlan,
    payPlanHistory: [structuredClone(payPlan)],
    onboardingDismissed: false,
    lastBackupAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeSettings(settings: ProfileSettings): ProfileSettings {
  const storedSchedule = getPayPlanSchedule({
    payPlan: settings.payPlan,
    payPlanHistory: settings.payPlanHistory ?? [],
  });
  const schedule = storedSchedule.map(migrateUnchangedLegacyDefaultPayPlan);
  schedule.forEach(assertValidPayPlan);
  const earliestMonth = getEarliestPayPlanMonth(schedule);
  return {
    ...settings,
    monthlyCommissionGoalCents: normalizeMonthlyCommissionGoal(
      (settings as ProfileSettings & { monthlyCommissionGoalCents?: unknown })
        .monthlyCommissionGoalCents,
    ),
    actualPaidByMonth: normalizeActualPaidByMonth(
      (settings as ProfileSettings & { actualPaidByMonth?: unknown }).actualPaidByMonth,
    ),
    deliveryGoalsByMonth: normalizeDeliveryGoalsByMonth(settings.deliveryGoalsByMonth),
    commissionGoalsByMonth: normalizeCommissionGoalsByMonth(settings.commissionGoalsByMonth),
    daysOffByMonth: normalizeDaysOffByMonth(
      (settings as ProfileSettings & { daysOffByMonth?: unknown }).daysOffByMonth,
    ),
    selectedMonth: settings.selectedMonth < earliestMonth ? earliestMonth : settings.selectedMonth,
    payPlan: structuredClone(schedule.at(-1) ?? settings.payPlan),
    payPlanHistory: structuredClone(schedule),
  };
}

export async function initializeDatabase(): Promise<ProfileSettings> {
  const existing = await db.settings.get(PROFILE_ID);
  if (existing) {
    const normalized = normalizeSettings(existing);
    if (JSON.stringify(existing) !== JSON.stringify(normalized)) await db.settings.put(normalized);
    return normalized;
  }
  const settings = createDefaultSettings();
  await db.settings.put(settings);
  return (await db.settings.get(PROFILE_ID)) ?? settings;
}

export async function loadTrackerData(): Promise<{
  settings: ProfileSettings;
  sales: Sale[];
  auditEvents: AuditEvent[];
}> {
  const settings = await initializeDatabase();
  const [sales, auditEvents] = await Promise.all([
    db.sales.where("profileId").equals(PROFILE_ID).toArray(),
    db.auditEvents.where("profileId").equals(PROFILE_ID).reverse().sortBy("occurredAt"),
  ]);
  return { settings, sales, auditEvents };
}

/**
 * Captures one internally consistent workspace snapshot for recovery backups.
 * UI reads can be eventually consistent, but a backup must never mix records
 * from before and after the same committed change.
 */
export async function loadBackupSnapshot(): Promise<{
  settings: ProfileSettings;
  sales: Sale[];
  auditEvents: AuditEvent[];
}> {
  await initializeDatabase();
  return db.transaction("r", db.settings, db.sales, db.auditEvents, async () => {
    const settings = await db.settings.get(PROFILE_ID);
    if (!settings) throw new Error("Sales settings are not initialized.");
    const [sales, auditEvents] = await Promise.all([
      db.sales.where("profileId").equals(PROFILE_ID).toArray(),
      db.auditEvents.where("profileId").equals(PROFILE_ID).reverse().sortBy("occurredAt"),
    ]);
    return { settings: normalizeSettings(settings), sales, auditEvents };
  });
}

function createAuditEvent(
  action: AuditEvent["action"],
  summary: string,
  entityId?: string,
  details?: AuditEvent["details"],
): AuditEvent {
  return {
    profileId: PROFILE_ID,
    action,
    entityId,
    occurredAt: new Date().toISOString(),
    summary,
    details,
  };
}

function isSameSaleVersion(sale: Sale, expected: SaleVersionToken): boolean {
  return sale.revision === expected.revision && sale.updatedAt === expected.updatedAt;
}

function saleConflict(sale: Pick<Sale, "id" | "stockNumber">): SaleWriteConflictError {
  return new SaleWriteConflictError(sale.id, sale.stockNumber);
}

export async function persistSale(
  sale: Sale,
  isNew: boolean,
  expectedVersion?: SaleVersionToken,
): Promise<void> {
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    assertSaleHasPayPlanCoverage(sale, await getStoredPayPlanSchedule());
    const existing = await db.sales.get(sale.id);

    if (isNew) {
      // UUID collisions are extremely unlikely, but a create must never replace
      // an already committed record if one does occur.
      if (existing) throw saleConflict(sale);
    } else {
      const expectedRevision = expectedVersion?.revision ?? sale.revision - 1;
      if (
        !existing
        || existing.revision !== expectedRevision
        || (expectedVersion && !isSameSaleVersion(existing, expectedVersion))
      ) {
        throw saleConflict(sale);
      }
    }

    const persisted = isNew
      ? sale
      : {
          ...sale,
          revision: (existing?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        };
    await db.sales.put(persisted);
    await db.auditEvents.add(
      createAuditEvent(
        isNew ? "sale.created" : "sale.updated",
        `${isNew ? "Added" : "Updated"} stock ${sale.stockNumber || "(missing)"}.`,
        sale.id,
        { status: persisted.status, saleDate: persisted.saleDate, revision: persisted.revision },
      ),
    );
  });
}

export async function softDeleteSale(sale: Sale): Promise<Sale> {
  const now = new Date().toISOString();
  const deleted = { ...sale, deletedAt: now, updatedAt: now, revision: sale.revision + 1 };
  await db.transaction("rw", db.sales, db.auditEvents, async () => {
    const existing = await db.sales.get(sale.id);
    if (!existing || !isSameSaleVersion(existing, sale)) throw saleConflict(sale);
    await db.sales.put(deleted);
    await db.auditEvents.add(
      createAuditEvent("sale.deleted", `Deleted stock ${sale.stockNumber || "(missing)"}.`, sale.id),
    );
  });
  return deleted;
}

export async function restoreSale(sale: Sale): Promise<Sale> {
  const now = new Date().toISOString();
  const { deletedAt: _deletedAt, ...activeSale } = sale;
  const restored: Sale = {
    ...activeSale,
    updatedAt: now,
    revision: sale.revision + 1,
  };
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    const existing = await db.sales.get(sale.id);
    if (!existing || !isSameSaleVersion(existing, sale)) throw saleConflict(sale);
    assertSaleHasPayPlanCoverage(restored, await getStoredPayPlanSchedule());
    await db.sales.put(restored);
    await db.auditEvents.add(
      createAuditEvent("sale.restored", `Restored stock ${sale.stockNumber || "(missing)"}.`, sale.id),
    );
  });
  return restored;
}

export async function persistSettings(settings: ProfileSettings): Promise<void> {
  const updated = normalizeSettings({ ...settings, updatedAt: new Date().toISOString() });
  await db.transaction("rw", db.settings, db.auditEvents, async () => {
    const previous = await db.settings.get(PROFILE_ID);
    await db.settings.put(updated);
    const payPlanChanged = Boolean(previous)
      && payPlanCalculationFingerprint(previous!.payPlan) !== payPlanCalculationFingerprint(updated.payPlan);
    const details: NonNullable<AuditEvent["details"]> = payPlanChanged && previous
      ? {
          payPlanChanged: true,
          priorPlan: previous.payPlan.version,
          priorEffectiveMonth: previous.payPlan.effectiveMonth,
          newPlan: updated.payPlan.version,
          newEffectiveMonth: updated.payPlan.effectiveMonth,
          priorBaseRateBps: previous.payPlan.baseFrontRateBps,
          newBaseRateBps: updated.payPlan.baseFrontRateBps,
          priorHigherRateBps: previous.payPlan.acceleratedFrontRateBps,
          newHigherRateBps: updated.payPlan.acceleratedFrontRateBps,
          priorThreshold: previous.payPlan.acceleratedThresholdExclusive,
          newThreshold: updated.payPlan.acceleratedThresholdExclusive,
          priorFiRateBps: previous.payPlan.fiRateBps,
          newFiRateBps: updated.payPlan.fiRateBps,
        }
      : { payPlanChanged: false };
    await db.auditEvents.add(
      createAuditEvent(
        "settings.updated",
        payPlanChanged
          ? `Updated pay plan ${updated.payPlan.version} beginning ${updated.payPlan.effectiveMonth}.`
          : "Updated tracker settings.",
        undefined,
        details,
      ),
    );
  });
}

export async function updateSelectedContext(
  _settings: ProfileSettings,
  changes: Partial<Pick<ProfileSettings, "selectedMonth" | "selectedView" | "onboardingDismissed">>,
): Promise<ProfileSettings> {
  return db.transaction("rw", db.settings, async () => {
    const current = await db.settings.get(PROFILE_ID);
    if (!current) throw new Error("Sales settings are not initialized.");
    const schedule = getPayPlanSchedule(current);
    if (changes.selectedMonth && !hasPayPlanCoverage(schedule, changes.selectedMonth)) {
      throw new Error(payPlanCoverageMessage(schedule, changes.selectedMonth));
    }
    const updated = normalizeSettings({
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
    });
    await db.settings.put(updated);
    return updated;
  });
}

export async function importSales(
  sales: Sale[],
  sourceName: string,
): Promise<{ added: number; alreadyPresent: number }> {
  let added = 0;
  let alreadyPresent = 0;
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    const schedule = await getStoredPayPlanSchedule();
    sales.forEach((sale) => assertSaleHasPayPlanCoverage(sale, schedule));
    for (const sale of sales) {
      const existing = await db.sales.get(sale.id);
      // A stable legacy ID is derived from the original workbook checksum and
      // row. Re-importing the same file must never undo a manual edit or revive
      // a soft-deleted record; changed workbooks receive new reviewable rows.
      if (existing) {
        alreadyPresent += 1;
        continue;
      }
      added += 1;
      await db.sales.put(sale);
    }
    await db.auditEvents.add(
      createAuditEvent("import.completed", `Imported ${added} new sales from ${sourceName}.`, undefined, {
        added,
        alreadyPresent,
      }),
    );
  });
  return { added, alreadyPresent };
}

/**
 * Loads only generated demonstration records. Unlike workbook imports, a
 * removed demo record can safely be restored because it has no user edits or
 * external source to preserve. Manual and imported rows are never changed.
 */
export async function loadDemoSales(
  sales: Sale[],
): Promise<{ added: number; restored: number; alreadyPresent: number }> {
  let added = 0;
  let restored = 0;
  let alreadyPresent = 0;
  const timestamp = new Date().toISOString();

  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    const schedule = await getStoredPayPlanSchedule();
    sales.forEach((sale) => assertSaleHasPayPlanCoverage(sale, schedule));

    for (const sale of sales) {
      const existing = await db.sales.get(sale.id);
      if (!existing) {
        added += 1;
        await db.sales.put(sale);
        continue;
      }
      if (existing.source === "demo" && existing.deletedAt) {
        restored += 1;
        await db.sales.put({
          ...sale,
          profileId: PROFILE_ID,
          deletedAt: undefined,
          updatedAt: timestamp,
          revision: existing.revision + 1,
        });
        continue;
      }
      alreadyPresent += 1;
    }

    await db.auditEvents.add(
      createAuditEvent(
        "demo.loaded",
        `Loaded ${added + restored} demonstration sales.`,
        undefined,
        { added, restored, alreadyPresent },
      ),
    );
  });

  return { added, restored, alreadyPresent };
}

export async function removeDemoSales(): Promise<number> {
  let removed = 0;
  const timestamp = new Date().toISOString();
  await db.transaction("rw", db.sales, db.auditEvents, async () => {
    const demoSales = await db.sales
      .where("profileId")
      .equals(PROFILE_ID)
      .filter((sale) => sale.source === "demo" && !sale.deletedAt)
      .toArray();
    removed = demoSales.length;
    if (demoSales.length) {
      await db.sales.bulkPut(
        demoSales.map((sale) => ({
          ...sale,
          deletedAt: timestamp,
          updatedAt: timestamp,
          revision: sale.revision + 1,
        })),
      );
    }
    await db.auditEvents.add(
      createAuditEvent("demo.removed", `Removed ${removed} demonstration sales.`, undefined, { removed }),
    );
  });
  return removed;
}

export async function replaceDatabaseFromBackup(
  settings: ProfileSettings,
  sales: Sale[],
  auditEvents: AuditEvent[],
): Promise<void> {
  const normalizedSettings = normalizeSettings({ ...settings, id: PROFILE_ID });
  const restoredSchedule = getPayPlanSchedule(normalizedSettings);
  sales.forEach((sale) => assertSaleHasPayPlanCoverage(sale, restoredSchedule));
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    await db.sales.clear();
    await db.auditEvents.clear();
    await db.settings.clear();
    await db.settings.add({ ...normalizedSettings, updatedAt: new Date().toISOString() });
    if (sales.length) await db.sales.bulkAdd(sales.map((sale) => ({ ...sale, profileId: PROFILE_ID })));
    if (auditEvents.length) {
      await db.auditEvents.bulkAdd(
        auditEvents.map(({ id: _id, ...event }) => ({ ...event, profileId: PROFILE_ID })),
      );
    }
    await db.auditEvents.add(
      createAuditEvent("restore.completed", `Restored ${sales.length} sales from a backup.`),
    );
  });
}

export async function recordBackupExport(_settings?: ProfileSettings): Promise<ProfileSettings> {
  return db.transaction("rw", db.settings, db.auditEvents, async () => {
    const current = await db.settings.get(PROFILE_ID);
    if (!current) throw new Error("Sales settings are not initialized.");
    const timestamp = new Date().toISOString();
    const updated = {
      ...current,
      lastBackupAt: timestamp,
      updatedAt: timestamp,
    };
    await db.settings.put(updated);
    await db.auditEvents.add(createAuditEvent("backup.exported", "Started a full backup download."));
    return updated;
  });
}

export async function requestPersistentStorage(): Promise<{
  supported: boolean;
  persisted: boolean;
}> {
  if (!navigator.storage?.persist) return { supported: false, persisted: false };
  return { supported: true, persisted: await navigator.storage.persist() };
}

export async function getStorageHealth(): Promise<{
  usageBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean | null;
}> {
  const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  return {
    usageBytes: estimate?.usage ?? null,
    quotaBytes: estimate?.quota ?? null,
    persisted,
  };
}
