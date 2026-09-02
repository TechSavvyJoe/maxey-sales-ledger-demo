import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releasesRoot = path.join(projectRoot, "releases");
const normalizedTimestamp = new Date("2000-01-01T00:00:00.000Z");
const maximumSourceFiles = 5_000;
const maximumSourceBytes = 150 * 1024 * 1024;

const sourceFiles = [
  ".gitignore",
  ".oxlintrc.json",
  "README.md",
  "RELEASE_NOTES.md",
  "Start Maxey Sales Ledger.cmd",
  "Start Maxey Sales Ledger.command",
  "app-icon-192.png",
  "components.json",
  "favicon-64.png",
  "index.html",
  "package.json",
  "playwright.config.ts",
  "playwright.production.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.js",
  "tailwind.config.js",
  "tsconfig.app.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vitest.config.ts",
];
const sourceDirectories = ["brand", "docs", "e2e", "e2e-production", "launcher", "public", "scripts", "src", "vendor"];
const requiredScreenshotNames = [
  "add-sale-desktop.png",
  "add-sale-mobile.png",
  "dashboard-desktop.png",
  "dashboard-mobile.png",
  "reports-desktop.png",
  "reports-mobile.png",
  "sales-desktop.png",
  "sales-mobile.png",
  "settings-desktop.png",
  "settings-mobile.png",
];

function compareNames(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function printHelp() {
  console.log(`Package a verified Maxey Sales Ledger release.

Usage:
  node scripts/package-release.mjs [--replace]

Options:
  --replace  Replace only the generated archives and checksum file for the
             current package.json version. README.md and other release notes
             in that version folder are preserved.
  --help     Show this help without creating or changing release files.

Before running, build and verify the current source, then capture the release
screenshots. The script reads the version from package.json and packages the
current dist/, source, launchers, screenshots, and brand sheet.`);
}

function parseArguments(argumentsList) {
  let replace = false;
  for (const argument of argumentsList) {
    if (argument === "--help" || argument === "-h") return { help: true, replace: false };
    if (argument === "--replace") replace = true;
    else throw new Error(`Unknown option: ${argument}. Run with --help for usage.`);
  }
  return { help: false, replace };
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function requireFile(relativePath) {
  const target = path.join(projectRoot, relativePath);
  const details = await stat(target).catch(() => null);
  if (!details?.isFile()) throw new Error(`Required file is missing: ${relativePath}`);
  return target;
}

async function requireDirectory(relativePath) {
  const target = path.join(projectRoot, relativePath);
  const details = await stat(target).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Required directory is missing: ${relativePath}`);
  return target;
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: { ...process.env, TZ: "UTC", ...options.env },
      stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}.\n${output.trim()}`));
    });
    if (options.input !== undefined) child.stdin.end(options.input);
  });
}

function isSensitiveSourcePath(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  const name = path.basename(lowerPath);
  return name === ".env"
    || name.startsWith(".env.")
    || name === ".npmrc"
    || name === ".pypirc"
    || name === "credentials.json"
    || name === "secrets.json"
    || /\.(?:key|pem|p12|pfx|kdbx)$/.test(name)
    || lowerPath.split(path.sep).some((segment) => segment === "credentials" || segment === "secrets");
}

async function copySourceTree(destination) {
  for (const relativePath of sourceFiles) {
    await requireFile(relativePath);
    await copyFile(path.join(projectRoot, relativePath), path.join(destination, relativePath));
  }
  for (const relativePath of sourceDirectories) {
    await requireDirectory(relativePath);
    await cp(path.join(projectRoot, relativePath), path.join(destination, relativePath), {
      recursive: true,
      preserveTimestamps: true,
      filter: (source) => {
        const candidate = path.relative(projectRoot, source);
        if (isSensitiveSourcePath(candidate)) {
          throw new Error(`Refusing to package potentially sensitive source path: ${candidate}`);
        }
        const name = path.basename(candidate);
        return name !== ".DS_Store" && !name.endsWith(".tsbuildinfo");
      },
    });
  }
}

