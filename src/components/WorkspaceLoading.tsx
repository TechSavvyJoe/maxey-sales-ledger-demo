import { useEffect, useId, useState } from "react";
import { LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./workspace-loading.css";

const RECOVERY_DELAY_MS = 10_000;

interface WorkspaceLoadingProps {
  isOnline: boolean;
  isCloud: boolean;
  onReload?: () => void;
}

/** Initial workspace opening only; never mount over a loaded, editable ledger. */
export function WorkspaceLoading({ isOnline, isCloud, onReload = () => window.location.reload() }: WorkspaceLoadingProps) {
  const [takingLonger, setTakingLonger] = useState(false);
  const titleId = useId();
  const offline = isCloud && !isOnline;

  useEffect(() => {
    const timeout = window.setTimeout(() => setTakingLonger(true), RECOVERY_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  const title = offline
    ? "Reconnect to open your workspace"
    : takingLonger ? "Your workspace is taking longer to open" : "Opening your sales workspace";
  const description = offline
    ? "Your cloud workspace needs an internet connection. Reconnect, then wait a moment or reload the app."
    : takingLonger
      ? "Your sales have not finished loading. You can keep waiting or reload the app to try again."
      : "Loading your sales and totals…";

  return (
    <main className="workspace-loading" aria-labelledby={titleId}>
      <div className="workspace-loading__content">
        <img className="workspace-loading__mark" src={`${import.meta.env.BASE_URL}brand/sales-ledger-mark.svg`} width="48" height="48" alt="" />
        <div className="workspace-loading__status" role="status" aria-live="polite" aria-atomic="true">
          <div className="workspace-loading__indicator" aria-hidden="true">
            {offline ? <WifiOff /> : <LoaderCircle className="workspace-loading__spinner" />}
          </div>
          <h1 id={titleId}>{title}</h1>
          <p>{description}</p>
        </div>
        {takingLonger ? (
          <Button className="workspace-loading__reload" type="button" onClick={onReload}>
            <RefreshCw aria-hidden="true" /> Reload app
          </Button>
        ) : null}
      </div>
    </main>
  );
}
