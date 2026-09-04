import { randomUUID } from "node:crypto";
import { deleteDoc, doc, getDocFromServer, setDoc } from "firebase/firestore";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";

const PROJECT_ID = "demo-sales-ledger-rules";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const FIRESTORE_PORT = 8080;
const AUTH_PORT = 9099;
const READINESS_TIMEOUT_MS = 30_000;

function requireLoopbackEmulator(variable: string, expectedPort: number): void {
  const configured = process.env[variable];
  if (!configured) throw new Error(`${variable} must be supplied by firebase emulators:exec.`);
  const address = new URL(`http://${configured}`);
  if (!LOOPBACK_HOSTS.has(address.hostname)
    || Number(address.port) !== expectedPort
    || address.username
    || address.password
    || address.pathname !== "/") {
    throw new Error(`${variable} must point to the local emulator on port ${expectedPort}.`);
  }
}

async function bounded<T>(operation: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${description} did not finish within ${READINESS_TIMEOUT_MS / 1_000} seconds.`)), READINESS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function warmFirestoreEmulator(environment: RulesTestEnvironment): Promise<void> {
  const token = randomUUID();
  await bounded(environment.withSecurityRulesDisabled(async (context) => {
    const reference = doc(context.firestore(), "__cloudHarnessReadiness", `warmup-${token}`);
    try {
      await setDoc(reference, { token, synthetic: true });
      const saved = await getDocFromServer(reference);
      if (!saved.exists() || saved.data().token !== token || saved.data().synthetic !== true) {
        throw new Error("The Firestore emulator readiness document did not round-trip exactly.");
      }
    } finally {
      await deleteDoc(reference);
    }
  }), "The Firestore emulator readiness check");
}

/**
 * Wait for a real Firestore write/read round trip before a browser opens its
 * first long-polling channel. firebase emulators:exec reports readiness once
 * the port is listening, while the emulator can still be warming internally.
 * The temporary document is rules-disabled, synthetic, uniquely scoped, and
 * deleted before this helper returns.
 */
export async function createReadyCloudTestEnvironment(): Promise<RulesTestEnvironment> {
  requireLoopbackEmulator("FIRESTORE_EMULATOR_HOST", FIRESTORE_PORT);
  requireLoopbackEmulator("FIREBASE_AUTH_EMULATOR_HOST", AUTH_PORT);
  const environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: "127.0.0.1", port: FIRESTORE_PORT },
  });
  try {
    await warmFirestoreEmulator(environment);
    return environment;
  } catch (error) {
    await environment.cleanup();
    throw error;
  }
}
