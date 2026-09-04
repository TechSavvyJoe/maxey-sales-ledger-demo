import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuditEvent, BackupEnvelope } from "@/domain/types";
import type {
  AutomaticBackupController,
  AutomaticBackupUiStatus,
} from "@/hooks/automaticBackupTypes";
import { createBackupEnvelope } from "@/lib/files";
import {
  AutomaticBackupConflictError,
  AutomaticBackupVerificationError,
  AUTOMATIC_BACKUP_DIRECTORY_NAME,
  chooseAutomaticBackupDirectory,
  clearAutomaticBackupBinding,
  isAutomaticBackupSupported,
  loadAutomaticBackupBinding,
  queryAutomaticBackupPermission,
  readCurrentBackup,
  requestAutomaticBackupPermission,
  writeVerifiedBackup,
  type AutomaticBackupBinding,
} from "@/persistence/automaticBackup";
import { loadBackupSnapshot } from "@/persistence/database";

const BACKUP_LOCK_NAME = "maxey-sales-ledger-automatic-backup";
const BACKUP_DEBOUNCE_MS = 1_200;

interface AutomaticBackupViewState {
  status: AutomaticBackupUiStatus;
  folderName: string | null;
  lastSuccessfulAt: string | null;
  message: string | null;
  announcement: string;
}

const initialState: AutomaticBackupViewState = {
  status: "loading",
  folderName: null,
  lastSuccessfulAt: null,
  message: null,
  announcement: "",
};

function folderDisplayName(binding: AutomaticBackupBinding): string {
  return `${binding.selectedFolderName} / ${AUTOMATIC_BACKUP_DIRECTORY_NAME}`;
}

function errorName(error: unknown): string | null {
  if (error instanceof DOMException) return error.name;
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

function isPickerCancellation(error: unknown): boolean {
  return errorName(error) === "AbortError";
}

function stateForFailure(
  error: unknown,
  binding: AutomaticBackupBinding | null,
): Pick<AutomaticBackupViewState, "status" | "folderName" | "lastSuccessfulAt" | "message"> {
  const base = {
    folderName: binding ? folderDisplayName(binding) : null,
    lastSuccessfulAt: binding?.lastSuccessfulAt ?? null,
  };
  if (error instanceof AutomaticBackupConflictError) {
    return {
      ...base,
      status: "conflict",
      message: error.code === "invalid-current-backup" || error.code === "invalid-recovery-backup"
        ? "The existing backup could not be checked, so Sales Ledger did not replace it. Review the folder backup or choose another folder."
        : "The folder backup changed outside this browser. Sales Ledger did not overwrite it. Review that copy before continuing.",
    };
  }
  const name = errorName(error);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      ...base,
      status: "error",
      message: "This browser blocked folder access. Automatic folder backups are unavailable right now. Use Download full backup.",
    };
  }
  if (name === "NotFoundError") {
    return {
      ...base,
      status: "error",
      message: "That backup folder is no longer available. Choose another folder.",
    };
  }
  if (name === "QuotaExceededError") {
    return {
      ...base,
      status: "error",
      message: "The backup file could not be saved. Check that the folder is available and has space, then try again.",
    };
  }
  if (error instanceof AutomaticBackupVerificationError) {
    return {
      ...base,
      status: "error",
      message: "The backup file could not be saved and checked safely. Your current data is still in this browser.",
    };
  }
  return {
    ...base,
    status: "error",
    message: error instanceof Error
      ? error.message
      : "The backup file could not be saved. Your current data is still in this browser.",
  };
}

async function withCrossTabBackupLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) return operation();
  return navigator.locks.request(BACKUP_LOCK_NAME, { mode: "exclusive" }, operation);
}

