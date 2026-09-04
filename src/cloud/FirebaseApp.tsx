import { lazy, Suspense } from "react";
import { readFirebaseCloudConfig } from "./config";
import { CloudAuthGate } from "./CloudAuthGate";
import { CloudAccessGate } from "./CloudAccessGate";
import type { CloudWorkspaceSession } from "./CloudWorkspace";

const configuration = readFirebaseCloudConfig();
const CloudWorkspace = lazy(() => import("./CloudWorkspace"));

export default function FirebaseApp() {
  if (configuration.status !== "enabled") {
    return <main className="app-fatal" role="alert">
      <h1>Cloud setup is not complete</h1>
      <p>This private app has not been connected yet. No sales have been uploaded.</p>
      <p>Please ask the app owner to finish setup, then reload this page.</p>
    </main>;
  }
  return <CloudAuthGate config={configuration.config}>{(session) => <CloudAccessGate key={session.user.uid}
    firestore={session.firestore} uid={session.user.uid} email={session.user.email ?? "Your account"} signOut={session.signOut}>
    <Suspense fallback={<p role="status" className="app-fatal">Opening your cloud ledger…</p>}><CloudWorkspace session={session as CloudWorkspaceSession} /></Suspense>
  </CloudAccessGate>}</CloudAuthGate>;
}
