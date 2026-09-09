import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { read as readWorkbook, utils as workbookUtils } from "xlsx";
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

test("complete downloads include older cloud sales and match their commission reports", async ({ context, page, request }, testInfo) => {
  test.setTimeout(150_000);
  const unexpectedOrigins = await blockRemoteRequests(context);
  await page.clock.setFixedTime(new Date("2026-09-09T16:00:00.000Z"));
  await page.goto(APP_ORIGIN);
  await signInWithEmailLink(page, request, await createAccount(request));

  const entries = [
    { name: "OlderExample", stock: "EXPORT-OLD-01", date: "2026-01-05", gross: "-316.61", fi: "1200", vehicle: "2022 Ford Explorer Limited" },
    { name: "RecentExample", stock: "EXPORT-NEW-01", date: "2026-09-01", gross: "2300", fi: "", vehicle: "2024 Ford Escape Active" },
  ];
  for (const entry of entries) {
    await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
    await page.getByLabel("Delivery date", { exact: true }).fill(entry.date);
    await page.getByLabel("Customer last name", { exact: true }).fill(entry.name);
    await page.getByRole("textbox", { name: /^Stock number/ }).fill(entry.stock);
    await page.getByLabel("Vehicle optional", { exact: true }).fill(entry.vehicle);
    await page.getByRole("textbox", { name: "Front gross", exact: true }).fill(entry.gross);
    await page.getByRole("textbox", { name: "Total F&I gross", exact: true }).fill(entry.fi);
    await page.getByRole("radio", { name: "Finance", exact: true }).check();
    await page.getByRole("checkbox", { name: "Service contract / warranty", exact: true }).check();
    await page.getByLabel("Notes optional", { exact: true }).fill("Fictional export acceptance record.");
    await page.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
  }
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("group", { name: "Sales time range" }).getByRole("button", { name: "All months", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search sales" }).fill("OlderExample");
  await expect(page.locator(".sales-page")).toContainText("EXPORT-OLD-01");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Cloud saving", exact: true }).click();
  const savedStatus = await page.getByRole("region", { name: "Cloud account", exact: true }).getByRole("status").textContent();

  const excelPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel report", exact: true }).click();
  const excel = await excelPromise;
  expect(await excel.failure()).toBeNull();
  expect(excel.suggestedFilename()).toMatch(/^Sales-Ledger-All-Data-.*\.xlsx$/);
  const excelPath = testInfo.outputPath("complete-synthetic-report.xlsx");
  await excel.saveAs(excelPath);
  const workbook = readWorkbook(await readFile(excelPath), { type: "buffer", cellFormula: true });
  expect(workbook.SheetNames).toEqual(expect.arrayContaining(["Start here", "Sales", "Deleted sales", "Commissions", "Monthly", "Yearly", "Weekly", "Metric guide"]));
  const rows = (sheet: string) => workbookUtils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheet], { range: 4, defval: null });
  expect(rows("Sales")).toHaveLength(2);
  expect(rows("Sales")).toEqual(expect.arrayContaining(entries.map((entry) => expect.objectContaining({ "Customer last name": entry.name, "Stock number": entry.stock, Vehicle: entry.vehicle, Notes: "Fictional export acceptance record." }))));
  expect(rows("Commissions")).toEqual(expect.arrayContaining([
    expect.objectContaining({ "Customer last name": "OlderExample", "Front commission": 300, "F&I commission": 240, "Sale commission": 540 }),
    expect.objectContaining({ "Customer last name": "RecentExample", "Front commission": 690, "F&I commission": 0, "Sale commission": 690 }),
  ]));
  expect(rows("Monthly")).toEqual(expect.arrayContaining([
    expect.objectContaining({ Month: "2026-01", Delivered: 1, "Front gross": -316.61, "Estimated commission": 540 }),
    expect.objectContaining({ Month: "2026-09", Delivered: 1, "F&I amounts awaiting": 1, "Estimated commission": 690 }),
  ]));
  const jsonPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download data file", exact: true }).click();
  const json = await jsonPromise;
  const jsonPath = testInfo.outputPath("complete-synthetic-data.json");
  await json.saveAs(jsonPath);
  const envelope = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(envelope.data.sales).toHaveLength(2);
  expect(envelope.data.sales).toEqual(expect.arrayContaining([
    expect.objectContaining({ stockNumber: "EXPORT-OLD-01", frontGrossCents: -31661, fiGrossCents: 120000 }),
    expect.objectContaining({ stockNumber: "EXPORT-NEW-01", fiGrossCents: null }),
  ]));
  expect(envelope.data.profile.payPlan).toBeTruthy();
  expect(envelope.data.auditEvents.length).toBeGreaterThanOrEqual(2);
  expect(await page.getByRole("region", { name: "Cloud account", exact: true }).getByRole("status").textContent()).toBe(savedStatus);
  expect([...unexpectedOrigins]).toEqual([]);
});

