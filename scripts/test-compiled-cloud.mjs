import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distCloud = path.join(projectRoot, "dist-cloud");
const backupRoot = await mkdtemp(path.join(projectRoot, "node_modules", ".compiled-cloud-smoke-"));
const backupDistCloud = path.join(backupRoot, "dist-cloud");
let savedExistingBuild = false;
let managesDistCloud = false;

function runNode(relativeScript, args = []) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, relativeScript), ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${relativeScript} ended after signal ${result.signal}.`);
  if (result.status !== 0) {
    const error = new Error(`${relativeScript} failed with exit code ${result.status ?? 1}.`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

async function preserveExistingBuild() {
  const details = await lstat(distCloud).catch(() => null);
  if (!details) return;
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("dist-cloud must be an ordinary directory before the compiled-cloud smoke test can run.");
  }
  await rename(distCloud, backupDistCloud);
  savedExistingBuild = true;
}

async function restoreExistingBuild() {
  if (managesDistCloud) {
    await rm(distCloud, { recursive: true, force: true });
    if (savedExistingBuild) await rename(backupDistCloud, distCloud);
  }
  await rm(backupRoot, { recursive: true, force: true });
}

let exitCode = 0;
try {
  await preserveExistingBuild();
  managesDistCloud = true;
  runNode("scripts/build-cloud.mjs", ["--emulator-test"]);
  runNode("node_modules/@playwright/test/cli.js", ["test", "--config", "playwright.cloud-compiled.config.ts"]);
} catch (error) {
  exitCode = typeof error === "object" && error !== null && "exitCode" in error && Number.isInteger(error.exitCode)
    ? error.exitCode
    : 1;
  console.error(`Compiled-cloud smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try {
    await restoreExistingBuild();
  } catch (error) {
    exitCode = 1;
    console.error(`Could not restore the pre-test dist-cloud build: ${error instanceof Error ? error.message : String(error)}`);
  }
}

process.exitCode = exitCode;
