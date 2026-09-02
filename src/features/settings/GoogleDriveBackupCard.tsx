import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PreparedBackupFile } from "@/lib/files";

const GOOGLE_DRIVE_URL = "https://drive.google.com/drive/my-drive";

interface GoogleDriveBackupCardProps {
  disabled: boolean;
  onPrepareBackup: () => Promise<PreparedBackupFile | null>;
  onDownloadBackup: (prepared: PreparedBackupFile) => void;
}

export function GoogleDriveBackupCard({
  disabled,
  onPrepareBackup,
  onDownloadBackup,
}: GoogleDriveBackupCardProps) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [preparedBackup, setPreparedBackup] = useState<PreparedBackupFile | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const [downloadedFileName, setDownloadedFileName] = useState<string | null>(null);

  async function prepareAndOpen() {
    setInstructionsOpen(true);
    setPreparedBackup(null);
    setDownloadedFileName(null);
    setPreparationError(null);
    setIsPreparing(true);
    try {
      const prepared = await onPrepareBackup();
      if (prepared) setPreparedBackup(prepared);
    } catch (caught) {
      setPreparationError(caught instanceof Error ? caught.message : "Could not prepare the backup.");
    } finally {
      setIsPreparing(false);
    }
  }

  function handleDownload() {
    if (!preparedBackup) return;
    try {
      onDownloadBackup(preparedBackup);
      setDownloadedFileName(preparedBackup.fileName);
    } catch (caught) {
      setPreparationError(caught instanceof Error ? caught.message : "Could not start the backup download.");
    }
  }

  return (
    <>
      <section className="google-drive-card" aria-labelledby="google-drive-heading">
        <img
          className="google-drive-card__logo"
          src={`${import.meta.env.BASE_URL}brand/google-drive.png`}
          width="52"
          height="52"
          alt=""
        />
        <div className="google-drive-card__content">
          <div className="google-drive-card__heading">
            <h3 id="google-drive-heading">Google Drive backup</h3>
            <span>No account connection needed</span>
          </div>
          <p>
            Download a complete recovery copy, then open Google Drive to upload it. Google handles sign-in; Sales Ledger never receives the Google account or password.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          title="Save to Google Drive"
          onClick={() => void prepareAndOpen()}
        >
          <img src={`${import.meta.env.BASE_URL}brand/google-drive.png`} width="20" height="20" alt="" />
          Save to Google Drive
        </Button>
        {disabled ? (
          <p className="google-drive-card__notice">Save Settings first, then create the Google Drive copy.</p>
        ) : null}
      </section>

      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent className="google-drive-dialog">
          <DialogHeader>
            <DialogTitle>Save a recovery copy to Google Drive</DialogTitle>
            <DialogDescription>
              This uses Google Drive's normal website, so there is no dealership setup, Google developer account, or permission for Sales Ledger to browse your Drive.
            </DialogDescription>
          </DialogHeader>

          <ol className="google-drive-steps">
            <li><span>1</span><p><strong>Download the checked backup.</strong> The same button opens Google Drive in a new tab.</p></li>
            <li><span>2</span><p><strong>Sign in to Google</strong> if Google asks.</p></li>
            <li><span>3</span><p>In Google Drive, choose <strong>New → File upload</strong>, then select the downloaded JSON backup.</p></li>
          </ol>

          {isPreparing ? (
            <div className="google-drive-ready is-preparing" role="status">
              <LoaderCircle aria-hidden="true" className="is-spinning" />
              <span>
                <strong>Checking your backup…</strong>
                <small>Sales Ledger is validating the complete recovery file.</small>
              </span>
            </div>
          ) : preparationError ? (
            <div className="google-drive-ready is-error" role="alert">
              <AlertTriangle aria-hidden="true" />
              <span>
                <strong>Backup could not be prepared</strong>
                <small>{preparationError}</small>
              </span>
            </div>
          ) : downloadedFileName ? (
            <div className="google-drive-ready" role="status">
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Backup download started</strong>
                <small>Choose <code>{downloadedFileName}</code> in Google Drive.</small>
              </span>
            </div>
          ) : preparedBackup ? (
            <div className="google-drive-ready" role="status">
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>Backup checked and ready</strong>
                <small>{preparedBackup.fileName}</small>
              </span>
            </div>
          ) : (
            <p className="google-drive-boundary">
              This is a manual recovery copy, not automatic cloud sync. Keep it private because the file contains the complete tracker data.
            </p>
          )}

          <DialogFooter className="google-drive-dialog__footer">
            <Button type="button" variant="outline" onClick={() => setInstructionsOpen(false)}>
              Done
            </Button>
            {preparationError ? (
              <Button type="button" onClick={() => void prepareAndOpen()}>
                Try again
              </Button>
            ) : null}
            {preparedBackup ? <Button asChild>
              <a
                href={GOOGLE_DRIVE_URL}
                target="_blank"
                rel="noopener noreferrer"
                title="Save to Google Drive"
                onClick={handleDownload}
              >
                <img src={`${import.meta.env.BASE_URL}brand/google-drive.png`} width="20" height="20" alt="" />
                Download &amp; open Google Drive
                <ExternalLink aria-hidden="true" />
              </a>
            </Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
