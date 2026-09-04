import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  runTransaction,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import type { ZodType } from "zod";
import { currentMonthKey } from "@/domain/date";
import { normalizeSaleFinancing } from "@/domain/financing";
import { getPayPlanSchedule, hasPayPlanCoverage, payPlanCoverageMessage } from "@/domain/payPlan";
import type { AuditEvent, ProfileSettings, Sale } from "@/domain/types";
import { auditEventSchema, profileSchema, saleSchema } from "@/lib/files";
import { SaleWriteConflictError, SettingsWriteConflictError, type SaleVersionToken } from "@/persistence/errors";
export { SettingsWriteConflictError } from "@/persistence/errors";
import type { EditorDraftRepository } from "@/persistence/editorDraftSchema";
import { createFirebaseEditorDraftRepository } from "./firebaseEditorDrafts";
import {
  assertPersistableActualPaidByMonth,
  assertPersistableSaleNumbers,
  assertSaleHasPayPlanCoverage,
  createDefaultSettings,
  normalizeSettings,
} from "@/persistence/localDatabase";

const PROFILE_ID = "primary";
const SNAPSHOT_ATTEMPTS = 5;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// React development mode deliberately mounts a screen twice. Keep the first
// settings document creation shared for a Firebase instance and account so a
// remount never races itself or flashes a harmless write warning to the user.
const initializationByFirestore = new WeakMap<object, Map<string, Promise<void>>>();

export interface CloudTrackerData {
  settings: ProfileSettings;
  sales: Sale[];
  auditEvents: AuditEvent[];
  /** Ordering metadata for overlapping reads; never part of a report or backup. */
  cloudRevision?: number;
}

export interface CloudRepository extends EditorDraftRepository {
  loadTrackerData(): Promise<CloudTrackerData>;
  loadBackupSnapshot(): Promise<CloudTrackerData>;
  persistSale(sale: Sale, isNew: boolean, expectedVersion?: SaleVersionToken): Promise<Sale>;
  softDeleteSale(sale: Sale): Promise<Sale>;
  restoreSale(sale: Sale): Promise<Sale>;
  persistSettings(settings: ProfileSettings): Promise<ProfileSettings>;
  updateSelectedContext(
    settings: ProfileSettings,
    changes: Partial<Pick<ProfileSettings, "selectedMonth" | "selectedView" | "onboardingDismissed">>,
  ): Promise<ProfileSettings>;
  recordBackupExport(settings?: ProfileSettings): Promise<ProfileSettings>;
  subscribe(onChange: () => void, onError: (error: Error) => void): () => void;
}

export interface FirebaseRepositoryOptions {
  onWriteStatus?: (status: "saving" | "saved" | "error", error?: Error) => void;
}

interface StoredSettings {
  settings: ProfileSettings;
  cloudRevision: number;
}

interface ConsistentSnapshot extends CloudTrackerData {
  cloudRevision: number;
}

class SnapshotChangedError extends Error {}

export class CloudDataValidationError extends Error {
  readonly code = "CLOUD_DATA_INVALID";

  constructor(label: string) {
    super(`Your online ${label} could not be verified. Nothing was changed. Please contact support before continuing.`);
    this.name = "CloudDataValidationError";
  }
}

function assertOnline(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You are offline. Your entries were not saved online. Reconnect and try again.");
  }
}

function assertDocumentId(value: string, label: string): void {
  if (!value || value.includes("/") || value === "." || value === ".." || /^__.*__$/.test(value)) {
    throw new CloudDataValidationError(label);
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new CloudDataValidationError(label);
  }
}

function nextTimestamp(previous?: string): string {
  // A timestamp is also a conflict token. Two saves in one millisecond must
  // not leave that token unchanged, even when the device clock moves back.
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  function sorted(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sorted(entry)]));
    }
    return item;
  }
  return JSON.stringify(sorted(value));
}

function strictParse<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  // Backup schemas accept older formats by defaulting and normalizing them.
  // Cloud documents are canonical: silently repairing/stripping their fields
  // would hide malformed remote data or lose exact history on the next save.
  if (!result.success || stableJson(value) !== stableJson(result.data)) {
    throw new CloudDataValidationError(label);
  }
  return result.data;
}

