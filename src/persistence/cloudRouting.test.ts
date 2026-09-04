import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudRepository } from "@/cloud/firebaseRepository";
import {
  activateCloudRepository, getCloudStorageState, importSales, initializePublishedDemo,
  loadBackupSnapshot, loadDemoSales, loadTrackerData, persistSale, replaceDatabaseFromBackup, updateSelectedContext, captureStorageContext,
  loadEditorDraft, saveEditorDraft, clearEditorDraft,
} from "./database";
import type { EditorDraftRecord } from "./editorDraftSchema";
import { createDefaultSettings } from "./localDatabase";

let deactivate: (() => void) | undefined;
afterEach(() => { deactivate?.(); vi.unstubAllGlobals(); });

function fake() {
  const data: Awaited<ReturnType<CloudRepository["loadTrackerData"]>> = { settings: createDefaultSettings(), sales: [], auditEvents: [] };
  const target = {
    loadTrackerData: vi.fn(async () => data), loadBackupSnapshot: vi.fn(async () => data), persistSale: vi.fn(async () => {}),
    updateSelectedContext: vi.fn(async () => data.settings),
    loadEditorDraft: vi.fn(async (): Promise<EditorDraftRecord> => ({ key: "new-sale", revision: 0, payload: null, updatedAt: null })),
    saveEditorDraft: vi.fn(async (): Promise<EditorDraftRecord> => ({ key: "new-sale", revision: 1, payload: null, updatedAt: "2026-09-03T12:00:00.000Z" })),
    clearEditorDraft: vi.fn(async (): Promise<EditorDraftRecord> => ({ key: "new-sale", revision: 2, payload: null, updatedAt: "2026-09-03T12:00:01.000Z" })),
  };
  deactivate = activateCloudRepository(target as unknown as CloudRepository, { uid: "synthetic-account", email: "example@example.invalid" });
  return target;
}

