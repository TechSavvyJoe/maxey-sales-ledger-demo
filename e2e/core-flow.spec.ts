import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openWorkSchedule(page: Page) {
  await page.getByRole("button", { name: /^Days off/ }).click();
  const schedule = page.locator(".work-schedule-details");
  if ((await schedule.getAttribute("open")) === null) {
    await schedule.locator("summary").click();
  }
}

async function openSettingsDisclosure(page: Page, selector: string) {
  const categoryNameBySelector: Record<string, RegExp> = {
    ".data-settings": /^Data & backups/,
    ".pay-plan-settings": /^Pay plan/,
    ".bonus-settings": /^Volume bonuses/,
  };
  const categoryName = categoryNameBySelector[selector];
  if (!categoryName) throw new Error(`No Settings category is mapped for ${selector}.`);
  await page.getByRole("button", { name: categoryName }).click();
  const section = page.locator(selector);
  await expect(section).toBeVisible();
  return section;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("official dealership logo links to Howell and the product mark loads in reports", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();

  const officialLogoLink = page.locator('a[href="https://www.bobmaxeyfordhowell.com/"]:visible').first();
  await expect(officialLogoLink).toBeVisible();
  await expect(officialLogoLink).toHaveAttribute("target", "_blank");
  await expect(officialLogoLink).toHaveAttribute("rel", /noopener/);
  const officialLogo = officialLogoLink.locator('img[src*="bob-maxey-ford-howell"]');
  expect(await officialLogo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  const reportMark = page.locator(".report-title-lockup img");
  expect(await reportMark.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
});

test("adds a delivered sale, calculates commission, and exports CSV", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /2026|2027|2025/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeVisible();
  await page.getByLabel(/Customer last name/).fill("Miller");
  await page.getByLabel(/Stock number/).fill("QA-0001");
  await page.getByLabel("Front gross").fill("2500");
  await page.getByLabel(/Total F&I gross/).fill("600");
  await page.locator("details.sale-more-details > summary").click();
  await page.getByLabel("Vehicle optional").fill("2023 Ford Escape Active");
  await expect(page.locator(".sale-form__footer-estimate")).toContainText("$870.00");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();

  await expect(page.getByText("Sale added.")).toBeVisible();
  await expect(page.getByText("QA-0001").first()).toBeVisible();

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /sales$/i })).toBeVisible();
  const salesSurface = testInfo.project.name === "desktop-chrome"
    ? page.locator(".sales-table-wrap")
    : page.locator(".sales-card-list");
  await expect(salesSurface.getByText("QA-0001")).toBeVisible();
  await expect(salesSurface.getByText("$870").first()).toBeVisible();

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /reports$/i })).toBeVisible();
  await page
    .getByRole("tablist", { name: "Monthly report subject" })
    .getByRole("tab", { name: "Sales", exact: true })
    .click();
  await expect(page.locator(".report-sales-disclosure")).toHaveAttribute("open", "");
  const reportTable = page.locator(".report-table-wrap");
  const reportCards = page.locator(".report-sales-cards");
  const usesReportCards = testInfo.project.name === "tablet-chrome"
    || testInfo.project.name.startsWith("mobile");
  const reportSurface = usesReportCards ? reportCards : reportTable;
  await expect(reportSurface).toBeVisible();
  await expect(reportSurface.getByText("QA-0001")).toBeVisible();
  await expect(usesReportCards ? reportTable : reportCards).toBeHidden();
  expect(await reportTable.locator("tbody tr").first().locator("td").count()).toBe(
    await reportTable.locator("thead th").count(),
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Open report exports", exact: true }).click();
  await page.getByRole("button", { name: "Monthly CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/sales-\d{4}-\d{2}\.csv$/);
});

test("Excel export carries the cumulative bonus schedule and included total", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".data-settings");
  await page.getByRole("button", { name: "Load 2-year demo", exact: true }).click();
  await expect(page.getByText(/Two-year demonstration loaded/)).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Open report exports", exact: true }).click();
  await page.getByRole("button", { name: "Excel month + year", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (!downloadPath) throw new Error("Excel download path was not available.");

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await readFile(downloadPath));
  expect(workbook.SheetNames).toContain("Bonus Schedule");
  expect(workbook.SheetNames).toContain("Weekly Performance");
  expect(workbook.SheetNames).toEqual(expect.arrayContaining([
    "Product Performance",
    "Financing",
    "Product Mix & Bundles",
    "Data Quality",
  ]));
  const schedule = XLSX.utils.sheet_to_json<Record<string, number | string>>(
    workbook.Sheets["Bonus Schedule"],
  );
  expect(schedule.at(-1)).toMatchObject({
    "Delivered Milestone": 35,
    "Added at Milestone": 2_500,
    "Running Monthly Total": 8_100,
  });

  const summaryRows = XLSX.utils.sheet_to_json<Array<number | string>>(
    workbook.Sheets["Monthly Summary"],
    { header: 1 },
  );
  expect(summaryRows).toContainEqual(["Cumulative bonus earned", 300]);
  expect(summaryRows).toContainEqual(["Bonus included", 300]);
  expect(summaryRows).toContainEqual(["Scheduled workdays", 26]);
  expect(summaryRows).toContainEqual(["Elapsed scheduled workdays", 26]);
  expect(summaryRows).toContainEqual(["Personal days off", 0]);
  expect(summaryRows.some((row) => row[0] === "Front gross per delivery" && typeof row[1] === "number")).toBe(true);
  expect(summaryRows.some((row) => row[0] === "Projected month-end commission low" && typeof row[1] === "number")).toBe(true);

  const productRows = XLSX.utils.sheet_to_json<Record<string, number | string>>(
    workbook.Sheets["Product Performance"],
  );
  expect(productRows).toHaveLength(3);
  expect(productRows[0]).toMatchObject({
    Product: "Service contract / warranty",
  });
  expect(productRows[0]).not.toHaveProperty(
    "Deal-level Total F&I Gross on Matching Deals (Overlapping)",
  );
  expect(productRows[0]).not.toHaveProperty("Gross Scope");
  expect(JSON.stringify(productRows)).not.toMatch(/credited gross|gross breakdown/i);

  const financingRows = XLSX.utils.sheet_to_json<Record<string, number | string>>(
    workbook.Sheets.Financing,
  );
  expect(financingRows.map((row) => row["Financing Outcome"])).toEqual([
    "Dealer financed",
    "Not dealer financed",
    "Financing not marked",
  ]);

  const dataQualityRows = XLSX.utils.sheet_to_json<Record<string, number | string>>(
    workbook.Sheets["Data Quality"],
  );
  expect(dataQualityRows).toContainEqual(expect.objectContaining({
    Metric: "F&I report and commission amount",
    Value: "Total F&I gross",
  }));
});

