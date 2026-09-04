/** @vitest-environment jsdom */
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { CloudAuthGateProps, FirebaseCloudSession } from "./CloudAuthGate";
import { CloudAuthGate } from "./CloudAuthGate";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as User | null },
  listener: null as ((user: User | null) => void) | null,
  errorListener: null as (() => void) | null,
  setRememberMe: vi.fn(),
  openFirestoreForUser: vi.fn(),
  clearFirestore: vi.fn(),
  popup: vi.fn(),
  sendLink: vi.fn(),
  completeLink: vi.fn(),
  signOut: vi.fn(),
  isLink: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class { setCustomParameters() {} },
  onAuthStateChanged: vi.fn((_auth: unknown, next: (user: User | null) => void, error: () => void) => {
    let active = true;
    mocks.listener = next;
    mocks.errorListener = error;
    queueMicrotask(() => { if (active) next(mocks.auth.currentUser); });
    return () => { active = false; };
  }),
  isSignInWithEmailLink: mocks.isLink,
  signInWithPopup: mocks.popup,
  sendSignInLinkToEmail: mocks.sendLink,
  signInWithEmailLink: mocks.completeLink,
  signOut: mocks.signOut,
}));

const config = { apiKey: "demo-api-key", authDomain: "demo-sales-ledger.firebaseapp.com", projectId: "demo-sales-ledger", appId: "demo-app-id", useEmulators: false };
vi.mock("./firebaseClient", () => ({
  initializeFirebaseCloud: vi.fn(() => ({
    auth: mocks.auth,
    config: { useEmulators: false },
    remembersDevice: () => false,
    setRememberMe: mocks.setRememberMe,
    openFirestoreForUser: mocks.openFirestoreForUser,
    clearFirestore: mocks.clearFirestore,
  })),
}));

function user(uid: string): User { return { uid } as User; }
function showGate(onSession?: (session: FirebaseCloudSession) => void) {
  const props: CloudAuthGateProps = {
    config,
    children: (session) => {
      onSession?.(session);
      return createElement("div", { "data-testid": "ledger" }, `Private ledger ${session.user.uid}`);
    },
  };
  return render(createElement(CloudAuthGate, props));
}
async function emitUser(value: User | null) {
  await act(async () => { mocks.auth.currentUser = value; mocks.listener?.(value); });
}

beforeEach(() => {
  vi.clearAllMocks();
  const localValues = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => localValues.get(key) ?? null,
    setItem: (key: string, value: string) => { localValues.set(key, value); },
    removeItem: (key: string) => { localValues.delete(key); },
    clear: () => { localValues.clear(); },
  });
  mocks.auth.currentUser = null;
  mocks.listener = null;
  mocks.errorListener = null;
  toast.dismiss();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/private/");
  mocks.isLink.mockReturnValue(false);
  mocks.setRememberMe.mockResolvedValue(undefined);
  mocks.openFirestoreForUser.mockImplementation(async (uid: string) => ({ owner: uid }) as unknown as Firestore);
  mocks.clearFirestore.mockResolvedValue(undefined);
  mocks.popup.mockResolvedValue(undefined);
  mocks.sendLink.mockResolvedValue(undefined);
  mocks.completeLink.mockResolvedValue(undefined);
  mocks.signOut.mockImplementation(async () => { mocks.auth.currentUser = null; mocks.listener?.(null); });
});
afterEach(() => { cleanup(); toast.dismiss(); vi.unstubAllGlobals(); });

