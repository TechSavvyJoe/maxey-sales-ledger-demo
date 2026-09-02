import Dexie, { type EntityTable } from "dexie";
import type { BackupEnvelope } from "@/domain/types";
import { parseBackupFile } from "@/lib/files";

export const AUTOMATIC_BACKUP_DIRECTORY_NAME = "Sales Ledger Backups";
export const AUTOMATIC_BACKUP_CURRENT_FILE_NAME = "Sales Ledger - Current Backup.json";
export const AUTOMATIC_BACKUP_HISTORY_DIRECTORY_NAME = "Recovery History";

const BINDING_ID = "primary" as const;
const DIRECTORY_PICKER_ID = "sales-ledger-automatic-backup";

export type FileSystemWritePermissionState = "granted" | "denied" | "prompt";

interface PermissionCapableDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
}

interface FileSystemAccessGlobal {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string | FileSystemHandle;
  }) => Promise<FileSystemDirectoryHandle>;
}

export interface AutomaticBackupBinding {
  id: typeof BINDING_ID;
  /** Changes whenever the user selects a different folder. */
  selectionId: string;
  directoryHandle: FileSystemDirectoryHandle;
  selectedFolderName: string;
  connectedAt: string;
  lastSuccessfulAt: string | null;
  lastChecksum: string | null;
}

interface StoredAutomaticBackupBinding extends Partial<AutomaticBackupBinding> {
  id: typeof BINDING_ID;
  directoryHandle: FileSystemDirectoryHandle;
}

class AutomaticBackupDeviceDatabase extends Dexie {
  bindings!: EntityTable<StoredAutomaticBackupBinding, "id">;

  constructor() {
    super("maxey-sales-ledger-device-integrations");
    this.version(1).stores({ bindings: "id" });
  }
}

/**
 * Device-only integration state is deliberately separate from the sales
 * database. Restoring a Sales Ledger backup must never erase the selected
 * folder or its last verified checksum.
 */
export const automaticBackupDeviceDb = new AutomaticBackupDeviceDatabase();

export type AutomaticBackupConflictCode =
  | "current-backup-missing"
  | "external-current-change"
  | "unrecognized-current-backup"
  | "invalid-current-backup"
  | "external-recovery-change"
  | "invalid-recovery-backup";

export class AutomaticBackupConflictError extends Error {
  readonly name = "AutomaticBackupConflictError";
  readonly code: AutomaticBackupConflictCode;
  readonly details: {
    expectedPreviousChecksum: string | null;
    existingChecksum: string | null;
    incomingChecksum: string;
  };

