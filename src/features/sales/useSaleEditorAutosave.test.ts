// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sale } from "@/domain/types";
import { validateSaleForm } from "@/domain/validation";
import type { EditorDraftPayload, EditorDraftRecord } from "@/persistence/editorDrafts";
import { SaleWriteConflictError } from "@/persistence/errors";

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn(), assertCurrent: vi.fn() }));
vi.mock("@/persistence/database", () => ({ captureStorageContext: () => storage.assertCurrent }));
vi.mock("@/persistence/editorDrafts", () => ({ loadEditorDraft: storage.load, saveEditorDraft: storage.save, clearEditorDraft: storage.clear }));
import { saleEditorContentKey, saleEditorProducts, saleEditorValues, useSaleEditorAutosave, type SaleEditorSnapshot } from "./useSaleEditorAutosave";

const sale: Sale = {
  id: "sale-1", profileId: "primary", saleDate: "2026-08-01", customerLastName: "Miller",
  stockNumber: "DEMO-01", vehicleDescription: "2023 Ford Escape", status: "delivered",
  unitCreditBasis: 1000, frontGrossCents: 230_000, fiGrossCents: null, notes: "",
  createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z", revision: 1,
};

function snapshotFor(source: Sale | null): SaleEditorSnapshot {
  return {
    values: source ? saleEditorValues(source) : { ...saleEditorValues(sale), customerLastName: "", stockNumber: "", vehicleDescription: "", frontGross: "", fiGross: "" },
    fiProducts: saleEditorProducts(source),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let record: EditorDraftRecord;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T18:00:00.000Z"));
  vi.clearAllMocks();
  storage.assertCurrent.mockReset();
  record = { key: "sale:sale-1", revision: 0, updatedAt: null, payload: null };
  storage.load.mockReset().mockImplementation(async (key: string) => ({ ...record, key }));
  storage.save.mockReset().mockImplementation(async (key: string, payload: EditorDraftPayload, expected: number) => {
    if (expected !== record.revision) throw Object.assign(new Error("Draft changed elsewhere"), { code: "EDITOR_DRAFT_CONFLICT" });
    record = { key, revision: record.revision + 1, updatedAt: new Date().toISOString(), payload: structuredClone(payload) };
    return record;
  });
  storage.clear.mockReset().mockImplementation(async (key: string, expected: number) => {
    if (expected !== record.revision) throw Object.assign(new Error("Draft changed elsewhere"), { code: "EDITOR_DRAFT_CONFLICT" });
    record = { key, revision: record.revision + 1, updatedAt: new Date().toISOString(), payload: null };
    return record;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function openEditor({ initialSale = sale, onSave = vi.fn(async (submitted: Sale) => submitted), canCommit = () => true, sales = [sale] }: {
  initialSale?: Sale | null;
  onSave?: (submitted: Sale, isNew: boolean, options?: { silent?: boolean }) => Promise<Sale>;
  canCommit?: () => boolean;
  sales?: Sale[];
} = {}) {
  const hook = renderHook(() => useSaleEditorAutosave({
    open: true, initialSale, initialSnapshot: snapshotFor(initialSale), sales,
    validate: ({ values }) => validateSaleForm(values), canCommit, onSave,
  }));
  await act(async () => {});
  return { ...hook, onSave };
}
async function idle() { await act(async () => { await vi.advanceTimersByTimeAsync(1_050); }); }

describe("sale editor autosave", () => {
  it("saves valid edits after idle without changing typed values and rebases only on its own acknowledgment", async () => {
    const onSave = vi.fn(async (submitted: Sale) => ({ ...submitted, revision: submitted.revision + 4, updatedAt: "2026-09-03T18:00:30.000Z" }));
    const { result } = await openEditor({ onSave });
    act(() => result.current.setValues((values) => ({ ...values, frontGross: "2400" })));
    expect(result.current.needsUnloadWarning).toBe(true);
    await idle();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].revision).toBe(2);
    expect(result.current.values.frontGross).toBe("2400");
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.needsUnloadWarning).toBe(false);
    act(() => result.current.setValues((values) => ({ ...values, notes: "Updated later" })));
    await idle();
    expect(onSave.mock.calls[1][0].revision).toBe(7);
    expect(onSave.mock.calls[1][0].frontGrossCents).toBe(240_000);
  });

  it("coalesces a burst of typing into one quiet save", async () => {
    const onSave = vi.fn(async (submitted: Sale) => submitted);
    const { result } = await openEditor({ onSave });
    act(() => result.current.setValues((values) => ({ ...values, notes: "a" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    act(() => result.current.setValues((values) => ({ ...values, notes: "a complete note" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(onSave).not.toHaveBeenCalled();
    await idle();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ notes: "a complete note" }), false, { silent: true, expectedVersion: { revision: sale.revision, updatedAt: sale.updatedAt } });
    expect(storage.save).toHaveBeenCalledOnce();
  });

  it("serializes changes typed while a previous save is in flight", async () => {
    const first = deferred<Sale>();
    const onSave = vi.fn<(submitted: Sale) => Promise<Sale>>().mockReturnValueOnce(first.promise).mockImplementation(async (submitted) => submitted);
    const { result } = await openEditor({ onSave });
    act(() => result.current.setValues((values) => ({ ...values, notes: "first" })));
    await idle();
    expect(result.current.working).toBe(true);
    act(() => result.current.setValues((values) => ({ ...values, notes: "latest" })));
    await idle();
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => { first.resolve({ ...onSave.mock.calls[0][0], revision: 8 }); await first.promise; });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toMatchObject({ notes: "latest", revision: 9 });
    expect(result.current.values.notes).toBe("latest");
    expect(result.current.hasChanges).toBe(false);
  });

  it("keeps an incomplete field as a recoverable draft without overwriting the last valid sale", async () => {
    const { result, onSave } = await openEditor();
    act(() => result.current.setValues((values) => ({ ...values, stockNumber: "" })));
    await idle();
    expect(onSave).not.toHaveBeenCalled();
    expect(record.payload?.values.stockNumber).toBe("");
    expect(result.current.hasProtectedDraft).toBe(true);
    expect(result.current.needsUnloadWarning).toBe(false);
    act(() => result.current.setValues((values) => ({ ...values, stockNumber: "DEMO-02" })));
    await idle();
    expect(onSave).toHaveBeenCalledOnce();
    expect(record.payload).toBeNull();
  });

  it("does not count a new sale until explicitly added, and retries with the same ID", async () => {
    const onSave = vi.fn<(submitted: Sale) => Promise<Sale>>().mockRejectedValueOnce(new Error("Interrupted")).mockImplementation(async (submitted) => submitted);
    const { result } = await openEditor({ initialSale: null, onSave, sales: [] });
    act(() => result.current.setValues((values) => ({ ...values, stockNumber: "DEMO-NEW", frontGross: "2300" })));
    await idle();
    const draftId = record.payload!.draftId;
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.isNew).toBe(true);
    await act(async () => { await expect(result.current.saveNow(true)).rejects.toThrow("Interrupted"); });
    expect(result.current.values.stockNumber).toBe("DEMO-NEW");
    await act(async () => { await result.current.saveNow(true); });
    expect(onSave.mock.calls.map(([submitted]) => submitted.id)).toEqual([draftId, draftId]);
    expect(result.current.isNew).toBe(false);
    expect(record.payload).toBeNull();
  });

  it("restores the exact unfinished currency text without creating a sale", async () => {
    record = { key: "new-sale", revision: 3, updatedAt: sale.updatedAt, payload: {
      draftId: "new-draft", baseSale: null, ...snapshotFor(null),
      values: { ...snapshotFor(null).values, frontGross: "0.", customerLastName: "Restored" },
    } };
    const { result, onSave } = await openEditor({ initialSale: null, sales: [] });
    expect(result.current.values.frontGross).toBe("0.");
    expect(result.current.restored).toBe(true);
    expect(result.current.hasProtectedDraft).toBe(true);
    await idle();
    expect(onSave).not.toHaveBeenCalled();
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("clears a restored new draft before opening a fresh form with a new stable ID", async () => {
    record = { key: "new-sale", revision: 3, updatedAt: sale.updatedAt, payload: {
      draftId: "abandoned-draft", baseSale: null, ...snapshotFor(null),
      values: { ...snapshotFor(null).values, customerLastName: "Restore me", stockNumber: "DRAFT-OLD" },
    } };
    const { result, onSave } = await openEditor({ initialSale: null, sales: [] });
    expect(result.current.restored).toBe(true);
    await act(async () => { await result.current.discardNewDraft(); });
    expect(storage.clear).toHaveBeenCalledWith("new-sale", 3);
    expect(result.current.values.customerLastName).toBe("");
    expect(result.current.values.stockNumber).toBe("");
    expect(result.current.restored).toBe(false);
    expect(result.current.hasChanges).toBe(false);
    act(() => result.current.setValues((values) => ({ ...values, customerLastName: "Fresh", stockNumber: "DRAFT-NEW" })));
    await idle();
    expect(record.payload?.draftId).not.toBe("abandoned-draft");
    expect(record.payload?.values.stockNumber).toBe("DRAFT-NEW");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("retains every restored entry when clearing a draft is not acknowledged", async () => {
    record = { key: "new-sale", revision: 2, updatedAt: sale.updatedAt, payload: {
      draftId: "keep-draft", baseSale: null, ...snapshotFor(null),
      values: { ...snapshotFor(null).values, customerLastName: "Keep me", stockNumber: "DRAFT-KEEP" },
    } };
    storage.clear.mockRejectedValueOnce(new Error("Offline"));
    const { result } = await openEditor({ initialSale: null, sales: [] });
    await act(async () => { await expect(result.current.discardNewDraft()).rejects.toThrow("Offline"); });
    expect(result.current.values.customerLastName).toBe("Keep me");
    expect(result.current.values.stockNumber).toBe("DRAFT-KEEP");
    expect(result.current.error?.message).toBe("Offline");
    expect(result.current.hasProtectedDraft).toBe(true);
  });

  it("does not write a duplicate unless the editor explicitly permits it", async () => {
    const { result, onSave } = await openEditor({ canCommit: () => false });
    act(() => result.current.setValues((values) => ({ ...values, stockNumber: "DUPLICATE" })));
    await idle();
    expect(storage.save).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.hasProtectedDraft).toBe(true);
  });

  it("retains failed drafts, never marks them saved, and retries when connectivity returns", async () => {
    storage.save.mockRejectedValueOnce(new Error("Offline"));
    const { result, onSave } = await openEditor();
    act(() => result.current.setValues((values) => ({ ...values, notes: "Do not lose this" })));
    await idle();
    expect(result.current.error?.message).toBe("Offline");
    expect(result.current.needsUnloadWarning).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(onSave).toHaveBeenCalledOnce();
    expect(result.current.values.notes).toBe("Do not lose this");
    expect(result.current.needsUnloadWarning).toBe(false);
  });

  it("stops on a stale-sale conflict even if the user keeps typing", async () => {
    const onSave = vi.fn(async () => { throw new SaleWriteConflictError(sale.id); });
    const { result } = await openEditor({ onSave });
    act(() => result.current.setValues((values) => ({ ...values, notes: "My changes" })));
    await idle();
    expect(result.current.error).toBeInstanceOf(SaleWriteConflictError);
    act(() => result.current.setValues((values) => ({ ...values, notes: "Still my changes" })));
    await idle();
    expect(onSave).toHaveBeenCalledOnce();
    expect(result.current.needsUnloadWarning).toBe(true);
    await act(async () => { await expect(result.current.saveNow()).rejects.toBeInstanceOf(SaleWriteConflictError); });
  });

  it("does not overwrite another tab's draft after a CAS conflict", async () => {
    const { result, onSave } = await openEditor();
    record = { ...record, revision: 1 };
    act(() => result.current.setValues((values) => ({ ...values, notes: "Local draft" })));
    await idle();
    expect(result.current.error?.message).toBe("Draft changed elsewhere");
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { await expect(result.current.saveNow()).rejects.toThrow("Draft changed elsewhere"); });
    expect(storage.save).toHaveBeenCalledOnce();
  });

  it("can retry a failed initial draft read without enabling an unsafe blank editor", async () => {
    storage.load.mockRejectedValueOnce(new Error("Could not read"));
    const { result } = await openEditor();
    expect(result.current.ready).toBe(false);
    expect(result.current.error?.message).toBe("Could not read");
    await act(async () => { result.current.retryOpening(); });
    expect(result.current.ready).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("never starts a sale write after its draft write resolves in an old account", async () => {
    const pending = deferred<EditorDraftRecord>();
    storage.save.mockReturnValueOnce(pending.promise);
    const { result, unmount, onSave } = await openEditor();
    act(() => result.current.setValues((values) => ({ ...values, notes: "Old account" })));
    await idle();
    unmount();
    await act(async () => { pending.resolve({ key: "sale:sale-1", revision: 1, updatedAt: sale.updatedAt, payload: null }); await pending.promise; });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not create an extra sale revision for currency formatting alone", async () => {
    const { result, onSave } = await openEditor();
    act(() => result.current.setValues((values) => ({ ...values, frontGross: "2,300.00" })));
    await idle();
    expect(onSave).not.toHaveBeenCalled();
    expect(result.current.hasChanges).toBe(false);
    expect(saleEditorContentKey({ ...snapshotFor(sale), values: { ...snapshotFor(sale).values, frontGross: "2300" } })).toBe(saleEditorContentKey(snapshotFor(sale)));
  });

  it("recognizes an added sale after an interrupted draft cleanup instead of adding it twice", async () => {
    storage.clear.mockRejectedValueOnce(new Error("Cleanup interrupted"));
    let created: Sale | null = null;
    const onSave = vi.fn(async (submitted: Sale) => { created = submitted; return submitted; });
    const first = await openEditor({ initialSale: null, onSave, sales: [] });
    act(() => first.result.current.setValues((values) => ({ ...values, stockNumber: "DEMO-RECOVER" })));
    await act(async () => { await first.result.current.saveNow(true); });
    expect(created).not.toBeNull();
    expect(record.payload).not.toBeNull();
    first.unmount();
    const second = await openEditor({ initialSale: null, onSave, sales: [created!] });
    expect(second.result.current.isNew).toBe(true);
    expect(second.result.current.values.stockNumber).toBe("");
    expect(record.payload).toBeNull();
    await idle();
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("recognizes an already persisted edit without rewriting a stale revision", async () => {
    const acknowledged = { ...sale, notes: "Already saved", revision: 2 };
    record = { key: "sale:sale-1", revision: 1, updatedAt: sale.updatedAt, payload: {
      draftId: sale.id, baseSale: sale, ...snapshotFor(acknowledged),
    } };
    const { result, onSave } = await openEditor({ initialSale: acknowledged, sales: [acknowledged] });
    expect(result.current.baselineSale?.revision).toBe(2);
    expect(result.current.hasChanges).toBe(false);
    await idle();
    expect(onSave).not.toHaveBeenCalled();
    expect(record.payload).toBeNull();
  });
});
