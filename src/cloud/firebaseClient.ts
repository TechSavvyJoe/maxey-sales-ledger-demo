import { getApps, initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  setPersistence,
} from "firebase/auth";
import type { Auth } from "firebase/auth";
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, terminate } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { isLoopbackHostname } from "./config";
import type { FirebaseCloudConfig } from "./config";

export interface FirebaseCloudClient {
  app: FirebaseApp;
  auth: Auth;
  config: FirebaseCloudConfig;
  remembersDevice: () => boolean;
  setRememberMe: (remember: boolean) => Promise<void>;
  openFirestoreForUser: (uid: string) => Promise<Firestore>;
  clearFirestore: () => Promise<void>;
}

const clients = new Map<string, FirebaseCloudClient>();

function rememberKey(projectId: string): string {
  return `maxey-sales-ledger-cloud-remember-v1:${projectId}`;
}

function remembersDevice(projectId: string): boolean {
  try {
    return localStorage.getItem(rememberKey(projectId)) === "true";
  } catch {
    return false;
  }
}

export function initializeFirebaseCloud(config: FirebaseCloudConfig): FirebaseCloudClient {
  if (config.useEmulators && !isLoopbackHostname(globalThis.location?.hostname ?? "")) {
    throw new Error("Emulator mode requires a loopback app address.");
  }
  const key = JSON.stringify(config);
  const existing = clients.get(key);
  if (existing) return existing;

  const name = `sales-ledger-private-${config.projectId}-${config.useEmulators ? "emulator" : "cloud"}`;
  const priorApp = getApps().find((candidate) => candidate.name === name);
  if (priorApp && (["apiKey", "authDomain", "projectId", "appId"] as const).some((field) => priorApp.options[field] !== config[field])) {
    throw new Error("The private app configuration changed. Reload before signing in.");
  }
  const app = priorApp ?? initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId }, name);
  let auth: Auth;
  try {
    auth = initializeAuth(app, {
      persistence: remembersDevice(config.projectId) ? browserLocalPersistence : browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "auth/already-initialized")) throw error;
    auth = getAuth(app);
  }
  if (config.useEmulators && !auth.emulatorConfig) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

  let firestore: Firestore | null = null;
  let firestoreUid: string | null = null;
  let operations: Promise<void> = Promise.resolve();
  const clear = async () => {
    const previous = firestore;
    firestoreUid = null;
    if (previous) await terminate(previous);
    firestore = null;
  };
  const client: FirebaseCloudClient = {
    app,
    auth,
    config,
    remembersDevice: () => remembersDevice(config.projectId),
    async setRememberMe(remember) {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      try {
        if (remember) localStorage.setItem(rememberKey(config.projectId), "true");
        else localStorage.removeItem(rememberKey(config.projectId));
      } catch {
        // Auth still enforces the selected persistence; a missing preference is session-only next time.
      }
    },
    openFirestoreForUser(uid) {
      const next = operations.then(async () => {
        if (auth.currentUser?.uid !== uid) throw new Error("The signed-in account changed.");
        if (firestore && firestoreUid === uid) return firestore;
        await clear();
        if (auth.currentUser?.uid !== uid) throw new Error("The signed-in account changed.");
        firestore = initializeFirestore(app, {
          localCache: memoryLocalCache(),
          // Avoid buffered streaming connections in Safari and workplace proxies.
          // Memory-only data and server-acknowledged transactions remain unchanged.
          experimentalForceLongPolling: true,
        });
        if (config.useEmulators) connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
        firestoreUid = uid;
        return firestore;
      });
      operations = next.then(() => undefined, () => undefined);
      return next;
    },
    clearFirestore() {
      const next = operations.then(clear);
      operations = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  clients.set(key, client);
  return client;
}
