import { useEffect, useRef, useState } from "react";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { captureStorageContext, loadBackupSnapshot } from "@/persistence/database";
import { exportWorkspaceData, type WorkspaceExportFormat } from "@/lib/workspaceExport";
import "./workspace-export.css";

export function WorkspaceExportCard({ waitingForSave }: { waitingForSave: boolean }) {
  const [preparing, setPreparing] = useState<WorkspaceExportFormat | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const request = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { request.current += 1; }, []);

  async function download(format: WorkspaceExportFormat) {
    if (waitingForSave || busy.current) return;
    const generation = ++request.current;
    const assertAccount = captureStorageContext();
    busy.current = true;
    setPreparing(format);
    setError("");
    setResult("");
    try {
      await exportWorkspaceData({
        format,
        loadSnapshot: loadBackupSnapshot,
        assertCurrent: () => {
          assertAccount();
          if (generation !== request.current) throw new Error("Download canceled.");
        },
      });
      if (generation === request.current) setResult(`${format === "excel" ? "Excel report" : "Data file"} download started. Check your Downloads folder and open the file to confirm it saved.`);
    } catch (caught) {
      if (generation === request.current) setError(caught instanceof Error ? caught.message : "Your file could not be prepared. Please try again. Your saved sales have not changed.");
    } finally {
      if (generation === request.current) {
        busy.current = false;
        setPreparing(null);
      }
    }
  }

  function cancel() {
    request.current += 1;
    busy.current = false;
    setPreparing(null);
    setResult("Download canceled. Your saved sales have not changed.");
  }

  return <section className="workspace-export" aria-labelledby="workspace-export-title">
    <header className="workspace-export__heading">
      <Download aria-hidden="true" />
      <div>
        <h3 id="workspace-export-title">Download all your data</h3>
        <p>Every saved month and year, not just the period on screen. Keep a copy you can use without Sales Ledger.</p>
      </div>
    </header>
    <div className="workspace-export__options">
      <div className="workspace-export__option">
        <FileSpreadsheet aria-hidden="true" />
        <div>
          <h4>Complete Excel report</h4>
          <p>Customer last names, vehicles, stock numbers, notes, sales, F&I, commissions, milestones, goals, schedules, and reporting across your full history.</p>
          <Button variant="outline" disabled={waitingForSave || Boolean(preparing)} onClick={() => void download("excel")}>Download Excel report</Button>
        </div>
      </div>
      <div className="workspace-export__option">
        <FileJson aria-hidden="true" />
        <div>
          <h4>Complete data file</h4>
          <p>Your saved records, including deleted sales, settings, pay plans, and activity, in an open JSON format for migration or recovery support.</p>
          <Button variant="outline" disabled={waitingForSave || Boolean(preparing)} onClick={() => void download("data")}>Download data file</Button>
        </div>
      </div>
    </div>
    <p className="workspace-export__note">These are copies of saved data at download time. Excel works offline; it does not include cloud syncing or the app’s editing workflow. Unfinished drafts and earlier versions of edited sales are not included. Files include your customer last names—store them securely.</p>
    {waitingForSave ? <p className="workspace-export__notice" role="status">Finish any incomplete settings and wait for saving to finish before downloading.</p> : null}
    <div role="status" aria-live="polite" aria-atomic="true" className="workspace-export__status">
      {preparing ? `Preparing your ${preparing === "excel" ? "complete Excel report" : "data file"}… Larger histories may take a moment.` : result}
    </div>
    {preparing ? <Button variant="ghost" onClick={cancel}>Cancel download</Button> : null}
    {error ? <p className="workspace-export__error" role="alert">{error}</p> : null}
  </section>;
}
