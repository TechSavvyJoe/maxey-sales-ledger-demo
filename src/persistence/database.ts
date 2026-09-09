/** Selects one explicit storage destination. Cloud mode never falls back to a local ledger. */
import * as local from "./localDatabase";
import type { CloudRepository } from "@/cloud/firebaseRepository";
import type { Sale } from "@/domain/types";
import type { EditorDraftPayload, EditorDraftRecord, EditorDraftRepository } from "./editorDraftSchema";
import { SaleWriteConflictError } from "./errors";

export { db, createDefaultSettings, normalizeSettings } from "./localDatabase";

const requestedMode = import.meta.env.VITE_FIREBASE_ENABLED;
export const CLOUD_BUILD = requestedMode !== undefined && requestedMode !== "" && requestedMode !== "false";

export interface CloudStorageState {
  uid: string;
  email: string;
  pending: number;
  lastSavedAt: string | null;
  error: string | null;
  connectionError: string | null;
}

let cloud: CloudRepository | null = null;
let state: CloudStorageState | null = null;
let writeAttempt = 0;
const failedWrites = new Map<string, { attempt: number; message: string }>();
const acknowledgedWrites = new Map<string, number>();
const latestWriteAttempts = new Map<string, number>();
const listeners = new Set<() => void>();

function outstandingWriteError() {
  let latest: { attempt: number; message: string } | undefined;
  for (const failure of failedWrites.values()) {
    if (!latest || failure.attempt > latest.attempt) latest = failure;
  }
  return latest?.message ?? null;
}

function publish(next: CloudStorageState | null) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getCloudStorageState() { return state; }
export function subscribeCloudStorageState(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Guard asynchronous work before it downloads data or starts another write. */
export function captureStorageContext(): () => void {
  const expected = cloud;
  return () => {
    if (cloud !== expected || (CLOUD_BUILD && !expected)) {
      throw new Error("Your account changed. Open the current workspace and try again.");
    }
  };
}

export function activateCloudRepository(repository: CloudRepository, account: { uid: string; email: string }) {
  cloud = repository;
  failedWrites.clear();
  acknowledgedWrites.clear();
  latestWriteAttempts.clear();
  publish({ ...account, pending: 0, lastSavedAt: null, error: null, connectionError: null });
  return () => {
    if (cloud !== repository) return;
    cloud = null;
    failedWrites.clear();
    acknowledgedWrites.clear();
    latestWriteAttempts.clear();
    publish(null);
  };
}

function repository() {
  if (cloud) return cloud;
  if (CLOUD_BUILD) throw new Error("Sign in to open your cloud ledger.");
  return local;
}

function localOnly() {
  if (CLOUD_BUILD || cloud) throw new Error("Import and full-ledger replacement are not enabled in cloud saving. Your saved sales have not been changed.");
  return local;
}

async function write<T>(resource: string, operation: (target: ReturnType<typeof repository>) => Promise<T>): Promise<T> {
  const target = repository();
  const account = cloud;
  const attempt = ++writeAttempt;
  if (account && typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You are offline. Keep this editor open and reconnect to save your entries to the cloud.");
  }
  // A retry has not saved anything yet. Keep unresolved errors visible even
  // while another sale, settings change, or export is being acknowledged.
  if (account && state) {
    latestWriteAttempts.set(resource, attempt);
    publish({ ...state, pending: state.pending + 1 });
  }
  try {
    const result = await operation(target);
    if (account && cloud === account && state) {
      acknowledgedWrites.set(resource, Math.max(attempt, acknowledgedWrites.get(resource) ?? 0));
      const failure = failedWrites.get(resource);
      if (failure && failure.attempt <= attempt) failedWrites.delete(resource);
      publish({ ...state, lastSavedAt: new Date().toISOString(), error: outstandingWriteError() });
    }
    return result;
  } catch (error) {
    if (account && cloud === account && state) {
      // Out-of-order completion must not let an older request replace the
      // outcome of a later successful retry of the same resource.
      if (attempt > (acknowledgedWrites.get(resource) ?? 0) && attempt > (failedWrites.get(resource)?.attempt ?? 0)) {
        failedWrites.set(resource, {
          attempt,
          message: error instanceof Error ? error.message : "Cloud save failed. Your entries have not been confirmed saved.",
        });
      }
      publish({ ...state, error: outstandingWriteError() });
    }
    throw error;
  } finally {
    if (account && cloud === account && state) publish({ ...state, pending: Math.max(0, state.pending - 1) });
  }
}

export function subscribeStorageChanges(onChange: () => void, onError: (error: Error) => void) {
  const account = cloud;
  if (!account) return () => {};
  return account.subscribe(
    () => {
      if (cloud !== account) return;
      if (state?.connectionError) publish({ ...state, connectionError: null });
      onChange();
    },
    (error) => {
      if (cloud !== account) return;
      if (state) publish({ ...state, connectionError: error.message });
      onError(error);
    },
  );
}

async function read<T>(operation: (target: ReturnType<typeof repository>) => Promise<T>): Promise<T> {
  const target = repository();
  const account = cloud;
  const assertCurrent = captureStorageContext();
  try {
    const result = await operation(target);
    assertCurrent();
    if (account && cloud === account && state?.connectionError) publish({ ...state, connectionError: null });
    return result;
  } catch (error) {
    if (account && cloud === account && state) publish({
      ...state,
      connectionError: error instanceof Error ? error.message : "Your latest cloud records could not be loaded. Reconnect and try again.",
    });
    throw error;
  }
}

export type TrackerData = Awaited<ReturnType<typeof local.loadTrackerData>> & { cloudRevision?: number };
export const loadTrackerData = (): Promise<TrackerData> => read((target) => target.loadTrackerData());
export const loadBackupSnapshot: typeof local.loadBackupSnapshot = () => read((target) => target.loadBackupSnapshot());

/** Sale fields are scalar; omit undefined values just as cloud serialization does. */
function saleSnapshotKey(sale: Sale) {
  return JSON.stringify(Object.fromEntries(Object.entries(sale)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))));
}