test("commission goal and money projection follow the salesperson across dashboard and reports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".data-settings");
  await page.getByRole("button", { name: "Load 2-year demo", exact: true }).click();
  await expect(page.getByText(/Two-year demonstration loaded/)).toBeVisible();
  await page.getByRole("button", { name: /^Profile & goals/ }).click();
  await page.getByLabel("Salesperson name *").fill("Goal Test");
  await page.getByLabel(/commission goal/).fill("9000");
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();

  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  const projection = page.locator(".dashboard-v2-plan--money");
  await expect(projection).toContainText("Commission outlook");
  await expect(projection).toContainText("Projected month end");
  await expect(projection).toContainText("$9,000");

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  const reportProjection = page.locator(".report-commission-pace");
  await expect(reportProjection).toContainText("Projected month end");
  await expect(reportProjection).toContainText("$9,000");
  await expect(reportProjection).toContainText(/not guaranteed payroll/i);
});

test("work schedule changes the workday pace and survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Days off/ }).click();
  await expect(page.getByRole("heading", { name: "Days off" })).toBeVisible();
  const schedule = page.locator(".work-schedule-details");
  await expect(schedule).not.toHaveAttribute("open", "");
  await expect(schedule).toContainText("26 scheduled workdays · 0 days off");
  await openWorkSchedule(page);

  const augustThird = page.getByRole("button", {
    name: /^Monday, August 3 —/,
  });
  const augustTwentieth = page.getByRole("button", {
    name: /^Thursday, August 20 —/,
  });
  await augustThird.focus();
  await page.keyboard.press("Space");
  await expect(augustThird).toHaveAttribute("aria-pressed", "true");
  await augustTwentieth.click();
  await expect(schedule).toContainText("24 scheduled workdays · 2 days off");
  await page.getByRole("button", { name: /^Profile & goals/ }).click();
  await page.getByLabel("Salesperson name *").fill("Pace Test");
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.getByText("Settings saved and calculations refreshed.")).toBeVisible();

  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await expect(page.locator(".dashboard-v2-plan").first()).toContainText("24 scheduled workdays");
  await expect(page.locator(".dashboard-v2-plan").first()).toContainText("2 off");
  await expect(page.getByRole("button", { name: "Edit work schedule" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openWorkSchedule(page);
  await expect(page.getByRole("button", {
    name: "Monday, August 3 — day off. Select to mark working.",
  })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".work-schedule-details")).toContainText("24 scheduled workdays · 2 days off");
});

