import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "large laptop", width: 1440, height: 900, maxPageHeight: 1_200 },
  { name: "small monitor", width: 1280, height: 800, maxPageHeight: 1_200 },
  { name: "compact laptop", width: 1024, height: 768, maxPageHeight: 1_350 },
  { name: "portrait tablet", width: 768, height: 900, maxPageHeight: 1_350 },
  { name: "phone", width: 390, height: 844, maxPageHeight: 1_650 },
  { name: "small phone", width: 320, height: 700, maxPageHeight: 1_800 },
] as const;

const settingsCategories = [
  { name: /^Profile & goals/, panel: "#settings-panel-profile" },
  { name: /^Days off/, panel: "#settings-panel-schedule" },
  { name: /^Pay plan/, panel: "#settings-panel-pay-plan" },
  { name: /^Volume bonuses/, panel: "#settings-panel-bonuses" },
  { name: /^Data & backups/, panel: "#settings-panel-data" },
] as const;

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("collapsed Settings fits compactly without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");

  const measurements: Array<Record<string, number | string>> = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openSettings(page);

    await expect(page.locator(".settings-category-panel:visible")).toHaveCount(1);
    await expect(page.locator("#settings-panel-profile")).toBeVisible();

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
    });

    expect(metrics.pageHeight, `${viewport.name} Settings page height`).toBeLessThanOrEqual(
      viewport.maxPageHeight,
    );
    expect(metrics.pageWidth, `${viewport.name} horizontal overflow`).toBe(metrics.viewportWidth);

    const categoryHeights = await page.locator(".settings-category-button").evaluateAll(
      (buttons) => buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(categoryHeights.every((height) => height >= 44)).toBe(true);
  }

  await testInfo.attach("settings-density-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});

test("Settings categories and compact disclosures remain keyboard discoverable and axe-clean", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies a phone viewport.");
  await page.setViewportSize({ width: 320, height: 700 });
  await openSettings(page);

  for (const category of settingsCategories) {
    const button = page.getByRole("button", { name: category.name });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(page.locator(category.panel)).toBeVisible();
  }

  await page.getByRole("button", { name: /^Days off/ }).click();
  const schedule = page.locator(".work-schedule-details");
  await schedule.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(schedule).toHaveAttribute("open", "");
  const dayTargets = await page.locator(".work-schedule-day").evaluateAll(
    (days) => days.map((day) => day.getBoundingClientRect().height),
  );
  expect(dayTargets.every((height) => height >= 44)).toBe(true);

  await page.getByRole("button", { name: /^Data & backups/ }).click();
  for (const selector of [".privacy-settings", ".activity-settings"]) {
    const details = page.locator(selector);
    const summary = details.locator(":scope > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", "");
  }

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("switching Settings categories keeps one stable, contained flow at every target width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");
  test.slow();

  for (const viewport of viewports.filter(({ width }) => width >= 390)) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openSettings(page);

    const baseline = await page.locator(".settings-layout > *").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      }),
    );

    for (const category of settingsCategories) {
      await page.getByRole("button", { name: category.name }).click();
      const activePanel = page.locator(category.panel);
      await expect(activePanel).toBeVisible();

      const layout = await page.evaluate(() => {
        const sections = [...document.querySelectorAll<HTMLElement>(".settings-layout > *")];
        const sectionRects = sections.map((section) => section.getBoundingClientRect());
        const visiblePanel = [...document.querySelectorAll<HTMLElement>(".settings-category-panel")]
          .find((panel) => !panel.hidden);
        const panelRect = visiblePanel?.getBoundingClientRect();
        const descendants = visiblePanel
          ? [...visiblePanel.querySelectorAll<HTMLElement>(".settings-section > *")]
              .map((element) => element.getBoundingClientRect())
          : [];

        return {
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          sections: sectionRects.map((rect) => ({
            left: rect.left,
            right: rect.right,
            width: rect.width,
            top: rect.top,
            bottom: rect.bottom,
          })),
          panelBounds: panelRect ? { left: panelRect.left, right: panelRect.right } : null,
          descendants: descendants.map((rect) => ({ left: rect.left, right: rect.right })),
        };
      });

      expect(layout.pageWidth, `${viewport.name} ${category.panel} horizontal overflow`).toBe(
        layout.viewportWidth,
      );
      expect(layout.sections.every((rect, index) => (
        Math.abs(rect.left - baseline[index].left) < 1
        && Math.abs(rect.width - baseline[index].width) < 1
      )), `${viewport.name} ${category.panel} changed column position`).toBe(true);
      expect(layout.sections.every((rect, index, sections) => {
        if (index === sections.length - 1) return true;
        const next = sections[index + 1];
        return rect.right <= next.left + 0.5 || rect.bottom <= next.top + 0.5;
      }), `${viewport.name} ${category.panel} overlapped the following section`).toBe(true);
      expect(layout.panelBounds).not.toBeNull();
      expect(layout.descendants.every((rect) => (
        rect.left >= (layout.panelBounds?.left ?? 0) - 0.5
        && rect.right <= (layout.panelBounds?.right ?? 0) + 0.5
      )), `${viewport.name} ${category.panel} content escaped its panel`).toBe(true);
    }
  }
});

test("validation returns to the pay-plan category and focuses its field", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Covered once with a fixed viewport.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Test Salesperson");

  await page.getByRole("button", { name: /^Pay plan/ }).click();
  const payPlan = page.locator(".pay-plan-settings");
  const baseFrontRate = page.getByLabel("Base front rate");
  await baseFrontRate.fill("101");
  await page.getByRole("button", { name: /^Profile & goals/ }).click();
  await expect(payPlan).toBeHidden();

  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(payPlan).toBeVisible();
  await expect(baseFrontRate).toBeFocused();
  await expect(page.locator("#settings-base-front-rate-error")).toHaveText(
    "Base front rate must be between 0% and 100%.",
  );
});
