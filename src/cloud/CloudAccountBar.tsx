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
  const message = pending ? "Saving securely…" : !isOnline ? "Offline — reconnect to save" : storage?.connectionError ? "Cloud connection needs attention" : storage?.error ? "Last save needs attention" : storage?.lastSavedAt
    ? `Saved securely at ${new Date(storage.lastSavedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Private cloud workspace ready";
  async function signOut() {
    setSigningOut(true);
    setError("");
    try { await account.onSignOut(); }
    catch { setError("Sign-out did not finish. Please try again."); }
    finally { setSigningOut(false); }
  }
  return <section className={`cloud-account-bar${pending ? " cloud-account-bar--saving" : ""}${needsAttention ? " cloud-account-bar--attention" : ""}`} aria-label="Cloud account">
    {pending ? <LoaderCircle aria-hidden="true" /> : needsAttention ? <CloudOff aria-hidden="true" /> : <Cloud aria-hidden="true" />}
    <div className="cloud-account-bar__identity"><strong>{account.email}</strong><span role="status" aria-live="polite">{message}</span></div>
    <button type="button" onClick={() => void signOut()} disabled={pending || signingOut}><LogOut aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}</button>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
