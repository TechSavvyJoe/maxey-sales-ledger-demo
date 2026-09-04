import { expect, test, type Locator, type Page } from "@playwright/test";

const STOCK = "REPORT-OPEN-001";
const VEHICLE = "2024 Ford Escape";

async function createAwaitingSale(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-02T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  await page.getByRole("button", { name: "Show August 2026", exact: true }).click();
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Delivery date").fill("2026-08-20");
  await page.getByLabel("Customer last name", { exact: true }).fill("Example");
  await page.getByLabel(/Stock number/).fill(STOCK);
  await page.getByLabel("Vehicle optional").fill(VEHICLE);
  await page.getByLabel("Front gross", { exact: true }).fill("1000");
  await page.getByRole("checkbox", { name: "Service contract / warranty", exact: true }).check();
  await page.getByRole("radio", { name: "Outside Finance", exact: true }).check();
  await expect(page.getByLabel("Total F&I gross", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
}

async function openMonthlyReports(page: Page) {
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await expect(page.getByRole("tab", { name: "Monthly report", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /Choose reporting month/ })).toHaveAccessibleName(/August 2026/);
}

async function openMonthlySales(page: Page) {
  await openMonthlyReports(page);
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "Sales", exact: true }).click();
  return page.locator("#report-month-sales-panel");
}

async function visibleMonthlySale(panel: Locator) {
  const table = panel.locator(".report-table-wrap");
  return await table.isVisible()
    ? table.locator("tbody tr").filter({ hasText: STOCK })
    : panel.locator(".report-sale-card").filter({ hasText: STOCK });
}

async function visibleEvidenceSale(evidence: Locator) {
  const table = evidence.locator(".fi-center-evidence-table");
  return await table.isVisible()
    ? table.locator("tbody tr").filter({ hasText: STOCK })
    : evidence.locator(".fi-evidence-card").filter({ hasText: STOCK });
}

async function expectReportIdentity(sale: Locator, includeLastName = true) {
  await expect(sale.locator(".report-sale-identity__primary")).toHaveText(includeLastName ? "Example" : VEHICLE);
  if (includeLastName) await expect(sale.locator(".report-sale-identity__vehicle")).toHaveText(VEHICLE);
  else await expect(sale.getByText("Example", { exact: true })).toHaveCount(0);
  await expect(sale.locator(".report-sale-meta time")).toHaveText("08/20/2026");
  await expect(sale.locator(".report-sale-meta").getByRole("button", { name: `Open sale ${STOCK}`, exact: true })).toBeVisible();

  const hierarchy = await sale.evaluate((element) => {
    const identity = element.querySelector<HTMLElement>(".report-sale-identity__primary")!;
    const metadata = element.querySelector<HTMLElement>(".report-sale-meta")!;
    return {
      identityFirst: Boolean(identity.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING),
      identityFontSize: Number.parseFloat(getComputedStyle(identity).fontSize),
      metadataFontSize: Number.parseFloat(getComputedStyle(metadata).fontSize),
    };
  });
  expect(hierarchy.identityFirst).toBe(true);
  expect(hierarchy.identityFontSize).toBeGreaterThanOrEqual(hierarchy.metadataFontSize);
}

async function expectSaleEditor(page: Page) {
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
  await expect(page.getByLabel(/Stock number/)).toHaveValue(STOCK);
  await expect(page.getByRole("radio", { name: "Outside Finance", exact: true })).toBeChecked();
}

test("monthly report rows and phone cards open a sale and retain report context after saving F&I gross", async ({ page }) => {
  await createAwaitingSale(page);
  const panel = await openMonthlySales(page);
  const sale = await visibleMonthlySale(panel);
  await expect(sale).toHaveClass(/report-openable-sale/);
  await expectReportIdentity(sale);

  // Click ordinary row/card content, not the explicit stock button.
  if (await panel.locator(".report-table-wrap").isVisible()) await sale.locator("time").click();
  else await sale.locator("dl dt").last().click();
  await expectSaleEditor(page);
  await expect(page.getByLabel("Total F&I gross", { exact: true })).toHaveValue("");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();

  await expect(panel).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "Sales", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /Choose reporting month/ })).toHaveAccessibleName(/August 2026/);
  await expect(await visibleMonthlySale(panel)).toContainText("$600");
  await expect(await visibleMonthlySale(panel)).toContainText("$420");
  await expectReportIdentity(await visibleMonthlySale(panel));

  await (await visibleMonthlySale(panel)).getByRole("button", { name: `Open sale ${STOCK}`, exact: true }).click();
  await expectSaleEditor(page);
  await expect(page.getByLabel("Total F&I gross", { exact: true })).toHaveValue("600.00");
});