function parseSettingsDocument(snapshot: DocumentSnapshot<DocumentData>): StoredSettings {
  if (!snapshot.exists()) throw new CloudDataValidationError("settings");
  const { cloudRevision, ...data } = snapshot.data();
  if (!Number.isSafeInteger(cloudRevision) || cloudRevision < 0 || cloudRevision >= Number.MAX_SAFE_INTEGER) {
    throw new CloudDataValidationError("settings");
  }
  const settings = strictParse(profileSchema, data, "settings");
  if (settings.id !== PROFILE_ID || snapshot.id !== PROFILE_ID) throw new CloudDataValidationError("settings");
  assertTimestamp(settings.createdAt, "settings");
  assertTimestamp(settings.updatedAt, "settings");
  if (settings.lastBackupAt !== null) assertTimestamp(settings.lastBackupAt, "settings");
  return { settings, cloudRevision };
}

function parseSaleDocument(snapshot: DocumentSnapshot<DocumentData>): Sale {
  if (!snapshot.exists()) throw new CloudDataValidationError("sale");
  const sale = strictParse(saleSchema, snapshot.data(), "sale");
  if (sale.id !== snapshot.id || sale.profileId !== PROFILE_ID
    || !Number.isSafeInteger(sale.revision) || sale.revision >= Number.MAX_SAFE_INTEGER) {
    throw new CloudDataValidationError("sale");
  }
  assertDocumentId(sale.id, "sale");
  assertTimestamp(sale.createdAt, "sale");
  assertTimestamp(sale.updatedAt, "sale");
  if (sale.deletedAt !== undefined) assertTimestamp(sale.deletedAt, "sale");
  return sale;
}

function parseAuditDocument(snapshot: DocumentSnapshot<DocumentData>): AuditEvent {
  if (!snapshot.exists()) throw new CloudDataValidationError("activity");
  const event = strictParse(auditEventSchema, snapshot.data(), "activity");
  if (event.profileId !== PROFILE_ID || !Number.isSafeInteger(event.id) || (event.id ?? 0) < 1) {
    throw new CloudDataValidationError("activity");
  }
  assertTimestamp(event.occurredAt, "activity");
  return event;
}

function sameSaleVersion(sale: Sale, expected: SaleVersionToken): boolean {
  return sale.revision === expected.revision && sale.updatedAt === expected.updatedAt;
}

function prepareSale(sale: Sale): Sale {
  assertPersistableSaleNumbers(sale);
  const prepared = saleSchema.parse(withoutUndefined(normalizeSaleFinancing(structuredClone(sale))));
  if (prepared.profileId !== PROFILE_ID) throw new CloudDataValidationError("sale");
  assertDocumentId(prepared.id, "sale");
  if (prepared.status === "void") throw new Error("Undelivered sales are not saved. Delete the record instead.");
  if (prepared.source !== undefined && prepared.source !== "manual") {
    throw new Error("Importing or copying demonstration records into a cloud workspace is not available here.");
  }
  assertTimestamp(prepared.createdAt, "sale");
  assertTimestamp(prepared.updatedAt, "sale");
  if (prepared.deletedAt !== undefined) assertTimestamp(prepared.deletedAt, "sale");
  return prepared;
}

/**
 * Online-first cloud repository. The caller must supply a memory-cache-only
 * Firestore instance. All writes are transactions, never locally queued setDoc
 * calls. Their promises resolve only after Firestore acknowledges the commit.
 */
