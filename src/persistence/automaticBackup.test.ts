import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupEnvelope, Sale } from "@/domain/types";
import { createBackupEnvelope, parseBackupFile } from "@/lib/files";
import {
  AUTOMATIC_BACKUP_CURRENT_FILE_NAME,
  AUTOMATIC_BACKUP_DIRECTORY_NAME,
  AUTOMATIC_BACKUP_HISTORY_DIRECTORY_NAME,
  AutomaticBackupConflictError,
  AutomaticBackupVerificationError,
  automaticBackupDeviceDb,
  chooseAutomaticBackupDirectory,
  clearAutomaticBackupBinding,
  isAutomaticBackupSupported,
  loadAutomaticBackupBinding,
  queryAutomaticBackupPermission,
  readCurrentBackup,
  requestAutomaticBackupPermission,
  saveAutomaticBackupBinding,
  writeVerifiedBackup,
  writeVerifiedBackupToDirectory,
  type AutomaticBackupBinding,
} from "@/persistence/automaticBackup";
import {
  createDefaultSettings,
  db,
  replaceDatabaseFromBackup,
} from "@/persistence/database";

class MemoryFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  content = "";
  createWritableCalls = 0;
  closeCalls = 0;
  tamperAfterClose: string | null = null;
  failClose = false;
  onBeforeCloseCommit: (() => Promise<void>) | null = null;
  lastModified = 1_785_000_000_000;

  constructor(name: string) {
    this.name = name;
  }

  async getFile(): Promise<File> {
    return new File([this.content], this.name, {
      type: "application/json",
      lastModified: this.lastModified,
    });
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    this.createWritableCalls += 1;
    let staged = "";
    const writable = {
      write: async (value: FileSystemWriteChunkType) => {
        if (typeof value !== "string") throw new Error("Test writer expected a string.");
        staged = value;
      },
      close: async () => {
        this.closeCalls += 1;
        if (this.failClose) throw new DOMException("blocked", "NotAllowedError");
        await this.onBeforeCloseCommit?.();
        this.content = this.tamperAfterClose ?? staged;
        this.lastModified += 1;
      },
      abort: async () => undefined,
    };
    return writable as unknown as FileSystemWritableFileStream;
  }

  asHandle(): FileSystemFileHandle {
    return this as unknown as FileSystemFileHandle;
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  readonly files = new Map<string, MemoryFileHandle>();
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  onFileCreated: ((file: MemoryFileHandle) => void) | null = null;

  constructor(name: string) {
    this.name = name;
  }

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) return existing.asHandle();
    if (!options?.create) throw new DOMException("missing", "NotFoundError");
    const created = new MemoryDirectoryHandle(name);
    this.directories.set(name, created);
    return created.asHandle();
  }

  async getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing.asHandle();
    if (!options?.create) throw new DOMException("missing", "NotFoundError");
    const created = new MemoryFileHandle(name);
    this.files.set(name, created);
    this.onFileCreated?.(created);
    return created.asHandle();
  }

  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

async function envelopeFor(name: string): Promise<BackupEnvelope> {
  const settings = createDefaultSettings(new Date("2026-08-31T16:00:00.000Z"));
  settings.salespersonName = name;
  return createBackupEnvelope(settings, [], []);
}

function backupDirectory(root: MemoryDirectoryHandle): MemoryDirectoryHandle {
  const directory = root.directories.get(AUTOMATIC_BACKUP_DIRECTORY_NAME);
  if (!directory) throw new Error("Expected the backup directory to exist.");
  return directory;
}

function historyDirectory(root: MemoryDirectoryHandle): MemoryDirectoryHandle {
  const history = backupDirectory(root).directories.get(AUTOMATIC_BACKUP_HISTORY_DIRECTORY_NAME);
  if (!history) throw new Error("Expected the history directory to exist.");
  return history;
}

function currentFile(root: MemoryDirectoryHandle): MemoryFileHandle {
  const current = backupDirectory(root).files.get(AUTOMATIC_BACKUP_CURRENT_FILE_NAME);
  if (!current) throw new Error("Expected the current backup to exist.");
  return current;
}

function bindingFor(root: MemoryDirectoryHandle, lastChecksum: string | null): AutomaticBackupBinding {
  return {
    id: "primary",
    selectionId: "test-selection",
    directoryHandle: root.asHandle(),
    selectedFolderName: root.name,
    connectedAt: "2026-08-31T15:00:00.000Z",
    lastSuccessfulAt: lastChecksum ? "2026-08-31T15:30:00.000Z" : null,
    lastChecksum,
  };
}

