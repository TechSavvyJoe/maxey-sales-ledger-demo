import { mkdir, rm } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseURL = process.env.RELEASE_URL ?? "http://127.0.0.1:4180";
const outputDirectory = new URL("../release-screenshots/", import.meta.url);
const fixedNow = new Date("2026-08-31T16:00:00.000Z");
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

async function settleVisualState(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        });
      }
      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
      }
    }));
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  });
}

async function gotoRelease(page) {
  await page.clock.setFixedTime(fixedNow);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseURL);
  await settleVisualState(page);
}

async function assertWithinViewport(page, locator, label) {
  const [bounds, viewport] = await Promise.all([
    locator.boundingBox(),
    Promise.resolve(page.viewportSize()),
  ]);
  if (!bounds || !viewport) {
    throw new Error(`${label} bounds were unavailable.`);
  }

  const tolerance = 0.5;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  if (
    bounds.x < -tolerance
    || bounds.y < -tolerance
    || right > viewport.width + tolerance
    || bottom > viewport.height + tolerance
  ) {
    throw new Error(
      `${label} is outside the ${viewport.width}x${viewport.height} viewport: ${JSON.stringify(bounds)}`,
    );
  }
}

async function writeScreenshot(page, filename, fullPage = false) {
  await settleVisualState(page);
  const mobileFullPageStyle = fullPage && (page.viewportSize()?.width ?? Infinity) <= 720
    ? await page.addStyleTag({
        content: ".mobile-nav { display: none !important; } .main-content { padding-bottom: 36px !important; }",
      })
    : null;
  await page.screenshot({
    path: new URL(filename, outputDirectory).pathname,
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
  if (mobileFullPageStyle) await mobileFullPageStyle.evaluate((element) => element.remove());
}

async function dismissToasts(page) {
  await page.locator("[data-sonner-toast]").evaluateAll((toasts) => {
    toasts.forEach((toast) => toast.remove());
  });
}

async function openPage(page, name, marker) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await marker.waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await settleVisualState(page);
}

async function prepare(page) {
  await gotoRelease(page);
  await openPage(page, "Settings", page.getByRole("heading", { name: "Settings" }));
  await page.getByLabel(/Salesperson name/).fill("Jordan Lee");
  await page.getByLabel(/commission goal/i).fill("9000");
  await page.getByRole("button", { name: /^Days off/ }).click();
  await page.locator(".work-schedule-details > summary").click();
  await page.locator(".work-schedule-day").nth(1).click();
  await page.locator(".work-schedule-day").nth(4).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await page.getByText("Settings saved and calculations refreshed.").waitFor();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  const dataSettings = page.locator(".data-settings");
  await dataSettings.waitFor();
  await dataSettings.getByRole("button", { name: "Load demo data" }).click();
  await page.getByText(/Demonstration sales loaded/).waitFor();
  await openPage(page, "Dashboard", page.locator(".dashboard-page"));
  await page.getByText(/DEMO-\d{6}-13/).first().waitFor();
  await dismissToasts(page);
}

async function captureAddSale(page, filename) {
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByRole("heading", { name: "Add sale" }).waitFor();
  const sheet = page.locator(".sale-sheet");
  await sheet.waitFor({ state: "visible" });
  await settleVisualState(page);
  await assertWithinViewport(page, sheet, "Add Sale sheet");
  await assertWithinViewport(page, page.locator(".sale-form__footer"), "Add Sale footer");
  await writeScreenshot(page, filename);
  await page.keyboard.press("Escape");
}

async function captureView(context, name, markerForPage, filename, fullPage = false) {
  const page = await context.newPage();
  await gotoRelease(page);
  await openPage(page, name, markerForPage(page));
  await dismissToasts(page);
  await writeScreenshot(page, filename, fullPage);
  await page.close();
}

async function captureWeeklyReport(context, filename, fullPage = false) {
  const page = await context.newPage();
  await gotoRelease(page);
  await openPage(page, "Reports", (page.getByRole("heading", { name: /reports$/i })));
  await page.getByRole("tab", { name: "Weekly performance report" }).click();
  await page.getByRole("heading", { name: /weekly performance/i }).waitFor();

  const populatedWeek = page
    .getByRole("group", { name: "Select a store week" })
    .getByRole("button")
    .nth(3);
  await populatedWeek.click();
  await page.getByRole("heading", { name: /Week 4.*Aug 17.*Aug 22/i }).waitFor();
  await page
    .getByRole("region", { name: "Selected week results" })
    .locator(".report-metric")
    .filter({ hasText: "This-week sold" })
    .getByText("3", { exact: true })
    .waitFor();

  await dismissToasts(page);
  await writeScreenshot(page, filename, fullPage);
  await page.close();
}

async function captureMonthlyReport(context, subject, filename, fullPage = false) {
  const page = await context.newPage();
  await gotoRelease(page);
  await openPage(page, "Reports", page.getByRole("heading", { name: "Reports", exact: true }));
  const subjectTabs = page.getByRole("tablist", { name: "Monthly report subject" });
  await subjectTabs.getByRole("tab", { name: subject, exact: true }).click();
  if (subject === "Overview") {
    await page.getByRole("region", { name: "Monthly report summary" }).getByText("12", { exact: true }).waitFor();
  } else {
    await page.getByRole("heading", { name: "Products, financing, and total F&I gross" }).waitFor();
  }
  await dismissToasts(page);
  await writeScreenshot(page, filename, fullPage);
  await page.close();
}

const browser = await chromium.launch({ channel: "chrome" });

const desktop = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
  timezoneId: "America/Detroit",
});
const desktopPage = await desktop.newPage();
await prepare(desktopPage);
await writeScreenshot(desktopPage, "dashboard-desktop.png");
await captureAddSale(desktopPage, "add-sale-desktop.png");
await desktopPage.close();
await captureView(desktop, "Settings", (page) => page.getByRole("heading", { name: "Settings" }), "settings-desktop.png", true);
await captureView(desktop, "Sales", (page) => page.getByRole("heading", { name: /sales$/i }), "sales-desktop.png");
await captureMonthlyReport(desktop, "Overview", "reports-month-overview-desktop.png", true);
await captureMonthlyReport(desktop, "F&I", "reports-fi-desktop.png", true);
await captureWeeklyReport(desktop, "reports-week-desktop.png", true);
await desktop.close();

