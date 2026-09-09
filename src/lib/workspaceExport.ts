import type { AuditEvent, ProfileSettings, Sale } from "@/domain/types";
import { downloadBlob, prepareBackupFile } from "./files";

export interface WorkspaceExportSnapshot {
  settings: ProfileSettings;
  sales: Sale[];
  auditEvents: AuditEvent[];
}

export type WorkspaceExportFormat = "excel" | "data";

/** Read the whole saved workspace, never a filtered view or an unfinished edit. */
export async function exportWorkspaceData({
  format,
  loadSnapshot,
  assertCurrent,
}: {
  format: WorkspaceExportFormat;
  loadSnapshot: () => Promise<WorkspaceExportSnapshot>;
  assertCurrent: () => void;
}): Promise<string> {
  assertCurrent();
  const snapshot = await loadSnapshot();
  assertCurrent();
  const prepared = format === "excel"
    ? await (await import("./portableWorkbook")).preparePortableWorkbook(snapshot)
    : await prepareBackupFile(snapshot.settings, snapshot.sales, snapshot.auditEvents);
  // A download must not leak a previous account's data after sign-out, or
  // complete after the user cancels. Exporting is not an acknowledged save.
  assertCurrent();
  downloadBlob(prepared.file, prepared.fileName);
  return prepared.fileName;
}