export function createFirebaseRepository(
  firestore: Firestore,
  uid: string,
  options: FirebaseRepositoryOptions = {},
): CloudRepository {
  assertDocumentId(uid, "account");
  const settingsRef = doc(firestore, "users", uid, "settings", PROFILE_ID);
  const salesRef = collection(firestore, "users", uid, "sales");
  const auditRef = collection(firestore, "users", uid, "auditEvents");
  let selectedContext: Pick<ProfileSettings, "selectedMonth" | "selectedView"> = {
    selectedMonth: currentMonthKey(),
    selectedView: "dashboard",
  };
  let localLastBackupAt: string | null = null;

  function forThisDevice(settings: ProfileSettings): ProfileSettings {
    return normalizeSettings({ ...structuredClone(settings), ...selectedContext, lastBackupAt: localLastBackupAt });
  }

  async function withWriteStatus<T>(operation: () => Promise<T>): Promise<T> {
    try {
      assertOnline();
      options.onWriteStatus?.("saving");
      const result = await operation();
      options.onWriteStatus?.("saved");
      return result;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Your entries could not be saved online. Try again.");
      options.onWriteStatus?.("error", failure);
      throw failure;
    }
  }

  async function initialize(): Promise<void> {
    assertOnline();
    const inFlightForFirestore = initializationByFirestore.get(firestore) ?? new Map<string, Promise<void>>();
    initializationByFirestore.set(firestore, inFlightForFirestore);
    const existing = inFlightForFirestore.get(uid);
    if (existing) return existing;

    const firstLoad = (async () => {
      try {
        await runTransaction(firestore, async (transaction) => {
          assertOnline();
          const settingsSnapshot = await transaction.get(settingsRef);
          if (settingsSnapshot.exists()) {
            parseSettingsDocument(settingsSnapshot);
            return;
          }
          const settings = profileSchema.parse(normalizeSettings(createDefaultSettings()));
          transaction.set(settingsRef, { ...settings, cloudRevision: 0 });
        }, { maxAttempts: 3 });
      } catch (caught) {
        // Two separate devices can still initialize an empty account at the
        // same moment. Accept that race only after confirming the valid server
        // record created by the other device; all other failures remain visible.
        const code = typeof caught === "object" && caught !== null && "code" in caught ? String(caught.code) : "";
        if (code !== "already-exists") throw caught;
        parseSettingsDocument(await getDocFromServer(settingsRef));
      }
    })();
    inFlightForFirestore.set(uid, firstLoad);
    try {
      await firstLoad;
    } catch (error) {
      // Do not poison future retries after a real offline or permission error.
      inFlightForFirestore.delete(uid);
      throw error;
    }
  }

  async function readConsistentSnapshot(): Promise<ConsistentSnapshot> {
    assertOnline();
    await initialize();
    for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
      const before = parseSettingsDocument(await getDocFromServer(settingsRef));
      const [salesSnapshot, auditSnapshot] = await Promise.all([
        getDocsFromServer(salesRef),
        getDocsFromServer(auditRef),
      ]);
      const after = parseSettingsDocument(await getDocFromServer(settingsRef));
      // Every data write atomically increments this counter. Equal counters
      // bracket collection reads without mixing two committed account states.
      if (before.cloudRevision !== after.cloudRevision) continue;
      const sales = salesSnapshot.docs.map(parseSaleDocument).sort((a, b) => a.id.localeCompare(b.id));
      const auditEvents = auditSnapshot.docs.map(parseAuditDocument)
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      if (sales.length > 25_000 || auditEvents.length > 100_000) throw new CloudDataValidationError("records");
      const eventIds = new Set(auditEvents.map((event) => event.id));
      if (eventIds.size !== auditEvents.length || auditEvents.some((event) => (event.id ?? 0) > after.cloudRevision)) {
        throw new CloudDataValidationError("activity");
      }
      sales.forEach((sale) => assertSaleHasPayPlanCoverage(sale, getPayPlanSchedule(after.settings)));
      return { settings: after.settings, sales, auditEvents, cloudRevision: after.cloudRevision };
    }
    throw new Error("Your online records kept changing while they were being loaded. Please try again in a moment.");
  }

  async function loadSnapshot(): Promise<CloudTrackerData> {
    const snapshot = await readConsistentSnapshot();
    return { settings: forThisDevice(snapshot.settings), sales: snapshot.sales, auditEvents: snapshot.auditEvents, cloudRevision: snapshot.cloudRevision };
  }

  function commitAudit(
    transaction: Transaction,
    eventRef: ReturnType<typeof doc>,
    stored: StoredSettings,
    event: Omit<AuditEvent, "id" | "profileId" | "occurredAt">,
    timestamp: string,
    settings = stored.settings,
  ): void {
    const cloudRevision = stored.cloudRevision + 1;
    transaction.set(settingsRef, { ...settings, cloudRevision });
    transaction.set(eventRef, withoutUndefined({
      ...event,
      id: cloudRevision,
      profileId: PROFILE_ID,
      occurredAt: timestamp,
    }) as DocumentData);
  }

  async function persistSale(sale: Sale, isNew: boolean, expectedVersion?: SaleVersionToken): Promise<Sale> {
    const incoming = prepareSale(sale);
    const expected = expectedVersion ? { ...expectedVersion } : undefined;
    if (!isNew && (!expected || !Number.isSafeInteger(expected.revision) || !expected.updatedAt)) {
      throw new SaleWriteConflictError(sale.id, sale.stockNumber);
    }
    if (isNew && (incoming.revision !== 1 || incoming.deletedAt !== undefined)) {
      throw new Error("A new online sale must be an active first version.");
    }
    const saleRef = doc(salesRef, incoming.id);
    const eventRef = doc(auditRef);
    return withWriteStatus(() => runTransaction(firestore, async (transaction) => {
      assertOnline();
      const [settingsSnapshot, saleSnapshot] = await Promise.all([
        transaction.get(settingsRef), transaction.get(saleRef),
      ]);
      const stored = parseSettingsDocument(settingsSnapshot);
      const existing = saleSnapshot.exists() ? parseSaleDocument(saleSnapshot) : undefined;
      // Compare against the original editor token on EVERY SDK retry. Never
      // replace the token with the latest document read by a retry.
      if (isNew ? Boolean(existing) : !existing || !sameSaleVersion(existing, expected!)) {
        throw new SaleWriteConflictError(incoming.id, incoming.stockNumber);
      }
      if (existing?.deletedAt || incoming.deletedAt !== undefined) {
        throw new Error("Restore this deleted sale before editing it.");
      }
      assertSaleHasPayPlanCoverage(incoming, getPayPlanSchedule(stored.settings));
      const timestamp = nextTimestamp(existing?.updatedAt);
      const persisted: Sale = {
        ...incoming,
        createdAt: existing?.createdAt ?? incoming.createdAt,
        updatedAt: timestamp,
        revision: existing ? existing.revision + 1 : 1,
      };
      if (existing) {
        transaction.set(doc(firestore, "users", uid, "saleHistory", existing.id, "versions", String(existing.revision)), existing);
      }
      transaction.set(saleRef, persisted);
      commitAudit(transaction, eventRef, stored, {
        action: isNew ? "sale.created" : "sale.updated",
        summary: `${isNew ? "Added" : "Updated"} stock ${incoming.stockNumber || "(missing)"}.`,
        entityId: incoming.id,
        details: {
          status: persisted.status,
          saleDate: persisted.saleDate,
          revision: persisted.revision,
          ...(persisted.frontCommissionOverrideCents != null || existing?.frontCommissionOverrideCents != null ? {
            frontCommissionOverrideChanged: (existing?.frontCommissionOverrideCents ?? null) !== (persisted.frontCommissionOverrideCents ?? null),
            priorFrontCommissionOverrideCents: existing?.frontCommissionOverrideCents ?? null,
            newFrontCommissionOverrideCents: persisted.frontCommissionOverrideCents ?? null,
          } : {}),
        },
      }, timestamp);
      return persisted;
    }, { maxAttempts: 3 }));
  }

  async function changeDeletedState(sale: Sale, restore: boolean): Promise<Sale> {
    const expected = { revision: sale.revision, updatedAt: sale.updatedAt };
    assertDocumentId(sale.id, "sale");
    const saleRef = doc(salesRef, sale.id);
    const eventRef = doc(auditRef);
    return withWriteStatus(() => runTransaction(firestore, async (transaction) => {
      assertOnline();
      const [settingsSnapshot, saleSnapshot] = await Promise.all([
        transaction.get(settingsRef), transaction.get(saleRef),
      ]);
      const stored = parseSettingsDocument(settingsSnapshot);
      const existing = saleSnapshot.exists() ? parseSaleDocument(saleSnapshot) : undefined;
      if (!existing || !sameSaleVersion(existing, expected)) throw new SaleWriteConflictError(sale.id, sale.stockNumber);
      if (restore ? !existing.deletedAt : Boolean(existing.deletedAt)) {
        throw new Error(restore ? "This sale is already active. Reload your sales." : "This sale is already deleted. Reload your sales.");
      }
      const timestamp = nextTimestamp(existing.updatedAt);
      const { deletedAt: _deletedAt, ...active } = existing;
      const changed: Sale = restore
        ? { ...active, status: active.status === "void" ? "pending" : active.status, updatedAt: timestamp, revision: existing.revision + 1 }
        : { ...existing, deletedAt: timestamp, updatedAt: timestamp, revision: existing.revision + 1 };
      if (restore) assertSaleHasPayPlanCoverage(changed, getPayPlanSchedule(stored.settings));
      transaction.set(doc(firestore, "users", uid, "saleHistory", existing.id, "versions", String(existing.revision)), existing);
      transaction.set(saleRef, changed);
      commitAudit(transaction, eventRef, stored, {
        action: restore ? "sale.restored" : "sale.deleted",
        summary: `${restore ? "Restored" : "Deleted"} stock ${existing.stockNumber || "(missing)"}.`,
        entityId: existing.id,
        details: { revision: changed.revision },
      }, timestamp);
      return changed;
    }, { maxAttempts: 3 }));
  }

  async function persistSettings(settings: ProfileSettings): Promise<ProfileSettings> {
    assertPersistableActualPaidByMonth(settings.actualPaidByMonth);
    const requested = profileSchema.parse(withoutUndefined(structuredClone(settings)));
    if (requested.id !== PROFILE_ID) throw new CloudDataValidationError("settings");
    const expectedUpdatedAt = requested.updatedAt;
    const eventRef = doc(auditRef);
    return withWriteStatus(async () => {
      for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
        const snapshot = await readConsistentSnapshot();
        if (snapshot.settings.updatedAt !== expectedUpdatedAt) throw new SettingsWriteConflictError();
        try {
          const committed = await runTransaction(firestore, async (transaction) => {
            assertOnline();
            const stored = parseSettingsDocument(await transaction.get(settingsRef));
            if (stored.settings.updatedAt !== expectedUpdatedAt) throw new SettingsWriteConflictError();
            // A sale added/changed while coverage was checked must cause a
            // complete re-read, not reuse a stale collection in an SDK retry.
            if (stored.cloudRevision !== snapshot.cloudRevision) throw new SnapshotChangedError();
            const timestamp = nextTimestamp(stored.settings.updatedAt);
            const normalized = profileSchema.parse(normalizeSettings(requested));
            const updated: ProfileSettings = {
              ...normalized,
              selectedMonth: stored.settings.selectedMonth,
              selectedView: stored.settings.selectedView,
              onboardingDismissed: stored.settings.onboardingDismissed,
              lastBackupAt: stored.settings.lastBackupAt,
              createdAt: stored.settings.createdAt,
              updatedAt: timestamp,
            };
            const schedule = getPayPlanSchedule(updated);
            snapshot.sales.forEach((item) => assertSaleHasPayPlanCoverage(item, schedule));
            const payPlanChanged = stableJson(getPayPlanSchedule(stored.settings)) !== stableJson(schedule);
            commitAudit(transaction, eventRef, stored, {
              action: "settings.updated",
              summary: payPlanChanged
                ? `Updated pay plan ${updated.payPlan.version} beginning ${updated.payPlan.effectiveMonth}.`
                : "Updated tracker settings.",
              details: {
                payPlanChanged,
                ...(payPlanChanged ? {
                  priorPlan: stored.settings.payPlan.version,
                  priorEffectiveMonth: stored.settings.payPlan.effectiveMonth,
                  newPlan: updated.payPlan.version,
                  newEffectiveMonth: updated.payPlan.effectiveMonth,
                } : {}),
              },
            }, timestamp, updated);
            return updated;
          }, { maxAttempts: 3 });
          return forThisDevice(committed);
        } catch (error) {
          if (!(error instanceof SnapshotChangedError)) throw error;
        }
      }
      throw new Error("Your sales kept changing while settings were checked. Your settings were not saved. Please try again.");
    });
  }

  async function updateSelectedContext(
    settings: ProfileSettings,
    changes: Partial<Pick<ProfileSettings, "selectedMonth" | "selectedView" | "onboardingDismissed">>,
  ): Promise<ProfileSettings> {
    const context = { ...selectedContext };
    if (changes.selectedMonth !== undefined) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(changes.selectedMonth)) throw new Error("Choose a valid month.");
      const schedule = getPayPlanSchedule(settings);
      if (!hasPayPlanCoverage(schedule, changes.selectedMonth)) throw new Error(payPlanCoverageMessage(schedule, changes.selectedMonth));
      context.selectedMonth = changes.selectedMonth;
    }
    if (changes.selectedView !== undefined) {
      if (!["dashboard", "sales", "reports", "settings"].includes(changes.selectedView)) throw new Error("Choose a valid view.");
      context.selectedView = changes.selectedView;
    }
    let updated = settings;
    if (changes.onboardingDismissed !== undefined) {
      if (typeof changes.onboardingDismissed !== "boolean") throw new Error("Choose a valid welcome preference.");
      const onboardingDismissed = changes.onboardingDismissed;
      const eventRef = doc(auditRef);
      updated = await withWriteStatus(() => runTransaction(firestore, async (transaction) => {
        assertOnline();
        const stored = parseSettingsDocument(await transaction.get(settingsRef));
        const timestamp = nextTimestamp(stored.settings.updatedAt);
        const current = { ...stored.settings, onboardingDismissed, updatedAt: timestamp };
        commitAudit(transaction, eventRef, stored, {
          action: "settings.updated",
          summary: "Updated welcome preference.",
          details: { onboardingDismissed },
        }, timestamp, current);
        return current;
      }, { maxAttempts: 3 }));
    }
    selectedContext = context;
    return forThisDevice(updated);
  }

  async function recordBackupExport(_settings?: ProfileSettings): Promise<ProfileSettings> {
    const eventRef = doc(auditRef);
    return withWriteStatus(async () => {
      const result = await runTransaction(firestore, async (transaction) => {
        assertOnline();
        const stored = parseSettingsDocument(await transaction.get(settingsRef));
        const timestamp = nextTimestamp(localLastBackupAt ?? undefined);
        // A download is device activity, not a settings edit. Its audit still
        // shares the account revision barrier, without invalidating drafts.
        commitAudit(transaction, eventRef, stored, {
          action: "backup.exported",
          summary: "Started a full backup download.",
        }, timestamp);
        return { settings: stored.settings, timestamp };
      }, { maxAttempts: 3 });
      localLastBackupAt = result.timestamp;
      return forThisDevice(result.settings);
    });
  }

  function subscribe(onChange: () => void, onError: (error: Error) => void): () => void {
    let sawServer = false;
    let lastRevision: number | undefined;
    return onSnapshot(settingsRef, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return;
      if (snapshot.metadata.fromCache) {
        if (sawServer) onError(new Error("The online connection was interrupted. Reconnect before saving changes."));
        sawServer = false;
        return;
      }
      const reconnecting = !sawServer;
      sawServer = true;
      try {
        if (!snapshot.exists()) {
          onChange();
          return;
        }
        const { cloudRevision } = parseSettingsDocument(snapshot);
        if (reconnecting || cloudRevision !== lastRevision) {
          lastRevision = cloudRevision;
          onChange();
        }
      } catch (error) {
        onError(error instanceof Error ? error : new CloudDataValidationError("settings"));
      }
    }, (error) => onError(error));
  }

  return {
    ...createFirebaseEditorDraftRepository(firestore, uid),
    loadTrackerData: loadSnapshot,
    loadBackupSnapshot: loadSnapshot,
    persistSale,
    softDeleteSale: (sale) => changeDeletedState(sale, false),
    restoreSale: (sale) => changeDeletedState(sale, true),
    persistSettings,
    updateSelectedContext,
    recordBackupExport,
    subscribe,
  };
}