const laptop = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: "reduce",
  timezoneId: "America/Detroit",
});
const laptopPage = await laptop.newPage();
await prepare(laptopPage);
await writeScreenshot(laptopPage, "dashboard-laptop.png");
await captureAddSale(laptopPage, "add-sale-laptop.png");
await laptopPage.close();
await captureView(laptop, "Sales", (page) => page.getByRole("heading", { name: /sales$/i }), "sales-laptop.png");
await captureMonthlyReport(laptop, "Overview", "reports-month-overview-laptop.png", true);
await captureMonthlyReport(laptop, "F&I", "reports-fi-laptop.png", true);
await captureWeeklyReport(laptop, "reports-week-laptop.png", true);
await captureView(laptop, "Settings", (page) => page.getByRole("heading", { name: "Settings" }), "settings-laptop.png", true);
await laptop.close();

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  reducedMotion: "reduce",
  timezoneId: "America/Detroit",
});
const mobilePage = await mobile.newPage();
await prepare(mobilePage);
await writeScreenshot(mobilePage, "dashboard-mobile.png");
await captureAddSale(mobilePage, "add-sale-mobile.png");
await mobilePage.close();
await captureView(mobile, "Settings", (page) => page.getByRole("heading", { name: "Settings" }), "settings-mobile.png", true);
await captureView(mobile, "Sales", (page) => page.getByRole("heading", { name: /sales$/i }), "sales-mobile.png");
await captureMonthlyReport(mobile, "Overview", "reports-month-overview-mobile.png", true);
await captureMonthlyReport(mobile, "F&I", "reports-fi-mobile.png", true);
await captureWeeklyReport(mobile, "reports-week-mobile.png", true);
await mobile.close();

await browser.close();
console.log(`Release screenshots written to ${outputDirectory.pathname}`);
