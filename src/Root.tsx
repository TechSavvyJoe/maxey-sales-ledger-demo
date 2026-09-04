import { lazy, Suspense } from "react";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

// Keep this condition at the import boundary so the local/demo build can omit
// the Firebase SDK entirely. Invalid non-empty flags still fail closed at sign-in.
const CloudApp = import.meta.env.VITE_FIREBASE_ENABLED && import.meta.env.VITE_FIREBASE_ENABLED !== "false"
  ? lazy(() => import("./cloud/FirebaseApp"))
  : null;

export default function Root() {
  return (
    <AppErrorBoundary>
      {CloudApp
        ? <Suspense fallback={<p role="status">Opening Sales Ledger…</p>}><CloudApp /></Suspense>
        : <App />}
    </AppErrorBoundary>
  );
}
