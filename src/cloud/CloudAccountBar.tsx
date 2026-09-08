import { useState, useSyncExternalStore } from "react";
import { Cloud, CloudOff, LoaderCircle, LogOut } from "lucide-react";
import { getCloudStorageState, subscribeCloudStorageState } from "@/persistence/database";
import "./cloud-account.css";

export interface CloudAccount {
  email: string;
  onSignOut: () => Promise<void>;
}

export function CloudAccountBar({ account, isOnline }: { account: CloudAccount; isOnline: boolean }) {
  const storage = useSyncExternalStore(subscribeCloudStorageState, getCloudStorageState);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const pending = (storage?.pending ?? 0) > 0;
  const needsAttention = !isOnline || Boolean(storage?.connectionError || storage?.error);
  // A queued draft or another in-flight save must not conceal an offline or
  // failed-save warning. Only an acknowledged write can report a saved time.
  const message = !isOnline ? "Offline — reconnect to save" : storage?.connectionError ? "Cloud connection needs attention" : storage?.error ? "Last save needs attention" : pending ? "Saving securely…" : storage?.lastSavedAt
    ? `Saved securely at ${new Date(storage.lastSavedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Private cloud workspace ready";
  const recovery = !isOnline
    ? "Keep this tab open and reconnect before closing or refreshing. Offline changes have not been saved to the cloud."
    : storage?.connectionError
      ? "Your latest records could not be refreshed. Keep any editor open and check your connection. Your saved records have not been changed."
      : storage?.error
        ? "A change could not be confirmed saved. Review the message for the action you tried. Keep any editor open until resolved."
        : null;
  async function signOut() {
    setSigningOut(true);
    setError("");
    try { await account.onSignOut(); }
    catch { setError("Sign-out did not finish. Please try again."); }
    finally { setSigningOut(false); }
  }
  return <section className={`cloud-account-bar${pending ? " cloud-account-bar--saving" : ""}${needsAttention ? " cloud-account-bar--attention" : ""}`} aria-label="Cloud account">
    {needsAttention ? <CloudOff aria-hidden="true" /> : pending ? <LoaderCircle aria-hidden="true" className="cloud-account-bar__spinner" /> : <Cloud aria-hidden="true" />}
    <div className="cloud-account-bar__identity"><strong>{account.email}</strong><span role="status" aria-live="polite" aria-atomic="true">{message}</span></div>
    <button type="button" onClick={() => void signOut()} disabled={pending || signingOut}><LogOut aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}</button>
    {recovery ? <p className="cloud-account-bar__recovery">{recovery}</p> : null}
    {error ? <p className="cloud-account-bar__error" role="alert">{error}</p> : null}
  </section>;
}
