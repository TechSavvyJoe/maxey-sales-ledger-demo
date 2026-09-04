import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const projectDirectory = path.resolve(import.meta.dirname, "..");
const launcherPath = path.join(projectDirectory, "launcher", "server.mjs");
const appDirectory = path.join(projectDirectory, "dist");
const appUrl = "http://127.0.0.1:4180/";
const healthUrl = `${appUrl}__maxey_local_health__`;
const expectedVersion = "1.9.0";
const children = new Set();

function trackChild(child) {
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.output = "";
  child.stdout?.on("data", (chunk) => { child.output += chunk; });
  child.stderr?.on("data", (chunk) => { child.output += chunk; });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function startLauncher(version = expectedVersion, servedDirectory = appDirectory) {
  return trackChild(spawn(process.execPath, [launcherPath, "--app-dir", servedDirectory], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      SALES_LEDGER_LAUNCHER_VERSION: version,
      SALES_LEDGER_NO_OPEN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }));
}

async function waitForHealth(version = expectedVersion) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(400) });
      const payload = await response.json();
      if (response.ok && payload.app === "maxey-sales-ledger" && payload.launcherVersion === version) return payload;
    } catch {
      // The server may still be binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Launcher ${version} did not become ready.`);
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return child.exitCode;
  return Promise.race([
    new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 0))),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Process did not exit. Output:\n${child.output}`)), timeoutMs)),
  ]);
}

async function stopLauncher(child) {
  if (child.exitCode !== null) return;
  if (child.processGroup) process.kill(-child.pid, "SIGTERM");
  else child.kill("SIGTERM");
  await waitForExit(child);
}

async function rawStatus(requestPath) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: 4180, method: "GET", path: requestPath }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}

async function assertHttpSurface() {
  const root = await fetch(appUrl);
  const html = await root.text();
  assert.equal(root.status, 200);
  assert.match(html, /Sales Ledger · Commission Tracker/);
  assert.equal(root.headers.get("x-content-type-options"), "nosniff");
  assert.match(root.headers.get("cache-control") ?? "", /no-cache/);
  assert.match(root.headers.get("content-security-policy") ?? "", /sha256-YodShMa4YRqCY4hmv2TR2cG\/ezeV78jHiIBL\/55\+xrE=/);
  assert.doesNotMatch(root.headers.get("content-security-policy") ?? "", /unsafe-inline.*script|script-src[^;]*unsafe-inline/);

  for (const file of [
    "manifest.webmanifest",
    "sw.js",
    "app-icon-192.png",
    "app-icon-512.png",
    "app-icon-maskable-512.png",
    "apple-touch-icon.png",
    "favicon-64.png",
    "brand/sales-ledger-mark.svg",
    "brand/sales-ledger-mark-reversed.svg",
    "brand/sales-ledger-mark-monochrome.svg",
  ]) {
    const response = await fetch(`${appUrl}${file}`);
    assert.equal(response.status, 200, `${file} should be served`);
    assert.ok((await response.arrayBuffer()).byteLength > 0, `${file} should not be empty`);
  }

  const assetPath = html.match(/src="(\.\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(assetPath, "built HTML should reference a JavaScript asset");
  const asset = await fetch(new URL(assetPath, appUrl));
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

  assert.notEqual(await rawStatus("/%2e%2e%5cpackage.json"), 200, "encoded backslash traversal must not expose project files");
  assert.notEqual(await rawStatus("/..%5c..%5cpackage.json"), 200, "nested encoded traversal must not expose project files");
}

async function addSaleAndClose(profileDirectory) {
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(appUrl);
    await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
    await page.getByLabel(/Customer last name/).fill("LauncherTest");
    await page.getByLabel(/Stock number/).fill("LAUNCH-0001");
    await page.getByLabel("Front gross").fill("2000");
    await page.getByLabel(/Total F&I gross/).fill("500");
    await page.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();
    await page.getByText("Sale added.").waitFor();
  } finally {
    await context.close();
  }
}

async function assertSaleSurvived(profileDirectory) {
  const context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(appUrl);
    await page.getByRole("button", { name: "Sales", exact: true }).first().click();
    await page.getByText("LAUNCH-0001").first().waitFor();
  } finally {
    await context.close();
  }
}

async function assertFileRecoveryPage() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(projectDirectory, "index.html")).href);
    await page.getByRole("heading", { name: "Open the app from its local web address" }).waitFor();
    await page.getByRole("link", { name: "Open Sales Ledger" }).waitFor();
    await page.getByText("Start Maxey Sales Ledger.command").waitFor();
    await page.getByText("Start Maxey Sales Ledger.cmd").waitFor();
    assert.equal(await page.getByRole("link", { name: "Open Sales Ledger" }).getAttribute("href"), appUrl);
  } finally {
    await browser.close();
  }
}

async function startSentinel() {
  const marker = `sentinel-${Date.now()}`;
  const server = createServer((_request, response) => {
    response.statusCode = 200;
    response.end(marker);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4180, "127.0.0.1", resolve);
  });
  return { marker, server };
}

async function createPackagedLayout() {
  const packageDirectory = await mkdtemp(path.join(tmpdir(), "maxey-ledger-package-"));
  await mkdir(path.join(packageDirectory, "launcher"), { recursive: true });
  await cp(appDirectory, path.join(packageDirectory, "app"), { recursive: true });
  await cp(launcherPath, path.join(packageDirectory, "launcher", "server.mjs"));
  for (const file of ["Start Maxey Sales Ledger.command", "Start Maxey Sales Ledger.cmd"]) {
    await cp(path.join(projectDirectory, file), path.join(packageDirectory, file));
  }
  await cp(path.join(projectDirectory, "launcher", "READ ME FIRST.txt"), path.join(packageDirectory, "READ ME FIRST.txt"));
  await chmod(path.join(packageDirectory, "Start Maxey Sales Ledger.command"), 0o755);
  return packageDirectory;
}

function startPackagedMacLauncher(packageDirectory) {
  const child = trackChild(spawn("/bin/zsh", [path.join(packageDirectory, "Start Maxey Sales Ledger.command")], {
    cwd: packageDirectory,
    detached: true,
    env: { ...process.env, SALES_LEDGER_NO_OPEN: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  child.processGroup = true;
  return child;
}

let profileDirectory;
let packageDirectory;
let differentBuildDirectory;
try {
  await assertFileRecoveryPage();
  console.log("✓ direct file opening shows recovery instructions");

  profileDirectory = await mkdtemp(path.join(tmpdir(), "maxey-ledger-launcher-"));
  let launcher = startLauncher();
  await waitForHealth();
  await assertHttpSurface();
  console.log("✓ launcher serves the complete app with safe headers and paths");

  await addSaleAndClose(profileDirectory);
  await stopLauncher(launcher);
  launcher = startLauncher();
  await waitForHealth();
  await assertSaleSurvived(profileDirectory);
  console.log("✓ a saved sale survives launcher stop and restart on the same origin");

  const matching = startLauncher();
  assert.equal(await waitForExit(matching), 0);
  assert.match(matching.output, /already running/);
  await waitForHealth();
  console.log("✓ a matching launcher reopens without replacing the active server");

  const different = startLauncher("9.9.9");
  assert.equal(await waitForExit(different), 1);
  assert.match(different.output, /Another Sales Ledger window is already using this address/);
  await waitForHealth();
  console.log("✓ a different launcher version is refused and the active server remains healthy");

  differentBuildDirectory = await mkdtemp(path.join(tmpdir(), "maxey-ledger-different-build-"));
  await cp(appDirectory, differentBuildDirectory, { recursive: true });
  const alteredManifestPath = path.join(differentBuildDirectory, "manifest.webmanifest");
  const alteredManifest = await readFile(alteredManifestPath, "utf8");
  await writeFile(alteredManifestPath, `${alteredManifest}\n`);
  const differentBuild = startLauncher(expectedVersion, differentBuildDirectory);
  assert.equal(await waitForExit(differentBuild), 1);
  assert.match(differentBuild.output, /Another Sales Ledger window is already using this address/);
  await waitForHealth();
  console.log("✓ the same launcher version refuses a different content build");

  await stopLauncher(launcher);

  packageDirectory = await createPackagedLayout();
  const commandDetails = await stat(path.join(packageDirectory, "Start Maxey Sales Ledger.command"));
  assert.notEqual(commandDetails.mode & 0o111, 0, "macOS launcher should be executable");
  const packagedLauncher = process.platform === "darwin"
    ? startPackagedMacLauncher(packageDirectory)
    : startLauncher(expectedVersion, path.join(packageDirectory, "app"));
  await waitForHealth();
  await assertHttpSurface();
  await stopLauncher(packagedLauncher);
  console.log("✓ the extracted Local package layout starts through the platform launcher path");

  const symlinkPath = path.join(packageDirectory, "app", "outside-project.txt");
  await symlink(path.join(projectDirectory, "package.json"), symlinkPath);
  const symlinkGuardLauncher = startLauncher(expectedVersion, path.join(packageDirectory, "app"));
  await waitForHealth();
  assert.equal((await fetch(`${appUrl}outside-project.txt`)).status, 403);
  await stopLauncher(symlinkGuardLauncher);
  console.log("✓ a symlink cannot escape the packaged app directory");

  const sentinel = await startSentinel();
  try {
    const collision = startLauncher();
    assert.equal(await waitForExit(collision), 1);
    assert.match(collision.output, /being used by another app/);
    assert.equal(await (await fetch(appUrl)).text(), sentinel.marker);
  } finally {
    await new Promise((resolve) => sentinel.server.close(resolve));
  }
  console.log("✓ an unrelated server survives a port collision unchanged");
} finally {
  await Promise.all([...children].map((child) => stopLauncher(child).catch(() => undefined)));
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
  if (packageDirectory) await rm(packageDirectory, { recursive: true, force: true });
  if (differentBuildDirectory) await rm(differentBuildDirectory, { recursive: true, force: true });
}
