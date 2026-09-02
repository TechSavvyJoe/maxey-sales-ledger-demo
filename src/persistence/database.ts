import Dexie, { type EntityTable } from "dexie";
import { currentMonthKey, monthKeyFromDate, todayDateOnly } from "@/domain/date";
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
  upsertPayPlan,
} from "@/domain/payPlan";
import {
  buildDemoSales,
  createPublicDemoHistoricPlan,
  DEMO_HISTORIC_PLAN_VERSION,
} from "@/domain/demo";
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

function isValidActualPaidAmount(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && Math.abs(value) <= MAX_CURRENCY_CENTS
  );
}

/**
 * Settings loaded from an older browser are normalized below, but new writes
 * must fail loudly instead of silently dropping a payroll amount the user just
 * entered. This keeps the stored record and every backup within the same
 * numeric contract.
 */
function assertPersistableActualPaidByMonth(value: unknown): asserts value is Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Actual-paid amounts must be saved by month.");
  }
  for (const [monthKey, amount] of Object.entries(value)) {
    if (!isMonthKey(monthKey)) {
      throw new Error("Actual-paid amounts must use a valid month.");
    }
    if (!isValidActualPaidAmount(amount)) {
      throw new Error("Actual-paid amounts must be whole cents between -$1,000,000 and $1,000,000.");
    }
  }
}

/** Removes malformed legacy values rather than retaining settings that cannot be backed up. */
function normalizeActualPaidByMonth(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([monthKey, amount]) => (
        isMonthKey(monthKey)
        && isValidActualPaidAmount(amount)
      ))
      .sort(([a], [b]) => a.localeCompare(b)),
  ) as Record<string, number | null>;
}

function assertPersistableSaleNumbers(sale: Sale): void {
  if (
    !Number.isSafeInteger(sale.unitCreditBasis)
    || sale.unitCreditBasis < 0
    || sale.unitCreditBasis > 2_000
  ) {
    throw new Error("Sale unit credit must be a whole number of thousandths between 0 and 2.");
  }
  for (const [label, amount] of [
    ["Front gross", sale.frontGrossCents],
    ["Total F&I gross", sale.fiGrossCents],
  ] as const) {
    if (
      amount !== null
      && (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_CURRENCY_CENTS)
    ) {
      throw new Error(`${label} must be whole cents between -$1,000,000 and $1,000,000.`);
    }
  }
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

function isSameDemoPayload(existing: Sale, incoming: Sale): boolean {
  const comparable = (sale: Sale) => {
    const {
      profileId: _profileId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      revision: _revision,
      deletedAt: _deletedAt,
      ...payload
    } = sale;
    return payload;
  };
  return JSON.stringify(comparable(existing)) === JSON.stringify(comparable(incoming));
}

function archiveLegacyVoidSales(sales: Sale[], timestamp: string): Sale[] {
  return sales.map((sale) => (
    sale.status === "void" && !sale.deletedAt
      ? {
          ...sale,
          deletedAt: timestamp,
          updatedAt: timestamp,
          revision: sale.revision + 1,
        }
      : sale
  ));
}

function withoutDemoHistoricPlan(settings: ProfileSettings): ProfileSettings {
  const schedule = getPayPlanSchedule(settings)
    .filter((plan) => plan.version !== DEMO_HISTORIC_PLAN_VERSION);
  if (schedule.length === 0 || schedule.length === getPayPlanSchedule(settings).length) return settings;
  return normalizeSettings({
    ...settings,
    payPlan: structuredClone(schedule.at(-1) ?? settings.payPlan),
    payPlanHistory: structuredClone(schedule),
    updatedAt: new Date().toISOString(),
  });
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
    const legacyVoidSales = await db.sales
      .where("status")
      .equals("void")
      .filter((sale) => sale.profileId === PROFILE_ID && !sale.deletedAt)
      .toArray();
    const settingsChanged = JSON.stringify(existing) !== JSON.stringify(normalized);
    if (settingsChanged || legacyVoidSales.length > 0) {
      const timestamp = new Date().toISOString();
      await db.transaction("rw", db.settings, db.sales, db.auditEvents, async () => {
        if (settingsChanged) await db.settings.put(normalized);
        if (legacyVoidSales.length > 0) {
          await db.sales.bulkPut(archiveLegacyVoidSales(legacyVoidSales, timestamp));
          await db.auditEvents.add(
            createAuditEvent(
              "sale.deleted",
              `Moved ${legacyVoidSales.length} older undelivered ${legacyVoidSales.length === 1 ? "sale" : "sales"} to Recently deleted.`,
            ),
          );
        }
      });
    }
    return normalized;
  }
  const settings = createDefaultSettings();
  await db.settings.put(settings);
  return (await db.settings.get(PROFILE_ID)) ?? settings;
}

