import { useCallback, useEffect, useState, type ReactNode } from "react";
import { doc, getDocFromServer, onSnapshot, setDoc, type Firestore, type Unsubscribe } from "firebase/firestore";
import { CloudOff, LoaderCircle, LockKeyhole, LogOut } from "lucide-react";
import { AuthFrame } from "./CloudAuthGate";

type AccessState = "checking" | "approved" | "unavailable" | "error";

function isEnabled(snapshot: { exists: () => boolean; data: () => unknown }): boolean {
  const profile = snapshot.data();
  return snapshot.exists() && typeof profile === "object" && profile !== null
    && "enabled" in profile && profile.enabled === true;
}

/**
 * A sales person's cloud data is private to their Firebase UID. The enrollment
 * record gives the rules a stable, server-acknowledged ownership boundary
 * without making somebody maintain a per-person approval list.
 */
export function CloudAccessGate({ firestore, uid, email, signOut, children }: {
  firestore: Firestore; uid: string; email: string; signOut: () => Promise<void>; children?: ReactNode;
}) {
  const [permission, setPermission] = useState<{ uid: string; firestore: Firestore; status: AccessState }>(() => ({
    uid, firestore, status: typeof navigator !== "undefined" && !navigator.onLine ? "error" : "checking",
  }));
  const access = permission.uid === uid && permission.firestore === firestore ? permission.status : "checking";
  const setAccess = useCallback((status: AccessState) => setPermission({ uid, firestore, status }), [uid, firestore]);
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  useEffect(() => {
    let active = true;
    let unsubscribe: Unsubscribe = () => undefined;
    const profileRef = doc(firestore, "pilotUsers", uid);

    async function openWorkspace() {
      setAccess("checking");
      try {
        if (!navigator.onLine) throw new Error("offline");
        let profile = await getDocFromServer(profileRef);
        if (!profile.exists()) {
          try {
            await setDoc(profileRef, { uid, enabled: true, createdAt: new Date().toISOString() });
          } catch (caught) {
            // Two tabs can finish sign-in together. A second create is denied
            // once the first server write wins, so confirm before surfacing it.
            profile = await getDocFromServer(profileRef);
            if (!profile.exists()) throw caught;
          }
          profile = await getDocFromServer(profileRef);
        }
        if (!active) return;
        setAccess(isEnabled(profile) ? "approved" : "unavailable");
        if (!isEnabled(profile)) return;
        unsubscribe = onSnapshot(profileRef, { includeMetadataChanges: true }, (snapshot) => {
          if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
          setAccess(isEnabled(snapshot) ? "approved" : "unavailable");
        }, () => {
          // A connection interruption must not throw the user out of an open
          // ledger. The cloud-status bar will explain that saves need a retry.
        });
      } catch {
        if (active) setAccess("error");
      }
    }
    void openWorkspace();
    return () => { active = false; unsubscribe(); };
  }, [firestore, uid, attempt, setAccess]);

  async function leave() {
    setSigningOut(true); setSignOutError(false);
    try { await signOut(); }
    catch { setSignOutError(true); }
    finally { setSigningOut(false); }
  }

  if (access === "approved") return children;
  return <AuthFrame>
    <div className="cloud-auth__access-icon" aria-hidden="true">
      {access === "checking" ? <LoaderCircle /> : access === "error" ? <CloudOff /> : <LockKeyhole />}
    </div>
    <h1 id="cloud-auth-title">{access === "checking" ? "Preparing your workspace" : access === "error" ? "Let’s reconnect" : "This workspace is unavailable"}</h1>
    <p role="status">{access === "checking" ? "Setting up your private cloud ledger. This usually takes a moment." : access === "error"
      ? "We couldn’t check your access. Check your internet connection and try again."
      : "This account cannot open its cloud ledger right now. Use a different account or contact the person who shared Sales Ledger."}</p>
    <p className="cloud-auth__account-email">{email}</p>
    {access === "error" && <button type="button" className="cloud-auth__button" onClick={() => { setAccess("checking"); setAttempt((value) => value + 1); }}>Try again</button>}
    <button type="button" className="cloud-auth__text-button" disabled={signingOut} onClick={() => void leave()}><LogOut size={16} aria-hidden="true" /> {signingOut ? "Signing out…" : "Use a different account"}</button>
    {signOutError && <p role="alert" className="cloud-auth__error">Sign-out could not finish. Close this tab on a shared computer, then reopen Sales Ledger.</p>}
  </AuthFrame>;
}
