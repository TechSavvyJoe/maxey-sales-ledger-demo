// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement, createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@/persistence/localDatabase";
import type { Sale } from "@/domain/types";
import type { EditorDraftPayload, EditorDraftRecord } from "@/persistence/editorDrafts";

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock("@/persistence/database", () => ({ CLOUD_BUILD: false, captureStorageContext: () => () => {} }));
vi.mock("@/persistence/editorDrafts", () => ({ loadEditorDraft: storage.load, saveEditorDraft: storage.save, clearEditorDraft: storage.clear }));
import { SaleFormSheet } from "./SaleFormSheet";

const sale: Sale = {
  id: "sale-ui-1", profileId: "primary", saleDate: "2026-08-01", customerLastName: "Miller",
  stockNumber: "DEMO-UI-01", vehicleDescription: "2023 Ford Escape", status: "delivered",
  unitCreditBasis: 1000, frontGrossCents: 230_000, fiGrossCents: null, notes: "",
  createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z", revision: 1,
};

let record: EditorDraftRecord;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T18:00:00.000Z"));
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  record = { key: "sale:sale-ui-1", revision: 0, updatedAt: null, payload: null };
  storage.load.mockReset().mockImplementation(async (key: string) => ({ ...record, key }));
  storage.save.mockReset().mockImplementation(async (key: string, payload: EditorDraftPayload) => {
    record = { key, revision: record.revision + 1, updatedAt: new Date().toISOString(), payload: structuredClone(payload) };
    return record;
  });
  storage.clear.mockReset().mockImplementation(async (key: string) => {
    record = { key, revision: record.revision + 1, updatedAt: new Date().toISOString(), payload: null };
    return record;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openForm(source: Sale | null = sale) {
  const onSave = vi.fn(async (submitted: Sale) => submitted);
  const onOpenChange = vi.fn();
  const onUnsavedChange = vi.fn();
  const settings = { ...createDefaultSettings(), selectedMonth: "2026-08" };
  await act(async () => {
    render(createElement(SaleFormSheet, {
      open: true, saleToEdit: source, settings, sales: source ? [source] : [],
      returnFocusRef: createRef<HTMLElement>(), onOpenChange, onSave,
      onLoadLatestSale: vi.fn(async () => {}), onUnsavedChange,
    }));
  });
  return { onSave, onOpenChange, onUnsavedChange };
}
async function idle() { await act(async () => { await vi.advanceTimersByTimeAsync(1_050); }); }

describe("sale editor autosave interaction", () => {
  it("keeps focus and editable text stable through a background save", async () => {
    const { onSave, onUnsavedChange } = await openForm();
    const input = screen.getByLabelText("Customer last name");
    input.focus();
    fireEvent.change(input, { target: { value: "Davis" } });
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true);
    await idle();
    expect(onSave).toHaveBeenCalledOnce();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Davis");
    expect(input).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByText("Saved on this device")).toBeVisible();
    expect(onUnsavedChange).toHaveBeenLastCalledWith(false);
  });

  it("closes a new draft after saving it without adding a delivered sale", async () => {
    const { onSave, onOpenChange } = await openForm(null);
    fireEvent.change(screen.getByLabelText("Customer last name"), { target: { value: "Draft customer" } });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: /^Close$/ }).at(-1)!); });
    expect(record.payload?.values.customerLastName).toBe("Draft customer");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("confirms Start fresh, leaves saved sales alone, and returns focus to the cleared form", async () => {
    const restored = {
      values: {
        status: "delivered" as const, saleDate: "2026-08-03", customerLastName: "Restored", stockNumber: "DRAFT-UI",
        vehicleDescription: "2024 Ford Escape", unitCredit: "1", frontGross: "0.", fiGross: "",
        manualFrontCommissionEnabled: false, frontCommissionOverride: "", notes: "Unfinished",
      },
      fiProducts: { serviceContractSold: false, tireWheelSold: false, gapSold: false },
    };
    record = { key: "new-sale", revision: 4, updatedAt: sale.updatedAt, payload: { draftId: "restored-ui-draft", baseSale: null, ...restored } };
    const { onSave } = await openForm(null);
    const startFresh = screen.getByRole("button", { name: "Start fresh" });
    startFresh.focus();
    fireEvent.click(startFresh);
    expect(screen.getByRole("dialog", { name: "Start a fresh sale?" })).toHaveTextContent("No saved sales or commission totals will change.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard draft" })); });
    expect(storage.clear).toHaveBeenCalledWith("new-sale", 4);
    expect(screen.getByLabelText("Customer last name")).toHaveValue("");
    expect(screen.getByLabelText(/Stock number/)).toHaveValue("");
    expect(screen.getByLabelText("Front gross")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Start fresh" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByLabelText("Customer last name")).toHaveFocus();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves invalid input as a draft and highlights it only when Done is requested", async () => {
    const { onSave } = await openForm();
    const stock = screen.getByLabelText(/Stock number/);
    fireEvent.change(stock, { target: { value: "" } });
    await idle();
    expect(onSave).not.toHaveBeenCalled();
    expect(stock).toHaveValue("");
    expect(screen.getByText("Draft saved · complete the fields to update this sale")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(stock).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Stock number is required for a delivered vehicle.")).toBeVisible();
  });

  it("warns before unload if the current draft has not been acknowledged", async () => {
    storage.save.mockRejectedValue(new Error("Offline. Keep this editor open."));
    const { onSave, onUnsavedChange } = await openForm();
    fireEvent.change(screen.getByLabelText("Notes optional"), { target: { value: "Unsent note" } });
    await idle();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByText("Changes not saved")).toBeVisible();
    expect(screen.getByLabelText("Notes optional")).toHaveValue("Unsent note");
    expect(onSave).not.toHaveBeenCalled();
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true);
  });

  it("adds a new delivery only through the explicit Add sale action", async () => {
    const { onSave, onOpenChange } = await openForm(null);
    fireEvent.change(screen.getByLabelText(/Stock number/), { target: { value: "DEMO-NEW-UI" } });
    fireEvent.change(screen.getByLabelText("Front gross"), { target: { value: "2300" } });
    await idle();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Draft saved on this device/)).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Add sale$/ })); });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stockNumber: "DEMO-NEW-UI", frontGrossCents: 230_000 }), true, { silent: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