describe("private sign-in gate", () => {
  it("keeps the ledger unmounted until authentication is checked and uses shared-device defaults", async () => {
    showGate();
    expect(screen.queryByTestId("ledger")).toBeNull();
    await screen.findByRole("button", { name: /Continue with Google/ });
    expect(screen.queryByLabelText("Your email address")).toBeNull();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(mocks.openFirestoreForUser).not.toHaveBeenCalled();
    expect(mocks.sendLink).not.toHaveBeenCalled();
  });

  it("applies explicit remember choice before Google sign-in", async () => {
    showGate();
    await screen.findByRole("button", { name: /Continue with Google/ });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/ }));
    await waitFor(() => expect(mocks.popup).toHaveBeenCalledTimes(1));
    expect(mocks.setRememberMe).toHaveBeenCalledWith(true);
    expect(mocks.setRememberMe.mock.invocationCallOrder[0]).toBeLessThan(mocks.popup.mock.invocationCallOrder[0]);
  });

  it("gives a usable popup-blocked fallback without exposing raw errors", async () => {
    mocks.popup.mockRejectedValue({ code: "auth/popup-blocked", message: "private-token" });
    showGate();
    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/email sign-in link/);
    expect(screen.getByRole("alert").textContent).not.toContain("private-token");
  });

  it("sends email only after submit, to a query-free same-origin completion URL", async () => {
    window.history.replaceState(null, "", "/private/?next=https://elsewhere.example&email=not-used@example.com#secret");
    showGate();
    fireEvent.click(await screen.findByRole("button", { name: "Use an email link instead" }));
    const input = await screen.findByLabelText("Your email address");
    expect((input as HTMLInputElement).value).toBe("");
    fireEvent.change(input, { target: { value: "salesperson@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    await waitFor(() => expect(mocks.sendLink).toHaveBeenCalledWith(mocks.auth, "salesperson@example.com", { url: `${window.location.origin}/private/`, handleCodeInApp: true }));
    expect(localStorage.getItem("emailForSignIn")).toBeNull();
    expect(sessionStorage.getItem("maxey-sales-ledger-cloud-email-link-v1")).toContain("salesperson@example.com");
    expect(screen.queryByTestId("ledger")).toBeNull();
  });

  it("requires confirmation on an email-link landing, never accepting an email from the URL", async () => {
    mocks.isLink.mockReturnValue(true);
    window.history.replaceState(null, "", "/private/?mode=signIn&oobCode=test&email=attacker@example.com");
    showGate();
    const input = await screen.findByLabelText("Your email address");
    expect((input as HTMLInputElement).value).toBe("");
    expect(mocks.completeLink).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "salesperson@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm email and sign in" }));
    await waitFor(() => expect(mocks.completeLink).toHaveBeenCalledWith(mocks.auth, "salesperson@example.com", expect.stringContaining("oobCode=test")));
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(sessionStorage.getItem("maxey-sales-ledger-cloud-email-link-v1")).toBeNull();
  });

  it("unmounts the prior user's ledger before the next user's client is ready", async () => {
    showGate();
    await screen.findByRole("button", { name: /Continue with Google/ });
    await emitUser(user("account-a"));
    expect((await screen.findByTestId("ledger")).textContent).toBe("Private ledger account-a");
    toast.success("Sale deleted.", { description: "Fictional stock ACCOUNT-A", action: { label: "Undo", onClick: vi.fn() } });
    expect(toast.getToasts()).toHaveLength(1);
    let finish: ((value: Firestore) => void) | undefined;
    mocks.openFirestoreForUser.mockImplementationOnce(() => new Promise<Firestore>((resolve) => { finish = resolve; }));
    await emitUser(user("account-b"));
    expect(screen.queryByTestId("ledger")).toBeNull();
    expect(toast.getToasts()).toHaveLength(0);
    await act(async () => { finish?.({} as Firestore); });
    expect((await screen.findByTestId("ledger")).textContent).toBe("Private ledger account-b");
    expect(toast.getToasts()).toHaveLength(0);
  });

  it("clears sale notifications immediately when sign-out starts, before its request finishes", async () => {
    let session: FirebaseCloudSession | undefined;
    showGate((value) => { session = value; });
    await screen.findByRole("button", { name: /Continue with Google/ });
    await emitUser(user("account-a"));
    await screen.findByTestId("ledger");
    toast.success("Sale saved.", { description: "Fictional stock ACCOUNT-A" });
    let finish: (() => void) | undefined;
    mocks.signOut.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let signingOut: Promise<void> | undefined;
    act(() => { signingOut = session?.signOut(); });
    expect(screen.queryByTestId("ledger")).toBeNull();
    expect(toast.getToasts()).toHaveLength(0);
    await act(async () => { finish?.(); await signingOut; });
  });

  it("does not allow a captured previous-account sign-out action to sign out the new account", async () => {
    let session: FirebaseCloudSession | undefined;
    showGate((value) => { session = value; });
    await screen.findByRole("button", { name: /Continue with Google/ });
    await emitUser(user("account-a"));
    await screen.findByTestId("ledger");
    const previousSignOut = session!.signOut;
    await emitUser(user("account-b"));
    await act(async () => { await previousSignOut(); });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("ledger").textContent).toBe("Private ledger account-b");
  });

  it("clears queued notifications when the auth gate unmounts", async () => {
    const view = showGate();
    await screen.findByRole("button", { name: /Continue with Google/ });
    await emitUser(user("account-a"));
    await screen.findByTestId("ledger");
    toast.success("Fictional account A notification");
    view.unmount();
    expect(toast.getToasts()).toHaveLength(0);
  });

  it("clears notifications and invalidates a pending account open when authentication fails", async () => {
    showGate();
    await screen.findByRole("button", { name: /Continue with Google/ });
    let finish: ((value: Firestore) => void) | undefined;
    mocks.openFirestoreForUser.mockImplementationOnce(() => new Promise<Firestore>((resolve) => { finish = resolve; }));
    await emitUser(user("account-a"));
    toast.error("Fictional account A notification");
    act(() => { mocks.errorListener?.(); });
    expect(toast.getToasts()).toHaveLength(0);
    await act(async () => { finish?.({} as Firestore); });
    expect(screen.queryByTestId("ledger")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("could not be checked");
  });

  it("never reveals an already signed-in account when requesting a replacement email link", async () => {
    mocks.isLink.mockReturnValue(true);
    mocks.auth.currentUser = user("previous-account");
    window.history.replaceState(null, "", "/private/?mode=signIn&oobCode=test");
    showGate();
    await screen.findByRole("button", { name: "Confirm email and sign in" });
    expect(screen.queryByTestId("ledger")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request a new sign-in link" }));
    await screen.findByRole("button", { name: "Email me a sign-in link" });
    expect(screen.queryByTestId("ledger")).toBeNull();
  });

  it("does not publish an obsolete session after rapid account changes", async () => {
    showGate();
    await screen.findByRole("button", { name: /Continue with Google/ });
    let finish: ((value: Firestore) => void) | undefined;
    mocks.openFirestoreForUser.mockImplementationOnce(() => new Promise<Firestore>((resolve) => { finish = resolve; }));
    await emitUser(user("account-a"));
    await emitUser(null);
    await act(async () => { finish?.({} as Firestore); });
    expect(screen.queryByTestId("ledger")).toBeNull();
    await screen.findByRole("button", { name: /Continue with Google/ });
  });

  it("clears the cloud view and temporary email on sign-out without deleting a local ledger", async () => {
    let session: FirebaseCloudSession | undefined;
    sessionStorage.setItem("local-ledger-marker", "keep-me");
    showGate((value) => { session = value; });
    await screen.findByRole("button", { name: /Continue with Google/ });
    await emitUser(user("account-a"));
    await screen.findByTestId("ledger");
    await act(async () => { await session?.signOut(); });
    expect(screen.queryByTestId("ledger")).toBeNull();
    expect(mocks.clearFirestore).toHaveBeenCalled();
    expect(mocks.setRememberMe).toHaveBeenCalledWith(false);
    expect(sessionStorage.getItem("local-ledger-marker")).toBe("keep-me");
  });

  it("fails closed if preparing an isolated data client fails", async () => {
    mocks.openFirestoreForUser.mockRejectedValueOnce(new Error("private details"));
    showGate();
    await screen.findByRole("button", { name: /Continue with Google/ });
    await emitUser(user("account-a"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not open safely/);
    expect(screen.queryByTestId("ledger")).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toContain("private details");
  });
});
