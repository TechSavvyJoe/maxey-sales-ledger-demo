// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const exporting = vi.hoisted(() => ({ download: vi.fn(), assert: vi.fn() }));
vi.mock("@/persistence/database", () => ({ captureStorageContext: () => exporting.assert, loadBackupSnapshot: vi.fn() }));
vi.mock("@/lib/workspaceExport", () => ({ exportWorkspaceData: exporting.download }));
import { WorkspaceExportCard } from "./WorkspaceExportCard";
beforeEach(() => { vi.clearAllMocks(); exporting.download.mockResolvedValue("fictional.xlsx"); });
afterEach(cleanup);

describe("Settings complete export", () => {
  it("explains scope, independent Excel use and app-only exclusions", () => {
    render(createElement(WorkspaceExportCard, { waitingForSave: false }));
    expect(screen.getByRole("heading", { name: "Download all your data" })).toBeVisible();
    expect(screen.getByText(/Every saved month and year/)).toBeVisible();
    expect(screen.getByText(/Excel works offline/)).toHaveTextContent("Unfinished drafts and earlier versions");
    expect(screen.getByRole("button", { name: "Download Excel report" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download data file" })).toBeEnabled();
  });

  it("waits for settings saves and never implies a disabled export has finished", () => {
    render(createElement(WorkspaceExportCard, { waitingForSave: true }));
    fireEvent.click(screen.getByRole("button", { name: "Download Excel report" }));
    expect(exporting.download).not.toHaveBeenCalled();
    expect(screen.getByText(/wait for saving to finish/)).toBeVisible();
  });

  it.each(["Download Excel report", "Download data file"])("announces that %s starts a download rather than claiming the disk file exists", async (label) => {
    render(createElement(WorkspaceExportCard, { waitingForSave: false }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
    expect(exporting.download).toHaveBeenCalledOnce();
    expect(exporting.download.mock.calls[0][0].format).toBe(label.includes("Excel") ? "excel" : "data");
    expect(screen.getByRole("status")).toHaveTextContent("Check your Downloads folder and open the file to confirm it saved.");
  });

  it("offers safe cancellation and blocks a late download result", async () => {
    let finish!: () => void;
    let guarded!: () => void;
    exporting.download.mockImplementation(({ assertCurrent }: { assertCurrent: () => void }) => {
      guarded = assertCurrent;
      return new Promise<string>((resolve) => { finish = () => resolve("late.xlsx"); });
    });
    render(createElement(WorkspaceExportCard, { waitingForSave: false }));
    fireEvent.click(screen.getByRole("button", { name: "Download Excel report" }));
    expect(screen.getByRole("button", { name: "Download data file" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing your complete Excel report");
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    expect(guarded).toThrow("Download canceled");
    await act(async () => { finish(); });
    expect(screen.getByRole("status")).toHaveTextContent("Download canceled");
    expect(screen.getByRole("button", { name: "Download Excel report" })).toBeEnabled();
  });

  it("invalidates pending work when Settings unmounts", () => {
    let guarded!: () => void;
    exporting.download.mockImplementation(({ assertCurrent }: { assertCurrent: () => void }) => { guarded = assertCurrent; return new Promise(() => {}); });
    const { unmount } = render(createElement(WorkspaceExportCard, { waitingForSave: false }));
    fireEvent.click(screen.getByRole("button", { name: "Download Excel report" }));
    unmount();
    expect(guarded).toThrow("Download canceled");
  });

  it("keeps a failed download retryable without a false success", async () => {
    exporting.download.mockRejectedValue(new Error("Reconnect to read your saved data."));
    render(createElement(WorkspaceExportCard, { waitingForSave: false }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Download data file" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Reconnect");
    expect(screen.getByRole("button", { name: "Download data file" })).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