/**
 * Gives a first-time visitor to the published demo a populated workspace.
 * The public-build caller opts into this behavior. The check and load share
 * one transaction so another tab cannot seed twice or slip a user write
 * between the empty-workspace check and the demonstration import.
 */
export async function initializePublishedDemo(asOfDate = todayDateOnly()): Promise<boolean> {
  return db.transaction("rw", db.settings, db.sales, db.auditEvents, async () => {
    const settings = await initializeDatabase();
    // Include deleted rows and all activity: an intentionally emptied or
    // restored workspace must never be repopulated on the next page load.
    if (await db.sales.count() || await db.auditEvents.count()) return false;

    const defaults = createDefaultSettings();
    if (
      Object.keys(settings.actualPaidByMonth).length > 0
      || settings.salespersonName !== defaults.salespersonName
      || settings.storeName !== defaults.storeName
      || settings.monthlyGoal !== defaults.monthlyGoal
      || settings.monthlyCommissionGoalCents !== null
      || Object.keys(settings.deliveryGoalsByMonth ?? {}).length > 0
      || Object.keys(settings.commissionGoalsByMonth ?? {}).length > 0
      || Object.keys(settings.daysOffByMonth).length > 0
      || settings.onboardingDismissed
      || settings.lastBackupAt !== null
      || getPayPlanSchedule(settings).length !== 1
      || payPlanCalculationFingerprint(settings.payPlan) !== payPlanCalculationFingerprint(defaults.payPlan)
    ) return false;

    await loadDemoSales(buildDemoSales(monthKeyFromDate(asOfDate), asOfDate, "two-year"), {
      historicDemoPlan: createPublicDemoHistoricPlan(asOfDate),
    });
    return true;
  });
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
  assertPersistableSaleNumbers(sale);
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    if (sale.status === "void") {
      throw new Error("Undelivered sales are not saved. Delete the record instead.");
    }
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
    status: activeSale.status === "void" ? "pending" : activeSale.status,
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
  assertPersistableActualPaidByMonth(settings.actualPaidByMonth);
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
  sales.forEach(assertPersistableSaleNumbers);
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    const schedule = await getStoredPayPlanSchedule();
    if (sales.some((sale) => sale.status === "void")) {
      throw new Error("Undelivered sales are not imported. Remove those rows from the source file.");
    }
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
  options?: { historicDemoPlan?: PayPlan },
): Promise<{ added: number; restored: number; alreadyPresent: number }> {
  let added = 0;
  let restored = 0;
  let alreadyPresent = 0;
  const timestamp = new Date().toISOString();
  const incomingIds = new Set(sales.map((sale) => sale.id));
  if (incomingIds.size !== sales.length) throw new Error("Demonstration data contains duplicate record IDs.");
  sales.forEach(assertPersistableSaleNumbers);

  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    const currentSettings = await db.settings.get(PROFILE_ID);
    if (!currentSettings) throw new Error("Sales settings are not initialized.");
    let schedule = getPayPlanSchedule(currentSettings);
    const needsHistoricCoverage = sales.some((sale) => !hasPayPlanCoverage(schedule, monthKeyFromDate(sale.saleDate)));
    if (needsHistoricCoverage && options?.historicDemoPlan) {
      const nonDemoSales = await db.sales
        .where("profileId")
        .equals(PROFILE_ID)
        .filter((sale) => sale.source !== "demo")
        .toArray();
      if (nonDemoSales.length > 0) {
        throw new Error("Use a clean demo workspace before loading the two-year demonstration.");
      }
      const demoSchedule = upsertPayPlan(schedule, options.historicDemoPlan);
      const updatedSettings = normalizeSettings({
        ...currentSettings,
        payPlan: structuredClone(demoSchedule.at(-1) ?? currentSettings.payPlan),
        payPlanHistory: structuredClone(demoSchedule),
        updatedAt: timestamp,
      });
      await db.settings.put(updatedSettings);
      schedule = getPayPlanSchedule(updatedSettings);
    }
    sales.forEach((sale) => assertSaleHasPayPlanCoverage(sale, schedule));

    const existingDemoSales = await db.sales
      .where("profileId")
      .equals(PROFILE_ID)
      .filter((sale) => sale.source === "demo")
      .toArray();
    const staleDemoSales = existingDemoSales.filter((sale) => !sale.deletedAt && !incomingIds.has(sale.id));
    if (staleDemoSales.length > 0) {
      await db.sales.bulkPut(
        staleDemoSales.map((sale) => ({
          ...sale,
          deletedAt: timestamp,
          updatedAt: timestamp,
          revision: sale.revision + 1,
        })),
      );
    }

    for (const sale of sales) {
      const existing = await db.sales.get(sale.id);
      if (!existing) {
        added += 1;
        await db.sales.put({ ...sale, profileId: PROFILE_ID });
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
      if (existing.source === "demo" && !isSameDemoPayload(existing, sale)) {
        alreadyPresent += 1;
        await db.sales.put({
          ...sale,
          profileId: PROFILE_ID,
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
        { added, restored, alreadyPresent, archived: staleDemoSales.length },
      ),
    );
  });

  return { added, restored, alreadyPresent };
}

export async function removeDemoSales(): Promise<number> {
  let removed = 0;
  const timestamp = new Date().toISOString();
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
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
    const nonDemoSales = await db.sales
      .where("profileId")
      .equals(PROFILE_ID)
      .filter((sale) => sale.source !== "demo")
      .toArray();
    const settings = await db.settings.get(PROFILE_ID);
    if (settings && nonDemoSales.length === 0) {
      const withoutHistoricDemo = withoutDemoHistoricPlan(settings);
      if (withoutHistoricDemo !== settings) await db.settings.put(withoutHistoricDemo);
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
  const timestamp = new Date().toISOString();
  const restoredSales = archiveLegacyVoidSales(sales, timestamp);
  restoredSales
    .filter((sale) => !sale.deletedAt)
    .forEach((sale) => assertSaleHasPayPlanCoverage(sale, restoredSchedule));
  const archivedLegacyVoidCount = restoredSales.filter(
    (sale, index) => sale.status === "void" && !sales[index].deletedAt,
  ).length;
  await db.transaction("rw", db.sales, db.settings, db.auditEvents, async () => {
    await db.sales.clear();
    await db.auditEvents.clear();
    await db.settings.clear();
    await db.settings.add({ ...normalizedSettings, updatedAt: timestamp });
    if (restoredSales.length) {
      await db.sales.bulkAdd(restoredSales.map((sale) => ({ ...sale, profileId: PROFILE_ID })));
    }
    if (auditEvents.length) {
      await db.auditEvents.bulkAdd(
        auditEvents.map(({ id: _id, ...event }) => ({ ...event, profileId: PROFILE_ID })),
      );
    }
    await db.auditEvents.add(
      createAuditEvent("restore.completed", `Restored ${sales.length} sales from a backup.`),
    );
    if (archivedLegacyVoidCount > 0) {
      await db.auditEvents.add(
        createAuditEvent(
          "sale.deleted",
          `Moved ${archivedLegacyVoidCount} older undelivered ${archivedLegacyVoidCount === 1 ? "sale" : "sales"} to Recently deleted during backup restore.`,
        ),
      );
    }
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
