import { spawnSync } from "node:child_process";
import { loadEnv } from "vite";

const env = { ...loadEnv("cloud", process.cwd(), "VITE_"), ...process.env };
if (env.VITE_FIREBASE_ENABLED !== "true" || env.VITE_PUBLIC_DEMO === "true" || env.VITE_FIREBASE_EMULATORS === "true") {
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
console.log("Built private cloud app in dist-cloud. The local demo build was not replaced.");