test("report stock buttons support keyboard activation and restore focus on close", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Native keyboard behavior is covered on desktop.");
  await createAwaitingSale(page);
  const panel = await openMonthlySales(page);
  const button = (await visibleMonthlySale(panel)).getByRole("button", { name: `Open sale ${STOCK}`, exact: true });
  await button.focus();
  await button.press("Enter");
  await expectSaleEditor(page);
  await page.getByRole("dialog", { name: "Edit sale" }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();
  await expect(button).toBeFocused();
  await expect(panel).toBeVisible();
});

test("filtered F&I evidence opens the same sale without losing filters or payment and product context", async ({ page }) => {
  await createAwaitingSale(page);
  await openMonthlyReports(page);
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  const center = page.locator(".fi-report-center").first();
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "Tracked products per sale (PPD)" })).toContainText("1.00");
  await center.getByRole("tab", { name: "Deals", exact: true }).click();
  const evidence = center.locator(".fi-center-evidence");
  await evidence.getByRole("combobox", { name: "Show", exact: true }).selectOption("serviceContract");
  await evidence.getByRole("searchbox", { name: "Find a deal", exact: true }).fill(STOCK);
  const table = evidence.locator(".fi-center-evidence-table");
  const sale = await visibleEvidenceSale(evidence);
  await expect(sale).toHaveClass(/report-openable-sale/);
  await expectReportIdentity(sale);
  if (await table.isVisible()) await sale.locator(".report-sale-identity__primary").click();
  else await sale.locator(".report-sale-identity__vehicle").click();
  await expectSaleEditor(page);
  await expect(page.getByRole("checkbox", { name: "Service contract / warranty", exact: true })).toBeChecked();
  await page.getByRole("dialog", { name: "Edit sale" }).getByRole("button", { name: "Close" }).click();
  await expect(evidence).toBeVisible();
  await expect(center.getByRole("tab", { name: "Deals", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(evidence.getByRole("combobox", { name: "Show", exact: true })).toHaveValue("serviceContract");
  await expect(evidence.getByRole("searchbox", { name: "Find a deal", exact: true })).toHaveValue(STOCK);
  await expect(sale).toContainText("Outside Finance");
});

test("report privacy hides last names while keeping vehicle identity, dates, and stock access", async ({ page }) => {
  await createAwaitingSale(page);
  const panel = await openMonthlySales(page);
  await expectReportIdentity(await visibleMonthlySale(panel));

  async function setNamesIncluded(included: boolean) {
    await page.getByRole("button", { name: "Open report exports", exact: true }).click();
    const exports = page.locator(".report-export-popover");
    await exports.getByRole("checkbox", { name: /Include customer last names/ }).setChecked(included);
    await page.keyboard.press("Escape");
    await expect(exports).toBeHidden();
  }

  await setNamesIncluded(false);
  await expectReportIdentity(await visibleMonthlySale(panel), false);
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  const center = page.locator(".fi-report-center").first();
  await center.getByRole("tab", { name: "Deals", exact: true }).click();
  const evidence = center.locator(".fi-center-evidence");
  await expectReportIdentity(await visibleEvidenceSale(evidence), false);
  await (await visibleEvidenceSale(evidence)).getByRole("button", { name: `Open sale ${STOCK}`, exact: true }).click();
  await expectSaleEditor(page);
  await expect(page.getByLabel("Customer last name", { exact: true })).toHaveValue("Example");
  await page.getByRole("dialog", { name: "Edit sale" }).getByRole("button", { name: "Close" }).click();

  await setNamesIncluded(true);
  await expectReportIdentity(await visibleEvidenceSale(evidence));
});

test("a closed month awaiting F&I gross keeps its earnings provisional while product and payment metrics remain available", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Financial status wording is viewport-independent.");
  await createAwaitingSale(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Profile & goals/ }).click();
  await page.getByLabel("Salesperson name *").fill("Report Test");
  await page.getByLabel(/commission goal/).fill("5000");
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  const outlook = page.getByRole("region", { name: "Monthly goal and commission outlook" });
  await expect(outlook).toContainText("Awaiting F&I gross");
  await expect(outlook).toContainText("Earnings recorded so far");
  await expect(outlook).not.toContainText("Final recorded estimate");
  await expect(outlook).not.toContainText("below the monthly commission goal");
  await expect(outlook.locator(".dashboard-v2-plan--money .pace-chip.is-behind")).toHaveCount(0);

  await openMonthlyReports(page);
  const result = page.getByRole("region", { name: "Closed-month commission result" });
  await expect(result).toContainText("Awaiting F&I gross on 1 sale");
  await expect(result).not.toContainText("final recorded results");
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  const center = page.locator(".fi-report-center").first();
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "F&I gross per sale (PVR)" }).locator("strong")).toHaveText("—");
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "Deals with tracked products" })).toContainText("100%");
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "Finance Penetration" })).toContainText("0 of 1 sales");
});