test("confirming a month change discards the unsaved work schedule draft", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openWorkSchedule(page);
  await page.getByRole("button", { name: /^Monday, August 3 —/ }).click();
  await page.getByRole("button", { name: /^Profile & goals/ }).click();
  await page.getByLabel(/delivery goal/).fill("20");
  await expect(page.getByText(/Unsaved settings changes/)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Show July 2026" }).click();
  await expect(page.getByRole("button", { name: /Choose reporting month/ })).toHaveAccessibleName(/July 2026/);
  await expect(page.getByLabel(/delivery goal/)).toHaveValue("15");
  await expect(page.getByText(/Unsaved settings changes/)).toBeHidden();

  await page.getByRole("button", { name: "Show August 2026" }).click();
  await openWorkSchedule(page);
  await expect(page.getByRole("button", { name: /^Monday, August 3 —/ })).toHaveAttribute("aria-pressed", "false");
});

test("fresh dashboard has no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("settings, reports, and empty sales have no automatically detectable WCAG A/AA violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(/Engine v|App version|Database schema|SHA-256|checksum/i)).toHaveCount(0);
  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /reports$/i })).toBeVisible();
  await expect(page.getByText(/Engine v|App version|Database schema|SHA-256|checksum/i)).toHaveCount(0);
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 2, name: "No sales in this month yet" })).toBeVisible();
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("automatic folder backup keeps a clear manual fallback when browser access is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByLabel("Salesperson name *").fill("Drive Test");
  await openSettingsDisclosure(page, ".data-settings");

  const backupSection = page.getByRole("region", { name: "Automatic backup folder" });
  await expect(backupSection).toContainText("Not available in this browser");
  await expect(backupSection).toContainText("Recovery copies only — not live sync");
  await expect(backupSection).toContainText("Download full backup still works");
  const downloadBackup = page.getByRole("button", { name: /^Download backup/ });
  await expect(downloadBackup).toBeDisabled();
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.getByText("Settings saved and calculations refreshed.")).toBeVisible();
  await expect(downloadBackup).toBeEnabled();
});

test("Google Drive handoff checks a complete backup before download", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByLabel("Salesperson name *").fill("Drive Test");
  await openSettingsDisclosure(page, ".data-settings");

  const driveSection = page.getByRole("region", { name: "Google Drive backup" });
  await expect(driveSection).toContainText("No account connection needed");
  const driveButton = driveSection.getByRole("button", { name: "Save to Google Drive" });
  await expect(driveButton).toBeDisabled();
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.getByText("Settings saved and calculations refreshed.")).toBeVisible();
  await expect(driveButton).toBeEnabled();
  await driveButton.click();

  const dialog = page.getByRole("dialog", { name: "Save a recovery copy to Google Drive" });
  await expect(dialog).toContainText("Backup checked and ready");
  await expect(dialog).toContainText("drive-test-sales-backup-2026-08-31.json");

  const driveLink = dialog.getByRole("link", { name: /Download & open Google Drive/ });
  await expect(driveLink).toHaveAttribute("href", "https://drive.google.com/drive/my-drive");
  await expect(driveLink).toHaveAttribute("target", "_blank");
  await expect(driveLink).toHaveAttribute("rel", "noopener noreferrer");
  await driveLink.evaluate((anchor) => {
    anchor.addEventListener("click", (event) => event.preventDefault(), { capture: true });
  });

  const downloadPromise = page.waitForEvent("download");
  await driveLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("drive-test-sales-backup-2026-08-31.json");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (!downloadPath) throw new Error("Google Drive backup download path was not available.");
  const parsed = JSON.parse(await readFile(downloadPath, "utf8")) as { format?: string; checksum?: string };
  expect(parsed.format).toBe("maxey-sales-command-center");
  expect(parsed.checksum).toMatch(/^[a-f0-9]{64}$/);
  await expect(dialog).toContainText("Backup download started");
});

