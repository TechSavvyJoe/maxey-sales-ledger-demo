import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "large laptop", width: 1440, height: 900, maxPageHeight: 1_500 },
  { name: "small monitor", width: 1280, height: 800, maxPageHeight: 1_500 },
  { name: "phone", width: 390, height: 844, maxPageHeight: 2_150 },
  { name: "small phone", width: 320, height: 700, maxPageHeight: 2_200 },
] as const;

async function openView(page: Page, name: "Dashboard" | "Sales" | "Reports" | "Settings") {
  await page.getByRole("button", { name, exact: true }).first().click();
}

async function loadDemoData(page: Page) {
  await page.goto("/");
  await openView(page, "Settings");
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  const dataSection = page.locator(".data-settings");
  await expect(dataSection).toBeVisible();
  const loadButton = page.getByRole("button", { name: /^(?:Load sample history|Load full-year demo)$/ });
  if (await loadButton.isVisible()) {
    await loadButton.click();
    await expect(page.getByText(/(?:Sample history|Full-year demo) loaded/)).toBeVisible();
  }
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("dashboard stays compact and overflow-free across target screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");
  await loadDemoData(page);

  const measurements: Array<Record<string, number | string | boolean>> = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openView(page, "Settings");
    await openView(page, "Dashboard");
    await expect(page.locator(".dashboard-page")).toBeVisible();

    const isPhone = viewport.width <= 720;
    await expect(page.locator(".performance-insights")).toHaveJSProperty("open", !isPhone);
    await expect(page.locator(".trend-panel")).toHaveJSProperty("open", !isPhone);

    const metrics = await page.evaluate(() => ({
      pageHeight: document.documentElement.scrollHeight,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    measurements.push({
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
      pageHeight: metrics.pageHeight,
      screens: Number((metrics.pageHeight / viewport.height).toFixed(2)),
      insightsOpen: await page.locator(".performance-insights").evaluate((node: HTMLDetailsElement) => node.open),
      trendOpen: await page.locator(".trend-panel").evaluate((node: HTMLDetailsElement) => node.open),
    });

    expect(metrics.pageHeight, `${viewport.name} Dashboard page height`).toBeLessThanOrEqual(
      viewport.maxPageHeight,
    );
    expect(metrics.pageWidth, `${viewport.name} horizontal overflow`).toBe(metrics.viewportWidth);
  }

  await testInfo.attach("dashboard-density-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});

test("phone disclosures and dashboard actions remain accessible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Covered once with a fixed phone viewport.");
  await page.setViewportSize({ width: 320, height: 700 });
  await loadDemoData(page);
  await openView(page, "Dashboard");

  const compactPeriod = page.locator(".period-switcher__value--compact");
  await expect(compactPeriod).toBeVisible();
  await expect(compactPeriod).toHaveText("Aug 2026");
  await expect(page.locator(".period-switcher__value--full")).toBeHidden();
  const mobileDealerLink = page.locator('a.topbar-product[href="https://www.bobmaxeyfordhowell.com/"]');
  await expect(mobileDealerLink).toBeVisible();
  await expect(mobileDealerLink.locator('img[src*="bob-maxey-ford-howell"]')).toBeVisible();

  for (const selector of [".performance-insights", ".trend-panel"]) {
    const details = page.locator(selector);
    const summary = details.locator(":scope > summary");
    expect(await summary.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", "");
  }

  const actionHeights = await page.locator(
    ".dashboard-pace-lane > button:visible, .dashboard-pace-lane__footer button:visible, .recent-sales__list > button:visible",
  ).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(actionHeights.length).toBeGreaterThan(0);
  expect(actionHeights.every((height) => height >= 44)).toBe(true);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a closed phone trend loads chart code only when opened", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Covered once with a fixed phone viewport.");
  await page.setViewportSize({ width: 390, height: 844 });
  const chartRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/TrendChart[.-]|\/recharts[.-]/.test(request.url())) {
      chartRequests.push(request.url());
    }
  });
  await loadDemoData(page);
  await openView(page, "Dashboard");

  const trend = page.locator(".trend-panel");
  await expect(trend).toHaveJSProperty("open", false);
  await expect(trend.locator(".trend-chart")).toHaveCount(0);
  expect(chartRequests).toEqual([]);

  await trend.locator(":scope > summary").click();
  await expect(trend.getByRole("img", { name: /chart of delivered units/ })).toBeVisible();
  expect(chartRequests.length).toBeGreaterThan(0);
  await trend.getByText("View monthly chart data", { exact: true }).click();
  await expect(trend.getByRole("table")).toBeVisible();

  await trend.locator(":scope > summary").click();
  await expect(trend.locator(".trend-chart")).toHaveCount(0);
  await trend.locator(":scope > summary").click();
  await expect(trend.getByRole("img", { name: /chart of delivered units/ })).toBeVisible();
});

