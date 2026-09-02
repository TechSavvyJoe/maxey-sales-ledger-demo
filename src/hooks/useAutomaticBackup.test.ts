/** @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent, BackupEnvelope } from "@/domain/types";
import type { AutomaticBackupBinding } from "@/persistence/automaticBackup";
import { useAutomaticBackup } from "@/hooks/useAutomaticBackup";

const mocks = vi.hoisted(() => ({
  supported: true,
  loadBinding: vi.fn(),
  chooseDirectory: vi.fn(),
  clearBinding: vi.fn(),
  queryPermission: vi.fn(),
  requestPermission: vi.fn(),
  readCurrent: vi.fn(),
  writeVerified: vi.fn(),
  loadSnapshot: vi.fn(),
  createEnvelope: vi.fn(),
}));

vi.mock("@/persistence/automaticBackup", () => {
  class ConflictError extends Error {
    readonly code = "external-current-change";
  }
  class VerificationError extends Error {}
  return {
    AUTOMATIC_BACKUP_DIRECTORY_NAME: "Sales Ledger Backups",
    AutomaticBackupConflictError: ConflictError,
    AutomaticBackupVerificationError: VerificationError,
    isAutomaticBackupSupported: vi.fn(() => mocks.supported),
    loadAutomaticBackupBinding: mocks.loadBinding,
    chooseAutomaticBackupDirectory: mocks.chooseDirectory,
    clearAutomaticBackupBinding: mocks.clearBinding,
    queryAutomaticBackupPermission: mocks.queryPermission,
    requestAutomaticBackupPermission: mocks.requestPermission,
    readCurrentBackup: mocks.readCurrent,
    writeVerifiedBackup: mocks.writeVerified,
  };
});

vi.mock("@/persistence/database", () => ({
  loadBackupSnapshot: mocks.loadSnapshot,
}));

vi.mock("@/lib/files", () => ({
  createBackupEnvelope: mocks.createEnvelope,
}));

const binding: AutomaticBackupBinding = {
  id: "primary",
  selectionId: "saved-folder",
  directoryHandle: { kind: "directory", name: "Private OneDrive" } as FileSystemDirectoryHandle,
  selectedFolderName: "Private OneDrive",
  connectedAt: "2026-08-31T15:00:00.000Z",
  lastSuccessfulAt: "2026-08-31T15:30:00.000Z",
  lastChecksum: "a".repeat(64),
};

const envelope = {
  format: "maxey-sales-command-center",
  schemaVersion: 2,
  appVersion: "test",
  exportedAt: "2026-08-31T16:00:00.000Z",
  timezone: "America/Detroit",
  checksum: "b".repeat(64),
  data: { profile: {}, sales: [], auditEvents: [] },
} as unknown as BackupEnvelope;

const event: AuditEvent = {
  id: 1,
  profileId: "primary",
  action: "sale.created",
  entityId: "sale-1",
  occurredAt: "2026-08-31T16:00:00.000Z",
  summary: "Added a sale.",
};

describe("automatic backup controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supported = true;
    mocks.loadBinding.mockResolvedValue(binding);
    mocks.queryPermission.mockResolvedValue("granted");
    mocks.requestPermission.mockResolvedValue("granted");
    mocks.loadSnapshot.mockResolvedValue({ settings: {}, sales: [], auditEvents: [] });
    mocks.createEnvelope.mockResolvedValue(envelope);
    mocks.writeVerified.mockResolvedValue({
      status: "written",
      checksum: envelope.checksum,
      lastSuccessfulAt: "2026-08-31T16:01:00.000Z",
      currentFileName: "Sales Ledger - Current Backup.json",
      recoveryFileName: "Sales Ledger Backup 2026-08-31.json",
      binding: {
        ...binding,
        lastChecksum: envelope.checksum,
        lastSuccessfulAt: "2026-08-31T16:01:00.000Z",
      },
    });
    mocks.clearBinding.mockResolvedValue(undefined);
  });

  it("shows the manual fallback without loading a saved folder in unsupported browsers", async () => {
    mocks.supported = false;
    const { result } = renderHook(() => useAutomaticBackup([]));

    await waitFor(() => expect(result.current.status).toBe("unsupported"));
    expect(result.current.message).toMatch(/Download full backup still works/);
    expect(mocks.loadBinding).not.toHaveBeenCalled();
  });

  it("checks and verifies a granted saved folder without prompting on load", async () => {
    const { result } = renderHook(() => useAutomaticBackup([event]));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.folderName).toBe("Private OneDrive / Sales Ledger Backups");
    expect(mocks.queryPermission).toHaveBeenCalledWith(binding);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.writeVerified).toHaveBeenCalledTimes(1);
  });

  it("never opens a permission prompt during startup", async () => {
    mocks.queryPermission.mockResolvedValue("prompt");
    const { result } = renderHook(() => useAutomaticBackup([]));

    await waitFor(() => expect(result.current.status).toBe("permission-needed"));
    expect(mocks.requestPermission).not.toHaveBeenCalled();
    expect(mocks.writeVerified).not.toHaveBeenCalled();
  });

  it("requests permission only from reconnect and resumes verified backups", async () => {
    mocks.queryPermission.mockResolvedValue("prompt");
    const { result } = renderHook(() => useAutomaticBackup([]));
    await waitFor(() => expect(result.current.status).toBe("permission-needed"));

    await act(async () => result.current.reconnect());

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
    expect(mocks.writeVerified).toHaveBeenCalledTimes(1);
    expect(result.current.announcement).toMatch(/Automatic backup saved/);
  });

  it("keeps browser data available when reconnect permission is denied", async () => {
    mocks.queryPermission.mockResolvedValue("prompt");
    mocks.requestPermission.mockResolvedValue("denied");
    const { result } = renderHook(() => useAutomaticBackup([]));
    await waitFor(() => expect(result.current.status).toBe("permission-needed"));

    await act(async () => result.current.reconnect());

    expect(result.current.status).toBe("permission-needed");
    expect(result.current.message).toMatch(/current data is still in this browser|did not allow/i);
    expect(mocks.writeVerified).not.toHaveBeenCalled();
  });

  it("turns off future backups without deleting folder files", async () => {
    const { result } = renderHook(() => useAutomaticBackup([]));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => result.current.turnOff());

    expect(mocks.clearBinding).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("not-configured");
    expect(result.current.announcement).toMatch(/files were not deleted/);
  });
});