test("automatic folder backup verifies saved changes and reconnects after reload", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: () => navigator.storage.getDirectory(),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".data-settings");
  const backupSection = page.getByRole("region", { name: "Automatic backup folder" });
  await backupSection.getByRole("button", { name: "Choose backup folder" }).click();
  await expect(backupSection).toContainText("Automatic backups on");
  await expect(backupSection).toContainText("Last successful backup");

  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel(/Customer last name/).fill("BackupTest");
  await page.getByLabel(/Stock number/).fill("AUTO-BACKUP-001");
  await page.getByLabel("Front gross").fill("2000");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();

  await expect.poll(async () => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("Sales Ledger Backups");
    const handle = await directory.getFileHandle("Sales Ledger - Current Backup.json");
    const parsed = JSON.parse(await (await handle.getFile()).text()) as {
      data?: { sales?: Array<{ stockNumber?: string }> };
    };
    return parsed.data?.sales?.some((sale) => sale.stockNumber === "AUTO-BACKUP-001") ?? false;
  }), { timeout: 10_000 }).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".data-settings");
  await expect(page.getByRole("region", { name: "Automatic backup folder" })).toContainText("Automatic backups on");
});

test("populated dashboard and sales views have no automatically detectable WCAG A/AA violations", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".data-settings");
  await page.getByRole("button", { name: "Load 2-year demo", exact: true }).click();
  await expect(page.getByText(/Two-year demonstration loaded/)).toBeVisible();

  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await expect(page.getByText(/DEMO-\d{6}-13/).first()).toBeVisible();
  let results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  const salesSurface = testInfo.project.name === "desktop-chrome"
    ? page.locator(".sales-table-wrap")
    : page.locator(".sales-card-list");
  await expect(salesSurface.getByText(/DEMO-\d{6}-\d+/).first()).toBeVisible();
  results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("sales log keeps filtered context clear and offers practical sorting", async ({ page }, testInfo) => {
  const usesSaleCards = testInfo.project.name !== "desktop-chrome";
  const isPhone = testInfo.project.name === "mobile-chrome";
  if (isPhone) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".data-settings");
  await page.getByRole("button", { name: "Load 2-year demo", exact: true }).click();
  await expect(page.getByText(/Two-year demonstration loaded/)).toBeVisible();

  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel(/Customer last name/).fill("Review");
  await page.getByLabel(/Stock number/).fill("QA-REVIEW-001");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  const salesSurface = usesSaleCards
    ? page.locator(".sales-card-list")
    : page.locator(".sales-table-wrap");
  const firstRecord = usesSaleCards
    ? salesSurface.locator(".sale-card").first()
    : salesSurface.locator("tbody tr").first();

  await expect(salesSurface.getByText("Front gross not entered")).toBeVisible();
  const showMore = page.getByRole("button", { name: "Show 12 more" });
  await expect(showMore).toBeVisible();
  await showMore.click();
  await expect(showMore).toBeHidden();

  await page.getByLabel("Search sales").fill("Miller");
  await page.getByRole("button", { name: /Pending 1/ }).click();
  await expect(page.locator(".page-heading p")).toContainText("Showing 1 of 14 sales");
  const clearButton = page.getByRole("button", { name: "Clear search and filters" });
  await expect(clearButton).toBeVisible();
  await clearButton.click();
  await expect(page.getByLabel("Search sales")).toHaveValue("");
  await expect(page.getByRole("button", { name: /All 14/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".page-heading p")).not.toContainText("Showing");

  const sortControl = page.getByLabel("Sort sales");
  await sortControl.selectOption("customer");
  await expect(firstRecord).toContainText("Clark");
  await sortControl.selectOption("pending-first");
  await expect(firstRecord).toContainText(/pending/i);
  await sortControl.selectOption("review-first");
  await expect(firstRecord).toContainText("QA-REVIEW-001");
  await expect(firstRecord).toContainText("Front gross not entered");
  await sortControl.selectOption("front-high");
  await expect(firstRecord).toContainText(/DEMO-\d{6}-12/);
  await sortControl.selectOption("fi-high");
  await expect(firstRecord).toContainText(/DEMO-\d{6}-12/);

  if (isPhone) {
    const filterRail = page.locator(".filter-chips");
    const filterButtons = filterRail.locator(".filter-chip:visible");
    await expect(filterButtons).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      await expect(filterButtons.nth(index)).toBeVisible();
    }
    const filterLayout = await filterRail.evaluate((element) => {
      const buttons = [...element.querySelectorAll<HTMLElement>(".filter-chip")]
        .filter((button) => button.getBoundingClientRect().height > 0);
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        rowCount: new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top))).size,
        minimumButtonHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
      };
    });
    expect(filterLayout.scrollWidth).toBeLessThanOrEqual(filterLayout.clientWidth);
    expect(filterLayout.rowCount).toBe(2);
    expect(filterLayout.minimumButtonHeight).toBeGreaterThanOrEqual(44);
    const toolbarBox = await page.locator(".sales-toolbar").boundingBox();
    expect(toolbarBox?.height).toBeLessThanOrEqual(180);
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
  }
});