export function useAutomaticBackup(auditEvents: AuditEvent[], enabled = true): AutomaticBackupController {
  const [viewState, setViewState] = useState<AutomaticBackupViewState>(initialState);
  const bindingRef = useRef<AutomaticBackupBinding | null>(null);
  const pendingCandidateRef = useRef<AutomaticBackupBinding | null>(null);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);
  const latestChangeMarker = useMemo(() => {
    const latest = auditEvents[0];
    return latest
      ? `${latest.id ?? "local"}:${latest.occurredAt}:${latest.action}:${latest.entityId ?? ""}`
      : "empty-workspace";
  }, [auditEvents]);
  const previousChangeMarkerRef = useRef(latestChangeMarker);

  const setIfMounted = useCallback((state: AutomaticBackupViewState) => {
    if (mountedRef.current) setViewState(state);
  }, []);

  const runBackup = useCallback(async (
    binding: AutomaticBackupBinding,
    options: { userInitiated: boolean; replaceExistingBindingOnSuccess?: boolean },
  ) => {
    setIfMounted({
      status: "saving",
      folderName: folderDisplayName(binding),
      lastSuccessfulAt: binding.lastSuccessfulAt,
      message: "Creating and checking the recovery copy…",
      announcement: options.userInitiated ? "Backing up now." : "",
    });
    try {
      const snapshot = await loadBackupSnapshot();
      const envelope = await createBackupEnvelope(
        snapshot.settings,
        snapshot.sales,
        snapshot.auditEvents,
      );
      const result = await withCrossTabBackupLock(() => writeVerifiedBackup(binding, envelope, {
        replaceExistingBindingOnSuccess: options.replaceExistingBindingOnSuccess,
      }));
      bindingRef.current = result.binding;
      pendingCandidateRef.current = null;
      const successMessage = result.status === "unchanged"
        ? "The selected folder already has the latest verified recovery copy."
        : "Saved after completed changes while Sales Ledger is open.";
      setIfMounted({
        status: "ready",
        folderName: folderDisplayName(result.binding),
        lastSuccessfulAt: result.binding.lastSuccessfulAt,
        message: successMessage,
        announcement: options.userInitiated
          ? `Automatic backup saved at ${new Date(result.lastSuccessfulAt).toLocaleString("en-US")}.`
          : "",
      });
    } catch (error) {
      const target = pendingCandidateRef.current ?? bindingRef.current ?? binding;
      const failed = stateForFailure(error, target);
      setIfMounted({
        ...failed,
        announcement: options.userInitiated ? failed.message ?? "Automatic backup failed." : "",
      });
      throw error;
    }
  }, [setIfMounted]);

  const chooseFolder = useCallback(async () => {
    try {
      const candidate = await chooseAutomaticBackupDirectory();
      pendingCandidateRef.current = candidate;
      let permission = await queryAutomaticBackupPermission(candidate);
      if (permission === "prompt") {
        permission = await requestAutomaticBackupPermission(candidate);
      }
      if (permission !== "granted") {
        setIfMounted({
          status: "permission-needed",
          folderName: folderDisplayName(candidate),
          lastSuccessfulAt: null,
          message: "Edge did not allow Sales Ledger to use that folder. Choose Reconnect folder and select Allow.",
          announcement: "The backup folder needs permission.",
        });
        return;
      }
      await runBackup(candidate, {
        userInitiated: true,
        replaceExistingBindingOnSuccess: true,
      });
    } catch (error) {
      if (isPickerCancellation(error)) {
        pendingCandidateRef.current = null;
        const current = bindingRef.current;
        setIfMounted(current ? {
          status: "ready",
          folderName: folderDisplayName(current),
          lastSuccessfulAt: current.lastSuccessfulAt,
          message: "Automatic backups remain on in the current folder.",
          announcement: "Folder selection canceled. Automatic backups were not changed.",
        } : {
          status: "not-configured",
          folderName: null,
          lastSuccessfulAt: null,
          message: null,
          announcement: "Folder selection canceled. Automatic backups were not changed.",
        });
        return;
      }
      if (error instanceof AutomaticBackupConflictError || error instanceof AutomaticBackupVerificationError) return;
      const target = pendingCandidateRef.current ?? bindingRef.current;
      const failed = stateForFailure(error, target);
      setIfMounted({ ...failed, announcement: failed.message ?? "Automatic backup failed." });
    }
  }, [runBackup, setIfMounted]);

  const reconnect = useCallback(async () => {
    const target = pendingCandidateRef.current ?? bindingRef.current;
    if (!target) {
      await chooseFolder();
      return;
    }
    try {
      const permission = await requestAutomaticBackupPermission(target);
      if (permission !== "granted") {
        setIfMounted({
          status: "permission-needed",
          folderName: folderDisplayName(target),
          lastSuccessfulAt: target.lastSuccessfulAt,
          message: "Edge did not allow Sales Ledger to use that folder. Choose Reconnect folder and select Allow.",
          announcement: "The backup folder still needs permission.",
        });
        return;
      }
      await runBackup(target, {
        userInitiated: true,
        replaceExistingBindingOnSuccess: pendingCandidateRef.current !== null,
      });
    } catch (error) {
      if (error instanceof AutomaticBackupConflictError || error instanceof AutomaticBackupVerificationError) return;
      const failed = stateForFailure(error, target);
      setIfMounted({ ...failed, announcement: failed.message ?? "Automatic backup failed." });
    }
  }, [chooseFolder, runBackup, setIfMounted]);

  const backupNow = useCallback(async () => {
    const target = pendingCandidateRef.current ?? bindingRef.current;
    if (!target) {
      await chooseFolder();
      return;
    }
    try {
      let permission = await queryAutomaticBackupPermission(target);
      if (permission === "prompt") permission = await requestAutomaticBackupPermission(target);
      if (permission !== "granted") {
        setIfMounted({
          status: "permission-needed",
          folderName: folderDisplayName(target),
          lastSuccessfulAt: target.lastSuccessfulAt,
          message: "Your current data is still in this browser. Reconnect the folder to continue automatic backups.",
          announcement: "The backup folder needs permission.",
        });
        return;
      }
      await runBackup(target, {
        userInitiated: true,
        replaceExistingBindingOnSuccess: pendingCandidateRef.current !== null,
      });
    } catch (error) {
      if (error instanceof AutomaticBackupConflictError || error instanceof AutomaticBackupVerificationError) return;
      const failed = stateForFailure(error, target);
      setIfMounted({ ...failed, announcement: failed.message ?? "Automatic backup failed." });
    }
  }, [chooseFolder, runBackup, setIfMounted]);

  const turnOff = useCallback(async () => {
    await clearAutomaticBackupBinding();
    bindingRef.current = null;
    pendingCandidateRef.current = null;
    setIfMounted({
      status: "not-configured",
      folderName: null,
      lastSuccessfulAt: null,
      message: null,
      announcement: "Automatic backups turned off. Existing folder files were not deleted.",
    });
  }, [setIfMounted]);

  const readLatestBackup = useCallback(async (): Promise<BackupEnvelope> => {
    const target = pendingCandidateRef.current ?? bindingRef.current;
    if (!target) throw new Error("Choose an automatic backup folder first.");
    let permission = await queryAutomaticBackupPermission(target);
    if (permission === "prompt") permission = await requestAutomaticBackupPermission(target);
    if (permission !== "granted") {
      throw new Error("Allow access to the backup folder before reviewing its recovery copy.");
    }
    const backup = await readCurrentBackup(target);
    if (!backup) throw new Error("No current folder backup was found.");
    return backup.envelope;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    mountedRef.current = true;
    if (initializedRef.current) return () => { mountedRef.current = false; };
    initializedRef.current = true;
    void (async () => {
      if (!isAutomaticBackupSupported()) {
        setIfMounted({
          status: "unsupported",
          folderName: null,
          lastSuccessfulAt: null,
          message: "Automatic backup folders need desktop Microsoft Edge or Chrome. Download full backup still works.",
          announcement: "",
        });
        return;
      }
      try {
        const binding = await loadAutomaticBackupBinding();
        bindingRef.current = binding;
        if (!binding) {
          setIfMounted({
            status: "not-configured",
            folderName: null,
            lastSuccessfulAt: null,
            message: null,
            announcement: "",
          });
          return;
        }
        const permission = await queryAutomaticBackupPermission(binding);
        if (permission !== "granted") {
          setIfMounted({
            status: "permission-needed",
            folderName: folderDisplayName(binding),
            lastSuccessfulAt: binding.lastSuccessfulAt,
            message: "Your current data is still in this browser. Reconnect the folder to continue automatic backups.",
            announcement: "",
          });
          return;
        }
        await runBackup(binding, { userInitiated: false });
      } catch (error) {
        const failed = stateForFailure(error, bindingRef.current);
        setIfMounted({ ...failed, announcement: "" });
      }
    })();
    return () => { mountedRef.current = false; };
  }, [enabled, runBackup, setIfMounted]);

  useEffect(() => {
    if (!enabled) return;
    if (previousChangeMarkerRef.current === latestChangeMarker) return;
    previousChangeMarkerRef.current = latestChangeMarker;
    const timeout = window.setTimeout(() => {
      const binding = bindingRef.current;
      if (!binding || pendingCandidateRef.current) return;
      void queryAutomaticBackupPermission(binding).then((permission) => {
        if (permission === "granted") {
          return runBackup(binding, { userInitiated: false }).catch(() => undefined);
        }
        setIfMounted({
          status: "permission-needed",
          folderName: folderDisplayName(binding),
          lastSuccessfulAt: binding.lastSuccessfulAt,
          message: "Your current data is still in this browser. Reconnect the folder to continue automatic backups.",
          announcement: "",
        });
        return undefined;
      }).catch((error: unknown) => {
        const failed = stateForFailure(error, binding);
        setIfMounted({ ...failed, announcement: "" });
      });
    }, BACKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [enabled, latestChangeMarker, runBackup, setIfMounted]);

  return {
    ...viewState,
    chooseFolder,
    reconnect,
    backupNow,
    turnOff,
    readLatestBackup,
  };
}