async function normalizeTree(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
    const details = await lstat(target);
    if (details.isSymbolicLink()) throw new Error(`Release inputs cannot contain symbolic links: ${relativePath}`);
    if (details.isDirectory()) {
      await normalizeTree(target, relativePath);
      await chmod(target, 0o755);
    } else if (details.isFile()) {
      await chmod(target, 0o644);
    } else {
      throw new Error(`Release inputs must be regular files or directories: ${relativePath}`);
    }
    await utimes(target, normalizedTimestamp, normalizedTimestamp);
  }
  await chmod(directory, 0o755);
  await utimes(directory, normalizedTimestamp, normalizedTimestamp);
}

async function listArchiveEntries(directory, relativeDirectory = "") {
  const output = [];
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  for (const entry of entries.sort(compareNames)) {
    const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
    if (relativePath.includes("\n") || relativePath.includes("\r")) {
      throw new Error(`Archive paths cannot contain line breaks: ${relativePath}`);
    }
    const archivePath = relativePath.split(path.sep).join("/");
    if (entry.isDirectory()) {
      output.push(`${archivePath}/`);
      output.push(...await listArchiveEntries(directory, relativePath));
    } else {
      output.push(archivePath);
    }
  }
  return output;
}

async function createArchive(sourceDirectory, destination) {
  const entries = await listArchiveEntries(sourceDirectory);
  if (entries.length === 0) throw new Error(`Cannot create an empty archive from ${sourceDirectory}.`);
  await run("/usr/bin/zip", ["-X", "-q", "-9", destination, "-@"], {
    cwd: sourceDirectory,
    input: `${entries.join("\n")}\n`,
  });
}

async function sha256(file) {
  const contents = await readFile(file);
  return createHash("sha256").update(contents).digest("hex");
}

async function verifyChecksumFile(directory, archiveNames) {
  const checksumFile = await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8");
  const expectedLines = checksumFile.trim().split("\n");
  if (expectedLines.length !== archiveNames.length) {
    throw new Error("SHA256SUMS.txt does not list every release archive exactly once.");
  }
  for (let index = 0; index < archiveNames.length; index += 1) {
    const archiveName = archiveNames[index];
    const match = expectedLines[index].match(/^([a-f0-9]{64})  (.+)$/);
    if (!match || match[2] !== archiveName) {
      throw new Error(`SHA256SUMS.txt has an invalid entry for ${archiveName}.`);
    }
    if (await sha256(path.join(directory, archiveName)) !== match[1]) {
      throw new Error(`Checksum verification failed for ${archiveName}.`);
    }
  }
}

async function updateFingerprint(hash, target, relativePath) {
  const details = await lstat(target);
  const portablePath = relativePath.split(path.sep).join("/");
  if (details.isDirectory()) {
    hash.update(`directory\0${portablePath}\0`);
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries.sort(compareNames)) {
      await updateFingerprint(hash, path.join(target, entry.name), path.join(relativePath, entry.name));
    }
  } else if (details.isFile()) {
    const contents = await readFile(target);
    hash.update(`file\0${portablePath}\0${contents.length}\0`);
    hash.update(contents);
  } else {
    throw new Error(`Release inputs cannot contain symbolic links or special files: ${relativePath}`);
  }
}

async function releaseInputFingerprint() {
  const hash = createHash("sha256");
  for (const relativePath of [...sourceFiles, ...sourceDirectories, "dist", "release-screenshots"]) {
    await updateFingerprint(hash, path.join(projectRoot, relativePath), relativePath);
  }
  return hash.digest("hex");
}

async function measureTree(directory) {
  let files = 0;
  let bytes = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const details = await lstat(target);
    if (details.isDirectory()) {
      const nested = await measureTree(target);
      files += nested.files;
      bytes += nested.bytes;
    } else if (details.isFile()) {
      files += 1;
      bytes += details.size;
    } else {
      throw new Error(`Release inputs cannot contain symbolic links or special files: ${target}`);
    }
  }
  return { files, bytes };
}

async function assertPng(file, relativePath) {
  const contents = await readFile(file);
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (contents.length < 10_000 || pngSignature.some((byte, index) => contents[index] !== byte)) {
    throw new Error(`Release screenshot is missing, empty, or not a PNG: ${relativePath}`);
  }
}

