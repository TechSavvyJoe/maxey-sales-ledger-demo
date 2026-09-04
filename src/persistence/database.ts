/** Selects one explicit storage destination. Cloud mode never falls back to a local ledger. */
import * as local from "./localDatabase";
import type { CloudRepository } from "@/cloud/firebaseRepository";
import type { EditorDraftPayload, EditorDraftRecord, EditorDraftRepository } from "./editorDraftSchema";

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
const listeners = new Set<() => void>();

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
  publish({ ...account, pending: 0, lastSavedAt: null, error: null, connectionError: null });
  return () => {
    if (cloud !== repository) return;
    cloud = null;
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

async function write<T>(operation: (target: ReturnType<typeof repository>) => Promise<T>): Promise<T> {
  const target = repository();
  const account = cloud;
  if (account && typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You are offline. Keep this editor open and reconnect to save your entries to the cloud.");
  }
  if (account && state) publish({ ...state, pending: state.pending + 1, error: null });
  try {
    const result = await operation(target);
    if (account && cloud === account && state) publish({ ...state, lastSavedAt: new Date().toISOString(), error: null });
    return result;
  } catch (error) {
    if (account && cloud === account && state) publish({ ...state, error: error instanceof Error ? error.message : "Cloud save failed. Your entries have not been confirmed saved." });
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
export const persistSale: typeof local.persistSale = (...args) => write((target) => target.persistSale(...args));
export const softDeleteSale: typeof local.softDeleteSale = (...args) => write((target) => target.softDeleteSale(...args));
export const restoreSale: typeof local.restoreSale = (...args) => write((target) => target.restoreSale(...args));
export const persistSettings: typeof local.persistSettings = (...args) => write((target) => target.persistSettings(...args));
export const updateSelectedContext: typeof local.updateSelectedContext = (settings, changes) => {
  // Month/view selection is device-local in cloud mode. It is not evidence of
  // an acknowledged server write and must not clear a failed-save warning.
  if (cloud && changes.onboardingDismissed === undefined) return cloud.updateSelectedContext(settings, changes);
  return write((target) => target.updateSelectedContext(settings, changes));
};
export const recordBackupExport: typeof local.recordBackupExport = (...args) => write((target) => target.recordBackupExport(...args));

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
