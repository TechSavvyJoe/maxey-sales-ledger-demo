import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createReadyCloudTestEnvironment } from "./firestore-emulator-readiness";

const PROJECT_ID = "demo-sales-ledger-rules";
const APP_ORIGIN = "http://127.0.0.1:4220";
const AUTH_ORIGIN = "http://127.0.0.1:9099";
const API_KEY = "fake-compiled-cloud-test-key";
const CLOUD_MANIFEST_DESCRIPTION = "Private vehicle sales, commission, and performance tracker with automatic account-based cloud saving.";
const LOCAL_ORIGINS = new Set([APP_ORIGIN, AUTH_ORIGIN, "http://127.0.0.1:8080"]);
const NON_LOOPBACK_REQUEST = /^(?!http:\/\/127\.0\.0\.1:(?:4220|8080|9099)(?:\/|$))/;
let environment: RulesTestEnvironment;

interface EmulatorCode { email: string; oobCode: string }

function expectedSdkAuxiliary(address: URL, method: string) {
  const keys = [...address.searchParams.keys()];
  return (address.origin === "https://www.google.com" && address.pathname === "/images/cleardot.gif"
      && keys.every((key) => key === "zx") && method === "GET")
    || (address.origin === "https://apis.google.com" && address.pathname === "/js/api.js"
      && keys.every((key) => key === "onload") && /^__iframefcb\d+$/.test(address.searchParams.get("onload") ?? "") && method === "GET");
}

async function blockRemoteRequests(context: BrowserContext) {
  const unexpected = new Set<string>();
  await context.route(NON_LOOPBACK_REQUEST, async (route) => {
    const request = route.request();
    const address = new URL(request.url());
    if (LOCAL_ORIGINS.has(address.origin)) {
      await route.continue();
      return;
    }
    if (!expectedSdkAuxiliary(address, request.method())) unexpected.add(address.origin);
    await route.abort("blockedbyclient");
  });
  return unexpected;
}

async function readEmailCodes(request: APIRequestContext): Promise<EmulatorCode[]> {
  const response = await request.get(`${AUTH_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/oobCodes`, { maxRedirects: 0 });
  expect(response.ok(), "The local Auth emulator must be running; real authentication is forbidden.").toBeTruthy();
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("oobCodes" in body) || !Array.isArray(body.oobCodes)) {
    throw new Error("The local Auth emulator did not return its test-only email codes.");
  }
  return body.oobCodes.filter((entry): entry is EmulatorCode =>
    entry !== null && typeof entry === "object" && typeof entry.email === "string" && typeof entry.oobCode === "string",
  );
}

