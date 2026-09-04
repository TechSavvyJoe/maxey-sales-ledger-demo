// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@/persistence/localDatabase";
import type { Sale } from "@/domain/types";

const storage = vi.hoisted(() => ({
  initializePublishedDemo: vi.fn(), loadTrackerData: vi.fn(), persistSale: vi.fn(),
  persistSettings: vi.fn(), restoreSale: vi.fn(), softDeleteSale: vi.fn(), updateSelectedContext: vi.fn(),
  subscribeStorageChanges: vi.fn((_onChange: () => void, _onError?: () => void) => () => {}), CLOUD_BUILD: true,
}));
vi.mock("@/persistence/database", () => storage);
import { useTrackerData } from "./useTrackerData";

beforeEach(() => {
  vi.clearAllMocks();
  storage.loadTrackerData.mockResolvedValue({ settings: createDefaultSettings(), sales: [], auditEvents: [] });
});

function snapshot(name: string, cloudRevision: number) {
  return { settings: { ...createDefaultSettings(), salespersonName: name }, sales: [], auditEvents: [], cloudRevision };
}
function deferred() {
  let resolve!: (value: ReturnType<typeof snapshot>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof snapshot>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("overlapping refreshes", () => {
  it("shows a completed initial read even while a later refresh is still waiting", async () => {
    const initial = deferred(); const later = deferred();
    storage.loadTrackerData.mockReset().mockReturnValueOnce(initial.promise).mockReturnValueOnce(later.promise);
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(storage.loadTrackerData).toHaveBeenCalledOnce());
    const next = result.current.refresh();
    await act(async () => { initial.resolve(snapshot("Confirmed", 1)); await initial.promise; });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.settings?.salespersonName).toBe("Confirmed");
    await act(async () => { later.resolve(snapshot("Latest", 2)); await next; });
    expect(result.current.settings?.salespersonName).toBe("Latest");
    unmount();
  });

  it("never rolls server data back, and returns the applied snapshot instead of a discarded one", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const older = deferred(); const newer = deferred();
    storage.loadTrackerData.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const oldRead = result.current.refresh(); const newRead = result.current.refresh();
    await act(async () => { newer.resolve(snapshot("Revision 3", 3)); await newRead; });
    let returned: Awaited<typeof oldRead>;
    await act(async () => { older.resolve(snapshot("Revision 2", 2)); returned = await oldRead; });
    expect(result.current.settings?.salespersonName).toBe("Revision 3");
    expect(returned!.settings.salespersonName).toBe("Revision 3");
    unmount();
  });

  it("applies a higher server revision even when its request started earlier", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const first = deferred(); const second = deferred();
    storage.loadTrackerData.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstRead = result.current.refresh(); const secondRead = result.current.refresh();
    await act(async () => { second.resolve(snapshot("Revision 1", 1)); await secondRead; });
    await act(async () => { first.resolve(snapshot("Revision 2", 2)); await firstRead; });
    expect(result.current.settings?.salespersonName).toBe("Revision 2");
    unmount();
  });

  it("does not let a newer failed read suppress an earlier valid result", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const first = deferred(); const second = deferred();
    storage.loadTrackerData.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const firstRead = result.current.refresh(); const secondRead = result.current.refresh();
    await act(async () => { second.reject(new Error("Connection interrupted")); await secondRead; });
    await act(async () => { first.resolve(snapshot("Confirmed sale", 1)); await firstRead; });
    expect(result.current.settings?.salespersonName).toBe("Confirmed sale");
    expect(result.current.error).toBeNull();
    unmount();
  });
});

describe("workspace lifetime", () => {
  it("rejects every stale mutation callback after the workspace is unmounted", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const prior = result.current;
    unmount();
    const sale = {} as Sale;
    await expect(prior.saveSale(sale, true)).rejects.toThrow("no longer open");
    await expect(prior.deleteSale(sale)).rejects.toThrow("no longer open");
    await expect(prior.undoDelete(sale)).rejects.toThrow("no longer open");
    await expect(prior.saveSettings(createDefaultSettings())).rejects.toThrow("no longer open");
    await expect(prior.saveContext({ onboardingDismissed: true })).rejects.toThrow("no longer open");
    for (const write of [storage.persistSale, storage.softDeleteSale, storage.restoreSale, storage.persistSettings, storage.updateSelectedContext]) {
      expect(write).not.toHaveBeenCalled();
    }
  });
  it("does not let an old workspace refresh through the next account's repository", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const prior = result.current;
    unmount();
    storage.loadTrackerData.mockClear();
    await prior.refresh();
    await prior.refreshAfterExternalMutation();
    expect(storage.loadTrackerData).not.toHaveBeenCalled();
  });
});

