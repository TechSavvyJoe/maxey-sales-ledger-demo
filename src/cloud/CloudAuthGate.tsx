import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { AlertTriangle, ArrowRight, Cloud, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { cloudAuthErrorMessage, emailLinkReturnUrl, sameOriginEmailLink } from "./config";
import type { FirebaseCloudConfig } from "./config";
import { initializeFirebaseCloud } from "./firebaseClient";
import type { FirebaseCloudClient } from "./firebaseClient";
import "./cloud-auth.css";

export interface FirebaseCloudSession {
  user: User;
  firestore: Firestore;
  signOut: () => Promise<void>;
}

export interface CloudAuthGateProps {
  config: FirebaseCloudConfig;
  children: (session: FirebaseCloudSession) => ReactNode;
}

const EMAIL_KEY = "maxey-sales-ledger-cloud-email-link-v1";

function savedEmail(): string {
  try {
    const pending = JSON.parse(sessionStorage.getItem(EMAIL_KEY) ?? "null") as { email?: unknown; createdAt?: unknown } | null;
    if (typeof pending?.email === "string" && typeof pending.createdAt === "number" && Date.now() - pending.createdAt < 60 * 60 * 1000) return pending.email;
  } catch {
    // Asking for the email again is the safe fallback, including on another device.
  }
  return "";
}

function clearSavedEmail(): void {
  try { sessionStorage.removeItem(EMAIL_KEY); } catch { /* No email was persisted in this browser. */ }
}

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="cloud-auth">
      <section className="cloud-auth__card" aria-labelledby="cloud-auth-title">
        <div className="cloud-auth__brand">
          <img src={`${import.meta.env.BASE_URL}brand/sales-ledger-mark.svg`} width="40" height="40" alt="" />
          <div><strong>Sales Ledger</strong><span>Private workspace</span></div>
        </div>
        {children}
      </section>
    </main>
  );
}

export function CloudAuthGate({ config, children }: CloudAuthGateProps) {
  const [initialization] = useState(() => {
    try { return { client: initializeFirebaseCloud(config), signature: JSON.stringify(config) }; }
    catch { return { client: null, signature: JSON.stringify(config) }; }
  });
  if (!initialization.client || initialization.signature !== JSON.stringify(config)) {
    return <AuthFrame><AlertTriangle aria-hidden="true" /><h1 id="cloud-auth-title">Private sign-in could not start</h1><p>The private app setup needs attention. No local ledger has been opened or uploaded.</p><button className="cloud-auth__button" onClick={() => window.location.reload()}>Try again</button></AuthFrame>;
  }
  return <CloudAuthContent client={initialization.client}>{children}</CloudAuthContent>;
}

