import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  FolderArchive,
  FolderOpen,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  AutomaticBackupController,
  AutomaticBackupUiStatus,
} from "@/hooks/automaticBackupTypes";
import { cn } from "@/lib/utils";

export type { AutomaticBackupController } from "@/hooks/automaticBackupTypes";

interface AutomaticBackupCardProps {
  controller: AutomaticBackupController;
  onReviewBackup: () => Promise<void>;
}

function statusCopy(status: AutomaticBackupUiStatus): { label: string; tone: string } {
  switch (status) {
    case "loading":
      return { label: "Checking backup folder…", tone: "is-neutral" };
    case "unsupported":
      return { label: "Not available in this browser", tone: "is-neutral" };
    case "not-configured":
      return { label: "Not set up", tone: "is-neutral" };
    case "permission-needed":
      return { label: "Backup folder needs permission", tone: "is-warning" };
    case "ready":
      return { label: "Automatic backups on", tone: "is-success" };
    case "saving":
      return { label: "Backing up…", tone: "is-success" };
    case "conflict":
      return { label: "Folder backup needs review", tone: "is-warning" };
    case "error":
      return { label: "Automatic backup needs attention", tone: "is-danger" };
  }
}

function StatusIcon({ status }: { status: AutomaticBackupUiStatus }) {
  if (status === "ready" || status === "saving") return <CheckCircle2 aria-hidden="true" />;
  if (status === "unsupported") return <CloudOff aria-hidden="true" />;
  if (status === "permission-needed" || status === "conflict" || status === "error") {
    return <AlertTriangle aria-hidden="true" />;
  }
  return <FolderArchive aria-hidden="true" />;
}

export function AutomaticBackupCard({ controller, onReviewBackup }: AutomaticBackupCardProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const [turnOffOpen, setTurnOffOpen] = useState(false);
  const status = statusCopy(controller.status);
  const isBusy = controller.status === "loading" || controller.status === "saving";
  const hasFolder = Boolean(controller.folderName);
  const formattedLastBackup = controller.lastSuccessfulAt
    ? new Date(controller.lastSuccessfulAt).toLocaleString("en-US")
    : "No verified recovery copy yet";

  async function turnOff() {
    await controller.turnOff();
    setTurnOffOpen(false);
    setManageOpen(false);
  }

  return (
    <>
      <section
        className={cn("automatic-backup-card", status.tone)}
        aria-labelledby="automatic-backup-heading"
        aria-busy={isBusy}
      >
        <span className="automatic-backup-card__icon"><StatusIcon status={controller.status} /></span>
        <div className="automatic-backup-card__content">
          <div className="automatic-backup-card__heading">
            <h3 id="automatic-backup-heading">Automatic backup folder</h3>
            <span className={cn("automatic-backup-status", status.tone)}>{status.label}</span>
          </div>
          <p>Keep recovery copies in a folder you choose. No Sales Ledger sign-in or installation.</p>
          <strong className="automatic-backup-boundary">Recovery copies only — not live sync</strong>
          {hasFolder ? (
            <dl className="automatic-backup-meta">
              <div><dt>Folder</dt><dd>{controller.folderName}</dd></div>
              <div><dt>Last successful backup</dt><dd>{formattedLastBackup}</dd></div>
            </dl>
          ) : null}
          {controller.message ? (
            <p className={cn("automatic-backup-message", (controller.status === "error" || controller.status === "conflict") && "is-error") }>
              {controller.message}
            </p>
          ) : controller.status === "not-configured" ? (
            <p className="automatic-backup-message">
              Choose Documents, OneDrive, or a Google Drive folder already visible on this computer. Sales Ledger creates a <strong>Sales Ledger Backups</strong> folder there.
            </p>
          ) : controller.status === "ready" ? (
            <p className="automatic-backup-message">Saved after each completed change while this page is open.</p>
          ) : null}
        </div>
        <div className="automatic-backup-card__actions">
          {controller.status === "not-configured" ? (
            <Button type="button" onClick={() => void controller.chooseFolder()}>
              <FolderOpen aria-hidden="true" /> Choose backup folder
            </Button>
          ) : null}
          {controller.status === "permission-needed" ? (
            <>
              <Button type="button" onClick={() => void controller.reconnect()}>
                <RefreshCw aria-hidden="true" /> Reconnect folder
              </Button>
              <Button type="button" variant="outline" onClick={() => void controller.chooseFolder()}>
                Choose another
              </Button>
            </>
          ) : null}
          {controller.status === "ready" || controller.status === "saving" ? (
            <>
              <Button type="button" variant="outline" disabled={isBusy} onClick={() => void controller.backupNow()}>
                <RefreshCw aria-hidden="true" /> {isBusy ? "Backing up…" : "Back up now"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setManageOpen(true)}>
                <Settings2 aria-hidden="true" /> Folder options
              </Button>
            </>
          ) : null}
          {controller.status === "conflict" ? (
            <>
              <Button type="button" onClick={() => void onReviewBackup()}>
                Review folder backup
              </Button>
              <Button type="button" variant="outline" onClick={() => setManageOpen(true)}>
                Folder options
              </Button>
            </>
          ) : null}
          {controller.status === "error" && hasFolder ? (
            <>
              <Button type="button" onClick={() => void controller.backupNow()}>
                Try backup again
              </Button>
              <Button type="button" variant="outline" onClick={() => setManageOpen(true)}>
                Folder options
              </Button>
            </>
          ) : null}
        </div>
        {controller.status === "not-configured" ? (
          <p className="automatic-backup-privacy">
            Full backups contain customer last names, gross and commission values, days off, deleted records, settings, and activity. Choose a private folder—not a shared Teams or department folder.
          </p>
        ) : null}
        <p className="sr-only" aria-live="polite" aria-atomic="true">{controller.announcement}</p>
      </section>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="automatic-backup-dialog">
          <DialogHeader>
            <DialogTitle>Automatic backup folder</DialogTitle>
            <DialogDescription>
              Recovery copies are written after saved changes while Sales Ledger is open. Changes from another computer do not automatically appear here.
            </DialogDescription>
          </DialogHeader>
          <div className="automatic-backup-dialog__details">
            <div><span>Folder</span><strong>{controller.folderName ?? "Not selected"}</strong></div>
            <div><span>Last successful backup</span><strong>{formattedLastBackup}</strong></div>
            <p>
              If OneDrive or Google Drive is already visible in File Explorer or Finder, choose a private folder inside it. The sync service—not Sales Ledger—handles any upload, and Sales Ledger cannot confirm that the file reached the cloud.
            </p>
          </div>
          <div className="automatic-backup-dialog__actions">
            <Button type="button" variant="outline" onClick={() => void onReviewBackup()}>
              Review folder backup
            </Button>
            <Button type="button" variant="outline" onClick={() => void controller.chooseFolder()}>
              <FolderOpen aria-hidden="true" /> Change folder
            </Button>
            <Button type="button" variant="outline" onClick={() => setTurnOffOpen(true)}>
              <Trash2 aria-hidden="true" /> Turn off automatic backups
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setManageOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={turnOffOpen} onOpenChange={setTurnOffOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn off automatic backups?</DialogTitle>
            <DialogDescription>
              Your sales will remain in this browser. Existing backup files stay in the folder, but new recovery copies will stop.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTurnOffOpen(false)}>Keep backups on</Button>
            <Button type="button" variant="destructive" onClick={() => void turnOff()}>Turn off</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
