import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudRepository } from "@/cloud/firebaseRepository";
import {
  activateCloudRepository,
  captureStorageContext,
  getCloudStorageState,
  loadBackupSnapshot,
  recordBackupExport,
} from "@/persistence/database";
import { createDefaultSettings } from "@/persistence/localDatabase";
import type { PreparedBackupFile } from "./files";
import { exportWorkspaceBackup } from "./workspaceBackup";

const files = vi.hoisted(() => ({ prepare: vi.fn(), download: vi.fn() }));
vi.mock("./files", () => ({ prepareBackupFile: files.prepare, downloadPreparedBackup: files.download }));

let deactivate: (() => void) | undefined;
const prepared: PreparedBackupFile = { file: new File(["fictional"], "fictional-backup.json"), fileName: "fictional-backup.json" };
function openAccount(uid: string) {
  const settings = { ...createDefaultSettings(), salespersonName: `Fictional ${uid}` };
  const snapshot = { settings, sales: [], auditEvents: [] };
  const repository = {
    loadBackupSnapshot: vi.fn(async () => snapshot),
    recordBackupExport: vi.fn(async () => settings),
  };
  deactivate = activateCloudRepository(repository as unknown as CloudRepository, { uid, email: `${uid}@example.invalid` });
  return { repository, snapshot };
}
function startExport() {
  return exportWorkspaceBackup({
    loadSnapshot: loadBackupSnapshot,
    assertCurrent: captureStorageContext(),
    onExported: async () => { await recordBackupExport(); },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  files.prepare.mockResolvedValue(prepared);
  files.download.mockImplementation(() => undefined);
});
afterEach(() => { deactivate?.(); });

describe("workspace-bound backup export", () => {
  it("downloads and records an active account's backup normally", async () => {
    const a = openAccount("account-a");
    await expect(startExport()).resolves.toBe(prepared.fileName);
    expect(files.prepare).toHaveBeenCalledWith(a.snapshot.settings, [], []);
    expect(files.download).toHaveBeenCalledWith(prepared);
    expect(a.repository.recordBackupExport).toHaveBeenCalledOnce();
    expect(getCloudStorageState()?.lastSavedAt).not.toBeNull();
  });

  it("rejects a snapshot that finishes after another account opens", async () => {
    const a = openAccount("account-a");
    const reading = deferred<typeof a.snapshot>();
    a.repository.loadBackupSnapshot.mockReturnValueOnce(reading.promise);
    const exporting = startExport();
    const rejected = expect(exporting).rejects.toThrow("account changed");
    const b = openAccount("account-b");
    reading.resolve(a.snapshot);
    await rejected;
    expect(files.prepare).not.toHaveBeenCalled();
    expect(files.download).not.toHaveBeenCalled();
    expect(a.repository.recordBackupExport).not.toHaveBeenCalled();
    expect(b.repository.recordBackupExport).not.toHaveBeenCalled();
    expect(getCloudStorageState()?.lastSavedAt).toBeNull();
  });

  it.each(["account-b", "account-a"])("cancels delayed file preparation after signing out and opening a new %s session", async (nextUid) => {
    const a = openAccount("account-a");
    const preparing = deferred<PreparedBackupFile>();
    files.prepare.mockReturnValueOnce(preparing.promise);
    const exporting = startExport();
    const rejected = expect(exporting).rejects.toThrow("account changed");
    await vi.waitFor(() => expect(files.prepare).toHaveBeenCalledOnce());
    deactivate?.();
    const next = openAccount(nextUid);
    preparing.resolve(prepared);
    await rejected;
    expect(files.download).not.toHaveBeenCalled();
    expect(a.repository.recordBackupExport).not.toHaveBeenCalled();
    expect(next.repository.recordBackupExport).not.toHaveBeenCalled();
    expect(getCloudStorageState()?.lastSavedAt).toBeNull();
  });

  it("never records A's initiated download in B if the account changes at the download boundary", async () => {
    const a = openAccount("account-a");
    let b: ReturnType<typeof openAccount> | undefined;
    files.download.mockImplementationOnce(() => { b = openAccount("account-b"); });
    await expect(startExport()).rejects.toThrow("account changed");
    expect(files.download).toHaveBeenCalledOnce();
    expect(a.repository.recordBackupExport).not.toHaveBeenCalled();
    expect(b?.repository.recordBackupExport).not.toHaveBeenCalled();
    expect(getCloudStorageState()?.lastSavedAt).toBeNull();
  });

  it("keeps the ordinary local backup path working", async () => {
    const settings = createDefaultSettings();
    const onExported = vi.fn(async () => undefined);
    await expect(exportWorkspaceBackup({
      loadSnapshot: () => ({ settings, sales: [], auditEvents: [] }),
      assertCurrent: captureStorageContext(),
      onExported,
    })).resolves.toBe(prepared.fileName);
    expect(files.download).toHaveBeenCalledOnce();
    expect(onExported).toHaveBeenCalledOnce();
  });
});