  constructor(
    code: AutomaticBackupConflictCode,
    message: string,
    details: {
      expectedPreviousChecksum: string | null;
      existingChecksum: string | null;
      incomingChecksum: string;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.details = details;
  }
}

export class AutomaticBackupVerificationError extends Error {
  readonly name = "AutomaticBackupVerificationError";
  readonly code = "backup-verification-failed" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class AutomaticBackupBindingChangedError extends Error {
  readonly name = "AutomaticBackupBindingChangedError";
  readonly code = "backup-folder-changed" as const;

  constructor() {
    super("The automatic backup folder changed before this backup could be saved.");
  }
}

export interface AutomaticBackupReadResult {
  envelope: BackupEnvelope;
  fileName: typeof AUTOMATIC_BACKUP_CURRENT_FILE_NAME;
  lastModified: number;
}

export interface AutomaticBackupDirectoryWriteResult {
  status: "written" | "unchanged";
  checksum: string;
  lastSuccessfulAt: string;
  currentFileName: typeof AUTOMATIC_BACKUP_CURRENT_FILE_NAME;
  recoveryFileName: string | null;
}

export interface AutomaticBackupWriteResult extends AutomaticBackupDirectoryWriteResult {
  binding: AutomaticBackupBinding;
}

export interface AutomaticBackupWriteOptions {
  now?: Date;
}

export interface AutomaticBackupBindingWriteOptions extends AutomaticBackupWriteOptions {
  /**
   * Allows a newly picked, unsaved candidate to replace a prior binding, but
   * only after both backup files are written and verified. The old binding is
   * preserved if any folder check or write fails.
   */
  replaceExistingBindingOnSuccess?: boolean;
}

interface ExistingBackup {
  envelope: BackupEnvelope;
  file: File;
}

function fileSystemAccessGlobal(): FileSystemAccessGlobal {
  return globalThis as unknown as FileSystemAccessGlobal;
}

function createSelectionId(): string {
  return crypto.randomUUID();
}

function normalizePermissionState(value: PermissionState): FileSystemWritePermissionState {
  if (value === "granted" || value === "denied") return value;
  return "prompt";
}

function normalizeBinding(stored: StoredAutomaticBackupBinding): AutomaticBackupBinding {
  const connectedAt = stored.connectedAt ?? new Date().toISOString();
  return {
    id: BINDING_ID,
    selectionId: stored.selectionId ?? createSelectionId(),
    directoryHandle: stored.directoryHandle,
    selectedFolderName: stored.selectedFolderName?.trim()
      || stored.directoryHandle.name?.trim()
      || "Selected folder",
    connectedAt,
    lastSuccessfulAt: stored.lastSuccessfulAt ?? null,
    lastChecksum: stored.lastChecksum ?? null,
  };
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "NotFoundError"
    : typeof error === "object" && error !== null && "name" in error
      && (error as { name?: unknown }).name === "NotFoundError";
}

function detroitDateOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function recoveryFileName(now: Date): string {
  return `Sales Ledger Backup ${detroitDateOnly(now)}.json`;
}

async function getDirectoryIfPresent(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function getFileIfPresent(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle | null> {
  try {
    return await parent.getFileHandle(name);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function parseFileHandle(handle: FileSystemFileHandle): Promise<ExistingBackup> {
  const file = await handle.getFile();
  return { envelope: await parseBackupFile(file), file };
}

async function parseExistingForWrite(
  handle: FileSystemFileHandle,
  kind: "current" | "recovery",
  expectedPreviousChecksum: string | null,
  incomingChecksum: string,
): Promise<ExistingBackup> {
  try {
    return await parseFileHandle(handle);
  } catch (error) {
    throw new AutomaticBackupConflictError(
      kind === "current" ? "invalid-current-backup" : "invalid-recovery-backup",
      kind === "current"
        ? "The current folder backup is incomplete or changed. It was not overwritten."
        : "Today's recovery copy is incomplete or changed. It was not overwritten.",
      { expectedPreviousChecksum, existingChecksum: null, incomingChecksum },
      { cause: error },
    );
  }
}

function assertSafeExistingBackup(
  existing: ExistingBackup,
  kind: "current" | "recovery",
  expectedPreviousChecksum: string | null,
  incomingChecksum: string,
): void {
  const existingChecksum = existing.envelope.checksum;
  if (existingChecksum === incomingChecksum) return;
  if (expectedPreviousChecksum === existingChecksum) return;

  const code: AutomaticBackupConflictCode = kind === "current"
    ? expectedPreviousChecksum
      ? "external-current-change"
      : "unrecognized-current-backup"
    : "external-recovery-change";
  throw new AutomaticBackupConflictError(
    code,
    kind === "current"
      ? "The folder contains a different current backup. It was not overwritten."
      : "Today's recovery copy was changed outside this app. It was not overwritten.",
    { expectedPreviousChecksum, existingChecksum, incomingChecksum },
  );
}

async function writeAndVerify(
  handle: FileSystemFileHandle,
  serializedEnvelope: string,
  expectedChecksum: string,
): Promise<void> {
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(serializedEnvelope);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // The original write failure is the actionable error.
    }
    throw new AutomaticBackupVerificationError(
      "The backup could not be finished safely. Your saved browser data was not changed.",
      { cause: error },
    );
  }

  let verified: ExistingBackup;
  try {
    verified = await parseFileHandle(handle);
  } catch (error) {
    throw new AutomaticBackupVerificationError(
      "The backup was written but could not be verified. Choose a different backup folder before trying again.",
      { cause: error },
    );
  }
  if (verified.envelope.checksum !== expectedChecksum) {
    throw new AutomaticBackupVerificationError(
      "The backup changed while it was being verified. The app did not mark it as successful.",
    );
  }
}

export function isAutomaticBackupSupported(): boolean {
  return typeof fileSystemAccessGlobal().showDirectoryPicker === "function";
}

export async function loadAutomaticBackupBinding(): Promise<AutomaticBackupBinding | null> {
  const stored = await automaticBackupDeviceDb.bindings.get(BINDING_ID);
  if (!stored?.directoryHandle) return null;
  const normalized = normalizeBinding(stored);
  if (
    stored.selectionId !== normalized.selectionId
    || stored.selectedFolderName !== normalized.selectedFolderName
    || stored.connectedAt !== normalized.connectedAt
    || stored.lastSuccessfulAt !== normalized.lastSuccessfulAt
    || stored.lastChecksum !== normalized.lastChecksum
  ) {
    await automaticBackupDeviceDb.bindings.put(normalized);
  }
  return normalized;
}

export async function saveAutomaticBackupBinding(
  binding: AutomaticBackupBinding,
): Promise<AutomaticBackupBinding> {
  const normalized = normalizeBinding({ ...binding, id: BINDING_ID });
  await automaticBackupDeviceDb.bindings.put(normalized);
  return normalized;
}

export async function clearAutomaticBackupBinding(): Promise<void> {
  await automaticBackupDeviceDb.bindings.delete(BINDING_ID);
}

export async function chooseAutomaticBackupDirectory(): Promise<AutomaticBackupBinding> {
  const picker = fileSystemAccessGlobal().showDirectoryPicker;
  if (!picker) {
    throw new Error("Automatic folder backups need a current version of Microsoft Edge or Chrome.");
  }
  const directoryHandle = await picker.call(globalThis, {
    id: DIRECTORY_PICKER_ID,
    mode: "readwrite",
    startIn: "documents",
  });
  // This is intentionally an unsaved candidate. The caller must make a
  // verified backup before writeVerifiedBackup commits it as the binding.
  return {
    id: BINDING_ID,
    selectionId: createSelectionId(),
    directoryHandle,
    selectedFolderName: directoryHandle.name?.trim() || "Selected folder",
    connectedAt: new Date().toISOString(),
    lastSuccessfulAt: null,
    lastChecksum: null,
  };
}

export async function queryAutomaticBackupPermission(
  binding: AutomaticBackupBinding,
): Promise<FileSystemWritePermissionState> {
  const handle = binding.directoryHandle as PermissionCapableDirectoryHandle;
  if (typeof handle.queryPermission !== "function") return "prompt";
  return normalizePermissionState(await handle.queryPermission({ mode: "readwrite" }));
}

/** Must be called directly from a user action in supporting browsers. */
export async function requestAutomaticBackupPermission(
  binding: AutomaticBackupBinding,
): Promise<FileSystemWritePermissionState> {
  const handle = binding.directoryHandle as PermissionCapableDirectoryHandle;
  if (typeof handle.requestPermission !== "function") return "prompt";
  return normalizePermissionState(await handle.requestPermission({ mode: "readwrite" }));
}

export async function readCurrentBackup(
  binding: AutomaticBackupBinding,
): Promise<AutomaticBackupReadResult | null> {
  const backupDirectory = await getDirectoryIfPresent(
    binding.directoryHandle,
    AUTOMATIC_BACKUP_DIRECTORY_NAME,
  );
  if (!backupDirectory) return null;
  const currentHandle = await getFileIfPresent(backupDirectory, AUTOMATIC_BACKUP_CURRENT_FILE_NAME);
  if (!currentHandle) return null;
  const existing = await parseFileHandle(currentHandle);
  return {
    envelope: existing.envelope,
    fileName: AUTOMATIC_BACKUP_CURRENT_FILE_NAME,
    lastModified: existing.file.lastModified,
  };
}

export async function writeVerifiedBackupToDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  envelope: BackupEnvelope,
  options: AutomaticBackupWriteOptions & { expectedPreviousChecksum?: string | null } = {},
): Promise<AutomaticBackupDirectoryWriteResult> {
  const now = options.now ?? new Date();
  const lastSuccessfulAt = now.toISOString();
  const expectedPreviousChecksum = options.expectedPreviousChecksum ?? null;
  const backupDirectory = await directoryHandle.getDirectoryHandle(
    AUTOMATIC_BACKUP_DIRECTORY_NAME,
    { create: true },
  );
  const currentHandle = await getFileIfPresent(backupDirectory, AUTOMATIC_BACKUP_CURRENT_FILE_NAME);

  if (!currentHandle && expectedPreviousChecksum) {
    throw new AutomaticBackupConflictError(
      "current-backup-missing",
      "The current folder backup was removed outside this app. It was not recreated automatically.",
      { expectedPreviousChecksum, existingChecksum: null, incomingChecksum: envelope.checksum },
    );
  }

  if (currentHandle) {
    const current = await parseExistingForWrite(
      currentHandle,
      "current",
      expectedPreviousChecksum,
      envelope.checksum,
    );
    assertSafeExistingBackup(current, "current", expectedPreviousChecksum, envelope.checksum);
    if (current.envelope.checksum === envelope.checksum) {
      return {
        status: "unchanged",
        checksum: envelope.checksum,
        lastSuccessfulAt,
        currentFileName: AUTOMATIC_BACKUP_CURRENT_FILE_NAME,
        recoveryFileName: null,
      };
    }
  }

  const historyDirectory = await backupDirectory.getDirectoryHandle(
    AUTOMATIC_BACKUP_HISTORY_DIRECTORY_NAME,
    { create: true },
  );
  const snapshotName = recoveryFileName(now);
  const existingSnapshotHandle = await getFileIfPresent(historyDirectory, snapshotName);
  if (existingSnapshotHandle) {
    const snapshot = await parseExistingForWrite(
      existingSnapshotHandle,
      "recovery",
      expectedPreviousChecksum,
      envelope.checksum,
    );
    assertSafeExistingBackup(snapshot, "recovery", expectedPreviousChecksum, envelope.checksum);
  }

  const serializedEnvelope = `${JSON.stringify(envelope, null, 2)}\n`;
  const snapshotHandle = existingSnapshotHandle ?? await historyDirectory.getFileHandle(
    snapshotName,
    { create: true },
  );
  await writeAndVerify(snapshotHandle, serializedEnvelope, envelope.checksum);

  const writableCurrentHandle = currentHandle ?? await backupDirectory.getFileHandle(
    AUTOMATIC_BACKUP_CURRENT_FILE_NAME,
    { create: true },
  );
  await writeAndVerify(writableCurrentHandle, serializedEnvelope, envelope.checksum);

  return {
    status: "written",
    checksum: envelope.checksum,
    lastSuccessfulAt,
    currentFileName: AUTOMATIC_BACKUP_CURRENT_FILE_NAME,
    recoveryFileName: snapshotName,
  };
}

let writeQueue: Promise<void> = Promise.resolve();

function withCrossTabWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return operation();
  return navigator.locks.request(
    "maxey-sales-ledger-automatic-backup-write",
    { mode: "exclusive" },
    operation,
  );
}

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const run = () => withCrossTabWriteLock(operation);
  const result = writeQueue.then(run, run);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function writeVerifiedBackup(
  binding: AutomaticBackupBinding,
  envelope: BackupEnvelope,
  options: AutomaticBackupBindingWriteOptions = {},
): Promise<AutomaticBackupWriteResult> {
  return serializeWrite(async () => {
    const stored = await loadAutomaticBackupBinding();
    const storedSelectionId = stored?.selectionId ?? null;
    const bindingChanged = stored && stored.selectionId !== binding.selectionId;
    if (bindingChanged && !options.replaceExistingBindingOnSuccess) {
      throw new AutomaticBackupBindingChangedError();
    }
    const activeBinding = bindingChanged ? binding : stored ?? binding;
    const result = await writeVerifiedBackupToDirectory(activeBinding.directoryHandle, envelope, {
      now: options.now,
      expectedPreviousChecksum: activeBinding.lastChecksum,
    });
    const latestBinding = await loadAutomaticBackupBinding();
    if ((latestBinding?.selectionId ?? null) !== storedSelectionId) {
      throw new AutomaticBackupBindingChangedError();
    }
    const updatedBinding = await saveAutomaticBackupBinding({
      ...activeBinding,
      lastSuccessfulAt: result.lastSuccessfulAt,
      lastChecksum: result.checksum,
    });
    return { ...result, binding: updatedBinding };
  });
}
