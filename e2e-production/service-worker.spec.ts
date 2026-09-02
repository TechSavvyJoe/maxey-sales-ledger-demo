import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("a cached workspace opens without waiting for a hanging navigation request", async ({ context, page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add sale", exact: true }).first()).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 });

  let releaseNetwork!: () => void;
  const heldNetwork = new Promise<void>((resolve) => { releaseNetwork = resolve; });
  let navigationRequests = 0;
  const homeUrl = page.url();
  await context.route(homeUrl, async (route) => {
    navigationRequests += 1;
    await heldNetwork;
    await route.abort("timedout");
  });

  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Add sale", exact: true }).first()).toBeVisible();
    expect(navigationRequests).toBe(0);
  } finally {
    releaseNetwork();
    await context.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("a waiting update keeps its shell separate until Update now activates it", async ({ page }) => {
  const distRoot = path.resolve("dist");
  let version = "original";
  const mime: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const file = path.resolve(distRoot, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(`${distRoot}${path.sep}`)) {
        response.writeHead(403).end();
        return;
      }
      let body = await readFile(file);
      if (file.endsWith("index.html")) {
        body = Buffer.from(body.toString().replace("<html", `<html data-test-shell="${version}"`));
      }
      if (file.endsWith("sw.js") && version === "updated") {
        body = Buffer.from(body.toString().replace(
          /const CACHE_NAME = "([^"]+)";/,
          'const CACHE_NAME = "$1-update-test";',
        ));
      }
      response.writeHead(200, {
        "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test update server did not start.");

  try {
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.getByRole("button", { name: "Add sale", exact: true }).first()).toBeVisible();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 15_000 });
    await expect(page.locator("html")).toHaveAttribute("data-test-shell", "original");

    version = "updated";
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-test-shell", "original");
    await expect(page.getByRole("button", { name: "Update now", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Update now", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-test-shell", "updated");
    await expect(page.getByRole("button", { name: "Add sale", exact: true }).first()).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => (
      (await caches.keys()).filter((key) => key.startsWith("sales-ledger-"))
    ))).toEqual([expect.stringMatching(/-update-test$/)]);
  } finally {
    await page.goto("about:blank");
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