describe("explicit cloud destination", () => {
  it("routes draft reads, saves and clear to the active account, never into the local ledger", async () => {
    const target = fake();
    await loadEditorDraft("new-sale"); await saveEditorDraft("new-sale", {} as never, 0); await clearEditorDraft("new-sale", 1);
    expect(target.loadEditorDraft).toHaveBeenCalledWith("new-sale");
    expect(target.saveEditorDraft).toHaveBeenCalledWith("new-sale", {}, 0);
    expect(target.clearEditorDraft).toHaveBeenCalledWith("new-sale", 1);
  });
  it("a draft acknowledgement cannot erase an authoritative sale-save error", async () => {
    const target = fake();
    target.persistSale.mockRejectedValue(new Error("Sale save failed"));
    await expect(persistSale({} as never, true)).rejects.toThrow("Sale save failed");
    await saveEditorDraft("new-sale", {} as never, 0);
    expect(getCloudStorageState()).toMatchObject({ error: "Sale save failed", lastSavedAt: null, pending: 0 });
  });
  it("rejects late draft data after an account changes", async () => {
    const first = fake();
    let finish!: (draft: EditorDraftRecord) => void;
    first.loadEditorDraft.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const reading = loadEditorDraft("new-sale");
    deactivate?.(); fake();
    finish({ key: "new-sale", revision: 1, updatedAt: "2026-09-03T12:00:00.000Z", payload: null });
    await expect(reading).rejects.toThrow("account changed");
    expect(getCloudStorageState()?.lastSavedAt).toBeNull();
  });
  it("rejects a late draft acknowledgement after sign-out without publishing it to another account", async () => {
    const first = fake();
    let finish!: (draft: EditorDraftRecord) => void;
    first.saveEditorDraft.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const saving = saveEditorDraft("new-sale", {} as never, 0);
    expect(getCloudStorageState()?.pending).toBe(1);
    deactivate?.(); fake();
    finish({ key: "new-sale", revision: 1, updatedAt: "2026-09-03T12:00:00.000Z", payload: null });
    await expect(saving).rejects.toThrow("account changed");
    expect(getCloudStorageState()).toMatchObject({ pending: 0, error: null, lastSavedAt: null });
  });
  it("does not send cloud drafts while offline", async () => {
    const target = fake();
    vi.stubGlobal("navigator", { onLine: false });
    await expect(saveEditorDraft("new-sale", {} as never, 0)).rejects.toThrow("offline");
    expect(target.saveEditorDraft).not.toHaveBeenCalled();
  });
  it("routes reads and exports to the same private account", async () => {
    const target = fake();
    await loadTrackerData(); await loadBackupSnapshot();
    expect(target.loadTrackerData).toHaveBeenCalledOnce();
    expect(target.loadBackupSnapshot).toHaveBeenCalledOnce();
  });
  it("blocks demo loads, imports, and wholesale replacement before touching storage", () => {
    fake();
    expect(() => initializePublishedDemo()).toThrow("not enabled");
    expect(() => loadDemoSales([])).toThrow("not enabled");
    expect(() => importSales([], "fake")).toThrow("not enabled");
    expect(() => replaceDatabaseFromBackup(createDefaultSettings(), [], [])).toThrow("not enabled");
  });
  it("never claims offline input was saved", async () => {
    const target = fake();
    vi.stubGlobal("navigator", { onLine: false });
    await expect(persistSale({} as never, true)).rejects.toThrow("offline");
    expect(target.persistSale).not.toHaveBeenCalled();
    expect(getCloudStorageState()?.lastSavedAt).toBeNull();
  });
  it("marks a save only after acknowledgement and clears account state on exit", async () => {
    const target = fake();
    let acknowledge!: () => void;
    target.persistSale.mockImplementation(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const saving = persistSale({} as never, true);
    expect(getCloudStorageState()?.pending).toBe(1);
    expect(getCloudStorageState()?.lastSavedAt).toBeNull();
    acknowledge(); await saving;
    expect(getCloudStorageState()?.pending).toBe(0);
    expect(getCloudStorageState()?.lastSavedAt).not.toBeNull();
    deactivate?.(); expect(getCloudStorageState()).toBeNull();
  });
  it("a late old-account save cannot mark a different account saved", async () => {
    const first = fake();
    let acknowledge!: () => void;
    first.persistSale.mockImplementation(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const saving = persistSale({} as never, true);
    deactivate?.();
    const second = fake();
    acknowledge(); await saving;
    expect(second.persistSale).not.toHaveBeenCalled();
    expect(getCloudStorageState()?.lastSavedAt).toBeNull();
    expect(getCloudStorageState()?.pending).toBe(0);
  });
  it("month navigation never claims a cloud save or clears a failed-save warning", async () => {
    const target = fake();
    target.persistSale.mockRejectedValue(new Error("Save failed"));
    await expect(persistSale({} as never, true)).rejects.toThrow("Save failed");
    vi.stubGlobal("navigator", { onLine: false });
    await updateSelectedContext(createDefaultSettings(), { selectedMonth: "2026-08" });
    expect(target.updateSelectedContext).toHaveBeenCalledOnce();
    expect(getCloudStorageState()).toMatchObject({ pending: 0, lastSavedAt: null, error: "Save failed" });
  });
  it("a failed refresh is visible without marking a save, and a fresh read clears it", async () => {
    const target = fake();
    target.loadTrackerData.mockRejectedValueOnce(new Error("Connection interrupted"));
    await expect(loadTrackerData()).rejects.toThrow("Connection interrupted");
    expect(getCloudStorageState()).toMatchObject({ connectionError: "Connection interrupted", lastSavedAt: null });
    await loadTrackerData();
    expect(getCloudStorageState()).toMatchObject({ connectionError: null, lastSavedAt: null });
  });
  it("late read failures cannot change a different account's connection status", async () => {
    const first = fake();
    let fail!: (error: Error) => void;
    first.loadTrackerData.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const reading = loadTrackerData();
    deactivate?.(); fake();
    fail(new Error("Old connection failed"));
    await expect(reading).rejects.toThrow("Old connection failed");
    expect(getCloudStorageState()?.connectionError).toBeNull();
  });
  it("rejects completed old-account exports instead of returning their records to a new workspace", async () => {
    const first = fake();
    let finish!: (data: Awaited<ReturnType<CloudRepository["loadBackupSnapshot"]>>) => void;
    first.loadBackupSnapshot.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const reading = loadBackupSnapshot();
    deactivate?.(); fake();
    finish({ settings: createDefaultSettings(), sales: [], auditEvents: [] });
    await expect(reading).rejects.toThrow("account changed");
    expect(getCloudStorageState()).toMatchObject({ connectionError: null, error: null, lastSavedAt: null });
  });
  it("captures workspace identity rather than only the user ID", () => {
    fake();
    const assertCurrent = captureStorageContext();
    expect(assertCurrent).not.toThrow();
    deactivate?.(); fake(); // Same synthetic UID, but a new sign-in/repository.
    expect(assertCurrent).toThrow("account changed");
  });
});
