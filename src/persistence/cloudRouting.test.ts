import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudRepository } from "@/cloud/firebaseRepository";
import type { Sale } from "@/domain/types";
import {
  activateCloudRepository, getCloudStorageState, importSales, initializePublishedDemo,
  loadBackupSnapshot, loadDemoSales, loadTrackerData, persistSale, replaceDatabaseFromBackup, updateSelectedContext, captureStorageContext,
  loadEditorDraft, saveEditorDraft, clearEditorDraft, persistSettings, recordBackupExport, resolveRevertedSaleWrite,
} from "./database";
import type { EditorDraftRecord } from "./editorDraftSchema";
import { createDefaultSettings } from "./localDatabase";
import { SaleWriteConflictError } from "./errors";

let deactivate: (() => void) | undefined;
afterEach(() => { deactivate?.(); vi.unstubAllGlobals(); });

function fake() {
  const data: Awaited<ReturnType<CloudRepository["loadTrackerData"]>> = { settings: createDefaultSettings(), sales: [], auditEvents: [] };
  const target = {
    loadTrackerData: vi.fn(async () => data), loadBackupSnapshot: vi.fn(async () => data), persistSale: vi.fn(async () => {}),
    persistSettings: vi.fn(async () => data.settings), recordBackupExport: vi.fn(async () => data.settings),
    updateSelectedContext: vi.fn(async () => data.settings),
    loadEditorDraft: vi.fn(async (): Promise<EditorDraftRecord> => ({ key: "new-sale", revision: 0, payload: null, updatedAt: null })),
    saveEditorDraft: vi.fn(async (): Promise<EditorDraftRecord> => ({ key: "new-sale", revision: 1, payload: null, updatedAt: "2026-09-03T12:00:00.000Z" })),
    clearEditorDraft: vi.fn(async (): Promise<EditorDraftRecord> => ({ key: "new-sale", revision: 2, payload: null, updatedAt: "2026-09-03T12:00:01.000Z" })),
  };
  deactivate = activateCloudRepository(target as unknown as CloudRepository, { uid: "synthetic-account", email: "example@example.invalid" });
  return target;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function savedSale(): Sale {
  return {
    id: "sale-a", profileId: "primary", saleDate: "2026-09-01", customerLastName: "Sample",
    stockNumber: "SYNTHETIC-1", vehicleDescription: "Sample vehicle", status: "delivered",
    unitCreditBasis: 1_000, frontGrossCents: 230_000, fiGrossCents: null, notes: "",
    createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z", revision: 1,
  };
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
  it("unrelated sale, settings, welcome, and backup acknowledgements cannot erase a failed sale save", async () => {
    const target = fake();
    target.persistSale.mockRejectedValueOnce(new Error("Sale A was not saved"));
    await expect(persistSale({ id: "sale-a" } as never, true)).rejects.toThrow("Sale A was not saved");
    const unrelatedWrites = [
      () => persistSale({ id: "sale-b" } as never, true),
      () => persistSettings(createDefaultSettings()),
      () => updateSelectedContext(createDefaultSettings(), { onboardingDismissed: true }),
      () => recordBackupExport(),
    ];
    for (const save of unrelatedWrites) {
      await save();
      expect(getCloudStorageState()).toMatchObject({ error: "Sale A was not saved", pending: 0 });
    }
    expect(getCloudStorageState()?.lastSavedAt).not.toBeNull();
  });
  it("keeps a failed save visible throughout its retry and clears it only after acknowledgement", async () => {
    const target = fake();
    target.persistSale.mockRejectedValueOnce(new Error("Sale A was not saved"));
    await expect(persistSale({ id: "sale-a" } as never, true)).rejects.toThrow("Sale A was not saved");
    const retry = deferred();
    target.persistSale.mockImplementationOnce(() => retry.promise);
    const saving = persistSale({ id: "sale-a" } as never, true);
    expect(getCloudStorageState()).toMatchObject({ error: "Sale A was not saved", pending: 1, lastSavedAt: null });
    retry.resolve(); await saving;
    expect(getCloudStorageState()).toMatchObject({ error: null, pending: 0 });
    expect(getCloudStorageState()?.lastSavedAt).not.toBeNull();
  });
  it("welcome preferences and backup activity cannot clear a failed settings or payroll save", async () => {
    const target = fake();
    target.persistSettings.mockRejectedValueOnce(new Error("Payroll changes were not saved"));
    await expect(persistSettings(createDefaultSettings())).rejects.toThrow("Payroll changes were not saved");
    await updateSelectedContext(createDefaultSettings(), { onboardingDismissed: true });
    await recordBackupExport();
    expect(getCloudStorageState()?.error).toBe("Payroll changes were not saved");
    await persistSettings(createDefaultSettings());
    expect(getCloudStorageState()?.error).toBeNull();
  });
  it("keeps and updates the warning when a retry fails again", async () => {
    const target = fake();
    target.persistSale.mockRejectedValueOnce(new Error("Sale A was not saved"));
    await expect(persistSale({ id: "sale-a" } as never, true)).rejects.toThrow("Sale A was not saved");
    const retry = deferred();
    target.persistSale.mockImplementationOnce(() => retry.promise);
    const saving = persistSale({ id: "sale-a" } as never, true);
    expect(getCloudStorageState()).toMatchObject({ error: "Sale A was not saved", pending: 1 });
    retry.reject(new Error("Sale A retry failed"));
    await expect(saving).rejects.toThrow("Sale A retry failed");
    expect(getCloudStorageState()).toMatchObject({ error: "Sale A retry failed", pending: 0, lastSavedAt: null });
  });
  it("retains the failed resource when another concurrent write succeeds afterward", async () => {
    const target = fake();
    const first = deferred(); const second = deferred();
    target.persistSale.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const savingA = persistSale({ id: "sale-a" } as never, true);
    const savingB = persistSale({ id: "sale-b" } as never, true);
    expect(getCloudStorageState()?.pending).toBe(2);
    first.reject(new Error("Sale A failed"));
    await expect(savingA).rejects.toThrow("Sale A failed");
    expect(getCloudStorageState()).toMatchObject({ error: "Sale A failed", pending: 1 });
    second.resolve(); await savingB;
    expect(getCloudStorageState()).toMatchObject({ error: "Sale A failed", pending: 0 });
  });
  it("reveals another unresolved error when the most recent failed resource is successfully retried", async () => {
    const target = fake();
    target.persistSale.mockRejectedValueOnce(new Error("Sale A failed"));
    await expect(persistSale({ id: "sale-a" } as never, true)).rejects.toThrow("Sale A failed");
    target.persistSettings.mockRejectedValueOnce(new Error("Settings failed"));
    await expect(persistSettings(createDefaultSettings())).rejects.toThrow("Settings failed");
    expect(getCloudStorageState()?.error).toBe("Settings failed");
    await persistSettings(createDefaultSettings());
    expect(getCloudStorageState()?.error).toBe("Sale A failed");
    await persistSale({ id: "sale-a" } as never, true);
    expect(getCloudStorageState()?.error).toBeNull();
  });
  it("an older acknowledgement of the same resource cannot hide a newer failed attempt", async () => {
    const target = fake();
    const older = deferred();
    target.persistSale.mockImplementationOnce(() => older.promise).mockRejectedValueOnce(new Error("Newer sale edit failed"));
    const savingOlder = persistSale({ id: "sale-a" } as never, false);
    await expect(persistSale({ id: "sale-a" } as never, false)).rejects.toThrow("Newer sale edit failed");
    older.resolve(); await savingOlder;
    expect(getCloudStorageState()).toMatchObject({ error: "Newer sale edit failed", pending: 0 });
  });
  it("an older failure cannot replace a later acknowledgement of the same resource", async () => {
    const target = fake();
    const older = deferred();
    target.persistSale.mockImplementationOnce(() => older.promise);
    const savingOlder = persistSale({ id: "sale-a" } as never, false);
    await persistSale({ id: "sale-a" } as never, false);
    older.reject(new Error("Old sale edit failed"));
    await expect(savingOlder).rejects.toThrow("Old sale edit failed");
    expect(getCloudStorageState()).toMatchObject({ error: null, pending: 0 });
  });
  it("clears resource errors on account change and ignores late failures from the old account", async () => {
    const first = fake();
    first.persistSale.mockRejectedValueOnce(new Error("Old sale A failed"));
    await expect(persistSale({ id: "sale-a" } as never, true)).rejects.toThrow("Old sale A failed");
    const outstanding = deferred();
    first.persistSale.mockImplementationOnce(() => outstanding.promise);
    const saving = persistSale({ id: "sale-b" } as never, true);
    deactivate?.(); fake();
    outstanding.reject(new Error("Old sale B failed"));
    await expect(saving).rejects.toThrow("Old sale B failed");
    await persistSale({ id: "sale-c" } as never, true);
    expect(getCloudStorageState()).toMatchObject({ error: null, pending: 0 });
  });
  it("does not perform recovery reads without a failed baseline sale or in local mode", async () => {
    const target = fake();
    await resolveRevertedSaleWrite(savedSale());
    expect(target.loadTrackerData).not.toHaveBeenCalled();
    target.persistSettings.mockRejectedValueOnce(new Error("Settings failed"));
    await expect(persistSettings(createDefaultSettings())).rejects.toThrow("Settings failed");
    await resolveRevertedSaleWrite(savedSale());
    expect(target.loadTrackerData).not.toHaveBeenCalled();
    expect(getCloudStorageState()?.error).toBe("Settings failed");
    deactivate?.();
    await resolveRevertedSaleWrite(savedSale());
    expect(target.loadTrackerData).not.toHaveBeenCalled();
  });
  it("resolves only a reverted sale's failure after verifying the exact saved server baseline", async () => {
    const target = fake();
    const expected = savedSale();
    await recordBackupExport();
    const lastSavedAt = getCloudStorageState()?.lastSavedAt;
    target.persistSettings.mockRejectedValueOnce(new Error("Settings failed"));
    await expect(persistSettings(createDefaultSettings())).rejects.toThrow("Settings failed");
    target.persistSale.mockRejectedValueOnce(new Error("Sale edit was not confirmed"));
    await expect(persistSale(expected, false)).rejects.toThrow("Sale edit was not confirmed");
    // Field order and omitted undefined values are serialization details, not changes.
    target.loadTrackerData.mockResolvedValueOnce({ settings: createDefaultSettings(), sales: [{ ...Object.fromEntries(Object.entries(expected).reverse()), gapSold: undefined } as Sale], auditEvents: [] });
    await resolveRevertedSaleWrite(expected);
    expect(target.loadTrackerData).toHaveBeenCalledOnce();
    expect(getCloudStorageState()).toMatchObject({ error: "Settings failed", pending: 0, lastSavedAt });
    expect(target.persistSale).toHaveBeenCalledOnce();
  });
  it.each([
    ["new revision", { revision: 2 }],
    ["new timestamp", { updatedAt: "2026-09-02T12:00:00.000Z" }],
    ["changed contents", { frontGrossCents: 240_000 }],
    ["deleted sale", { deletedAt: "2026-09-02T12:00:00.000Z" }],
  ])("requires review instead of clearing a reverted-sale warning for a %s", async (_label, change) => {
    const target = fake();
    const expected = savedSale();
    target.persistSale.mockRejectedValueOnce(new Error("Sale edit was not confirmed"));
    await expect(persistSale(expected, false)).rejects.toThrow("Sale edit was not confirmed");
    target.loadTrackerData.mockResolvedValueOnce({ settings: createDefaultSettings(), sales: [{ ...expected, ...change }], auditEvents: [] });
    await expect(resolveRevertedSaleWrite(expected)).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(getCloudStorageState()).toMatchObject({ error: "Sale edit was not confirmed", lastSavedAt: null });
  });
  it("requires review when the reverted baseline sale no longer exists", async () => {
    const target = fake();
    target.persistSale.mockRejectedValueOnce(new Error("Sale edit was not confirmed"));
    await expect(persistSale(savedSale(), false)).rejects.toThrow("Sale edit was not confirmed");
    await expect(resolveRevertedSaleWrite(savedSale())).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(getCloudStorageState()).toMatchObject({ error: "Sale edit was not confirmed", lastSavedAt: null });
  });
  it("preserves a reverted-sale warning through a failed server read and allows a later verified retry", async () => {
    const target = fake();
    const expected = savedSale();
    target.persistSale.mockRejectedValueOnce(new Error("Sale edit was not confirmed"));
    await expect(persistSale(expected, false)).rejects.toThrow("Sale edit was not confirmed");
    target.loadTrackerData.mockRejectedValueOnce(new Error("Reconnect to verify"));
    await expect(resolveRevertedSaleWrite(expected)).rejects.toThrow("Reconnect to verify");
    expect(getCloudStorageState()).toMatchObject({ error: "Sale edit was not confirmed", connectionError: "Reconnect to verify", lastSavedAt: null });
    target.loadTrackerData.mockResolvedValueOnce({ settings: createDefaultSettings(), sales: [expected], auditEvents: [] });
    await resolveRevertedSaleWrite(expected);
    expect(getCloudStorageState()).toMatchObject({ error: null, connectionError: null, lastSavedAt: null });
  });
  it("cannot clear a newer sale failure while the baseline verification is pending", async () => {
    const target = fake();
    const expected = savedSale();
    target.persistSale.mockRejectedValueOnce(new Error("Old edit failed"));
    await expect(persistSale(expected, false)).rejects.toThrow("Old edit failed");
    let finish!: (data: Awaited<ReturnType<CloudRepository["loadTrackerData"]>>) => void;
    target.loadTrackerData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const recovery = resolveRevertedSaleWrite(expected);
    target.persistSale.mockRejectedValueOnce(new Error("New edit failed"));
    await expect(persistSale(expected, false)).rejects.toThrow("New edit failed");
    finish({ settings: createDefaultSettings(), sales: [expected], auditEvents: [] });
    await expect(recovery).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(getCloudStorageState()).toMatchObject({ error: "New edit failed", lastSavedAt: null });
  });
  it("cannot clear an error while a newer same-sale write is still pending", async () => {
    const target = fake();
    const expected = savedSale();
    target.persistSale.mockRejectedValueOnce(new Error("Old edit failed"));
    await expect(persistSale(expected, false)).rejects.toThrow("Old edit failed");
    let finish!: (data: Awaited<ReturnType<CloudRepository["loadTrackerData"]>>) => void;
    target.loadTrackerData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const recovery = resolveRevertedSaleWrite(expected);
    const nextWrite = deferred();
    target.persistSale.mockImplementationOnce(() => nextWrite.promise);
    const saving = persistSale(expected, false);
    finish({ settings: createDefaultSettings(), sales: [expected], auditEvents: [] });
    await expect(recovery).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(getCloudStorageState()).toMatchObject({ error: "Old edit failed", pending: 1 });
    nextWrite.resolve(); await saving;
    expect(getCloudStorageState()).toMatchObject({ error: null, pending: 0 });
  });
  it("cannot resolve a failure if a newer same-sale write was already pending before verification", async () => {
    const target = fake();
    const expected = savedSale();
    target.persistSale.mockRejectedValueOnce(new Error("Old edit failed"));
    await expect(persistSale(expected, false)).rejects.toThrow("Old edit failed");
    const nextWrite = deferred();
    target.persistSale.mockImplementationOnce(() => nextWrite.promise);
    const saving = persistSale(expected, false);
    target.loadTrackerData.mockResolvedValueOnce({ settings: createDefaultSettings(), sales: [expected], auditEvents: [] });
    await expect(resolveRevertedSaleWrite(expected)).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(getCloudStorageState()).toMatchObject({ error: "Old edit failed", pending: 1 });
    nextWrite.resolve(); await saving;
    expect(getCloudStorageState()).toMatchObject({ error: null, pending: 0 });
  });
  it("rejects old-account baseline verification without changing the new account's status", async () => {
    const target = fake();
    const expected = savedSale();
    target.persistSale.mockRejectedValueOnce(new Error("Old edit failed"));
    await expect(persistSale(expected, false)).rejects.toThrow("Old edit failed");
    let finish!: (data: Awaited<ReturnType<CloudRepository["loadTrackerData"]>>) => void;
    target.loadTrackerData.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const recovery = resolveRevertedSaleWrite(expected);
    deactivate?.(); fake();
    finish({ settings: createDefaultSettings(), sales: [expected], auditEvents: [] });
    await expect(recovery).rejects.toThrow("account changed");
    expect(getCloudStorageState()).toMatchObject({ error: null, connectionError: null, pending: 0, lastSavedAt: null });
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
  it("rejects a late settings acknowledgement after account change without publishing it to the new workspace", async () => {
    const first = fake();
    const pending = deferred();
    const saved = { ...createDefaultSettings(), salespersonName: "Old account example" };
    first.persistSettings.mockImplementationOnce(async () => { await pending.promise; return saved; });
    const saving = persistSettings(saved);
    deactivate?.();
    const second = fake();
    pending.resolve();
    await expect(saving).rejects.toThrow("account changed");
    expect(second.persistSettings).not.toHaveBeenCalled();
    expect(getCloudStorageState()).toMatchObject({ error: null, pending: 0, lastSavedAt: null });
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
