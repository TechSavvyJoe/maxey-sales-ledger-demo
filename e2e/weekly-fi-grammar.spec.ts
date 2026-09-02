import { expect, test, type Page, type TestInfo } from "@playwright/test";

const FIXED_NOW = new Date("2026-08-31T16:00:00.000Z");

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop-chrome", "Desktop workflow is covered once.");
}

async function openWorkspace(page: Page) {
  // Playwright gives every test a fresh browser context, so IndexedDB is isolated
  // without reaching into or deleting data from another test or the user's app.
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await expect(page.getByRole("main")).toBeVisible();
}

async function openDataSettings(page: Page) {
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  const section = page.locator(".data-settings");
  await expect(section).toBeVisible();
  return section;
}

async function addDeliveredFiSale(page: Page, stockNumber = "WEEK-FI-001") {
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeVisible();
  await page.getByLabel("Delivery date").fill("2026-08-31");
  await page.getByLabel(/Customer last name/).fill("Weekly");
  await page.getByLabel(/Stock number/).fill(stockNumber);
  await page.getByLabel("Front gross").fill("2500");
  await page.getByLabel(/Total F&I gross/).fill("600");

  for (const product of ["Service contract / warranty", "GAP", "Dealer financed"]) {
    const checkbox = page.getByRole("checkbox", { name: product, exact: true });
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
  }

  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();
  return stockNumber;
}