async function createAccount(request: APIRequestContext) {
  const email = `compiled-${randomUUID()}@example.test`;
  const response = await request.post(`${AUTH_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    maxRedirects: 0,
    data: { email, password: `emulator-only-${randomUUID()}`, returnSecureToken: true },
  });
  expect(response.ok(), "Creating the synthetic emulator account failed.").toBeTruthy();
  return email;
}

async function signInWithEmailLink(page: Page, request: APIRequestContext, email: string) {
  const previousCodes = new Set((await readEmailCodes(request)).filter((entry) => entry.email === email).map((entry) => entry.oobCode));
  await page.getByRole("button", { name: "Use an email link instead", exact: true }).click();
  await page.getByLabel("Your email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check your email for a sign-in link." })).toBeVisible();

  let code = "";
  await expect.poll(async () => {
    code = (await readEmailCodes(request)).find((entry) => entry.email === email && !previousCodes.has(entry.oobCode))?.oobCode ?? "";
    return code.length > 0;
  }, { message: "The Auth emulator should issue the requested email link." }).toBe(true);

  const link = new URL(APP_ORIGIN);
  link.searchParams.set("mode", "signIn");
  link.searchParams.set("oobCode", code);
  link.searchParams.set("apiKey", API_KEY);
  await page.goto(link.href);
  await expect(page.getByRole("heading", { name: "Finish signing in", exact: true })).toBeVisible();
  await page.getByLabel("Your email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Confirm email and sign in", exact: true }).click();
  await expect(page.getByRole("region", { name: "Cloud account", exact: true })).toContainText(email);
  await expect(page.locator(".dashboard-page")).toBeVisible();
}

test.beforeAll(async () => {
  environment = await createReadyCloudTestEnvironment();
});

test.afterAll(async () => {
  await environment?.cleanup();
});

test.beforeEach(async ({ baseURL }) => {
  expect(baseURL, "The compiled-cloud smoke test may only use its dedicated loopback app.").toBe(APP_ORIGIN);
});

test("compiled cloud signs in, saves in the background, and reloads without a service worker", async ({ context, page, request }) => {
  const unexpectedOrigins = await blockRemoteRequests(context);
  const requestedPaths: string[] = [];
  context.on("request", (browserRequest) => requestedPaths.push(new URL(browserRequest.url()).pathname));

  await page.goto(APP_ORIGIN);
  await expect(page.getByText("Local test only", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your sales, saved securely.", exact: true })).toBeVisible();

  const moduleSources = await page.locator('script[type="module"][src]').evaluateAll((scripts) =>
    scripts.map((script) => new URL((script as HTMLScriptElement).src).pathname));
  expect(moduleSources).toHaveLength(1);
  expect(moduleSources[0]).toMatch(/^\/assets\/index-[A-Za-z0-9_-]+\.js$/);
  expect(requestedPaths.some((pathname) => pathname.startsWith("/src/"))).toBe(false);

  const manifestResponse = await request.get(`${APP_ORIGIN}/manifest.webmanifest`);
  expect(manifestResponse.ok()).toBeTruthy();
  expect(await manifestResponse.json()).toMatchObject({
    name: "Sales Ledger · Commission Tracker",
    short_name: "Sales Ledger",
    description: CLOUD_MANIFEST_DESCRIPTION,
  });
  expect(await access(path.resolve("dist-cloud/sw.js")).then(() => true, () => false)).toBe(false);

  const email = await createAccount(request);
  await signInWithEmailLink(page, request, email);

  const stock = `COMPILED-${randomUUID().slice(0, 8).toUpperCase()}`;
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Customer last name", { exact: true }).fill("CompiledExample");
  await page.getByRole("textbox", { name: /^Stock number/ }).fill(stock);
  await page.getByRole("textbox", { name: "Front gross", exact: true }).fill("2000");
  await page.getByRole("textbox", { name: "Total F&I gross", exact: true }).fill("500");
  await page.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: `Actions for stock ${stock}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  const frontGross = page.getByRole("textbox", { name: "Front gross", exact: true });
  await frontGross.fill("3100");
  await expect(page.locator(".sale-form__save-state")).toHaveText("Changes waiting to save…");
  await expect(page.locator(".sale-form__save-state")).toHaveText("Saved to cloud");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  await page.reload();
  await expect(page.getByRole("region", { name: "Cloud account", exact: true })).toContainText(email);
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: `Actions for stock ${stock}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("3100.00");

  const serviceWorkerState = await page.evaluate(async () => ({
    controller: Boolean(navigator.serviceWorker?.controller),
    registrations: "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  }));
  expect(serviceWorkerState).toEqual({ controller: false, registrations: 0 });
  expect(requestedPaths.some((pathname) => pathname.endsWith("/sw.js"))).toBe(false);
  expect([...unexpectedOrigins], "The compiled smoke test must not contact any non-loopback service.").toEqual([]);

  const builtIndex = await readFile(path.resolve("dist-cloud/index.html"), "utf8");
  expect(builtIndex).not.toContain("/src/main.tsx");
  expect(builtIndex).toMatch(/\.\/assets\/index-[A-Za-z0-9_-]+\.js/);
});

test("compiled Firebase Settings stays responsive and uses cloud saving instead of Drive setup", async ({ context, page, request }, testInfo) => {
  test.setTimeout(150_000);
  const unexpectedOrigins = await blockRemoteRequests(context);
  await page.goto(APP_ORIGIN);
  await signInWithEmailLink(page, request, await createAccount(request));
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.locator(".settings-page")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Settings categories", exact: true });
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1180, 820], [1440, 900], [2560, 1440]]) {
    await page.setViewportSize({ width, height });
    for (const category of ["Profile & goals", "Days off", "Pay plan", "Volume bonuses", "Cloud saving"]) {
      await nav.getByRole("button", { name: category, exact: true }).click();
      await expect(nav.getByRole("button", { name: category, exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".settings-category-panel:visible")).toHaveCount(1);
      const geometry = await page.evaluate(() => ({
        viewport: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        targets: [...document.querySelectorAll(".settings-category-button")].map((button) => {
          const bounds = button.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height };
        }),
      }));
      expect(geometry.pageWidth, `${width}px ${category} must fit the viewport`).toBeLessThanOrEqual(width + 1);
      expect(geometry.targets.every((target) => target.width >= 43.9 && target.height >= 43.9)).toBe(true);
    }
    await expect(page.locator(".cloud-data-copy")).toContainText("Automatic saving:");
    await expect(page.getByRole("button", { name: "Download a copy", exact: true })).toBeVisible();
    await expect(page.getByText(/Google Drive/)).toHaveCount(0);
    await expect(page.locator(".automatic-backup-card, .google-drive-backup-card")).toHaveCount(0);
    if (width <= 390) {
      const headings = await page.locator(".settings-secondary-disclosure .settings-disclosure__title strong").evaluateAll((nodes) =>
        nodes.map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
      );
      expect(headings).toHaveLength(2);
      for (const heading of headings) {
        expect(heading.width, "Collapsed section titles need a readable text column").toBeGreaterThanOrEqual(160);
        expect(heading.height, "A short section title must not stack word by word").toBeLessThanOrEqual(48);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(`firebase-settings-${width}x${height}.png`), fullPage: true });
    if (width === 390 || width === 1180) {
      const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(accessibility.violations).toEqual([]);
    }
  }
  await nav.getByRole("button", { name: "Profile & goals", exact: true }).click();
  await page.getByLabel("Salesperson name", { exact: false }).fill("Cloud layout example");
  await expect(page.locator(".settings-dirty-state")).toContainText("All changes saved.");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByLabel("Salesperson name", { exact: false })).toHaveValue("Cloud layout example");
  expect([...unexpectedOrigins]).toEqual([]);
});
