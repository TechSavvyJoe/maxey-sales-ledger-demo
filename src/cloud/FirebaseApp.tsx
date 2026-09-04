import { useEffect, useMemo, useSyncExternalStore } from "react";
import App from "@/App";
import { activateCloudRepository, getCloudStorageState, subscribeCloudStorageState } from "@/persistence/database";
import { readFirebaseCloudConfig } from "./config";
import { CloudAuthGate } from "./CloudAuthGate";
import { CloudAccessGate } from "./CloudAccessGate";
import { createFirebaseRepository } from "./firebaseRepository";
import type { Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";

const configuration = readFirebaseCloudConfig();

function CloudWorkspace({ session }: { session: { user: User; firestore: Firestore; signOut: () => Promise<void> } }) {
  const repository = useMemo(() => createFirebaseRepository(session.firestore, session.user.uid), [session.firestore, session.user.uid]);
  const activeAccount = useSyncExternalStore(subscribeCloudStorageState, getCloudStorageState);
  useEffect(() => {
    const deactivate = activateCloudRepository(repository, { uid: session.user.uid, email: session.user.email ?? "Signed-in account" });
    return deactivate;
  }, [repository, session.user.uid, session.user.email]);
  if (activeAccount?.uid !== session.user.uid) return <p role="status" className="app-fatal">Opening your cloud ledger…</p>;
  return <App cloudAccount={{ email: session.user.email ?? "Signed-in account", onSignOut: session.signOut }} />;
}

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
    <CloudWorkspace session={session} />
  </CloudAccessGate>}</CloudAuthGate>;
}
