import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { createReadyCloudTestEnvironment } from "./firestore-emulator-readiness";

const PROJECT_ID = "demo-sales-ledger-rules";
const APP_ORIGIN = "http://127.0.0.1:4210";
const AUTH_ORIGIN = "http://127.0.0.1:9099";
const API_KEY = "fake-cloud-test-key";
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, AUTH_ORIGIN, "http://127.0.0.1:8080"]);
const NON_LOOPBACK_REQUEST = /^(?!http:\/\/127\.0\.0\.1:(?:4210|8080|9099)(?:\/|$))/;
let environment: RulesTestEnvironment;
let denyProxy: Server | undefined;
let denyProxyAddress: string | undefined;
const proxySockets = new Set<Socket>();
const unexpectedProxyTargets = new Set<string>();

function localDenyProxy() {
  return denyProxyAddress ? { server: denyProxyAddress, bypass: "127.0.0.1,localhost,[::1]" } : undefined;
}

async function startDenyProxy() {
  function recordTarget(target: string) {
    let host = "invalid-proxy-target";
    try { host = new URL(target.includes("://") ? target : `https://${target}`).host; } catch { /* Reject malformed targets too. */ }
    if (host !== "www.google.com" && host !== "apis.google.com") unexpectedProxyTargets.add(host);
  }
  // This proxy has no forwarding implementation. WebKit's explicit loopback
  // bypass keeps emulator streams native; every other destination is rejected.
  denyProxy = createServer((request, response) => {
    recordTarget(request.url ?? "");
    response.writeHead(403, { Connection: "close" });
    response.end("Remote requests are disabled for local emulator tests.");
  });
  denyProxy.on("connect", (request, socket) => {
    recordTarget(request.url ?? "");
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  denyProxy.on("upgrade", (request, socket) => {
    recordTarget(request.url ?? "");
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  denyProxy.on("connection", (socket) => {
    proxySockets.add(socket);
    socket.on("close", () => proxySockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    denyProxy!.once("error", reject);
    denyProxy!.listen(0, "127.0.0.1", () => resolve());
  });
  const address = denyProxy.address();
  if (!address || typeof address === "string") throw new Error("The local rejecting proxy did not open a loopback port.");
  denyProxyAddress = `http://127.0.0.1:${address.port}`;
}

function isBlockedSdkAuxiliary(address: URL, method: string) {
  const queryKeys = [...address.searchParams.keys()];
  const connectionProbe = address.origin === "https://www.google.com" && address.pathname === "/images/cleardot.gif"
    && queryKeys.every((key) => key === "zx") && method === "GET";
  const unusedPopupScript = address.origin === "https://apis.google.com" && address.pathname === "/js/api.js"
    && queryKeys.every((key) => key === "onload") && /^__iframefcb\d+$/.test(address.searchParams.get("onload") ?? "") && method === "GET";
  return connectionProbe || unusedPopupScript;
}

async function restrictToEmulators(context: BrowserContext) {
  const unexpectedOrigins = new Set<string>();
  if (denyProxyAddress) {
    // Passive observation only: any route, even a narrow matcher, activates
    // native WebKit interception for all URLs in this Playwright release.
    context.on("request", (request) => {
      const address = new URL(request.url());
      if (!ALLOWED_ORIGINS.has(address.origin) && !isBlockedSdkAuxiliary(address, request.method())) unexpectedOrigins.add(address.origin);
    });
    return unexpectedOrigins;
  }
  // Match outside destinations only, avoiding the test callback for local
  // streaming requests. Playwright may still enable engine-level interception.
  await context.route(NON_LOOPBACK_REQUEST, async (route) => {
    const address = new URL(route.request().url());
    if (ALLOWED_ORIGINS.has(address.origin)) {
      await route.continue();
      return;
    }
    // The installed Firebase SDK probes this image after a connection loss,
    // and proactively requests the unused popup helper on mobile. Neither is
    // permitted to leave this computer, even though they are expected SDK work.
    if (!isBlockedSdkAuxiliary(address, route.request().method())) unexpectedOrigins.add(address.origin);
    await route.abort("blockedbyclient");
  });
  return unexpectedOrigins;
}

interface EmulatorCode { email: string; oobCode: string }

async function readEmailCodes(request: APIRequestContext): Promise<EmulatorCode[]> {
  const response = await request.get(`${AUTH_ORIGIN}/emulator/v1/projects/${PROJECT_ID}/oobCodes`, { maxRedirects: 0 });
  expect(response.ok(), "The local Auth emulator must be running; real authentication is forbidden.").toBeTruthy();
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("oobCodes" in body) || !Array.isArray(body.oobCodes)) {
    throw new Error("The local Auth emulator did not return its test-only email-code collection.");
  }
  return body.oobCodes.filter((entry): entry is EmulatorCode =>
    entry !== null && typeof entry === "object" && typeof entry.email === "string" && typeof entry.oobCode === "string",
  );
}

async function createPilotAccount(request: APIRequestContext, label: string) {
  const email = `${label}-${randomUUID()}@example.test`;
  // A synthetic emulator account exercises the same self-service enrollment
  // path as a salesperson. Its token is never injected into the browser.
  const response = await request.post(`${AUTH_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    maxRedirects: 0,
    data: { email, password: `emulator-only-${randomUUID()}`, returnSecureToken: true },
  });
  expect(response.ok(), "Creating a synthetic account in the local Auth emulator failed.").toBeTruthy();
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("localId" in body) || typeof body.localId !== "string" || !/^[A-Za-z0-9_-]+$/.test(body.localId)) {
    throw new Error("The local Auth emulator did not return a valid synthetic UID.");
  }
  return email;
}

async function signInWithEmail(page: Page, request: APIRequestContext, email: string) {
  const priorCodes = new Set((await readEmailCodes(request)).filter((entry) => entry.email === email).map((entry) => entry.oobCode));
  await page.goto(APP_ORIGIN);
  await expect(page.getByText("Local test only", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your sales, saved securely.", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use an email link instead", exact: true }).click();
  await page.getByLabel("Your email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Check your email for a sign-in link." })).toBeVisible();

  let code = "";
  await expect.poll(async () => {
    const codes = await readEmailCodes(request);
    code = codes.find((entry) => entry.email === email && !priorCodes.has(entry.oobCode))?.oobCode ?? "";
    return code.length > 0;
  }, { message: "The local emulator should issue the email link requested through the UI." }).toBe(true);

  // Only the fake code is copied from the emulator. Do not navigate to an
  // emulator-supplied remote URL or place the user's email in a URL parameter.
  const link = new URL(APP_ORIGIN);
  link.searchParams.set("mode", "signIn");
  link.searchParams.set("oobCode", code);
  link.searchParams.set("apiKey", API_KEY);
  await page.goto(link.href);
  await expect(page.getByRole("heading", { name: "Finish signing in", exact: true })).toBeVisible();
  await page.getByLabel("Your email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Confirm email and sign in", exact: true }).click();
  await expect(page.getByRole("region", { name: "Cloud account", exact: true })).toContainText(email);
  // Navigation is device-local and may survive a same-device account switch.
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await expect(page.locator(".dashboard-page")).toBeVisible();
  await expect(page).toHaveURL(`${APP_ORIGIN}/`);
}

async function openSales(page: Page) {
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
}

function visibleSales(page: Page) {
  return page.locator(".sales-table-wrap:visible, .sales-card-list:visible");
}

async function expectEmptyLedger(page: Page) {
  await openSales(page);
  await expect(page.getByText("No sales in this month yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Actions for stock / })).toHaveCount(0);
}

async function addMiniSale(page: Page, stock: string, customerLastName = "Example") {
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeVisible();
  await page.getByLabel("Customer last name", { exact: true }).fill(customerLastName);
  await page.getByRole("textbox", { name: /^Stock number/ }).fill(stock);
  await page.getByRole("textbox", { name: "Front gross", exact: true }).fill("-316.61");
  await page.getByRole("textbox", { name: "Total F&I gross", exact: true }).fill("1200");
  await expect(page.locator(".sale-commission-components dd > strong")).toHaveText(["$300.00", "$240.00", "$540.00"]);
  await expect(page.locator(".sale-footer-method")).toContainText("Mini");
  await page.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
  await expect(page.getByRole("region", { name: "Cloud account", exact: true })).toContainText("Saved securely at");
  await openSales(page);
  await expect(visibleSales(page)).toContainText(stock);
  await expect(visibleSales(page)).toContainText("$540");
}

async function editSale(page: Page, stock: string) {
  await openSales(page);
  await page.getByRole("button", { name: `Actions for stock ${stock}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
}

test.use({
  serviceWorkers: "block",
  proxy: async ({ browserName }, provideProxy) => { await provideProxy(browserName === "webkit" ? localDenyProxy() : undefined); },
});

test.beforeAll(async ({ browserName }) => {
  environment = await createReadyCloudTestEnvironment();
  if (browserName === "webkit") await startDenyProxy();
});

test.afterAll(async () => {
  // Close our clients only. Other emulator suites may own records in this
  // project; this journey never clears or replaces their data or rules.
  await environment?.cleanup();
  for (const socket of proxySockets) socket.destroy();
  if (denyProxy) await new Promise<void>((resolve) => denyProxy!.close(() => resolve()));
  denyProxy = undefined;
  denyProxyAddress = undefined;
});

test.beforeEach(async ({ baseURL }) => {
  expect(baseURL, "Cloud journeys may only run against the dedicated local app.").toBe(APP_ORIGIN);
});

test("self-service email-link login, Mini commission, second-device visibility, and account isolation", async ({ browser, context, page, request }, testInfo) => {
  const firstBlocked = await restrictToEmulators(context);
  const accountA = await createPilotAccount(request, "ledger-a");
  const accountB = await createPilotAccount(request, "ledger-b");
  const stock = `CLOUD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const removedStock = `REMOVED-${randomUUID().slice(0, 8).toUpperCase()}`;
  const secondContext = await browser.newContext({ baseURL: APP_ORIGIN, serviceWorkers: "block", viewport: page.viewportSize(), proxy: localDenyProxy() });
  const secondBlocked = await restrictToEmulators(secondContext);
  try {
    await signInWithEmail(page, request, accountA);
    await expectEmptyLedger(page);
    await addMiniSale(page, stock);
    await page.screenshot({ path: testInfo.outputPath("mini-cloud-sale.png"), fullPage: true });

    const secondPage = await secondContext.newPage();
    await signInWithEmail(secondPage, request, accountA);
    await openSales(secondPage);
    await expect(visibleSales(secondPage)).toContainText(stock);
    await editSale(secondPage, stock);
    await expect(secondPage.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("-316.61");
    await expect(secondPage.getByRole("textbox", { name: "Total F&I gross", exact: true })).toHaveValue("1200.00");
    await expect(secondPage.locator(".sale-commission-components dd > strong")).toHaveText(["$300.00", "$240.00", "$540.00"]);
    await secondPage.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("textbox", { name: /^Salesperson name/ }).fill("Pilot Example");
    await expect(page.getByRole("button", { name: "Save settings", exact: true }).first()).toBeEnabled();
    await expect(page.getByText("All changes saved. Settings save automatically.", { exact: true })).toBeVisible();
    await secondPage.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(secondPage.getByRole("textbox", { name: /^Salesperson name/ })).toHaveValue("Pilot Example");
    await secondPage.reload();
    await expect(secondPage.getByRole("region", { name: "Cloud account", exact: true })).toContainText(accountA);
    await secondPage.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(secondPage.getByRole("textbox", { name: /^Salesperson name/ })).toHaveValue("Pilot Example");
    await openSales(secondPage);

    await page.getByRole("button", { name: /^Cloud saving/ }).click();
    const cloudSaving = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Cloud saving", exact: true }),
    });
    await expect(cloudSaving).toContainText("no folders or uploads needed");
    await expect(cloudSaving).toContainText("automatic recovery backups are not included");
    await expect(page.getByRole("button", { name: "Download a copy", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Import sales|Restore from backup|Choose.*folder|Connect.*folder|Connect Google Drive/i })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("cloud-saving-settings.png"), fullPage: true });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download a copy", exact: true }).click();
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    const backupPath = testInfo.outputPath("synthetic-cloud-backup.json");
    await download.saveAs(backupPath);
    const backup: unknown = JSON.parse(await readFile(backupPath, "utf8"));
    expect(backup).toMatchObject({
      format: "maxey-sales-command-center",
      data: {
        profile: { salespersonName: "Pilot Example" },
        sales: [{ stockNumber: stock, customerLastName: "Example", frontGrossCents: -31661, fiGrossCents: 120000 }],
      },
    });
    await expect(page.getByText("Verified full backup download started. Confirm the file was saved.", { exact: true })).toBeVisible();

    // Leave a real, actionable notification at the account boundary. It must
    // not reappear in B's workspace or retain a callback to A's deleted sale.
    await addMiniSale(page, removedStock, "ArchivedExample");
    await page.getByRole("button", { name: `Actions for stock ${removedStock}`, exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Delete sale", exact: true }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete this sale?", exact: true });
    await deleteDialog.getByRole("button", { name: "Delete sale", exact: true }).click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    await expect(page.getByText(`${removedStock} was removed from calculations.`, { exact: true })).toBeVisible();

    await page.getByRole("region", { name: "Cloud account", exact: true }).getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your sales, saved securely.", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Cloud account", exact: true })).toHaveCount(0);
    await expect(page.locator(".sales-surface, .dashboard-page")).toHaveCount(0);
    await expect(page.getByText(stock, { exact: true })).toHaveCount(0);
    await expect(page.getByText(removedStock, { exact: false })).toHaveCount(0);
    await expect(page.getByText("ArchivedExample", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);

    await signInWithEmail(page, request, accountB);
    await expectEmptyLedger(page);
    await expect(page.getByText(stock, { exact: true })).toHaveCount(0);
    await expect(page.getByText(removedStock, { exact: false })).toHaveCount(0);
    await expect(page.getByText("ArchivedExample", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: /^Salesperson name/ })).toHaveValue("");
    await page.reload();
    await expect(page.getByRole("region", { name: "Cloud account", exact: true })).toContainText(accountB);
    await expectEmptyLedger(page);
    // Account B's empty ledger must not erase or replace A's independent data.
    await expect(visibleSales(secondPage)).toContainText(stock);
    expect([...firstBlocked, ...secondBlocked, ...unexpectedProxyTargets], "No unexpected destinations may be used outside the loopback app and emulators.").toEqual([]);
  } finally {
    await secondContext.close();
  }
});

test("automatic saving rejects stale edits and preserves offline typing until reconnect", async ({ browser, context, page, request }, testInfo) => {
  const firstBlocked = await restrictToEmulators(context);
  const email = await createPilotAccount(request, "ledger-conflict");
  const stock = `RETRY-${randomUUID().slice(0, 8).toUpperCase()}`;
  const secondContext = await browser.newContext({ baseURL: APP_ORIGIN, serviceWorkers: "block", viewport: page.viewportSize(), proxy: localDenyProxy() });
  const secondBlocked = await restrictToEmulators(secondContext);
  try {
    await signInWithEmail(page, request, email);
    await addMiniSale(page, stock);
    const secondPage = await secondContext.newPage();
    await signInWithEmail(secondPage, request, email);
    await editSale(secondPage, stock);

    // Device B's open editor holds revision 1. Device A's change automatically
    // commits revision 2 while its editor stays open and focused.
    await editSale(page, stock);
    await page.getByRole("textbox", { name: "Front gross", exact: true }).fill("3100");
    await expect(page.locator(".sale-form__save-state")).toHaveText("Saved to cloud");
    await expect(page.getByRole("textbox", { name: "Front gross", exact: true })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("3100");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();
    await expect(visibleSales(page)).toContainText("$3,100");

    await secondPage.getByRole("textbox", { name: "Total F&I gross", exact: true }).fill("999");
    const conflict = secondPage.getByRole("alert").filter({ hasText: "Changes need attention" });
    // Draft revisions protect raw typing as well as the committed sale. The
    // draft conflict must stop B before it can overwrite A's acknowledged edit.
    await expect(conflict).toContainText("This draft changed in another tab or device.");
    await expect(conflict).toContainText("Your current entries are still here.");
    await expect(secondPage.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("-316.61");
    await expect(secondPage.getByRole("textbox", { name: "Total F&I gross", exact: true })).toHaveValue("999");
    await expect(visibleSales(page)).toContainText("$1,200");
    await expect(visibleSales(page)).not.toContainText("$999");

    await secondPage.getByRole("button", { name: "Reload saved draft", exact: true }).click();
    await secondPage.getByRole("dialog", { name: "Replace this draft with the saved draft?", exact: true }).getByRole("button", { name: "Load latest", exact: true }).click();
    await expect(secondPage.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("3100.00");
    await expect(secondPage.getByRole("textbox", { name: "Total F&I gross", exact: true })).toHaveValue("1200.00");
    await expect(conflict).toBeHidden();
    await secondContext.setOffline(true);
    // The open modal hides the background from the accessibility tree, so
    // inspect its still-rendered status without trying to interact behind it.
    await expect(secondPage.locator(".cloud-account-bar")).toContainText("Offline — reconnect to save");
    await secondPage.getByRole("textbox", { name: "Front gross", exact: true }).fill("4500");
    await expect(secondPage.getByRole("alert").filter({ hasText: "Changes need attention" })).toContainText(/offline|reconnect/i);
    await expect(secondPage.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
    await expect(secondPage.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("4500");
    await expect(secondPage.getByRole("textbox", { name: "Total F&I gross", exact: true })).toHaveValue("1200.00");
    await expect(visibleSales(page)).toContainText("$3,100");
    await expect(visibleSales(page)).not.toContainText("$4,500");
    await secondPage.screenshot({ path: testInfo.outputPath("offline-draft-preserved.png"), fullPage: true });

    await secondContext.setOffline(false);
    await expect(secondPage.locator(".cloud-account-bar")).not.toContainText("Offline — reconnect to save");
    // The still-open editor retries after reconnect. It does not rely on a
    // hidden offline queue or require another click on a save button.
    await expect(secondPage.locator(".sale-form__save-state")).toHaveText("Saved to cloud");
    await expect(secondPage.getByRole("textbox", { name: "Front gross", exact: true })).toBeFocused();
    await expect(visibleSales(page)).toContainText("$4,500");
    await page.reload();
    await expect(page.getByRole("region", { name: "Cloud account", exact: true })).toContainText(email);
    await openSales(page);
    await expect(visibleSales(page)).toContainText("$4,500");
    await secondPage.getByRole("button", { name: "Done", exact: true }).click();
    await expect(secondPage.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();
    await expect(secondPage.getByRole("region", { name: "Cloud account", exact: true })).toContainText("Saved securely at");
    await expect(visibleSales(page)).toContainText("$4,500");
    await editSale(page, stock);
    await expect(page.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("4500.00");
    await expect(page.getByRole("textbox", { name: "Total F&I gross", exact: true })).toHaveValue("1200.00");
    expect([...firstBlocked, ...secondBlocked, ...unexpectedProxyTargets], "No unexpected destinations may be used outside the loopback app and emulators.").toEqual([]);
  } finally {
    await secondContext.setOffline(false);
    await secondContext.close();
  }
});

test("unfinished sale drafts resume on another device without entering totals or crossing accounts", async ({ browser, context, page, request }) => {
  const firstBlocked = await restrictToEmulators(context);
  const accountA = await createPilotAccount(request, "ledger-draft-a");
  const accountB = await createPilotAccount(request, "ledger-draft-b");
  const stock = `DRAFT-${randomUUID().slice(0, 8).toUpperCase()}`;
  const secondContext = await browser.newContext({ baseURL: APP_ORIGIN, serviceWorkers: "block", viewport: page.viewportSize(), proxy: localDenyProxy() });
  const secondBlocked = await restrictToEmulators(secondContext);
  try {
    await signInWithEmail(page, request, accountA);
    await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
    await page.getByLabel("Customer last name", { exact: true }).fill("DraftExample");
    await page.getByRole("textbox", { name: /^Stock number/ }).fill(stock);
    await page.getByRole("textbox", { name: "Front gross", exact: true }).fill("0.");
    await expect(page.locator(".sale-form__save-state")).toHaveText("Draft saved to cloud · not in your sales yet");
    await expect(page.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("0.");
    // Escape closes the editor safely after its raw draft is acknowledged.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
    await expectEmptyLedger(page);

    const secondPage = await secondContext.newPage();
    await signInWithEmail(secondPage, request, accountA);
    await expectEmptyLedger(secondPage);
    await secondPage.getByRole("button", { name: "Add sale", exact: true }).first().click();
    await expect(secondPage.getByLabel("Customer last name", { exact: true })).toHaveValue("DraftExample");
    await expect(secondPage.getByRole("textbox", { name: /^Stock number/ })).toHaveValue(stock);
    await expect(secondPage.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("0.");
    await expect(secondPage.locator(".sale-draft-restored")).toContainText("Continue where you left off.");

    await page.getByRole("region", { name: "Cloud account", exact: true }).getByRole("button", { name: "Sign out", exact: true }).click();
    await signInWithEmail(page, request, accountB);
    await expectEmptyLedger(page);
    await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
    await expect(page.getByLabel("Customer last name", { exact: true })).toHaveValue("");
    await expect(page.getByRole("textbox", { name: /^Stock number/ })).toHaveValue("");
    await expect(page.locator(".sale-draft-restored")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();

    // Only the explicit Add sale action turns A's recovered draft into one
    // delivery. B remains empty even after A's cloud record is committed.
    await secondPage.getByRole("textbox", { name: "Front gross", exact: true }).fill("2300");
    await secondPage.getByRole("textbox", { name: "Total F&I gross", exact: true }).fill("1200");
    await secondPage.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();
    await expect(secondPage.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
    await openSales(secondPage);
    await expect(visibleSales(secondPage)).toContainText(stock);
    await expect(secondPage.getByRole("button", { name: `Actions for stock ${stock}`, exact: true })).toHaveCount(1);
    await expectEmptyLedger(page);
    expect([...firstBlocked, ...secondBlocked, ...unexpectedProxyTargets], "Draft recovery must use only the app and local emulators.").toEqual([]);
  } finally {
    await secondContext.close();
  }
});