function CloudAuthContent({ client, children }: { client: FirebaseCloudClient; children: CloudAuthGateProps["children"] }) {
  const [session, setSession] = useState<FirebaseCloudSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remember, setRemember] = useState(client.remembersDevice);
  const [email, setEmail] = useState(savedEmail);
  const [emailLink, setEmailLink] = useState(() => {
    const link = sameOriginEmailLink(window.location.href, window.location.origin);
    return link && isSignInWithEmailLink(client.auth, link) ? link : null;
  });
  const [requiresFreshSignIn, setRequiresFreshSignIn] = useState(Boolean(emailLink));
  const [showEmail, setShowEmail] = useState(Boolean(emailLink));
  const currentSession = useRef<FirebaseCloudSession | null>(null);
  const transition = useRef(0);
  const mounted = useRef(true);

  const signOut = useCallback(async (): Promise<void> => {
    transition.current += 1;
    currentSession.current = null;
    toast.dismiss();
    flushSync(() => { setSession(null); setChecking(true); setError(null); });
    clearSavedEmail();
    setEmail("");
    try {
      await firebaseSignOut(client.auth);
      await client.clearFirestore();
      await client.setRememberMe(false);
      if (mounted.current) { setRemember(false); setChecking(false); }
    } catch (caught) {
      if (mounted.current) { setFatal(true); setChecking(false); setError("Sign-out could not finish. Close this tab on a shared computer, then reopen the private app to try again."); }
      throw caught;
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const unsubscribe = onAuthStateChanged(client.auth, (user) => {
      if (!active) return;
      if (user && currentSession.current?.user.uid === user.uid) return;
      const version = ++transition.current;
      currentSession.current = null;
      // Remove the prior account's component tree before changing the data client.
      // Sonner's module-level queue otherwise replays its sale details and actions.
      toast.dismiss();
      flushSync(() => { setSession(null); setChecking(true); });
      const change = user ? client.openFirestoreForUser(user.uid) : client.clearFirestore();
      void change.then((firestore) => {
        if (!active || version !== transition.current || client.auth.currentUser?.uid !== user?.uid) return;
        if (user && firestore) {
          clearSavedEmail();
          setEmail("");
          const next: FirebaseCloudSession = {
            user,
            firestore,
            signOut: async () => {
              if (currentSession.current !== next || client.auth.currentUser?.uid !== user.uid) return;
              await signOut();
            },
          };
          currentSession.current = next;
          setSession(next);
        }
        setChecking(false);
      }).catch(() => {
        if (!active || version !== transition.current) return;
        setFatal(true);
        setChecking(false);
        setError("Your private workspace could not open safely. Reload the app to try again.");
      });
    }, () => {
      if (!active) return;
      transition.current += 1;
      currentSession.current = null;
      toast.dismiss();
      flushSync(() => { setSession(null); setChecking(false); setFatal(true); });
      setError("Your sign-in could not be checked. Reload the private app to try again.");
      void client.clearFirestore().catch(() => undefined);
    });
    return () => {
      active = false;
      mounted.current = false;
      transition.current += 1;
      currentSession.current = null;
      toast.dismiss();
      unsubscribe();
      void client.clearFirestore().catch(() => undefined);
    };
  }, [client, signOut]);

  async function googleSignIn() {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await client.setRememberMe(remember);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(client.auth, provider);
      if (mounted.current) setRequiresFreshSignIn(false);
    } catch (caught) {
      if (mounted.current) setError(cloudAuthErrorMessage(caught));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    setBusy(true); setError(null); setNotice(null);
    try {
      if (emailLink) {
        await client.setRememberMe(remember);
        await signInWithEmailLink(client.auth, address, emailLink);
        clearSavedEmail();
        setEmail("");
        setEmailLink(null);
        setRequiresFreshSignIn(false);
        window.history.replaceState(null, "", emailLinkReturnUrl(window.location.href));
      } else {
        await sendSignInLinkToEmail(client.auth, address, { url: emailLinkReturnUrl(window.location.href), handleCodeInApp: true });
        try { sessionStorage.setItem(EMAIL_KEY, JSON.stringify({ email: address, createdAt: Date.now() })); } catch { /* Completion will ask for the email again. */ }
        setNotice("Check your email for a sign-in link. Open it on the device where you want to use Sales Ledger. You may need to confirm your email again.");
      }
    } catch (caught) {
      if (mounted.current) setError(cloudAuthErrorMessage(caught));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (session && session.user.uid === client.auth.currentUser?.uid && !requiresFreshSignIn) {
    return <Fragment key={session.user.uid}>{children(session)}</Fragment>;
  }
  if (fatal) {
    return <AuthFrame><AlertTriangle aria-hidden="true" /><h1 id="cloud-auth-title">Private workspace paused</h1><p role="alert">{error}</p><button className="cloud-auth__button" onClick={() => window.location.reload()}>Reload private app</button></AuthFrame>;
  }
  if (checking) {
    return <AuthFrame><h1 id="cloud-auth-title">Opening your private workspace</h1><p className="cloud-auth__loading" role="status"><LoaderCircle aria-hidden="true" /> Checking your sign-in…</p></AuthFrame>;
  }
  return (
    <AuthFrame>
      <div className="cloud-auth__eyebrow"><Cloud size={16} aria-hidden="true" /> {client.config.useEmulators ? "Local test only" : "Private cloud saving"}</div>
      <h1 id="cloud-auth-title">{emailLink ? "Finish signing in" : "Your sales. Your workspace."}</h1>
      <p>{emailLink ? "Enter the email address that received this link." : "Sign in once. Your sales and settings stay with your account across your devices."}</p>
      <label className="cloud-auth__remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={busy} /><span>Remember me on this private device<small>Leave off on shared computers. Sign out when you finish.</small></span></label>
      {!emailLink && <><button className="cloud-auth__button cloud-auth__google" type="button" onClick={() => void googleSignIn()} disabled={busy}>{busy ? <LoaderCircle size={18} aria-hidden="true" /> : null}Continue with Google <ArrowRight size={18} aria-hidden="true" /></button>
        <button className="cloud-auth__text-button cloud-auth__email-toggle" type="button" aria-expanded={showEmail} aria-controls="cloud-email-form" disabled={busy} onClick={() => setShowEmail((value) => !value)}>{showEmail ? "Hide email sign-in" : "Use an email link instead"}</button></>}
      {(showEmail || emailLink) && <form id="cloud-email-form" className="cloud-auth__form" onSubmit={(event) => void submitEmail(event)}>
        <label htmlFor="cloud-auth-email">Your email address</label>
        <input id="cloud-auth-email" type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} aria-describedby={error ? "cloud-auth-error" : undefined} />
        <button className="cloud-auth__button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={18} aria-hidden="true" /> : <Mail size={18} aria-hidden="true" />}{emailLink ? "Confirm email and sign in" : "Email me a sign-in link"}</button>
      </form>}
      {emailLink && <button className="cloud-auth__text-button" type="button" disabled={busy} onClick={() => { setEmailLink(null); setError(null); clearSavedEmail(); window.history.replaceState(null, "", emailLinkReturnUrl(window.location.href)); }}>Request a new sign-in link</button>}
      {error && <p className="cloud-auth__error" id="cloud-auth-error" role="alert">{error}</p>}
      {notice && <p className="cloud-auth__notice" role="status">{notice}</p>}
      <p className="cloud-auth__privacy"><ShieldCheck size={18} aria-hidden="true" /><span>Your workspace opens only after access is approved. Existing on-device sales are not uploaded when you sign in.</span></p>
      <details className="cloud-auth__help"><summary>Having trouble signing in?</summary><p>Open this address directly in Chrome, Edge, Safari or Firefox if sign-in does not open inside another app. You can also use an email link.</p></details>
    </AuthFrame>
  );
}
