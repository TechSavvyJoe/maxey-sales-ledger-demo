import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@/persistence/localDatabase";
import { exportWorkspaceData, type WorkspaceExportSnapshot } from "./workspaceExport";

const files = vi.hoisted(() => ({ excel: vi.fn(), json: vi.fn(), download: vi.fn() }));
vi.mock("./files", () => ({ prepareBackupFile: files.json, downloadBlob: files.download }));
vi.mock("./portableWorkbook", () => ({ preparePortableWorkbook: files.excel }));
const prepared = { file: new Blob(["fictional"]), fileName: "fictional.xlsx" };
const snapshot: WorkspaceExportSnapshot = { settings: createDefaultSettings(), sales: [], auditEvents: [] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
beforeEach(() => { vi.clearAllMocks(); files.excel.mockResolvedValue(prepared); files.json.mockResolvedValue(prepared); });

describe("complete workspace downloads", () => {
  it.each(["excel", "data"] as const)("downloads a fresh full %s snapshot without changing saved data", async (format) => {
    const loadSnapshot = vi.fn(async () => snapshot);
    const assertCurrent = vi.fn();
    await expect(exportWorkspaceData({ format, loadSnapshot, assertCurrent })).resolves.toBe("fictional.xlsx");
    expect(loadSnapshot).toHaveBeenCalledOnce();
    expect(assertCurrent).toHaveBeenCalledTimes(3);
    if (format === "excel") expect(files.excel).toHaveBeenCalledWith(snapshot);
    else expect(files.json).toHaveBeenCalledWith(snapshot.settings, snapshot.sales, snapshot.auditEvents);
    expect(files.download).toHaveBeenCalledWith(prepared.file, prepared.fileName);
  });

  it("never exports cached screen data when the server snapshot fails", async () => {
    await expect(exportWorkspaceData({ format: "excel", assertCurrent: () => {}, loadSnapshot: async () => { throw new Error("Reconnect to read saved data."); } })).rejects.toThrow("Reconnect");
    expect(files.excel).not.toHaveBeenCalled();
    expect(files.download).not.toHaveBeenCalled();
  });

  it("cancels a snapshot when the account or request changes during reading", async () => {
    const reading = deferred<WorkspaceExportSnapshot>();
    let current = true;
    const exporting = exportWorkspaceData({ format: "excel", loadSnapshot: () => reading.promise, assertCurrent: () => { if (!current) throw new Error("Canceled"); } });
    const rejected = expect(exporting).rejects.toThrow("Canceled");
    current = false;
    reading.resolve(snapshot);
    await rejected;
    expect(files.excel).not.toHaveBeenCalled();
    expect(files.download).not.toHaveBeenCalled();
  });

  it("prevents a completed workbook from downloading after sign-out or cancellation", async () => {
    const preparing = deferred<typeof prepared>();
    files.excel.mockReturnValue(preparing.promise);
    let current = true;
    const exporting = exportWorkspaceData({ format: "excel", loadSnapshot: async () => snapshot, assertCurrent: () => { if (!current) throw new Error("Canceled"); } });
    const rejected = expect(exporting).rejects.toThrow("Canceled");
    await vi.waitFor(() => expect(files.excel).toHaveBeenCalledOnce());
    current = false;
    preparing.resolve(prepared);
    await rejected;
    expect(files.download).not.toHaveBeenCalled();
  });
});