test("month picker and primary navigation remain usable", async ({ page }) => {
  await page.goto("/");
  const periodButton = page.getByRole("button", { name: /Choose reporting month/ });
  await periodButton.click();
  await expect(page.getByRole("group", { name: /Months in/ })).toBeVisible();
  const pickerResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(pickerResults.violations).toEqual([]);
  await page.getByRole("button", { name: "Jan", exact: true }).click();
  await expect(periodButton).toHaveAccessibleName(/January/);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await openSettingsDisclosure(page, ".pay-plan-settings");
  await expect(page.getByText(/Sell more than 10 valid delivered vehicles/)).toBeVisible();
});

test("payroll entry follows the selected month without carrying values across months", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tab", { name: "Paid versus estimate" }).click();
  await page.getByLabel("Commission paid").fill("1234.56");
  await page.getByRole("button", { name: "Save payroll amount" }).click();
  await expect(page.getByText("Actual paid amount saved.")).toBeVisible();

  const monthButtons = page.getByRole("button", { name: /^Show (?!months)/ });
  await monthButtons.first().click();
  await page.getByRole("tab", { name: "Paid versus estimate" }).click();
  await expect(page.getByLabel("Commission paid")).toHaveValue("");

  await page.getByRole("button", { name: /^Show (?!months)/ }).last().click();
  await page.getByRole("tab", { name: "Paid versus estimate" }).click();
  await expect(page.getByLabel("Commission paid")).toHaveValue("1234.56");
});

test("editing a milestone add-on updates every later running total", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".bonus-settings");
  await page.getByLabel("Tier 1 bonus added at milestone").fill("350");
  await expect(page.getByText("$350", { exact: true })).toBeVisible();
  await expect(page.getByText("$8,150", { exact: true })).toBeVisible();
});

test("shows the cumulative six-level bonus schedule clearly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openSettingsDisclosure(page, ".bonus-settings");
  await expect(page.locator(".bonus-settings .settings-disclosure__summary")).toContainText("Volume bonuses");
  await expect(page.getByLabel("Tier 6 minimum delivered")).toHaveValue("35");
  await expect(page.getByLabel("Tier 6 bonus added at milestone")).toHaveValue("2500");
  await expect(page.getByText("$8,100", { exact: true })).toBeVisible();
});

test("settings validation explains errors and focuses the first invalid field", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();

  const salespersonName = page.getByLabel("Salesperson name *");
  await salespersonName.fill(" ");
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();

  const validationSummary = page.locator(".settings-validation-summary");
  await expect(validationSummary).toBeVisible();
  await expect(validationSummary).toContainText("Enter the salesperson name used on reports.");
  await expect(salespersonName).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#settings-salesperson-name-error")).toHaveText(
    "Enter the salesperson name used on reports.",
  );
  await expect(salespersonName).toBeFocused();

  await salespersonName.fill("Test Salesperson");
  await openSettingsDisclosure(page, ".pay-plan-settings");
  const baseFrontRate = page.getByLabel("Base front rate");
  await baseFrontRate.fill("101");
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();

  await expect(validationSummary).toContainText("Base front rate must be between 0% and 100%.");
  await expect(baseFrontRate).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#settings-base-front-rate-error")).toHaveText(
    "Base front rate must be between 0% and 100%.",
  );
  await expect(baseFrontRate).toBeFocused();
});
