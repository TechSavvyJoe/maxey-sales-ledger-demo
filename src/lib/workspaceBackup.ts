import type { AuditEvent, ProfileSettings, Sale } from "@/domain/types";
import { downloadPreparedBackup, prepareBackupFile } from "./files";

interface BackupSnapshot {
  settings: ProfileSettings;
  sales: Sale[];
  auditEvents: AuditEvent[];
}

/** Keep delayed file preparation and its activity record in the initiating workspace. */
export async function exportWorkspaceBackup({
  loadSnapshot,
  assertCurrent,
  onExported,
}: {
  loadSnapshot: () => BackupSnapshot | Promise<BackupSnapshot>;
  assertCurrent: () => void;
  onExported: () => Promise<void>;
}): Promise<string> {
  assertCurrent();
  const snapshot = await loadSnapshot();
  assertCurrent();
  const prepared = await prepareBackupFile(snapshot.settings, snapshot.sales, snapshot.auditEvents);
  assertCurrent();
  downloadPreparedBackup(prepared);
  assertCurrent();
  await onExported();
  return prepared.fileName;
}
