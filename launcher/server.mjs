import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APP_ID = "maxey-sales-ledger";
const LAUNCHER_VERSION = process.env.SALES_LEDGER_LAUNCHER_VERSION ?? "1.9.0";
const HOST = "127.0.0.1";
const PORT = 4180;
const APP_URL = `http://${HOST}:${PORT}/`;
const HEALTH_PATH = "/__maxey_local_health__";
const NO_OPEN = process.env.SALES_LEDGER_NO_OPEN === "1";
const RECOVERY_SCRIPT_HASH = "sha256-YodShMa4YRqCY4hmv2TR2cG/ezeV78jHiIBL/55+xrE=";
const launcherDirectory = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function readAppDirectoryArgument() {
  const equalsArgument = process.argv.find((argument) => argument.startsWith("--app-dir="));
  if (equalsArgument) return path.resolve(process.cwd(), equalsArgument.slice("--app-dir=".length));
  const index = process.argv.indexOf("--app-dir");
  if (index !== -1 && process.argv[index + 1]) return path.resolve(process.cwd(), process.argv[index + 1]);
  if (process.env.SALES_LEDGER_APP_DIR) return path.resolve(process.env.SALES_LEDGER_APP_DIR);

  const packagedDirectory = path.resolve(launcherDirectory, "..", "app");
  if (existsSync(path.join(packagedDirectory, "index.html"))) return packagedDirectory;
  return path.resolve(launcherDirectory, "..", "dist");
}

const appDirectory = readAppDirectoryArgument();

function verifiedAppDirectory() {
  const indexPath = path.join(appDirectory, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`The built app was not found at ${appDirectory}. Restore the complete Local package and try again.`);
  }
  return realpathSync(appDirectory);
}

const realAppDirectory = verifiedAppDirectory();
const appDirectoryPrefix = `${realAppDirectory}${path.sep}`;

function calculateBuildId(directory) {
  const hash = createHash("sha256");

  function visit(currentDirectory, relativeDirectory = "") {
    const entries = readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        hash.update(`directory\0${relativePath}\0`);
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const contents = readFileSync(absolutePath);
        hash.update(`file\0${relativePath}\0${contents.length}\0`);
        hash.update(contents);
      } else if (entry.isSymbolicLink()) {
        hash.update(`symlink\0${relativePath}\0${readlinkSync(absolutePath)}\0`);
      } else {
        hash.update(`other\0${relativePath}\0`);
      }
    }
  }

  visit(directory);
  return hash.digest("hex").slice(0, 20);
}

const buildId = calculateBuildId(realAppDirectory);

function healthPayload() {
  return JSON.stringify({
    app: APP_ID,
    buildId,
    launcherVersion: LAUNCHER_VERSION,
    origin: APP_URL,
  });
}

function applySecurityHeaders(response) {
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' '${RECOVERY_SCRIPT_HASH}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function cacheControlFor(relativePath) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  if (normalizedPath === "index.html" || normalizedPath === "sw.js") return "no-cache, no-store, must-revalidate";
  if (normalizedPath === "manifest.webmanifest") return "no-cache";
  if (normalizedPath.startsWith("assets/")) return "public, max-age=31536000, immutable";
  return "no-cache";
}

function safeFilePath(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl ?? "/", APP_URL).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (relativePath.includes("\0")) return null;
  const resolved = path.resolve(realAppDirectory, relativePath);
  if (resolved !== realAppDirectory && !resolved.startsWith(appDirectoryPrefix)) return null;
  return { relativePath, resolved };
}

function sendText(response, statusCode, message) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(message);
}

