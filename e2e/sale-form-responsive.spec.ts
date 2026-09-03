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
    const vehicle = page.getByLabel("Vehicle optional");
    const notes = page.getByLabel("Notes optional");
    const splitDeal = page.getByRole("checkbox", { name: /Split deal/ });
    await expect(vehicle).toBeVisible();
    await expect(notes).toBeVisible();
    await expect(splitDeal).toBeVisible();
    await expect(page.locator("details.sale-more-details")).toHaveCount(0);
    await expect(page.getByLabel("Custom", { exact: true })).toHaveCount(0);
    for (const outcome of [
      "Service contract / warranty",
      "Tire & Wheel",
      "GAP",
    ]) {
      await expect(page.getByRole("checkbox", { name: outcome, exact: true })).toBeAttached();
    }
    for (const method of ["Finance", "Cash", "Outside Finance"]) {
      await expect(page.getByRole("radio", { name: method, exact: true })).toBeAttached();
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
        inputFontSizes: [...document.querySelectorAll<HTMLElement>(".sale-form .field-group input, .sale-form .field-group textarea")]
          .map((input) => Number.parseFloat(getComputedStyle(input).fontSize)),
        outcomeHeights: [...document.querySelectorAll<HTMLElement>(".sale-fi-products > .grid > label")]
          .map((label) => label.getBoundingClientRect().height),
        paymentHeights: [...document.querySelectorAll<HTMLElement>(".sale-payment-choice")]
          .map((label) => label.getBoundingClientRect().height),
        split: bounds(".sale-split-credit"),
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
    expect(geometry.inputHeights.length).toBeGreaterThan(0);
    expect(geometry.inputHeights.every((height) => height >= 44)).toBe(true);
    expect(geometry.inputFontSizes.every((fontSize) => fontSize >= 14)).toBe(true);
    expect(geometry.outcomeHeights).toHaveLength(3);
    expect(geometry.outcomeHeights.every((height) => height >= 44)).toBe(true);
    expect(geometry.paymentHeights).toHaveLength(3);
    expect(geometry.paymentHeights.every((height) => height >= 44)).toBe(true);
    expect(geometry.split?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(geometry.scrollHeight).toBeGreaterThanOrEqual(geometry.scrollClientHeight);

    await splitDeal.check();
    await expect(splitDeal).toBeChecked();
    await splitDeal.uncheck();
    await expect(splitDeal).not.toBeChecked();

    await page.getByLabel(/Total F&I gross/).fill("600");
    await page.getByRole("checkbox", { name: "Service contract / warranty", exact: true }).click();
    await page.getByRole("radio", { name: "Finance", exact: true }).check();
    await expect(page.getByRole("checkbox", { name: "Service contract / warranty", exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Finance", exact: true })).toBeChecked();

    await vehicle.scrollIntoViewIfNeeded();
    await expect(vehicle).toBeInViewport();
    await vehicle.fill("2023 Ford Escape Active");
    await notes.scrollIntoViewIfNeeded();
    await expect(notes).toBeInViewport();
    await notes.fill("Sample vehicle and notes remain available without opening another section.");
    await scrollArea.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(footer.getByRole("button", { name: "Save sale", exact: true })).toBeInViewport();

    const internalOverflow = await page.evaluate(() => {
      const sheetElement = document.querySelector<HTMLElement>(".sale-sheet");
      const scrollElement = document.querySelector<HTMLElement>(".sale-form__scroll");
      return {
        sheet: (sheetElement?.scrollWidth ?? 0) - (sheetElement?.clientWidth ?? 0),
        form: (scrollElement?.scrollWidth ?? 0) - (scrollElement?.clientWidth ?? 0),
      };
    });
    expect(internalOverflow.sheet, `${viewport.name} sheet overflow`).toBeLessThanOrEqual(1);
    expect(internalOverflow.form, `${viewport.name} form overflow`).toBeLessThanOrEqual(1);

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
