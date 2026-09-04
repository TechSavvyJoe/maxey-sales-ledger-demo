import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const FIXED_NOW = new Date("2026-08-31T16:00:00.000Z");

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
}

async function loadReportFixtures(page: Page) {
  // Reconciliation assertions need a fixed, fully entered population. The
  // public demo deliberately evolves by date and leaves current F&I pending;
  // its loading behavior is covered separately by the demo-data tests.
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db, createDefaultSettings } = await import(modulePath);
    if (await db.sales.count()) throw new Error("Report fixtures require an empty isolated test workspace.");
    const now = "2026-08-31T16:00:00.000Z";
    const settings = createDefaultSettings(new Date(now));
    const payPlan = { ...settings.payPlan, effectiveMonth: "2026-05" };
    await db.settings.put({
      ...settings, salespersonName: "Report Test", selectedMonth: "2026-08",
      payPlan, payPlanHistory: [payPlan], onboardingDismissed: true,
    });
    const base = {
      profileId: "primary", customerLastName: "Example", vehicleDescription: "2024 Ford Escape",
      status: "delivered", unitCreditBasis: 1_000, frontGrossCents: 230_000,
      notes: "", createdAt: now, updatedAt: now, revision: 1, source: "manual",
    };
    // [delivery day, service contract, tire & wheel, GAP, payment, F&I dollars]
    // 6 service / 3 T&W / 4 GAP; 4 multi-product / 1 all-three; all 4 GAP sales
    // are financed. Finance totals $6,100; all 12 sales total $9,150.
    const august = [
      ["01", true, true, true, "dealer_financed", 1_800],
      ["03", true, false, true, "dealer_financed", 1_000],
      ["04", true, true, false, "dealer_financed", 1_200],
      ["05", true, false, true, "dealer_financed", 1_000],
      ["06", true, false, false, "cash", 1_700],
      ["07", true, false, false, "dealer_financed", 700],
      ["08", false, true, false, "outside_financing", 1_350],
      ["10", false, false, true, "dealer_financed", 400],
      ["11", false, false, false, "dealer_financed", 0],
      ["12", false, false, false, "dealer_financed", 0],
      ["13", false, false, false, "cash", 0],
      ["14", false, false, false, "outside_financing", 0],
    ] as const;
    await db.sales.bulkAdd([
      ...august.map(([day, serviceContractSold, tireWheelSold, gapSold, paymentMethod, fiDollars], index) => ({
        ...base, id: `reports-august-${index}`, stockNumber: `REPORT-AUG-${index}`,
        saleDate: `2026-08-${day}`, serviceContractSold, tireWheelSold, gapSold,
        paymentMethod, fiGrossCents: fiDollars * 100,
      })),
      ...["05", "06", "07"].map((month) => ({
        ...base, id: `reports-baseline-${month}`, stockNumber: `REPORT-BASE-${month}`,
        saleDate: `2026-${month}-01`, serviceContractSold: true, tireWheelSold: false,
        gapSold: true, paymentMethod: "dealer_financed", fiGrossCents: 120_000,
      })),
    ]);
  });
  await page.reload();
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
  await loadReportFixtures(page);
  await page
    .getByRole("tablist", { name: "Monthly report subject" })
    .getByRole("tab", { name: "F&I", exact: true })
    .click();

  const center = page.locator(".fi-report-center").first();
  await expect(center.getByRole("heading", { name: "Products, financing, and total F&I gross" })).toBeVisible();
  await expect(center).toContainText("12 delivered sales that count");
  const pvr = center.locator(".fi-center-kpi").filter({ hasText: "F&I gross per sale (PVR)" });
  await expect(pvr).toContainText("$9,150 total recorded");
  await expect(pvr).toContainText("$763");
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "Finance Penetration" })).toContainText("8 of 12 sales");
  await expect(center).not.toContainText("Positive F&I gross deals");
  await expect(center).not.toContainText("of deals have positive F&I gross");
  const personalComparison = center.locator(".fi-performance-comparison");
  await personalComparison.locator("summary").click();
  const pvrRow = personalComparison.getByRole("row", { name: /^F&I gross per sale \(PVR\)/ });
  await expect(pvrRow.locator('td[data-label="This period"]')).toContainText("$762.50");
  await expect(personalComparison).toContainText("prior completed months");
  await personalComparison.locator("summary").click();

  await center.getByRole("tab", { name: "Products", exact: true }).click();
  const productTable = center.locator(".fi-center-product-table");
  const serviceRow = productTable.locator("tbody tr").filter({ hasText: "Service contract / warranty" });
  const tireWheelRow = productTable.locator("tbody tr").filter({ hasText: "Tire & Wheel" });
  const gapRow = productTable.locator("tbody tr").filter({ hasText: "GAP" });
  await expect(serviceRow).toContainText("6 / 12");
  await expect(serviceRow).toContainText("50%");
  await expect(productTable).not.toContainText("Yes / No");
  await expect(productTable).not.toContainText("Answers recorded");
  await expect(serviceRow).not.toContainText("$");
  await expect(tireWheelRow).toContainText("3 / 12");
  await expect(tireWheelRow).toContainText("25%");
  await expect(gapRow).toContainText("4 / 12");
  await expect(gapRow).toContainText("33%");

  await center.getByRole("tab", { name: "Financing", exact: true }).click();
  await expect(center.locator(".fi-finance-highlight")).toContainText("4 of 8 sales");
  await expect(center.locator(".fi-finance-highlight")).toContainText("50.0%");
  const financedRow = center.getByRole("row", { name: /^Finance / });
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
  await expect(page.getByText("Add the total when F&I provides it. Blank means not received yet.", { exact: true })).toBeVisible();
  for (const outcome of [
    "Service contract / warranty",
    "Tire & Wheel",
    "GAP",
  ]) {
    await expect(page.getByRole("checkbox", { name: outcome, exact: true })).toBeVisible();
  }
  for (const method of ["Finance", "Cash", "Outside Finance"]) {
    await expect(page.getByRole("radio", { name: method, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/service contract gross|tire.*wheel gross|GAP gross|product credited gross/i)).toHaveCount(0);
});