async function assertVersionCoherence(version) {
  const expectedVersion = JSON.stringify(version);
  for (const relativePath of ["src/lib/files.ts", "launcher/server.mjs", "scripts/test-launcher.mjs"]) {
    const contents = await readFile(await requireFile(relativePath), "utf8");
    if (!contents.includes(expectedVersion)) {
      throw new Error(`${relativePath} does not contain the package.json release version ${version}.`);
    }
  }
  const releaseNotes = await readFile(await requireFile("RELEASE_NOTES.md"), "utf8");
  if (!releaseNotes.startsWith(`# Maxey Sales Ledger ${version}\n`)) {
    throw new Error(`RELEASE_NOTES.md is not headed for release ${version}.`);
  }
  const assetsDirectory = await requireDirectory("dist/assets");
  const builtScripts = (await readdir(assetsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"));
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const builtVersionLiteral = new RegExp(`[\\"'\\\`]${escapedVersion}[\\"'\\\`]`);
  let builtVersionFound = false;
  for (const entry of builtScripts) {
    const contents = await readFile(path.join(assetsDirectory, entry.name), "utf8");
    if (builtVersionLiteral.test(contents)) {
      builtVersionFound = true;
      break;
    }
  }
  if (!builtVersionFound) throw new Error(`dist/ does not contain release version ${version}; rebuild before packaging.`);
}

async function newestModifiedTime(directory) {
  let newest = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    const details = await lstat(target);
    if (details.isDirectory()) newest = Math.max(newest, await newestModifiedTime(target));
    else if (details.isFile()) newest = Math.max(newest, details.mtimeMs);
    else throw new Error(`Build inputs cannot contain symbolic links or special files: ${target}`);
  }
  return newest;
}

async function assertBuildAndScreenshotFreshness() {
  const builtServiceWorker = await stat(await requireFile("dist/sw.js"));
  const applicationInputTimes = await Promise.all([
    newestModifiedTime(path.join(projectRoot, "src")),
    newestModifiedTime(path.join(projectRoot, "public")),
    stat(path.join(projectRoot, "index.html")).then((details) => details.mtimeMs),
    stat(path.join(projectRoot, "package.json")).then((details) => details.mtimeMs),
    stat(path.join(projectRoot, "vite.config.ts")).then((details) => details.mtimeMs),
  ]);
  if (Math.max(...applicationInputTimes) > builtServiceWorker.mtimeMs) {
    throw new Error("dist/ is older than an application input. Run the verified production build again.");
  }
  for (const screenshotName of requiredScreenshotNames) {
    const relativePath = path.join("release-screenshots", screenshotName);
    const screenshot = await requireFile(relativePath);
    const details = await stat(screenshot);
    if (details.mtimeMs < builtServiceWorker.mtimeMs) {
      throw new Error(`${relativePath} is older than the current build. Capture release screenshots again.`);
    }
    await assertPng(screenshot, relativePath);
  }
}

async function listTree(directory, relativeDirectory = "") {
  const output = [];
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  for (const entry of entries.sort(compareNames)) {
    const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
    const details = await lstat(path.join(directory, relativePath));
    const type = details.isDirectory() ? "directory" : details.isFile() ? "file" : details.isSymbolicLink() ? "symlink" : "other";
    output.push({ relativePath, type, mode: details.mode & 0o777 });
    if (details.isDirectory()) output.push(...await listTree(directory, relativePath));
  }
  return output;
}

async function compareDirectories(expectedDirectory, actualDirectory, label, options = {}) {
  const expectedTree = await listTree(expectedDirectory);
  const actualTree = await listTree(actualDirectory);
  const comparableTree = (tree) => options.compareModes === false
    ? tree.map(({ relativePath, type }) => ({ relativePath, type }))
    : tree;
  if (JSON.stringify(comparableTree(expectedTree)) !== JSON.stringify(comparableTree(actualTree))) {
    throw new Error(`${label} does not have the expected file layout or permissions.`);
  }
  for (const entry of expectedTree) {
    if (entry.type !== "file") continue;
    const expectedFile = path.join(expectedDirectory, entry.relativePath);
    const actualFile = path.join(actualDirectory, entry.relativePath);
    const [expectedHash, actualHash] = await Promise.all([sha256(expectedFile), sha256(actualFile)]);
    if (expectedHash !== actualHash) throw new Error(`${label} differs from its verified staged content: ${entry.relativePath}`);
  }
}

async function assertRequiredExtractedLayout(extractedRoot, archiveNames) {
  const localRoot = path.join(extractedRoot, "local");
  const deployRoot = path.join(extractedRoot, "deploy");
  const sourceRoot = path.join(extractedRoot, "source");
  const visualRoot = path.join(extractedRoot, "visual");

  for (const relativePath of [
    "app/index.html",
    "launcher/server.mjs",
    "READ ME FIRST.txt",
    "Start Maxey Sales Ledger.command",
    "Start Maxey Sales Ledger.cmd",
  ]) {
    if (!await pathExists(path.join(localRoot, relativePath))) {
      throw new Error(`${archiveNames.local} is missing ${relativePath}.`);
    }
  }
  const localTopLevel = (await readdir(localRoot)).sort();
  const expectedLocalTopLevel = [
    "READ ME FIRST.txt",
    "Start Maxey Sales Ledger.cmd",
    "Start Maxey Sales Ledger.command",
    "app",
    "launcher",
  ].sort();
  if (JSON.stringify(localTopLevel) !== JSON.stringify(expectedLocalTopLevel)) {
    throw new Error(`${archiveNames.local} has an unexpected top-level layout.`);
  }
  const macLauncher = await stat(path.join(localRoot, "Start Maxey Sales Ledger.command"));
  if ((macLauncher.mode & 0o111) === 0) {
    throw new Error(`${archiveNames.local} did not preserve the executable macOS launcher bit.`);
  }

  for (const relativePath of ["index.html", "sw.js", "manifest.webmanifest"]) {
    if (!await pathExists(path.join(deployRoot, relativePath))) {
      throw new Error(`${archiveNames.deploy} is missing ${relativePath}.`);
    }
  }
  for (const relativePath of [
    "package.json",
    "pnpm-lock.yaml",
    "src/App.tsx",
    "scripts/package-release.mjs",
    "e2e/core-flow.spec.ts",
    "e2e-production/offline.spec.ts",
  ]) {
    if (!await pathExists(path.join(sourceRoot, relativePath))) {
      throw new Error(`${archiveNames.source} is missing ${relativePath}.`);
    }
  }
  for (const forbiddenPath of ["node_modules", "dist", "releases", "release-screenshots", "playwright-report", "test-results"]) {
    if (await pathExists(path.join(sourceRoot, forbiddenPath))) {
      throw new Error(`${archiveNames.source} unexpectedly contains ${forbiddenPath}/.`);
    }
  }
  for (const relativePath of ["settings-desktop.png", "settings-mobile.png", "sales-ledger-brand-sheet.png"]) {
    if (!await pathExists(path.join(visualRoot, relativePath))) {
      throw new Error(`${archiveNames.visual} is missing ${relativePath}.`);
    }
  }
}

async function moveVerifiedOutputs(outputDirectory, releaseDirectory, artifactNames, replace) {
  const installedNames = [];
  const operationId = `${process.pid}-${Date.now()}`;
  const stagedNames = new Map();
  const backupNames = new Map();
  try {
    if (!replace) {
      for (const artifactName of artifactNames) {
        await copyFile(
          path.join(outputDirectory, artifactName),
          path.join(releaseDirectory, artifactName),
          fileSystemConstants.COPYFILE_EXCL,
        );
        installedNames.push(artifactName);
      }
      return;
    }
    for (const artifactName of artifactNames) {
      const stagedName = `.${artifactName}.new-${operationId}`;
      await copyFile(path.join(outputDirectory, artifactName), path.join(releaseDirectory, stagedName));
      stagedNames.set(artifactName, stagedName);
    }
    for (const artifactName of artifactNames) {
      const destination = path.join(releaseDirectory, artifactName);
      if (await pathExists(destination)) {
        const backupName = `.${artifactName}.old-${operationId}`;
        await rename(destination, path.join(releaseDirectory, backupName));
        backupNames.set(artifactName, backupName);
      }
      await rename(path.join(releaseDirectory, stagedNames.get(artifactName)), destination);
      installedNames.push(artifactName);
    }
  } catch (error) {
    await Promise.all(installedNames.map((name) => rm(path.join(releaseDirectory, name), { force: true })));
    for (const [artifactName, backupName] of backupNames) {
      const backupPath = path.join(releaseDirectory, backupName);
      if (await pathExists(backupPath)) await rename(backupPath, path.join(releaseDirectory, artifactName));
    }
    throw error;
  } finally {
    await Promise.all([...stagedNames.values()].map((name) => rm(path.join(releaseDirectory, name), { force: true })));
  }
  const cleanupResults = await Promise.allSettled(
    [...backupNames.values()].map((name) => rm(path.join(releaseDirectory, name), { force: true })),
  );
  if (cleanupResults.some((result) => result.status === "rejected")) {
    console.warn("Release was installed, but one or more temporary replacement files could not be removed.");
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const packageJsonPath = await requireFile("package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const version = String(packageJson.version ?? "");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`package.json has an invalid release version: ${version || "missing"}`);
  }

  const archiveNames = {
    deploy: `Maxey_Sales_Ledger_Deploy_v${version}.zip`,
    local: `Maxey_Sales_Ledger_Local_v${version}.zip`,
    source: `Maxey_Sales_Ledger_Source_v${version}.zip`,
    visual: `Maxey_Sales_Ledger_Visual_Review_v${version}.zip`,
  };
  const generatedArtifactNames = [...Object.values(archiveNames), "SHA256SUMS.txt"];
  const releaseDirectory = path.join(releasesRoot, version);
  if (await pathExists(releaseDirectory)) {
    const interruptedFiles = (await readdir(releaseDirectory)).filter((name) =>
      name.startsWith(".")
      && (name.includes(".new-") || name.includes(".old-"))
      && generatedArtifactNames.some((artifactName) => name.startsWith(`.${artifactName}.`)),
    );
    if (interruptedFiles.length > 0) {
      throw new Error(
        `Release ${version} contains interrupted replacement files (${interruptedFiles.join(", ")}). `
        + "Preserve the folder and recover or remove those files explicitly before packaging again.",
      );
    }
  }
  const existingArtifacts = [];
  for (const artifactName of generatedArtifactNames) {
    if (await pathExists(path.join(releaseDirectory, artifactName))) existingArtifacts.push(artifactName);
  }
  if (existingArtifacts.length > 0 && !options.replace) {
    throw new Error(
      `Release ${version} already has generated files (${existingArtifacts.join(", ")}). `
      + "Bump package.json for a new release or rerun with --replace to replace only those generated files.",
    );
  }

  const distDirectory = await requireDirectory("dist");
  await requireFile("dist/index.html");
  await requireFile("dist/sw.js");
  await requireFile("launcher/server.mjs");
  await requireFile("launcher/READ ME FIRST.txt");
  await requireFile("Start Maxey Sales Ledger.command");
  await requireFile("Start Maxey Sales Ledger.cmd");
  await requireDirectory("release-screenshots");
  for (const screenshotName of requiredScreenshotNames) {
    await requireFile(path.join("release-screenshots", screenshotName));
  }
  const brandSheet = await requireFile("docs/brand/sales-ledger-brand-sheet.png");
  await assertPng(brandSheet, "docs/brand/sales-ledger-brand-sheet.png");
  await assertVersionCoherence(version);
  await assertBuildAndScreenshotFreshness();
  const initialInputFingerprint = await releaseInputFingerprint();

  await mkdir(releasesRoot, { recursive: true });
  const stageRoot = await mkdtemp(path.join(releasesRoot, `.package-${version}-`));
  try {
    const localDirectory = path.join(stageRoot, "local");
    const deployDirectory = path.join(stageRoot, "deploy");
    const sourceDirectory = path.join(stageRoot, "source");
    const visualDirectory = path.join(stageRoot, "visual");
    const outputDirectory = path.join(stageRoot, "output");
    const extractedRoot = path.join(stageRoot, "verify");
    await Promise.all([
      mkdir(path.join(localDirectory, "app"), { recursive: true }),
      mkdir(path.join(localDirectory, "launcher"), { recursive: true }),
      mkdir(deployDirectory, { recursive: true }),
      mkdir(sourceDirectory, { recursive: true }),
      mkdir(visualDirectory, { recursive: true }),
      mkdir(outputDirectory, { recursive: true }),
      mkdir(extractedRoot, { recursive: true }),
    ]);

    await Promise.all([
      cp(distDirectory, deployDirectory, { recursive: true, preserveTimestamps: true }),
      cp(distDirectory, path.join(localDirectory, "app"), { recursive: true, preserveTimestamps: true }),
      copyFile(path.join(projectRoot, "launcher", "server.mjs"), path.join(localDirectory, "launcher", "server.mjs")),
      copyFile(path.join(projectRoot, "launcher", "READ ME FIRST.txt"), path.join(localDirectory, "READ ME FIRST.txt")),
      copyFile(path.join(projectRoot, "Start Maxey Sales Ledger.command"), path.join(localDirectory, "Start Maxey Sales Ledger.command")),
      copyFile(path.join(projectRoot, "Start Maxey Sales Ledger.cmd"), path.join(localDirectory, "Start Maxey Sales Ledger.cmd")),
    ]);
    await chmod(path.join(localDirectory, "Start Maxey Sales Ledger.command"), 0o755);
    await copySourceTree(sourceDirectory);
    const sourceSize = await measureTree(sourceDirectory);
    if (sourceSize.files > maximumSourceFiles || sourceSize.bytes > maximumSourceBytes) {
      throw new Error(
        `Source package is unexpectedly large (${sourceSize.files} files, ${sourceSize.bytes} bytes). `
        + "Review the source allowlist before packaging.",
      );
    }

    const screenshots = (await readdir(path.join(projectRoot, "release-screenshots"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .sort(compareNames);
    if (screenshots.length === 0) throw new Error("release-screenshots/ does not contain any PNG screenshots.");
    await Promise.all(screenshots.map((entry) => copyFile(
      path.join(projectRoot, "release-screenshots", entry.name),
      path.join(visualDirectory, entry.name),
    )));
    await copyFile(
      path.join(projectRoot, "docs", "brand", "sales-ledger-brand-sheet.png"),
      path.join(visualDirectory, "sales-ledger-brand-sheet.png"),
    );

    await Promise.all([
      normalizeTree(localDirectory),
      normalizeTree(deployDirectory),
      normalizeTree(sourceDirectory),
      normalizeTree(visualDirectory),
    ]);
    await Promise.all([
      chmod(path.join(localDirectory, "Start Maxey Sales Ledger.command"), 0o755),
      chmod(path.join(sourceDirectory, "Start Maxey Sales Ledger.command"), 0o755),
    ]);
    await Promise.all([
      createArchive(deployDirectory, path.join(outputDirectory, archiveNames.deploy)),
      createArchive(localDirectory, path.join(outputDirectory, archiveNames.local)),
      createArchive(sourceDirectory, path.join(outputDirectory, archiveNames.source)),
      createArchive(visualDirectory, path.join(outputDirectory, archiveNames.visual)),
    ]);

    const checksumLines = [];
    for (const archiveName of Object.values(archiveNames)) {
      checksumLines.push(`${await sha256(path.join(outputDirectory, archiveName))}  ${archiveName}`);
    }
    await writeFile(path.join(outputDirectory, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");
    await verifyChecksumFile(outputDirectory, Object.values(archiveNames));

    for (const [kind, archiveName] of Object.entries(archiveNames)) {
      await run("/usr/bin/unzip", ["-t", path.join(outputDirectory, archiveName)]);
      const destination = path.join(extractedRoot, kind);
      await mkdir(destination, { recursive: true });
      await run("/usr/bin/unzip", ["-q", path.join(outputDirectory, archiveName), "-d", destination]);
    }
    await assertRequiredExtractedLayout(extractedRoot, archiveNames);
    await compareDirectories(deployDirectory, path.join(extractedRoot, "deploy"), archiveNames.deploy);
    await compareDirectories(localDirectory, path.join(extractedRoot, "local"), archiveNames.local);
    await compareDirectories(sourceDirectory, path.join(extractedRoot, "source"), archiveNames.source);
    await compareDirectories(visualDirectory, path.join(extractedRoot, "visual"), archiveNames.visual);
    await compareDirectories(distDirectory, path.join(extractedRoot, "deploy"), archiveNames.deploy, { compareModes: false });
    await compareDirectories(distDirectory, path.join(extractedRoot, "local", "app"), archiveNames.local, { compareModes: false });
    if (await releaseInputFingerprint() !== initialInputFingerprint) {
      throw new Error("Release inputs changed while packaging. Stop other builds or edits and run packaging again.");
    }

    await mkdir(releaseDirectory, { recursive: true });
    await moveVerifiedOutputs(
      outputDirectory,
      releaseDirectory,
      generatedArtifactNames,
      options.replace,
    );
    await verifyChecksumFile(releaseDirectory, Object.values(archiveNames));
    console.log(`Verified Sales Ledger ${version} release written to ${releaseDirectory}`);
    for (const artifactName of generatedArtifactNames) console.log(`- ${artifactName}`);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Release packaging failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
