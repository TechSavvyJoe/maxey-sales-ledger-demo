import { lazy, Suspense } from "react";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

// Keep this condition at the import boundary so the local/demo build can omit
// the Firebase SDK entirely. Invalid non-empty flags still fail closed at sign-in.
const CloudApp = import.meta.env.VITE_FIREBASE_ENABLED && import.meta.env.VITE_FIREBASE_ENABLED !== "false"
  ? lazy(() => import("./cloud/FirebaseApp"))
  : null;

function OpeningWorkspace() {
  return (
    <div className="app-loading" role="status">
      <img
        className="app-loading__mark"
        src={`${import.meta.env.BASE_URL}brand/sales-ledger-mark.svg`}
        width="48"
        height="48"
        alt=""
      />
      <strong>Opening your sales workspace</strong>
      <small>Loading your sales and totals…</small>
    </div>
  );
}

export default function Root() {
  return (
    <AppErrorBoundary>
      {CloudApp
        ? <Suspense fallback={<OpeningWorkspace />}><CloudApp /></Suspense>
        : <App />}
    </AppErrorBoundary>
  );
}