function requestHandler(request, response) {
  applySecurityHeaders(response);
  if (request.url === HEALTH_PATH) {
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(healthPayload());
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method not allowed.");
    return;
  }

  let target;
  try {
    target = safeFilePath(request.url);
  } catch {
    sendText(response, 400, "Invalid request path.");
    return;
  }
  if (!target) {
    sendText(response, 403, "Request path is outside the Sales Ledger app.");
    return;
  }

  let details;
  try {
    const realTarget = realpathSync(target.resolved);
    if (realTarget !== realAppDirectory && !realTarget.startsWith(appDirectoryPrefix)) {
      sendText(response, 403, "Request path is outside the Sales Ledger app.");
      return;
    }
    target.resolved = realTarget;
    details = statSync(target.resolved);
  } catch {
    sendText(response, 404, "File not found.");
    return;
  }
  if (!details.isFile()) {
    sendText(response, 404, "File not found.");
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", MIME_TYPES.get(path.extname(target.resolved).toLowerCase()) ?? "application/octet-stream");
  response.setHeader("Content-Length", details.size);
  response.setHeader("Cache-Control", cacheControlFor(target.relativePath));
  if (target.relativePath === "sw.js") response.setHeader("Service-Worker-Allowed", "/");
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(target.resolved).pipe(response);
}

async function inspectExistingListener() {
  try {
    const response = await fetch(`${APP_URL}${HEALTH_PATH.slice(1)}`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return { state: "occupied" };
    const payload = await response.json();
    if (payload?.app !== APP_ID) return { state: "occupied" };
    if (payload?.launcherVersion !== LAUNCHER_VERSION) {
      return { state: "different-version", version: String(payload?.launcherVersion ?? "unknown") };
    }
    if (payload?.buildId !== buildId) {
      return { state: "different-build", buildId: String(payload?.buildId ?? "unknown") };
    }
    return { state: "matching" };
  } catch {
    try {
      await fetch(APP_URL, { signal: AbortSignal.timeout(500) });
      return { state: "occupied" };
    } catch {
      return { state: "free" };
    }
  }
}

function openBrowser() {
  if (NO_OPEN) return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", APP_URL] : [APP_URL];
  const opener = spawn(command, args, { detached: true, stdio: "ignore" });
  opener.once("error", () => console.log(`Open ${APP_URL} in your browser.`));
  opener.unref();
}

function verifyRuntime() {
  const majorVersion = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(majorVersion) || majorVersion < 22) {
    throw new Error(`Node.js 22 or newer is required. This computer is using Node.js ${process.versions.node}.`);
  }
  if (!existsSync(path.join(appDirectory, "index.html"))) {
    throw new Error(`The built app was not found at ${appDirectory}. Restore the complete Local package and try again.`);
  }
}

async function start() {
  verifyRuntime();
  const existing = await inspectExistingListener();
  if (existing.state === "matching") {
    console.log(`Sales Ledger is already running at ${APP_URL}`);
    openBrowser();
    return;
  }
  if (existing.state === "different-version") {
    throw new Error(
      "Another Sales Ledger window is already using this address. Close that window, then try again.",
    );
  }
  if (existing.state === "different-build") {
    throw new Error(
      "Another Sales Ledger window is already using this address. Close that window, then try again.",
    );
  }
  if (existing.state === "occupied") {
    throw new Error(
      `Port ${PORT} is being used by another app. Close that app or ask for help. Sales Ledger will not switch ports because that could create a separate browser workspace.`,
    );
  }

  const server = createServer(requestHandler);
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch(async (error) => {
    if (error?.code !== "EADDRINUSE") throw error;
    const racedListener = await inspectExistingListener();
    if (racedListener.state === "matching") {
      console.log(`Sales Ledger is already running at ${APP_URL}`);
      openBrowser();
      return;
    }
    throw new Error(`Port ${PORT} became unavailable. Close the other app and try again.`);
  });

  if (!server.listening) return;
  console.log(`Sales Ledger is ready at ${APP_URL}`);
  console.log("Keep this window open while you use the app. Press Control-C to stop it.");
  openBrowser();

  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

start().catch((error) => {
  console.error(`\nCould not start Sales Ledger: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
