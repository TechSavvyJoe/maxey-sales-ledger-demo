import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "large laptop", width: 1440, height: 900, maxPageHeight: 1_500 },
  { name: "small monitor", width: 1280, height: 800, maxPageHeight: 1_500 },
  { name: "phone", width: 390, height: 844, maxPageHeight: 2_150 },
  { name: "small phone", width: 320, height: 700, maxPageHeight: 2_200 },
] as const;

async function openView(page: Page, name: "Dashboard" | "Settings") {
  await page.getByRole("button", { name, exact: true }).first().click();
}

async function loadDemoData(page: Page) {
  await page.goto("/");
  await openView(page, "Settings");
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  const dataSection = page.locator(".data-settings");
  await expect(dataSection).toBeVisible();
  const loadButton = page.getByRole("button", { name: "Load 2-year demo", exact: true });
  if (await loadButton.isVisible()) {
    await loadButton.click();
    await expect(page.getByText(/Two-year demonstration loaded/)).toBeVisible();
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