/**
 * Only for an editor that deliberately returned to its saved baseline and
 * already cleared its recoverable draft. A normal read or draft cleanup is
 * not enough to resolve an uncertain authoritative write.
 */
export async function resolveRevertedSaleWrite(expected: Sale): Promise<void> {
  const account = cloud;
  const saleId = expected.id;
  const stockNumber = expected.stockNumber;
  const resource = `sale:${saleId}`;
  const failure = failedWrites.get(resource);
  if (!account || !failure) return;
  const assertCurrent = captureStorageContext();
  const latestAttempt = latestWriteAttempts.get(resource);
  const expectedKey = saleSnapshotKey(expected);
  const fresh = await read((target) => target.loadTrackerData());
  assertCurrent();
  const saved = fresh.sales.find((sale) => sale.id === saleId);
  if (!saved || saved.deletedAt || saleSnapshotKey(saved) !== expectedKey
    || latestAttempt !== failure.attempt
    || latestWriteAttempts.get(resource) !== latestAttempt
    || failedWrites.get(resource) !== failure) {
    throw new SaleWriteConflictError(saleId, stockNumber);
  }
  failedWrites.delete(resource);
  // This acknowledges the user's verified recovery choice, not a new save.
  if (state) publish({ ...state, error: outstandingWriteError() });
}

export const persistSale: typeof local.persistSale = (...args) => write(`sale:${args[0].id}`, (target) => target.persistSale(...args));
export const softDeleteSale: typeof local.softDeleteSale = (...args) => write(`sale:${args[0].id}`, (target) => target.softDeleteSale(...args));
export const restoreSale: typeof local.restoreSale = (...args) => write(`sale:${args[0].id}`, (target) => target.restoreSale(...args));
export const persistSettings: typeof local.persistSettings = (...args) => {
  const assertCurrent = captureStorageContext();
  return write("settings", async (target) => {
    assertCurrent();
    const result = await target.persistSettings(...args);
    // A late acknowledgement (including verified lost-response recovery)
    // belongs only to the workspace that started the settings change.
    assertCurrent();
    return result;
  });
};
export const updateSelectedContext: typeof local.updateSelectedContext = (settings, changes) => {
  // Month/view selection is device-local in cloud mode. It is not evidence of
  // an acknowledged server write and must not clear a failed-save warning.
  if (cloud && changes.onboardingDismissed === undefined) return cloud.updateSelectedContext(settings, changes);
  return write("welcome-preference", (target) => target.updateSelectedContext(settings, changes));
};
export const recordBackupExport: typeof local.recordBackupExport = (...args) => write("backup-export", (target) => target.recordBackupExport(...args));

/** Drafts never fall through from a cloud account into browser storage. */
async function withDraftRepository<T>(operation: (target: EditorDraftRepository) => Promise<T>, saving: boolean): Promise<T> {
  const account = cloud;
  const assertCurrent = captureStorageContext();
  assertCurrent();
  const target = account ?? await import("./localEditorDrafts");
  assertCurrent();
  if (account && typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You are offline. Keep this editor open and reconnect to save your draft.");
  }
  if (account && saving && state) publish({ ...state, pending: state.pending + 1 });
  try {
    const result = await operation(target);
    assertCurrent();
    // A draft acknowledgement is not a sale/settings acknowledgement. In
    // particular it must not erase the last authoritative save's error.
    return result;
  } finally {
    if (account && cloud === account && saving && state) publish({ ...state, pending: Math.max(0, state.pending - 1) });
  }
}
export const loadEditorDraft = (key: string): Promise<EditorDraftRecord> => withDraftRepository((target) => target.loadEditorDraft(key), false);
export const saveEditorDraft = (key: string, payload: EditorDraftPayload, expectedRevision: number): Promise<EditorDraftRecord> => withDraftRepository((target) => target.saveEditorDraft(key, payload, expectedRevision), true);
export const clearEditorDraft = (key: string, expectedRevision: number): Promise<EditorDraftRecord> => withDraftRepository((target) => target.clearEditorDraft(key, expectedRevision), true);

export const initializeDatabase: typeof local.initializeDatabase = async () => CLOUD_BUILD || cloud
  ? (await loadTrackerData()).settings : local.initializeDatabase();
export const initializePublishedDemo: typeof local.initializePublishedDemo = (...args) => localOnly().initializePublishedDemo(...args);
export const importSales: typeof local.importSales = (...args) => localOnly().importSales(...args);
export const loadDemoSales: typeof local.loadDemoSales = (...args) => localOnly().loadDemoSales(...args);
export const removeDemoSales: typeof local.removeDemoSales = (...args) => localOnly().removeDemoSales(...args);
export const replaceDatabaseFromBackup: typeof local.replaceDatabaseFromBackup = (...args) => localOnly().replaceDatabaseFromBackup(...args);
export const requestPersistentStorage: typeof local.requestPersistentStorage = () => localOnly().requestPersistentStorage();
export const getStorageHealth: typeof local.getStorageHealth = async () => CLOUD_BUILD || cloud
  ? { usageBytes: null, quotaBytes: null, persisted: null } : local.getStorageHealth();