test("phone reports use disclosures and cards without page-level sideways scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Phone-specific report layout.");
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  await loadReportFixtures(page);

  const monthSubjects = page.getByRole("tablist", { name: "Monthly report subject" });
  await expectResponsiveSubjectTabs(monthSubjects, 4);
  await monthSubjects.getByRole("tab", { name: "F&I", exact: true }).click();
  const center = page.locator(".fi-report-center").first();
  await expectResponsiveSubjectTabs(center.locator(".fi-center-jump-nav"), 5);
  await center.getByRole("tab", { name: "Products", exact: true }).click();
  await expect(center.locator(".fi-center-product-table")).toBeHidden();
  await expect(center.locator(".fi-center-finance-table")).toBeHidden();
  const disclosureGroup = center.locator(".fi-center-phone-disclosures");
  await expect(disclosureGroup).toHaveCount(1);
  await expect(disclosureGroup.locator(".fi-center-product-card")).toHaveCount(3);

  await expect(disclosureGroup.locator(".fi-center-product-card").first()).toContainText("6 of 12");
  await expect(disclosureGroup).not.toContainText("Answers recorded");

  await center.getByRole("tab", { name: "Financing", exact: true }).click();
  await expect(disclosureGroup).toHaveCount(1);
  await expect(disclosureGroup.locator("details")).toHaveCount(3);

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
  await loadReportFixtures(page);
  await page
    .getByRole("tablist", { name: "Monthly report subject" })
    .getByRole("tab", { name: "F&I", exact: true })
    .click();

  const center = page.locator(".fi-report-center").first();
  const kpiRows = await center.locator(".fi-center-kpis > *").evaluateAll((cards) => (
    new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size
  ));
  expect(kpiRows).toBe(1);

  await center.getByRole("tab", { name: "Deals", exact: true }).click();
  const evidenceTable = center.locator(".fi-center-evidence-table");
  await expect(evidenceTable).toBeVisible();
  await expect(evidenceTable).toHaveAttribute("tabindex", "0");
  const dimensions = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.pageWidth).toBe(dimensions.viewportWidth);
});
