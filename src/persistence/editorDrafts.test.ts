import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { editorDraftDb, loadEditorDraft, saveEditorDraft, clearEditorDraft } from "./localEditorDrafts";
import { EditorDraftConflictError, parseEditorDraftRecord, type EditorDraftPayload } from "./editorDraftSchema";

export function syntheticDraft(): EditorDraftPayload {
  return {
    draftId: "synthetic-sale", baseSale: null,
    values: { status: "delivered", saleDate: "", customerLastName: "Example", stockNumber: "",
      vehicleDescription: "Fictional vehicle", unitCredit: "", frontGross: "-", fiGross: "0.",
      manualFrontCommissionEnabled: true, frontCommissionOverride: "", notes: "Synthetic only" },
    fiProducts: { serviceContractSold: true, gapSold: false, tireWheelSold: undefined },
  };
}

afterEach(async () => { await editorDraftDb.drafts.clear(); });
describe("local editor draft recovery", () => {
  it("retains incomplete raw input and unknown product answers without adding a sale", async () => {
    expect(await loadEditorDraft("new-sale")).toMatchObject({ revision: 0, payload: null });
    const saved = await saveEditorDraft("new-sale", syntheticDraft(), 0);
    expect(saved.revision).toBe(1);
    expect(saved.payload?.values).toMatchObject({ frontGross: "-", fiGross: "0.", stockNumber: "" });
    expect(saved.payload?.fiProducts).not.toHaveProperty("tireWheelSold");
    expect(await loadEditorDraft("new-sale")).toEqual(saved);
  });
  it("serializes competing tab writes and rejects the stale one", async () => {
    const results = await Promise.allSettled([
      saveEditorDraft("new-sale", syntheticDraft(), 0), saveEditorDraft("new-sale", syntheticDraft(), 0),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(EditorDraftConflictError);
  });
  it("clears content but retains a revision tombstone against stale resurrection", async () => {
    const first = await saveEditorDraft("new-sale", syntheticDraft(), 0);
    const cleared = await clearEditorDraft("new-sale", first.revision);
    expect(cleared).toMatchObject({ revision: 2, payload: null });
    await expect(saveEditorDraft("new-sale", syntheticDraft(), 0)).rejects.toBeInstanceOf(EditorDraftConflictError);
    await expect(clearEditorDraft("new-sale", 1)).rejects.toBeInstanceOf(EditorDraftConflictError);
    expect(await loadEditorDraft("new-sale")).toEqual(cleared);
  });
  it("rejects mismatched sale identifiers and unbounded input before storing", async () => {
    await expect(saveEditorDraft("sale:another-sale", syntheticDraft(), 0)).rejects.toThrow("does not match");
    await expect(saveEditorDraft("new-sale", { ...syntheticDraft(), values: { ...syntheticDraft().values, notes: "x".repeat(1001) } }, 0)).rejects.toThrow();
    await expect(loadEditorDraft("sale:../invalid")).rejects.toThrow();
    expect(await editorDraftDb.drafts.count()).toBe(0);
  });
  it("rejects unknown stored fields rather than silently repairing a draft", () => {
    expect(() => parseEditorDraftRecord({ key: "new-sale", revision: 1, updatedAt: "2026-09-03T12:00:00.000Z", payload: syntheticDraft(), unrecognized: true }, "new-sale")).toThrow();
  });
});
