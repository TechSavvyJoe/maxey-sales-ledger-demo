import type { BackupEnvelope } from "@/domain/types";

export type AutomaticBackupUiStatus =
  | "loading"
  | "unsupported"
  | "not-configured"
  | "permission-needed"
  | "ready"
  | "saving"
  | "conflict"
  | "error";

export interface AutomaticBackupController {
  status: AutomaticBackupUiStatus;
  folderName: string | null;
  lastSuccessfulAt: string | null;
  message: string | null;
  announcement: string;
  chooseFolder: () => Promise<void>;
  reconnect: () => Promise<void>;
  backupNow: () => Promise<void>;
  turnOff: () => Promise<void>;
  readLatestBackup: () => Promise<BackupEnvelope>;
}