describe("automatic backup folder service", () => {
  beforeEach(async () => {
    await automaticBackupDeviceDb.delete();
    await automaticBackupDeviceDb.open();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await automaticBackupDeviceDb.delete();
  });

  it("writes, closes, and checksum-verifies the current file and daily recovery copy", async () => {
    const root = new MemoryDirectoryHandle("Private OneDrive");
    const envelope = await envelopeFor("Verified User");

    const result = await writeVerifiedBackupToDirectory(root.asHandle(), envelope, {
      now: new Date("2026-08-31T16:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "written",
      checksum: envelope.checksum,
      recoveryFileName: "Sales Ledger Backup 2026-08-31.json",
    });
    const current = currentFile(root);
    const snapshot = historyDirectory(root).files.get("Sales Ledger Backup 2026-08-31.json");
    expect(current.createWritableCalls).toBe(1);
    expect(current.closeCalls).toBe(1);
    expect(snapshot?.createWritableCalls).toBe(1);
    expect(snapshot?.closeCalls).toBe(1);
    expect((await parseBackupFile(await current.getFile())).checksum).toBe(envelope.checksum);
    expect((await parseBackupFile(await snapshot!.getFile())).checksum).toBe(envelope.checksum);
    await expect(readCurrentBackup(bindingFor(root, envelope.checksum))).resolves.toMatchObject({
      envelope: { checksum: envelope.checksum },
      fileName: AUTOMATIC_BACKUP_CURRENT_FILE_NAME,
    });
  });

  it("does not rewrite files when the current backup already has the incoming checksum", async () => {
    const root = new MemoryDirectoryHandle("Private OneDrive");
    const envelope = await envelopeFor("Same User");
    await writeVerifiedBackupToDirectory(root.asHandle(), envelope, {
      now: new Date("2026-08-31T16:00:00.000Z"),
    });
    const current = currentFile(root);
    const snapshot = historyDirectory(root).files.get("Sales Ledger Backup 2026-08-31.json")!;

    const result = await writeVerifiedBackupToDirectory(root.asHandle(), envelope, {
      expectedPreviousChecksum: envelope.checksum,
      now: new Date("2026-08-31T17:00:00.000Z"),
    });

    expect(result.status).toBe("unchanged");
    expect(result.recoveryFileName).toBeNull();
    expect(current.createWritableCalls).toBe(1);
    expect(snapshot.createWritableCalls).toBe(1);
  });

  it("retains personal spiffs and Mini settings in verified recovery history when the override is cleared", async () => {
    const root = new MemoryDirectoryHandle("Personal backups");
    const settings = createDefaultSettings(new Date("2026-08-31T16:00:00Z"));
    settings.payPlan.minimumFrontCommissionCents = 45_000;
    settings.payPlanHistory[0].minimumFrontCommissionCents = 45_000;
    const sale: Sale = {
      id: "backup-spiff", profileId: "primary", saleDate: "2026-08-10",
      customerLastName: "Example", stockNumber: "SPIFF", vehicleDescription: "Example vehicle",
      status: "delivered", unitCreditBasis: 500, frontGrossCents: -31_661, fiGrossCents: null,
      frontCommissionOverrideCents: 50_000, notes: "", revision: 1,
      createdAt: "2026-08-10T12:00:00Z", updatedAt: "2026-08-10T12:00:00Z",
    };
    const first = await createBackupEnvelope(settings, [sale], []);
    await writeVerifiedBackupToDirectory(root.asHandle(), first, { now: new Date("2026-08-31T16:00:00Z") });
    const second = await createBackupEnvelope(settings, [{ ...sale, revision: 2, frontCommissionOverrideCents: null }], []);
    expect(second.checksum).not.toBe(first.checksum);
    await writeVerifiedBackupToDirectory(root.asHandle(), second, {
      now: new Date("2026-09-01T16:00:00Z"), expectedPreviousChecksum: first.checksum,
    });
    const current = (await readCurrentBackup(bindingFor(root, second.checksum)))!.envelope;
    expect(current.data.sales[0]).toMatchObject({ frontCommissionOverrideCents: null, frontGrossCents: -31_661, revision: 2 });
    expect(current.data.profile.payPlan.minimumFrontCommissionCents).toBe(45_000);
    const olderFile = historyDirectory(root).files.get("Sales Ledger Backup 2026-08-31.json")!;
    const older = await parseBackupFile(await olderFile.getFile());
    expect(older.checksum).toBe(first.checksum);
    expect(older.data.sales[0].frontCommissionOverrideCents).toBe(50_000);
  });

  it.each([
    ["f".repeat(64), "external-current-change"],
    [null, "unrecognized-current-backup"],
  ] as const)(
    "blocks a different current backup without overwriting it (expected checksum %s)",
    async (expectedPreviousChecksum, expectedCode) => {
      const root = new MemoryDirectoryHandle("Private OneDrive");
      const existing = await envelopeFor("Existing User");
      const incoming = await envelopeFor("Incoming User");
      await writeVerifiedBackupToDirectory(root.asHandle(), existing, {
        now: new Date("2026-08-31T16:00:00.000Z"),
      });
      const current = currentFile(root);
      const bytesBefore = current.content;
      const writesBefore = current.createWritableCalls;

      const attempt = writeVerifiedBackupToDirectory(root.asHandle(), incoming, {
        expectedPreviousChecksum,
        now: new Date("2026-08-31T17:00:00.000Z"),
      });
      await expect(attempt).rejects.toMatchObject({
        name: "AutomaticBackupConflictError",
        code: expectedCode,
      });
      expect(current.content).toBe(bytesBefore);
      expect(current.createWritableCalls).toBe(writesBefore);
    },
  );

  it.each([
    ["not JSON"],
    [JSON.stringify({ format: "maxey-sales-command-center", checksum: "0".repeat(64), data: {} })],
  ])("never overwrites an invalid current backup", async (invalidContent) => {
    const root = new MemoryDirectoryHandle("Private OneDrive");
    const appDirectory = new MemoryDirectoryHandle(AUTOMATIC_BACKUP_DIRECTORY_NAME);
    root.directories.set(AUTOMATIC_BACKUP_DIRECTORY_NAME, appDirectory);
    const current = new MemoryFileHandle(AUTOMATIC_BACKUP_CURRENT_FILE_NAME);
    current.content = invalidContent;
    appDirectory.files.set(AUTOMATIC_BACKUP_CURRENT_FILE_NAME, current);
    const incoming = await envelopeFor("Incoming User");

    const attempt = writeVerifiedBackupToDirectory(root.asHandle(), incoming);
    await expect(attempt).rejects.toBeInstanceOf(AutomaticBackupConflictError);
    await expect(attempt).rejects.toMatchObject({ code: "invalid-current-backup" });
    expect(current.content).toBe(invalidContent);
    expect(current.createWritableCalls).toBe(0);
    expect(appDirectory.directories.has(AUTOMATIC_BACKUP_HISTORY_DIRECTORY_NAME)).toBe(false);
  });

  it("treats removal of a previously verified current file as a conflict", async () => {
    const root = new MemoryDirectoryHandle("Private OneDrive");
    const appDirectory = new MemoryDirectoryHandle(AUTOMATIC_BACKUP_DIRECTORY_NAME);
    root.directories.set(AUTOMATIC_BACKUP_DIRECTORY_NAME, appDirectory);
    const incoming = await envelopeFor("Incoming User");

    await expect(writeVerifiedBackupToDirectory(root.asHandle(), incoming, {
      expectedPreviousChecksum: "a".repeat(64),
    })).rejects.toMatchObject({ code: "current-backup-missing" });
    expect(appDirectory.files.size).toBe(0);
  });

  it("does not update binding metadata when post-write verification fails", async () => {
    const root = new MemoryDirectoryHandle("Private OneDrive");
    const existing = await envelopeFor("Existing User");
    const incoming = await envelopeFor("Incoming User");
    await writeVerifiedBackupToDirectory(root.asHandle(), existing, {
      now: new Date("2026-08-31T15:00:00.000Z"),
    });
    const current = currentFile(root);
    current.tamperAfterClose = "tampered after close";
    const binding = bindingFor(root, existing.checksum);
    const put = vi.spyOn(automaticBackupDeviceDb.bindings, "put");

    await expect(writeVerifiedBackup(binding, incoming, {
      now: new Date("2026-08-31T16:00:00.000Z"),
    })).rejects.toBeInstanceOf(AutomaticBackupVerificationError);
    expect(put).not.toHaveBeenCalled();
    expect(binding.lastChecksum).toBe(existing.checksum);
    expect(binding.lastSuccessfulAt).toBe("2026-08-31T15:30:00.000Z");
  });

  it("heals stale binding metadata without rewriting a matching current file", async () => {
    const root = new MemoryDirectoryHandle("Private OneDrive");
    const currentEnvelope = await envelopeFor("Recovered User");
    await writeVerifiedBackupToDirectory(root.asHandle(), currentEnvelope, {
      now: new Date("2026-08-31T15:00:00.000Z"),
    });
    const current = currentFile(root);
    const writesBefore = current.createWritableCalls;
    const staleBinding = bindingFor(root, "a".repeat(64));
    const put = vi.spyOn(automaticBackupDeviceDb.bindings, "put")
      .mockResolvedValue("primary");

    const result = await writeVerifiedBackup(staleBinding, currentEnvelope, {
      now: new Date("2026-08-31T17:00:00.000Z"),
    });

    expect(result.status).toBe("unchanged");
    expect(result.binding.lastChecksum).toBe(currentEnvelope.checksum);
    expect(result.binding.lastSuccessfulAt).toBe("2026-08-31T17:00:00.000Z");
    expect(current.createWritableCalls).toBe(writesBefore);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      lastChecksum: currentEnvelope.checksum,
    }));
  });

  it("queries permission without requesting it and requests only when called explicitly", async () => {
    let requestCalls = 0;
    const directoryHandle = {
      kind: "directory",
      name: "Private OneDrive",
      queryPermission: vi.fn(async () => "prompt" as PermissionState),
      requestPermission: vi.fn(async () => {
        requestCalls += 1;
        return "denied" as PermissionState;
      }),
    } as unknown as FileSystemDirectoryHandle;
    const binding = {
      ...bindingFor(new MemoryDirectoryHandle("unused"), null),
      directoryHandle,
    };

    expect(await queryAutomaticBackupPermission(binding)).toBe("prompt");
    expect(requestCalls).toBe(0);
    expect(await requestAutomaticBackupPermission(binding)).toBe("denied");
    expect(requestCalls).toBe(1);
  });

  it("returns a picked folder as an unsaved candidate and preserves the prior binding on cancel", async () => {
    const cloneableHandle = {
      kind: "directory",
      name: "Original OneDrive",
    } as unknown as FileSystemDirectoryHandle;
    await saveAutomaticBackupBinding({
      id: "primary",
      selectionId: "original-selection",
      directoryHandle: cloneableHandle,
      selectedFolderName: "Original OneDrive",
      connectedAt: "2026-08-31T12:00:00.000Z",
      lastSuccessfulAt: null,
      lastChecksum: null,
    });
    const candidateRoot = new MemoryDirectoryHandle("New OneDrive");
    const picker = vi.fn(async () => candidateRoot.asHandle());
    const accessGlobal = globalThis as unknown as {
      showDirectoryPicker?: typeof picker;
    };
    accessGlobal.showDirectoryPicker = picker;

    expect(isAutomaticBackupSupported()).toBe(true);
    const candidate = await chooseAutomaticBackupDirectory();
    expect(candidate).toMatchObject({
      selectedFolderName: "New OneDrive",
      lastSuccessfulAt: null,
      lastChecksum: null,
    });
    expect(candidate.selectionId).not.toBe("original-selection");
    expect(await loadAutomaticBackupBinding()).toMatchObject({
      selectionId: "original-selection",
      selectedFolderName: "Original OneDrive",
    });
    expect(picker).toHaveBeenCalledWith({
      id: "sales-ledger-automatic-backup",
      mode: "readwrite",
      startIn: "documents",
    });

    picker.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
    await expect(chooseAutomaticBackupDirectory()).rejects.toMatchObject({ name: "AbortError" });
    expect(await loadAutomaticBackupBinding()).toMatchObject({ selectionId: "original-selection" });
    delete accessGlobal.showDirectoryPicker;
  });

  it("preserves the working binding when a replacement candidate conflicts", async () => {
    const originalHandle = {
      kind: "directory",
      name: "Original OneDrive",
    } as unknown as FileSystemDirectoryHandle;
    await saveAutomaticBackupBinding({
      id: "primary",
      selectionId: "original-selection",
      directoryHandle: originalHandle,
      selectedFolderName: "Original OneDrive",
      connectedAt: "2026-08-31T12:00:00.000Z",
      lastSuccessfulAt: "2026-08-31T13:00:00.000Z",
      lastChecksum: "c".repeat(64),
    });
    const candidateRoot = new MemoryDirectoryHandle("New OneDrive");
    const existing = await envelopeFor("Different Folder Owner");
    const incoming = await envelopeFor("Current User");
    await writeVerifiedBackupToDirectory(candidateRoot.asHandle(), existing, {
      now: new Date("2026-08-31T14:00:00.000Z"),
    });
    const candidate = {
      ...bindingFor(candidateRoot, null),
      selectionId: "candidate-selection",
    };

    await expect(writeVerifiedBackup(candidate, incoming, {
      replaceExistingBindingOnSuccess: true,
      now: new Date("2026-08-31T16:00:00.000Z"),
    })).rejects.toMatchObject({ code: "unrecognized-current-backup" });
    expect(await loadAutomaticBackupBinding()).toMatchObject({
      selectionId: "original-selection",
      selectedFolderName: "Original OneDrive",
      lastChecksum: "c".repeat(64),
    });
  });

  it("does not clobber a binding selected by another tab during a candidate write", async () => {
    const originalHandle = {
      kind: "directory",
      name: "Original OneDrive",
    } as unknown as FileSystemDirectoryHandle;
    await saveAutomaticBackupBinding({
      id: "primary",
      selectionId: "original-selection",
      directoryHandle: originalHandle,
      selectedFolderName: "Original OneDrive",
      connectedAt: "2026-08-31T12:00:00.000Z",
      lastSuccessfulAt: null,
      lastChecksum: null,
    });
    const candidateRoot = new MemoryDirectoryHandle("Candidate OneDrive");
    const appDirectory = new MemoryDirectoryHandle(AUTOMATIC_BACKUP_DIRECTORY_NAME);
    candidateRoot.directories.set(AUTOMATIC_BACKUP_DIRECTORY_NAME, appDirectory);
    const newerHandle = {
      kind: "directory",
      name: "Other Tab OneDrive",
    } as unknown as FileSystemDirectoryHandle;
    appDirectory.onFileCreated = (file) => {
      if (file.name !== AUTOMATIC_BACKUP_CURRENT_FILE_NAME) return;
      file.onBeforeCloseCommit = async () => {
        await saveAutomaticBackupBinding({
          id: "primary",
          selectionId: "other-tab-selection",
          directoryHandle: newerHandle,
          selectedFolderName: "Other Tab OneDrive",
          connectedAt: "2026-08-31T16:00:00.000Z",
          lastSuccessfulAt: null,
          lastChecksum: null,
        });
      };
    };
    const candidate = {
      ...bindingFor(candidateRoot, null),
      selectionId: "candidate-selection",
    };

    await expect(writeVerifiedBackup(candidate, await envelopeFor("Current User"), {
      replaceExistingBindingOnSuccess: true,
      now: new Date("2026-08-31T16:30:00.000Z"),
    })).rejects.toMatchObject({ code: "backup-folder-changed" });
    expect(await loadAutomaticBackupBinding()).toMatchObject({
      selectionId: "other-tab-selection",
      selectedFolderName: "Other Tab OneDrive",
    });
    expect(currentFile(candidateRoot).closeCalls).toBe(1);
  });

  it("keeps the selected folder in a separate device database during a full data restore", async () => {
    await db.delete();
    await db.open();
    const cloneableHandle = {
      kind: "directory",
      name: "Private OneDrive",
    } as unknown as FileSystemDirectoryHandle;
    await saveAutomaticBackupBinding({
      id: "primary",
      selectionId: "persistent-selection",
      directoryHandle: cloneableHandle,
      selectedFolderName: "Private OneDrive",
      connectedAt: "2026-08-31T12:00:00.000Z",
      lastSuccessfulAt: "2026-08-31T13:00:00.000Z",
      lastChecksum: "b".repeat(64),
    });

    const restoredSettings = createDefaultSettings(new Date("2026-08-31T16:00:00.000Z"));
    restoredSettings.salespersonName = "Restored User";
    await replaceDatabaseFromBackup(restoredSettings, [], []);

    expect(await loadAutomaticBackupBinding()).toMatchObject({
      selectionId: "persistent-selection",
      selectedFolderName: "Private OneDrive",
      lastChecksum: "b".repeat(64),
    });
    const envelope = await createBackupEnvelope(restoredSettings, [], []);
    expect("directoryHandle" in envelope.data.profile).toBe(false);
    await db.delete();
  });

  it("normalizes missing nullable metadata on a stored binding", async () => {
    const cloneableHandle = {
      kind: "directory",
      name: "Private OneDrive",
    } as unknown as FileSystemDirectoryHandle;
    await automaticBackupDeviceDb.bindings.put({
      id: "primary",
      directoryHandle: cloneableHandle,
    });

    const loaded = await loadAutomaticBackupBinding();
    expect(loaded).toMatchObject({
      selectedFolderName: "Private OneDrive",
      lastSuccessfulAt: null,
      lastChecksum: null,
    });
    expect(loaded?.selectionId).toBeTruthy();
    expect(loaded?.connectedAt).toBeTruthy();
    await clearAutomaticBackupBinding();
    expect(await loadAutomaticBackupBinding()).toBeNull();
  });
});
