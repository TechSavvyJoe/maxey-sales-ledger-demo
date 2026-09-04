import { useCallback, useEffect, useState, type ReactNode } from "react";
import { doc, onSnapshot, type Firestore } from "firebase/firestore";
import { CloudOff, LoaderCircle, LockKeyhole, LogOut } from "lucide-react";
import { AuthFrame } from "./CloudAuthGate";

type AccessState = "checking" | "approved" | "waiting" | "error";

/** Admission is checked before mounting the ledger, not presented as data loss. */
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
    const offline = () => setPermission((current) => current.uid === uid && current.firestore === firestore
      && current.status === "approved" ? current : { uid, firestore, status: "error" });
    window.addEventListener("offline", offline);
    const unsubscribe = onSnapshot(doc(firestore, "pilotUsers", uid), { includeMetadataChanges: true }, (snapshot) => {
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      setAccess(snapshot.exists() && snapshot.data().enabled === true ? "approved" : "waiting");
    }, () => { if (active) setAccess("error"); });
    return () => { active = false; unsubscribe(); window.removeEventListener("offline", offline); };
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
    <h1 id="cloud-auth-title">{access === "checking" ? "Opening your workspace" : access === "error" ? "Let’s reconnect" : "You’re signed in"}</h1>
    <p role="status">{access === "checking" ? "Checking your account access…" : access === "error"
      ? "We couldn’t check your access. Check your internet connection and try again."
      : "Your account is waiting for access to Sales Ledger. Ask the person who shared this app to approve you. This page will open your workspace automatically when it’s ready."}</p>
    <p className="cloud-auth__account-email">{email}</p>
    {access === "error" && <button type="button" className="cloud-auth__button" onClick={() => { setAccess("checking"); setAttempt((value) => value + 1); }}>Try again</button>}
    <button type="button" className="cloud-auth__text-button" disabled={signingOut} onClick={() => void leave()}><LogOut size={16} aria-hidden="true" /> {signingOut ? "Signing out…" : "Use a different account"}</button>
    {signOutError && <p role="alert" className="cloud-auth__error">Sign-out could not finish. Close this tab on a shared computer, then reopen Sales Ledger.</p>}
  </AuthFrame>;
}