async function addOverduePendingSale(page: Page, stockNumber = "PENDING-OVERDUE") {
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByRole("button", { name: /^Pending\./ }).click();
  await page.getByLabel("Expected delivery date").fill("2026-08-01");
  await page.getByLabel(/Customer last name/).fill("Followup");
  await page.getByLabel(/Stock number/).fill(stockNumber);
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();
  return stockNumber;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test("tracks F&I products and carries the current-week requirement into the Week report", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);
  const stockNumber = await addDeliveredFiSale(page);

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  const saleRow = page.locator(".sales-table tbody tr").filter({ hasText: stockNumber });
  await expect(saleRow).toBeVisible();
  await expect(
    saleRow.getByRole("group", {
      name: "F&I products sold: Service contract / warranty, GAP. F&I products marked No: Tire & Wheel. Dealer financing: Yes",
      exact: true,
    }),
  ).toBeVisible();
  await expect(saleRow.getByText("T&W", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  const fiPanel = page.locator(".performance-insights");
  await expect(fiPanel).toContainText("1 valid delivered deal");
  await expect(fiPanel.locator("dl > div").filter({ hasText: "Service contract / warranty" })).toContainText("100%");
  await expect(fiPanel.locator("dl > div").filter({ hasText: "Tire & Wheel" })).toContainText("0%");
  await expect(fiPanel.locator("dl > div").filter({ hasText: "GAP" })).toContainText("100%");
  await expect(fiPanel.locator("dl > div").filter({ hasText: "Dealer financing" })).toContainText("100%");

  await expect(page.getByText("This week · 1 sold · 14 more needed by 08/31", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Weekly performance", exact: true }).click();

  const weekTab = page.getByRole("tab", { name: "Weekly performance report", exact: true });
  await expect(weekTab).toHaveAttribute("aria-selected", "true");
  const selectedWeek = page
    .getByRole("group", { name: "Select a store week" })
    .locator(".week-selector__button[aria-pressed='true']");
  await expect(selectedWeek).toHaveAttribute("aria-pressed", "true");
  await expect(selectedWeek).toContainText("Aug 31");
  await expect(
    page.getByText("14 more deliveries needed by Aug 31 to reach the 15-delivery checkpoint.", { exact: true }),
  ).toBeVisible();
  const weekResults = page.getByRole("region", { name: "Selected week results" });
  const soldMetric = weekResults.locator(".report-metric").filter({ hasText: "This-week sold" });
  await expect(soldMetric.getByText("1", { exact: true })).toBeVisible();
  const pacePanel = page.getByRole("region", { name: "Goal checkpoint" });
  const paceMetric = pacePanel.locator("dl > div").filter({ hasText: "Pace vs expected to date" });
  await expect(paceMetric.locator("dd")).toHaveText("14.0 behind");
});

test("dashboard task links preserve Data, review, and paid-versus-estimate destinations", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);

  await page.getByRole("button", { name: "Import Excel tracker", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const dataSettings = await openDataSettings(page);
  await expect(dataSettings.getByRole("button", { name: /^Import from Excel/ })).toBeVisible();

  const stockNumber = await addOverduePendingSale(page);
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  const attentionPanel = page.getByRole("region", { name: "Needs review" });
  await expect(attentionPanel).toContainText(stockNumber);
  await expect(attentionPanel).toContainText(/Pending.*overdue/i);
  await page.getByRole("button", { name: /Review 1 sale/ }).click();

  const attentionFilter = page.getByRole("button", { name: /Needs review 1/ });
  await expect(attentionFilter).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sales-table tbody tr").filter({ hasText: stockNumber })).toBeVisible();

  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await page.getByRole("button", { name: "Compare with payroll", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Paid versus estimate" })).toHaveAttribute("aria-selected", "true");
});

test("report exports have dismissible report scope and route private backup to Data settings", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();

  const exportTrigger = page.getByRole("button", { name: "Open report exports", exact: true });
  await exportTrigger.click();
  const exportContent = page.locator(".report-export-popover");
  await expect(exportContent).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exportContent).toBeHidden();
  await expect(exportTrigger).toBeFocused();

  await exportTrigger.click();
  await expect(exportContent).toBeVisible();
  await page.getByRole("heading", { name: "Reports", exact: true }).click();
  await expect(exportContent).toBeHidden();

  await exportTrigger.click();
  await expect(exportContent.getByRole("checkbox", { name: /Include customer last names/ })).toBeVisible();
  await expect(exportContent.getByText(/Full backup/i)).toHaveCount(0);
  await expect(exportContent.getByText(/recovery backup/i)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  const dataSettings = await openDataSettings(page);
  await expect(dataSettings.getByRole("button", { name: /^Download backup/ })).toBeVisible();
});

test("a deleted sale remains restorable after navigation and reload", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);
  const stockNumber = await addDeliveredFiSale(page, "RESTORE-LATER-001");

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  const saleRow = page.locator(".sales-table tbody tr").filter({ hasText: stockNumber });
  await saleRow.getByRole("button", { name: `Actions for stock ${stockNumber}` }).click();
  await page.getByRole("menuitem", { name: "Delete sale", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this sale?" });
  await dialog.getByRole("button", { name: "Delete sale", exact: true }).click();
  await expect(page.getByText("Sale deleted.")).toBeVisible();

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.reload();
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  const deletedFilter = page.getByRole("button", { name: /Recently deleted 1/ });
  await deletedFilter.click();
  await expect(deletedFilter).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(stockNumber).first()).toBeVisible();
  await page.getByRole("button", { name: /^Restore(?: sale)?$/ }).click();
  await expect(page.getByText("Sale restored.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Recently deleted 0/ })).toBeVisible();
  await page.getByRole("button", { name: /All 1/ }).click();
  await expect(page.locator(".sales-table tbody tr").filter({ hasText: stockNumber })).toBeVisible();
});

test("keyboard month stepping keeps focus on the month switcher", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);

  const monthTrigger = page.getByRole("button", { name: /Choose reporting month/ });
  await monthTrigger.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(monthTrigger).toBeFocused();
  await expect(monthTrigger).toHaveAccessibleName(/July 2026/);

  await page.keyboard.press("ArrowRight");
  await expect(monthTrigger).toBeFocused();
  await expect(monthTrigger).toHaveAccessibleName(/August 2026/);
});

test("mobile Year report uses month cards without page-level horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Phone-specific Year report contract.");
  await openWorkspace(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const dataSettings = await openDataSettings(page);
  await dataSettings.getByRole("button", { name: "Load 2-year demo", exact: true }).click();
  await expect(page.getByText(/Two-year demonstration loaded/)).toBeVisible();

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tab", { name: "Full-year report", exact: true }).click();
  await page.getByRole("tablist", { name: "Year report subject" }).getByRole("tab", { name: "Monthly results", exact: true }).click();
  const yearCards = page.locator(".year-report-cards");
  await expect(yearCards).toBeVisible();
  await expect(yearCards.locator("article")).toHaveCount(12);
  await expect(yearCards.getByRole("heading", { name: "Aug 2026", exact: true })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.pageWidth).toBe(dimensions.viewportWidth);
});