test("responsive disclosures reset by layout mode and mobile page status stays visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own resize sequence.");
  await page.setViewportSize({ width: 390, height: 844 });
  await loadDemoData(page);
  await openView(page, "Dashboard");

  const disclosures = [page.locator(".performance-insights"), page.locator(".trend-panel")];
  const compactScorecardRows = async () => page.locator(".dashboard-v2-scorecard .metric-card").evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().top)),
  );
  const initialScorecardRows = await compactScorecardRows();
  expect(initialScorecardRows).toHaveLength(3);
  expect(initialScorecardRows[0], "the first two phone metrics share a row").toBe(initialScorecardRows[1]);
  expect(initialScorecardRows[2], "the projection metric gets its own readable row").toBeGreaterThan(initialScorecardRows[0]);
  for (const details of disclosures) {
    await expect(details).toHaveJSProperty("open", false);
    await details.locator(":scope > summary").click();
    await expect(details).toHaveJSProperty("open", true);
  }

  // Entering the wide mode uses its open default. Remaining within that mode
  // preserves an intentional manual choice.
  await page.setViewportSize({ width: 1024, height: 800 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", true);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", true);

  // Returning to compact mode resets both disclosures instead of carrying a
  // phone-open choice indefinitely across future breakpoint transitions.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", false);

  await page.setViewportSize({ width: 1024, height: 800 });
  for (const details of disclosures) {
    await expect(details).toHaveJSProperty("open", true);
    await details.locator(":scope > summary").click();
    await expect(details).toHaveJSProperty("open", false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", false);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", false);
  const returnedScorecardRows = await compactScorecardRows();
  expect(returnedScorecardRows[0]).toBe(returnedScorecardRows[1]);
  expect(returnedScorecardRows[2]).toBeGreaterThan(returnedScorecardRows[0]);
  await page.setViewportSize({ width: 1024, height: 800 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", true);

  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const view of ["Sales", "Reports"] as const) {
      await openView(page, view);
      const headingStatus = page.locator(`.${view.toLowerCase()}-page .page-heading__action .review-state`);
      await expect(headingStatus).toBeVisible();
      await expect(headingStatus).toContainText(/(?:All clear|needs? review)/);
      const bounds = await headingStatus.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, width: document.documentElement.clientWidth };
      });
      expect(bounds.left, `${view} status starts inside ${width}px viewport`).toBeGreaterThanOrEqual(0);
      expect(bounds.right, `${view} status ends inside ${width}px viewport`).toBeLessThanOrEqual(bounds.width + 1);
      expect(bounds.top, `${view} status remains in the page heading at ${width}px`).toBeGreaterThanOrEqual(0);
      if (width === 390) {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${view} mobile heading accessibility`).toEqual([]);
      }
    }
  }
});

test("short landscape uses compact disclosures and a deliberate compact shell", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own resize sequence.");
  await page.setViewportSize({ width: 844, height: 390 });
  await loadDemoData(page);
  await openView(page, "Dashboard");

  const disclosures = [page.locator(".performance-insights"), page.locator(".trend-panel")];
  const compactFooter = page.locator(".sidebar-footer");
  const topbarDealerLink = page.locator('a.topbar-product[href="https://www.bobmaxeyfordhowell.com/"]');
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", false);
  await expect(compactFooter).toBeHidden();
  await expect(topbarDealerLink).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.screenshot({ path: testInfo.outputPath("dashboard-short-landscape.png"), fullPage: false });

  // Manual choices remain stable while the layout stays in compact mode,
  // including rotation between short landscape and narrow portrait.
  for (const details of disclosures) {
    await details.locator(":scope > summary").click();
    await expect(details).toHaveJSProperty("open", true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", true);

  // Crossing into a roomy desktop layout restores that mode's default. A
  // manual desktop choice then survives additional resizing within the mode.
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const details of disclosures) {
    await expect(details).toHaveJSProperty("open", true);
    await details.locator(":scope > summary").click();
    await expect(details).toHaveJSProperty("open", false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", false);

  // Re-entering short landscape resets to the compact default rather than
  // carrying a desktop preference into the space-constrained presentation.
  await page.setViewportSize({ width: 844, height: 390 });
  for (const details of disclosures) await expect(details).toHaveJSProperty("open", false);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(compactFooter).toBeHidden();
  await expect(topbarDealerLink).toBeVisible();
  await expect(topbarDealerLink).toHaveAttribute("aria-label", /Bob Maxey Ford of Howell/);
  const logoWidth = await topbarDealerLink.locator("img").evaluate((image) => image.getBoundingClientRect().width);
  expect(logoWidth).toBeGreaterThanOrEqual(80);
  const topbarLayout = await page.locator(".topbar").evaluate((topbar) => {
    const logo = topbar.querySelector(".topbar-product")!.getBoundingClientRect();
    const period = topbar.querySelector(".period-switcher")!.getBoundingClientRect();
    const addSale = topbar.querySelector(".add-sale-button")!.getBoundingClientRect();
    return { logoRight: logo.right, periodLeft: period.left, periodRight: period.right, addSaleLeft: addSale.left };
  });
  expect(topbarLayout.logoRight).toBeLessThanOrEqual(topbarLayout.periodLeft);
  expect(topbarLayout.periodRight).toBeLessThanOrEqual(topbarLayout.addSaleLeft);
  await page.screenshot({ path: testInfo.outputPath("dashboard-compact-rail.png"), fullPage: false });

  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(compactFooter).toBeVisible();
  await expect(topbarDealerLink).toBeHidden();
});

test("empty sales states stay compact while their action remains easy to tap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openView(page, "Sales");

  const emptyState = page.locator(".sales-page .empty-state").last();
  await expect(emptyState).toBeVisible();
  await expect(emptyState.getByRole("button", { name: "Add sale", exact: true })).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844, maxMinHeight: 164 },
    { width: 1024, height: 800, maxMinHeight: 216 },
    { width: 1440, height: 900, maxMinHeight: 216 },
  ]) {
    await page.setViewportSize(viewport);
    const metrics = await emptyState.evaluate((node) => {
      const stateRect = node.getBoundingClientRect();
      const action = node.querySelector("button");
      const actionRect = action?.getBoundingClientRect();
      return {
        minHeight: Number.parseFloat(getComputedStyle(node).minHeight),
        actualHeight: stateRect.height,
        actionHeight: actionRect?.height ?? 0,
        left: stateRect.left,
        right: stateRect.right,
        viewportWidth: document.documentElement.clientWidth,
      };
    });

    expect(metrics.minHeight).toBeLessThanOrEqual(viewport.maxMinHeight + 1);
    expect(metrics.actualHeight).toBeLessThan(260);
    expect(metrics.actionHeight).toBeGreaterThanOrEqual(44);
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  }
});