test("compiled Firebase Settings stays responsive and uses cloud saving instead of Drive setup", async ({ context, page, request }, testInfo) => {
  test.setTimeout(150_000);
  const unexpectedOrigins = await blockRemoteRequests(context);
  await page.goto(APP_ORIGIN);
  await signInWithEmailLink(page, request, await createAccount(request));
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.locator(".settings-page")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Settings categories", exact: true });
  for (const [width, height] of [[320, 568], [390, 844], [410, 844], [460, 844], [844, 390], [1180, 820], [1440, 900], [2560, 1440]]) {
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
      if (category === "Volume bonuses") {
        const schedule = await page.locator(".bonus-tier-table").evaluate((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
          rows: [...element.querySelectorAll(".bonus-tier-row")].map((row) => {
            const bounds = row.getBoundingClientRect();
            return {
              client: row.clientWidth,
              scroll: row.scrollWidth,
              contained: [...row.querySelectorAll("input, .bonus-tier-total")].every((field) => {
                const fieldBounds = field.getBoundingClientRect();
                return fieldBounds.left >= bounds.left && fieldBounds.right <= bounds.right;
              }),
            };
          }),
        }));
        expect(schedule.scroll, `${width}px bonus table must not hide horizontal overflow`).toBeLessThanOrEqual(schedule.client + 1);
        expect(schedule.rows).toHaveLength(6);
        for (const row of schedule.rows) {
          expect(row.scroll).toBeLessThanOrEqual(row.client + 1);
          expect(row.contained, `${width}px every bonus field and total stays inside its row`).toBe(true);
        }
        if (width <= 460) await page.screenshot({ path: testInfo.outputPath(`firebase-bonuses-${width}.png`), fullPage: true });
        if (width === 390 || width === 1180) {
          const bonusAccessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          expect(bonusAccessibility.violations).toEqual([]);
        }
      }
    }
    await expect(page.locator(".cloud-data-copy")).toContainText("Automatic saving:");
    await expect(page.getByRole("button", { name: "Download data file", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download Excel report", exact: true })).toBeVisible();
    const exportGeometry = await page.locator(".workspace-export").evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      controls: [...element.querySelectorAll("button")].map((button) => ({
        height: button.getBoundingClientRect().height, width: button.clientWidth, scroll: button.scrollWidth,
      })),
    }));
    expect(exportGeometry.scroll).toBeLessThanOrEqual(exportGeometry.width + 1);
    for (const control of exportGeometry.controls) {
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.scroll).toBeLessThanOrEqual(control.width + 1);
    }
    if (width === 390 || width === 1180) {
      await page.locator(".workspace-export").screenshot({ path: testInfo.outputPath(`complete-export-${width}.png`) });
      expect((await new AxeBuilder({ page }).include(".workspace-export").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    }
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
    if (width <= 460) {
      await page.getByRole("button", { name: "Reports", exact: true }).first().click();
      const reportSubjects = page.getByRole("tablist", { name: "Monthly report subject", exact: true });
      await expect(reportSubjects).toBeVisible();
      expect(await reportSubjects.evaluate((element) => element.getBoundingClientRect().height),
        `${width}px Firebase Reports must keep four subject tabs on one compact row`).toBeLessThanOrEqual(54);
      await page.screenshot({ path: testInfo.outputPath(`firebase-reports-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Settings", exact: true }).first().click();
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

test("compiled cloud recovery and split guidance fit small and large screens", async ({ context, page, request }, testInfo) => {
  const unexpected = await blockRemoteRequests(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(APP_ORIGIN);
  await signInWithEmailLink(page, request, await createAccount(request));
  await page.evaluate(() => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(options) {
      if (typeof options === "object") this.setAttribute("data-tested-scroll-behavior", options.behavior ?? "auto");
      original.call(this, options);
    };
  });
  await page.getByRole("button", { name: "Edit work schedule", exact: true }).click();
  await expect(page.locator(".work-schedule-actions")).toContainText("Changes save automatically and update your pace.");
  await expect(page.locator('[data-tested-scroll-behavior="instant"]')).not.toHaveCount(0);
  await expect(page.locator(".work-schedule-details > summary")).toBeFocused();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tab", { name: "F&I", exact: true }).click();
  await expect(page.getByRole("region", { name: "Missing details", exact: true }).getByText("No delivered sales in this period", { exact: true })).toBeVisible();
  await expect(page.getByText("All F&I details are complete", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Deals", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Deals", exact: true }).getByText("No delivered sales in this period", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all deals", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await context.setOffline(true);
  try {
    const account = page.getByRole("region", { name: "Cloud account", exact: true });
    await expect(account).toContainText("Offline — reconnect to save");
    await expect(account).toContainText("Keep this tab open and reconnect before closing or refreshing.");
    for (const [width, height] of [[320, 568], [440, 844], [768, 900], [1440, 900], [2560, 1440]]) {
      await page.setViewportSize({ width, height });
      const geometry = await account.evaluate((element) => {
        const button = element.querySelector("button")!.getBoundingClientRect();
        return { width: element.clientWidth, scroll: element.scrollWidth, buttonWidth: button.width, buttonHeight: button.height, pageWidth: document.documentElement.scrollWidth };
      });
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.pageWidth).toBeLessThanOrEqual(width + 1);
      expect(geometry.buttonWidth).toBeGreaterThanOrEqual(44);
      expect(geometry.buttonHeight).toBeGreaterThanOrEqual(44);
      if (width === 320 || width === 1440) {
        const a11y = await new AxeBuilder({ page }).include(".cloud-account-bar").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(a11y.violations).toEqual([]);
      }
      await page.screenshot({ path: testInfo.outputPath(`cloud-recovery-${width}.png`), fullPage: true });
    }
  } finally { await context.setOffline(false); }
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByRole("checkbox", { name: "Split deal", exact: true }).check();
  await expect(page.getByText("Enter your share of front and F&I gross.", { exact: true })).toBeVisible();
  for (const width of [320, 440, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const helper = page.locator("#split-gross-help");
    await helper.scrollIntoViewIfNeeded();
    expect(await helper.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`split-guidance-${width}.png`) });
  }
  expect([...unexpected]).toEqual([]);
});

test("Settings verifies a lost save acknowledgement but preserves and retries a truly rejected change", async ({ context, page, request }, testInfo) => {
  const unexpected = await blockRemoteRequests(context);
  const email = await createAccount(request);
  await page.goto(APP_ORIGIN);
  await signInWithEmailLink(page, request, email);
  await page.setViewportSize({ width: 520, height: 844 });
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();

  let fault: "lost acknowledgement" | "rejected change" | null = "lost acknowledgement";
  let injected = 0;
  await context.route(/^http:\/\/127\.0\.0\.1:8080\/v1\/projects\/demo-sales-ledger-rules\/databases\/\(default\)\/documents:commit(?:\?|$)/, async (route) => {
    const payload = route.request().postData() ?? "";
    if (!fault || !payload.includes('"settings.updated"')) return route.continue();
    const mode = fault;
    fault = null;
    injected += 1;
    if (mode === "lost acknowledgement") {
      // Apply only this synthetic emulator commit, then simulate a failed
      // acknowledgement. No request is ever forwarded to a live Firebase app.
      const committed = await route.fetch({ maxRedirects: 0 });
      expect(committed.status()).toBe(200);
    }
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "Synthetic acknowledgement failure." } }),
    });
  });

  const name = page.getByLabel("Salesperson name", { exact: false });
  await name.fill("Confirmed save example");
  await expect(page.locator(".settings-dirty-state")).toContainText("All changes saved.");
  expect(injected).toBe(1);
  await expect(page.getByRole("alert").filter({ hasText: "Saved settings have changed" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(name).toHaveValue("Confirmed save example");

  fault = "rejected change";
  await name.fill("Retry after rejection example");
  await expect(page.locator(".settings-dirty-state")).toContainText("Not saved yet.");
  await expect(name).toHaveValue("Retry after rejection example");
  expect(injected).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("settings-rejected-save-520.png"), fullPage: true });

  const reader = await context.newPage();
  await reader.goto(APP_ORIGIN);
  // Sign-in state is intentionally scoped to a tab; use the same synthetic
  // account rather than assuming a new page inherits its session storage.
  await signInWithEmailLink(reader, request, email);
  await reader.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(reader.getByLabel("Salesperson name", { exact: false })).toHaveValue("Confirmed save example");
  await reader.close();
  await page.getByRole("button", { name: "Try saving again", exact: true }).first().click();
  await expect(page.locator(".settings-dirty-state")).toContainText("All changes saved.");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(name).toHaveValue("Retry after rejection example");
  await page.screenshot({ path: testInfo.outputPath("settings-recovered-save-520.png"), fullPage: true });
  expect([...unexpected]).toEqual([]);
});
