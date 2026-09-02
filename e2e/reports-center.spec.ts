import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const FIXED_NOW = new Date("2026-08-31T16:00:00.000Z");

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
}

async function loadDemoData(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  const dataSettings = page.locator(".data-settings");
  await expect(dataSettings).toBeVisible();
  await dataSettings.getByRole("button", { name: "Load 2-year demo", exact: true }).click();
  await expect(page.getByText(/Two-year demonstration loaded/)).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
}

async function expectResponsiveSubjectTabs(nav: Locator, expectedCount: number) {
  const choices = nav.getByRole("tab");
  await expect(choices).toHaveCount(expectedCount);
  for (let index = 0; index < expectedCount; index += 1) {
    await expect(choices.nth(index)).toBeVisible();
  }
  const layout = await nav.evaluate((element) => {
    const tabs = [...element.querySelectorAll<HTMLElement>('[role="tab"]')];
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      selectedCount: tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length,
      minimumChoiceHeight: Math.min(...tabs.map((tab) => tab.getBoundingClientRect().height)),
    };
  });
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.selectedCount).toBe(1);
  expect(layout.minimumChoiceHeight).toBeGreaterThanOrEqual(42);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test("reports center reconciles product, financing, and one total F&I gross source", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Dense table evidence is covered once on desktop.");
  await openWorkspace(page);
  await loadDemoData(page);
  await page
    .getByRole("tablist", { name: "Monthly report subject" })
    .getByRole("tab", { name: "F&I", exact: true })
    .click();

  const center = page.locator(".fi-report-center").first();
  await expect(center.getByRole("heading", { name: "Products, financing, and total F&I gross" })).toBeVisible();
  await expect(center).toContainText("12 delivered sales that count");
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "Total F&I gross" })).toContainText("$9,150");

  await center.getByRole("tab", { name: "Products", exact: true }).click();
  const productTable = center.locator(".fi-center-product-table");
  const serviceRow = productTable.locator("tbody tr").filter({ hasText: "Service contract / warranty" });
  const tireWheelRow = productTable.locator("tbody tr").filter({ hasText: "Tire & Wheel" });
  const gapRow = productTable.locator("tbody tr").filter({ hasText: "GAP" });
  await expect(serviceRow).toContainText("6 / 12");
  await expect(serviceRow).toContainText("50%");
  await expect(serviceRow).toContainText("6 Yes · 6 No");
  await expect(serviceRow).not.toContainText("$");
  await expect(tireWheelRow).toContainText("3 / 12");
  await expect(tireWheelRow).toContainText("25%");
  await expect(gapRow).toContainText("4 / 12");
  await expect(gapRow).toContainText("33%");

  await center.getByRole("tab", { name: "Financing", exact: true }).click();
  const financedRow = center.getByRole("row", { name: /^Dealer financed / });
  await expect(financedRow).toContainText("8");
  await expect(financedRow).toContainText("67%");
  await expect(financedRow).toContainText("$6,100");

  await expect(center.getByText(/entered product.*gross|product credited gross|optional product gross|gross breakdown/i)).toHaveCount(0);

  await center.getByRole("tab", { name: "Products", exact: true }).click();
  await serviceRow.getByRole("button", { name: /View service: Service contract/ }).click();
  const evidence = center.locator(".fi-center-evidence");
  await expect(evidence).toContainText("6 of 12 deals");
  await expect(evidence.locator(".fi-center-filter-summary strong")).toHaveText(
    "Service contract / warranty sold",
  );

  await center.getByRole("tab", { name: "Combinations", exact: true }).click();
  const attachmentPanel = center.getByRole("heading", { name: "Attachment levels" }).locator("..");
  const twoOrMoreButton = attachmentPanel.getByRole("button", {
    name: /^View 4 deals: 2\+ products:/,
  });
  const allThreeButton = attachmentPanel.getByRole("button", {
    name: /^View 1 deal: all 3 products:/,
  });
  await expect(twoOrMoreButton).toHaveText("View 4 deals: 2+ products");
  await expect(allThreeButton).toHaveText("View 1 deal: all 3 products");

  await twoOrMoreButton.click();
  await expect(evidence).toContainText("4 of 12 deals");
  await expect(evidence.locator(".fi-center-filter-summary strong")).toHaveText(
    "Two or more products sold",
  );

  await center.getByRole("tab", { name: "Combinations", exact: true }).click();
  await allThreeButton.click();
  await expect(evidence).toContainText("1 of 12 deals");
  await expect(evidence.locator(".fi-center-filter-summary strong")).toHaveText(
    "All three products sold",
  );
});

