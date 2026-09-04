import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Firestore } from "firebase/firestore";
import type { User } from "firebase/auth";
import App from "@/App";
import { activateCloudRepository, getCloudStorageState, subscribeCloudStorageState } from "@/persistence/database";
import { createFirebaseRepository } from "./firebaseRepository";

export interface CloudWorkspaceSession {
  user: User;
  firestore: Firestore;
  signOut: () => Promise<void>;
}

/**
 * Loaded only after authentication. Keeping the ledger separate from the
 * sign-in route gives a returning salesperson a lighter, faster first screen.
 */
export default function CloudWorkspace({ session }: { session: CloudWorkspaceSession }) {
  const repository = useMemo(() => createFirebaseRepository(session.firestore, session.user.uid), [session.firestore, session.user.uid]);
  const activeAccount = useSyncExternalStore(subscribeCloudStorageState, getCloudStorageState);

  useEffect(() => {
    const deactivate = activateCloudRepository(repository, { uid: session.user.uid, email: session.user.email ?? "Signed-in account" });
    return deactivate;
  }, [repository, session.user.uid, session.user.email]);

  if (activeAccount?.uid !== session.user.uid) return <p role="status" className="app-fatal">Opening your cloud ledger…</p>;
  return <App cloudAccount={{ email: session.user.email ?? "Signed-in account", onSignOut: session.signOut }} />;
}
