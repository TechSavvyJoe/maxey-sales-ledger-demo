import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "small monitor", width: 1280, height: 800 },
  { name: "compact laptop", width: 1024, height: 768 },
  { name: "portrait tablet", width: 768, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "small phone", width: 320, height: 700 },
] as const;

async function openNewSale(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-01T16:00:00.000Z"));
});

test("sale entry stays usable without clipping across laptop, tablet, and phone widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");
  test.slow();

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openNewSale(page);

    const sheet = page.locator(".sale-sheet");
    const scrollArea = page.locator(".sale-form__scroll");
    const footer = page.locator(".sale-form__footer");
    const close = sheet.getByRole("button", { name: "Close" });

    await expect(page.getByLabel("Customer last name")).toBeVisible();
    await expect(page.getByLabel(/Stock number/)).toBeVisible();
    await expect(page.getByLabel("Front gross")).toBeVisible();
    await expect(page.getByLabel(/Total F&I gross/)).toBeVisible();
    for (const outcome of [
      "Service contract / warranty",
      "Tire & Wheel",
      "GAP",
      "Dealer financed",
    ]) {
      await expect(page.getByRole("checkbox", { name: outcome, exact: true })).toBeAttached();
    }

    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return rect ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        } : null;
      };
      const scrolling = document.querySelector<HTMLElement>(".sale-form__scroll");
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        sheet: bounds(".sale-sheet"),
        footer: bounds(".sale-form__footer"),
        close: bounds(".sale-sheet > button"),
        scrollHeight: scrolling?.scrollHeight ?? 0,
        scrollClientHeight: scrolling?.clientHeight ?? 0,
        inputHeights: [...document.querySelectorAll<HTMLElement>(".sale-form .field-group input")]
          .map((input) => input.getBoundingClientRect().height),
        outcomeHeights: [...document.querySelectorAll<HTMLElement>(".sale-fi-products > .grid > label")]
          .map((label) => label.getBoundingClientRect().height),
      };
    });

    expect(geometry.pageWidth, `${viewport.name} page-level overflow`).toBe(geometry.viewportWidth);
    expect(geometry.sheet).not.toBeNull();
    expect(geometry.sheet?.left ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect(geometry.sheet?.right ?? Infinity).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(geometry.sheet?.top ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect(geometry.sheet?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.viewportHeight + 0.5);
    expect(geometry.footer?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.viewportHeight + 0.5);
    expect(geometry.close?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(geometry.close?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(geometry.inputHeights.every((height) => height >= 44)).toBe(true);
    expect(geometry.outcomeHeights.every((height) => height >= 44)).toBe(true);
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.scrollClientHeight);

    await page.getByLabel(/Total F&I gross/).fill("600");
    await page.getByRole("checkbox", { name: "Service contract / warranty", exact: true }).click();
    await page.getByRole("checkbox", { name: "Dealer financed", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Service contract / warranty", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Dealer financed", exact: true })).toBeChecked();

    const moreDetails = page.locator("details.sale-more-details");
    await moreDetails.locator("summary").click();
    await expect(moreDetails).toHaveAttribute("open", "");
    await scrollArea.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByLabel("Vehicle optional")).toBeVisible();

    const internalOverflow = await page.evaluate(() => {
      const sheetElement = document.querySelector<HTMLElement>(".sale-sheet");
      const detailsElement = document.querySelector<HTMLElement>(".sale-more-details");
      return {
        sheet: (sheetElement?.scrollWidth ?? 0) - (sheetElement?.clientWidth ?? 0),
        details: (detailsElement?.scrollWidth ?? 0) - (detailsElement?.clientWidth ?? 0),
      };
    });
    expect(internalOverflow.sheet, `${viewport.name} sheet overflow`).toBeLessThanOrEqual(1);
    expect(internalOverflow.details, `${viewport.name} details overflow`).toBeLessThanOrEqual(1);

    await close.click();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  }
});

test("phone sale entry remains axe-clean with product outcomes recorded", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Covered once with a fixed phone viewport.");
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewSale(page);
  await page.getByLabel(/Total F&I gross/).fill("600");
  await page.getByRole("checkbox", { name: "GAP", exact: true }).click();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