describe("authoritative save acknowledgements", () => {
  it("does not roll a newer listener sale back when an older write ack arrives later", async () => {
    const old = { id: "race-sale", stockNumber: "RACE", revision: 1, updatedAt: "2026-09-03T12:00:00.001Z" } as Sale;
    storage.loadTrackerData.mockResolvedValue({ settings: createDefaultSettings(), sales: [old], auditEvents: [], cloudRevision: 1 });
    let acknowledge!: (sale: Sale) => void;
    storage.persistSale.mockReturnValue(new Promise<Sale>((resolve) => { acknowledge = resolve; }));
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.sales).toContain(old));
    const submitted = { ...old, revision: 2, updatedAt: "2026-09-03T12:00:00.002Z" };
    const pendingSave = result.current.saveSale(submitted, false, old);
    const newer = { ...old, revision: 3, updatedAt: "2026-09-03T12:00:00.003Z" };
    storage.loadTrackerData.mockResolvedValue({ settings: createDefaultSettings(), sales: [newer], auditEvents: [], cloudRevision: 3 });
    await act(async () => { storage.subscribeStorageChanges.mock.calls[0][0](); });
    await waitFor(() => expect(result.current.sales).toContain(newer));
    storage.loadTrackerData.mockRejectedValue(new Error("Read failed"));
    await act(async () => { acknowledge(submitted); await pendingSave; });
    expect(result.current.sales).toContain(newer);
    unmount();
  });

  it("does not roll newer settings back when an older write ack arrives later", async () => {
    const base = createDefaultSettings();
    storage.loadTrackerData.mockResolvedValue({ settings: base, sales: [], auditEvents: [], cloudRevision: 1 });
    let acknowledge!: (settings: typeof base) => void;
    storage.persistSettings.mockReturnValue(new Promise<typeof base>((resolve) => { acknowledge = resolve; }));
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.settings).toEqual(base));
    const submitted = { ...base, salespersonName: "My write", updatedAt: new Date(Date.parse(base.updatedAt) + 1).toISOString() };
    const pendingSave = result.current.saveSettings(submitted);
    const newer = { ...base, salespersonName: "Other device", updatedAt: new Date(Date.parse(base.updatedAt) + 2).toISOString() };
    storage.loadTrackerData.mockResolvedValue({ settings: newer, sales: [], auditEvents: [], cloudRevision: 3 });
    await act(async () => { storage.subscribeStorageChanges.mock.calls[0][0](); });
    await waitFor(() => expect(result.current.settings).toEqual(newer));
    storage.loadTrackerData.mockRejectedValue(new Error("Read failed"));
    await act(async () => { acknowledge(submitted); await pendingSave; });
    expect(result.current.settings).toEqual(newer);
    unmount();
  });

  it("returns the committed sale even when the following read fails, and keeps its version for the next edit", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const committed = { id: "ack-sale", revision: 1, updatedAt: "2026-09-03T12:00:00.000Z" } as Sale;
    storage.persistSale.mockResolvedValueOnce(committed);
    storage.loadTrackerData.mockRejectedValue(new Error("Read connection interrupted"));
    let returned: Sale | undefined;
    await act(async () => { returned = await result.current.saveSale(committed, true); });
    expect(returned).toBe(committed);
    const next = { ...committed, revision: 2, updatedAt: "2026-09-03T12:01:00.000Z" };
    storage.persistSale.mockResolvedValueOnce(next);
    await act(async () => { await result.current.saveSale(next, false); });
    expect(storage.persistSale).toHaveBeenLastCalledWith(next, false, { revision: 1, updatedAt: committed.updatedAt });
    expect(result.current.error).toBeNull();
    unmount();
  });

  it("returns the settings write acknowledgement rather than a later snapshot", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const committed = { ...createDefaultSettings(), salespersonName: "Acknowledged" };
    storage.persistSettings.mockResolvedValue(committed);
    storage.loadTrackerData.mockResolvedValue(snapshot("Subsequent edit", 20));
    let returned;
    await act(async () => { returned = await result.current.saveSettings(committed); });
    expect(returned).toBe(committed);
    expect(result.current.settings?.salespersonName).toBe("Subsequent edit");
    unmount();
  });

  it("applies committed settings when their follow-up refresh fails", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const base = result.current.settings!;
    const committed = { ...base, salespersonName: "Saved despite read failure", updatedAt: new Date(Date.parse(base.updatedAt) + 1).toISOString() };
    storage.persistSettings.mockResolvedValue(committed);
    storage.loadTrackerData.mockRejectedValue(new Error("Read connection interrupted"));
    await act(async () => { await result.current.saveSettings(committed); });
    expect(result.current.settings).toBe(committed);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it("shows a committed sale when its follow-up refresh fails", async () => {
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const committed = { id: "visible-ack", revision: 1, updatedAt: "2026-09-03T12:00:00.001Z" } as Sale;
    storage.persistSale.mockResolvedValue(committed);
    storage.loadTrackerData.mockRejectedValue(new Error("Read connection interrupted"));
    await act(async () => { await result.current.saveSale(committed, true); });
    expect(result.current.sales).toContain(committed);
    storage.loadTrackerData.mockResolvedValue({ settings: createDefaultSettings(), sales: [], auditEvents: [], cloudRevision: 1 });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.sales).toContain(committed);
    const newer = { ...committed, revision: 2, updatedAt: "2026-09-03T12:00:00.002Z" };
    storage.loadTrackerData.mockResolvedValue({ settings: createDefaultSettings(), sales: [newer], auditEvents: [], cloudRevision: 2 });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.sales).toContain(newer);
    unmount();
  });

  it("applies acknowledged delete and restore states before a failed refresh", async () => {
    const stored = { id: "delete-ack", revision: 1, updatedAt: "2026-09-03T12:00:00.000Z" } as Sale;
    storage.loadTrackerData.mockResolvedValue({ settings: createDefaultSettings(), sales: [stored], auditEvents: [], cloudRevision: 1 });
    const { result, unmount } = renderHook(() => useTrackerData());
    await waitFor(() => expect(result.current.sales).toContain(stored));
    const deleted = { ...stored, revision: 2, deletedAt: "2026-09-03T12:01:00.000Z", updatedAt: "2026-09-03T12:01:00.000Z" };
    storage.softDeleteSale.mockResolvedValue(deleted);
    storage.loadTrackerData.mockRejectedValue(new Error("Read connection interrupted"));
    await act(async () => { await result.current.deleteSale(stored); });
    expect(result.current.sales).toContain(deleted);
    const restored = { ...stored, revision: 3, updatedAt: "2026-09-03T12:02:00.000Z" };
    storage.restoreSale.mockResolvedValue(restored);
    await act(async () => { await result.current.undoDelete(deleted); });
    expect(result.current.sales).toContain(restored);
    unmount();
  });
});