test("sale entry has product outcomes and only one F&I dollar field", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Input contract is viewport-independent.");
  await openWorkspace(page);
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();

  await expect(page.getByLabel("Total F&I gross", { exact: true })).toBeVisible();
  await expect(page.getByText("Enter one combined F&I gross amount for the whole deal.", { exact: true })).toBeVisible();
  for (const outcome of [
    "Service contract / warranty",
    "Tire & Wheel",
    "GAP",
    "Dealer financed",
  ]) {
    await expect(page.getByRole("checkbox", { name: outcome, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/service contract gross|tire.*wheel gross|GAP gross|product credited gross/i)).toHaveCount(0);
});

test("phone reports use disclosures and cards without page-level sideways scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Phone-specific report layout.");
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  await loadDemoData(page);

  const monthSubjects = page.getByRole("tablist", { name: "Monthly report subject" });
  await expectResponsiveSubjectTabs(monthSubjects, 4);
  await monthSubjects.getByRole("tab", { name: "F&I", exact: true }).click();
  const center = page.locator(".fi-report-center").first();
  await expectResponsiveSubjectTabs(center.locator(".fi-center-jump-nav"), 5);
  await center.getByRole("tab", { name: "Products", exact: true }).click();
  await expect(center.locator(".fi-center-product-table")).toBeHidden();
  await expect(center.locator(".fi-center-finance-table")).toBeHidden();
  const disclosureGroups = center.locator(".fi-center-phone-disclosures");
  await expect(disclosureGroups).toHaveCount(2);
  await expect(disclosureGroups.nth(0).locator("details")).toHaveCount(3);
  await expect(disclosureGroups.nth(1).locator("details")).toHaveCount(3);

  await disclosureGroups.nth(0).locator("details").first().locator("summary").click();
  await expect(disclosureGroups.nth(0).locator("details").first()).toContainText("Details complete");

  await monthSubjects.getByRole("tab", { name: "Sales", exact: true }).click();
  const salesDetail = page.locator(".report-sales-disclosure");
  await expect(salesDetail).toHaveAttribute("open", "");
  await expect(salesDetail.locator(".report-sales-cards")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.pageWidth).toBe(dimensions.viewportWidth);

  let accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("tab", { name: "Weekly performance report" }).click();
  await expect(page.getByRole("heading", { name: /August 2026 weekly performance/ })).toBeVisible();
  const weekSubjects = page.getByRole("tablist", { name: "Weekly report subject" });
  await expectResponsiveSubjectTabs(weekSubjects, 3);
  await weekSubjects.getByRole("tab", { name: "F&I", exact: true }).click();
  const weeklyCenter = page.locator(".weekly-fi-section .fi-report-center");
  await expectResponsiveSubjectTabs(weeklyCenter.locator(".fi-center-jump-nav"), 5);
  const weeklyDimensions = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(weeklyDimensions.pageWidth).toBe(weeklyDimensions.viewportWidth);
  accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("tablet reports keep all overflow inside named report regions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet-chrome", "Tablet-specific report layout.");
  await page.setViewportSize({ width: 1024, height: 768 });
  await openWorkspace(page);
  await loadDemoData(page);
  await page
    .getByRole("tablist", { name: "Monthly report subject" })
    .getByRole("tab", { name: "F&I", exact: true })
    .click();

  const dimensions = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.pageWidth).toBe(dimensions.viewportWidth);
  const kpiRows = await page.locator(".fi-center-kpis").first().locator(":scope > *").evaluateAll((cards) => (
    new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size
  ));
  expect(kpiRows).toBe(1);
  await expect(page.locator(".fi-center-table-wrap").first()).toHaveAttribute("tabindex", "0");
});
