import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { loadEnv } from "vite";

const argumentsList = process.argv.slice(2);
const emulatorTest = argumentsList.length === 1 && argumentsList[0] === "--emulator-test";
if (argumentsList.length > 0 && !emulatorTest) {
  throw new Error(`Unknown build-cloud option: ${argumentsList.join(" ")}`);
}

function requireLocalEmulator(variable, expectedPort) {
  const configured = process.env[variable];
  if (!configured) throw new Error(`${variable} is required for an emulator test build.`);
  const address = new URL(`http://${configured}`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)
    || Number(address.port) !== expectedPort || address.username || address.password || address.pathname !== "/") {
    throw new Error(`${variable} must point to the loopback emulator on port ${expectedPort}.`);
  }
}

if (emulatorTest) {
  requireLocalEmulator("FIREBASE_AUTH_EMULATOR_HOST", 9099);
  requireLocalEmulator("FIRESTORE_EMULATOR_HOST", 8080);
}

const env = emulatorTest
  ? {
      ...process.env,
      VITE_FIREBASE_ENABLED: "true",
      VITE_PUBLIC_DEMO: "false",
      VITE_FIREBASE_EMULATORS: "true",
      VITE_FIREBASE_API_KEY: "fake-compiled-cloud-test-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-sales-ledger-rules.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "demo-sales-ledger-rules",
      VITE_FIREBASE_APP_ID: "1:123456789:web:compiledcloudtest",
    }
  : { ...loadEnv("cloud", process.cwd(), "VITE_"), ...process.env };
if (!emulatorTest && (env.VITE_FIREBASE_ENABLED !== "true" || env.VITE_PUBLIC_DEMO === "true" || env.VITE_FIREBASE_EMULATORS === "true")) {
  throw new Error("A private deployment requires Firebase enabled, demo disabled, and emulator mode disabled. Set .env.cloud.local first.");
}
for (const key of ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"]) {
  if (!env[key]?.trim()) throw new Error(`${key} is missing. The private app was not built.`);
}
for (const args of [
  ["node_modules/typescript/bin/tsc", "-b", "--pretty", "false"],
  ["node_modules/vite/bin/vite.js", "build", "--mode", "cloud", "--outDir", "dist-cloud"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const cloudManifestPath = new URL("../dist-cloud/manifest.webmanifest", import.meta.url);
const cloudManifest = JSON.parse(await readFile(cloudManifestPath, "utf8"));
cloudManifest.description = "Private vehicle sales, commission, and performance tracker with automatic account-based cloud saving.";
await writeFile(cloudManifestPath, `${JSON.stringify(cloudManifest, null, 2)}\n`, "utf8");

console.log(emulatorTest
  ? "Built the loopback-only private cloud smoke artifact in dist-cloud."
  : "Built private cloud app in dist-cloud. The local demo build was not replaced.");
