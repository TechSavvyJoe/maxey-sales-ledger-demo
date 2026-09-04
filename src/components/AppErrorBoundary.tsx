import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { isStaleModuleError } from "./appErrorRecovery";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, details: ErrorInfo) {
    if (import.meta.env.DEV) console.error("Sales Ledger render failed", error, details);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const updated = isStaleModuleError(this.state.error);
    return (
      <main className="app-fatal app-recovery" role="alert" aria-labelledby="app-recovery-title">
        <span className="app-recovery__icon" aria-hidden="true"><AlertTriangle /></span>
        <p className="app-recovery__eyebrow">Sales Ledger</p>
        <h1 id="app-recovery-title">{updated ? "A new version is ready" : "Sales Ledger needs to reload"}</h1>
        <p>{updated
          ? "This open tab was using an older page file. Reload to continue with the latest version."
          : "The page could not finish opening. Reload the app to start with a clean screen."}</p>
        <button className="app-recovery__button" type="button" onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden="true" /> Reload Sales Ledger
        </button>
        <small>Your saved sales remain in place. An unfinished sale draft may reopen after the reload.</small>
      </main>
    );
  }
}
