import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FirebaseCloudConfig } from "./config";

const sdk = vi.hoisted(() => ({
  apps: [] as Array<{ name: string; options: Record<string, unknown> }>,
  auth: { currentUser: null as { uid: string } | null, emulatorConfig: null as object | null },
  sessionPersistence: { type: "SESSION" },
  localPersistence: { type: "LOCAL" },
  popupResolver: { kind: "popup-resolver" },
  initializeApp: vi.fn(),
  initializeAuth: vi.fn(),
  setPersistence: vi.fn(),
  connectAuthEmulator: vi.fn(),
  memoryLocalCache: vi.fn(),
  initializeFirestore: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("firebase/app", () => ({ getApps: () => sdk.apps, initializeApp: sdk.initializeApp }));
vi.mock("firebase/auth", () => ({
  browserSessionPersistence: sdk.sessionPersistence,
  browserLocalPersistence: sdk.localPersistence,
  browserPopupRedirectResolver: sdk.popupResolver,
  initializeAuth: sdk.initializeAuth,
  getAuth: () => sdk.auth,
  setPersistence: sdk.setPersistence,
  connectAuthEmulator: sdk.connectAuthEmulator,
}));
vi.mock("firebase/firestore", () => ({
  memoryLocalCache: sdk.memoryLocalCache,
  initializeFirestore: sdk.initializeFirestore,
  connectFirestoreEmulator: sdk.connectFirestoreEmulator,
  terminate: sdk.terminate,
}));

const config: FirebaseCloudConfig = {
  apiKey: "demo-api-key",
  authDomain: "demo-sales-ledger.firebaseapp.com",
  projectId: "demo-sales-ledger",
  appId: "demo-app-id",
  useEmulators: false,
};
const rememberKey = `maxey-sales-ledger-cloud-remember-v1:${config.projectId}`;
let initializeFirebaseCloud: typeof import("./firebaseClient")["initializeFirebaseCloud"];

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  sdk.apps.length = 0;
  sdk.auth.currentUser = null;
  sdk.auth.emulatorConfig = null;
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal("location", { hostname: "private.example.invalid" });
  sdk.initializeApp.mockImplementation((options, name) => {
    const app = { options, name };
    sdk.apps.push(app);
    return app;
  });
  sdk.initializeAuth.mockReturnValue(sdk.auth);
  sdk.setPersistence.mockResolvedValue(undefined);
  sdk.memoryLocalCache.mockImplementation(() => ({ kind: "memory" }));
  sdk.initializeFirestore.mockImplementation((app, options) => ({ app, options }));
  sdk.terminate.mockResolvedValue(undefined);
  ({ initializeFirebaseCloud } = await import("./firebaseClient"));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("private Firebase client initialization", () => {
  it("defaults to session-only sign-in and creates only a memory cache with forced long polling after a user is known", async () => {
    const client = initializeFirebaseCloud(config);
    expect(sdk.initializeApp).toHaveBeenCalledWith({
      apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId,
    }, "sales-ledger-private-demo-sales-ledger-cloud");
    expect(sdk.initializeAuth).toHaveBeenCalledWith(client.app, {
      persistence: sdk.sessionPersistence,
      popupRedirectResolver: sdk.popupResolver,
    });
    expect(sdk.initializeFirestore).not.toHaveBeenCalled();
    expect(client.remembersDevice()).toBe(false);
    expect(initializeFirebaseCloud({ ...config })).toBe(client);
    expect(sdk.initializeApp).toHaveBeenCalledOnce();
    sdk.auth.currentUser = { uid: "account-a" };
    await client.openFirestoreForUser("account-a");
    expect(sdk.initializeFirestore).toHaveBeenCalledWith(client.app, {
      localCache: sdk.memoryLocalCache.mock.results[0].value,
      experimentalForceLongPolling: true,
    });
    expect(sdk.memoryLocalCache).toHaveBeenCalledOnce();
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
    expect(sdk.connectFirestoreEmulator).not.toHaveBeenCalled();
  });

  it("uses persistent sign-in only for an explicit remembered-device preference and returns to session-only when cleared", async () => {
    localStorage.setItem(rememberKey, "true");
    const client = initializeFirebaseCloud(config);
    expect(sdk.initializeAuth.mock.calls[0][1].persistence).toBe(sdk.localPersistence);
    expect(client.remembersDevice()).toBe(true);
    await client.setRememberMe(false);
    expect(sdk.setPersistence).toHaveBeenLastCalledWith(client.auth, sdk.sessionPersistence);
    expect(localStorage.getItem(rememberKey)).toBeNull();
    await client.setRememberMe(true);
    expect(sdk.setPersistence).toHaveBeenLastCalledWith(client.auth, sdk.localPersistence);
    expect(localStorage.getItem(rememberKey)).toBe("true");
  });

  it("does not remember a device when the authentication persistence change fails", async () => {
    const client = initializeFirebaseCloud(config);
    sdk.setPersistence.mockRejectedValueOnce(new Error("Persistence unavailable"));
    await expect(client.setRememberMe(true)).rejects.toThrow("Persistence unavailable");
    expect(client.remembersDevice()).toBe(false);
    expect(localStorage.getItem(rememberKey)).toBeNull();
  });

  it("waits for A's cache teardown before creating B's cache and creates another fresh cache after logout", async () => {
    const client = initializeFirebaseCloud(config);
    sdk.auth.currentUser = { uid: "account-a" };
    const a = await client.openFirestoreForUser("account-a");
    expect(await client.openFirestoreForUser("account-a")).toBe(a);
    expect(sdk.initializeFirestore).toHaveBeenCalledOnce();
    let finishTermination!: () => void;
    sdk.terminate.mockImplementationOnce(() => new Promise<void>((resolve) => { finishTermination = resolve; }));
    sdk.auth.currentUser = { uid: "account-b" };
    const openingB = client.openFirestoreForUser("account-b");
    await vi.waitFor(() => expect(sdk.terminate).toHaveBeenCalledWith(a));
    expect(sdk.initializeFirestore).toHaveBeenCalledOnce();
    finishTermination();
    const b = await openingB;
    expect(b).not.toBe(a);
    expect(sdk.initializeFirestore).toHaveBeenCalledTimes(2);
    expect(sdk.memoryLocalCache.mock.results[1].value).not.toBe(sdk.memoryLocalCache.mock.results[0].value);
    sdk.auth.currentUser = null;
    await client.clearFirestore();
    expect(sdk.terminate).toHaveBeenLastCalledWith(b);
    sdk.auth.currentUser = { uid: "account-a" };
    const nextA = await client.openFirestoreForUser("account-a");
    expect(nextA).not.toBe(a);
    expect(nextA).not.toBe(b);
    expect(sdk.initializeFirestore).toHaveBeenCalledTimes(3);
    expect(sdk.memoryLocalCache).toHaveBeenCalledTimes(3);
  });

  it("rejects an obsolete user while teardown is pending instead of initializing that user's client", async () => {
    const client = initializeFirebaseCloud(config);
    sdk.auth.currentUser = { uid: "account-a" };
    await client.openFirestoreForUser("account-a");
    let finishTermination!: () => void;
    sdk.terminate.mockImplementationOnce(() => new Promise<void>((resolve) => { finishTermination = resolve; }));
    sdk.auth.currentUser = { uid: "account-b" };
    const openingB = client.openFirestoreForUser("account-b");
    const rejected = expect(openingB).rejects.toThrow("account changed");
    await vi.waitFor(() => expect(sdk.terminate).toHaveBeenCalledOnce());
    sdk.auth.currentUser = { uid: "account-c" };
    const openingC = client.openFirestoreForUser("account-c");
    finishTermination();
    await rejected;
    const c = await openingC;
    expect(c).toBe(sdk.initializeFirestore.mock.results[1].value);
    expect(sdk.initializeFirestore).toHaveBeenCalledTimes(2);
    await expect(client.openFirestoreForUser("account-b")).rejects.toThrow("account changed");
    expect(sdk.initializeFirestore).toHaveBeenCalledTimes(2);
  });

  it("wires only loopback emulator endpoints and refuses emulator initialization on a hosted address", async () => {
    const emulatorConfig = { ...config, useEmulators: true };
    expect(() => initializeFirebaseCloud(emulatorConfig)).toThrow("loopback");
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    vi.stubGlobal("location", { hostname: "localhost" });
    const client = initializeFirebaseCloud(emulatorConfig);
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(client.auth, "http://127.0.0.1:9099", { disableWarnings: true });
    sdk.auth.currentUser = { uid: "account-a" };
    const firestore = await client.openFirestoreForUser("account-a");
    expect(sdk.connectFirestoreEmulator).toHaveBeenCalledWith(firestore, "127.0.0.1", 8080);
  });
});
