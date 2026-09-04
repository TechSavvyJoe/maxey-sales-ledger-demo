import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

async function openSales(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.locator("nav").getByRole("button", { name: "Sales", exact: true }).filter({ visible: true }).click();
  await expect(page.locator(".sales-page")).toBeVisible();
}

async function openNewSale(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeVisible();
}

function overlaps(a: Bounds, b: Bounds) {
  return a.left < b.right - 0.5
    && a.right > b.left + 0.5
    && a.top < b.bottom - 0.5
    && a.bottom > b.top + 0.5;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-04T16:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("Sales search, filters, and sorting reflow from the usable workspace without cramped boundary states", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test owns its responsive viewport matrix.");
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSales(page);

  for (const width of [320, 390, 720, 721, 760, 761, 920, 921, 1024, 1120, 1121, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const geometry = await page.locator(".sales-page").evaluate((salesPage) => {
      const bounds = (element: Element | null) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const toolbar = salesPage.querySelector<HTMLElement>(".sales-toolbar");
      const filterRail = salesPage.querySelector<HTMLElement>(".filter-chips");
      const filterButtons = [...salesPage.querySelectorAll<HTMLElement>(".filter-chip")]
        .filter((button) => button.getBoundingClientRect().height > 0);
      const rowGroups = new Map<number, Bounds[]>();
      for (const button of filterButtons) {
        const rect = bounds(button)!;
        const key = Math.round(rect.top);
        rowGroups.set(key, [...(rowGroups.get(key) ?? []), rect]);
      }
      return {
        canvasWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        workspaceWidth: salesPage.getBoundingClientRect().width,
        containerType: getComputedStyle(salesPage).containerType,
        toolbar: bounds(toolbar),
        search: bounds(salesPage.querySelector(".search-field")),
        filters: bounds(filterRail),
        actions: bounds(salesPage.querySelector(".sales-toolbar__actions")),
        filterRailClientWidth: filterRail?.clientWidth ?? 0,
        filterRailScrollWidth: filterRail?.scrollWidth ?? 0,
        filterHeights: filterButtons.map((button) => button.getBoundingClientRect().height),
        rows: [...rowGroups.values()].map((row) => ({
          left: Math.min(...row.map((item) => item.left)),
          right: Math.max(...row.map((item) => item.right)),
          count: row.length,
        })),
        searchInputHeight: salesPage.querySelector<HTMLElement>(".search-field input")?.getBoundingClientRect().height ?? 0,
        sortHeight: salesPage.querySelector<HTMLElement>(".sort-control")?.getBoundingClientRect().height ?? 0,
      };
    });

    expect(geometry.canvasWidth, `${width}px page overflow`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.containerType).toBe("inline-size");
    expect(geometry.toolbar).not.toBeNull();
    expect(geometry.search).not.toBeNull();
    expect(geometry.filters).not.toBeNull();
    expect(geometry.actions).not.toBeNull();
    expect(overlaps(geometry.search!, geometry.filters!), `${width}px search/filter overlap`).toBe(false);
    expect(overlaps(geometry.search!, geometry.actions!), `${width}px search/action overlap`).toBe(false);
    expect(overlaps(geometry.filters!, geometry.actions!), `${width}px filter/action overlap`).toBe(false);
    expect(geometry.searchInputHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.sortHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.filterHeights).toHaveLength(5);
    expect(geometry.filterHeights.every((height) => height >= 44)).toBe(true);

    if (geometry.workspaceWidth <= 1080) {
      expect(geometry.search!.bottom, `${width}px search occupies its own first row`).toBeLessThanOrEqual(geometry.filters!.top + 1);
    }
    if (geometry.workspaceWidth <= 760) {
      expect(geometry.filters!.bottom, `${width}px filters precede sorting in DOM and layout`).toBeLessThanOrEqual(geometry.actions!.top + 1);
    }
    if (geometry.workspaceWidth <= 500) {
      expect(geometry.filterRailScrollWidth, `${width}px phone filter overflow`).toBeLessThanOrEqual(geometry.filterRailClientWidth + 1);
      expect(geometry.rows.map((row) => row.count), `${width}px balanced phone filter rows`).toEqual([3, 2]);
      for (const row of geometry.rows) {
        expect(Math.abs(row.left - geometry.filters!.left), `${width}px filter row starts flush`).toBeLessThanOrEqual(1);
        expect(Math.abs(row.right - geometry.filters!.right), `${width}px filter row fills available width`).toBeLessThanOrEqual(1);
      }
    }
    if (width === 1280) {
      expect(geometry.search!.bottom, "1280px keeps the full search field above the controls").toBeLessThanOrEqual(geometry.filters!.top + 1);
    }
    if (width === 1440) {
      expect(Math.abs(geometry.search!.top - geometry.filters!.top), "1440px returns to the efficient single row").toBeLessThanOrEqual(2);
      expect(geometry.search!.width, "1440px search prompt has adequate room").toBeGreaterThanOrEqual(280);
    }
    if ([390, 721, 1120, 1280, 1440].includes(width)) {
      await page.screenshot({ path: testInfo.outputPath(`sales-toolbar-${width}.png`), fullPage: false });
    }
  }
});

test("Add sale keeps one compact sticky commission summary on short landscape screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test owns its landscape viewport matrix.");

  for (const viewport of [
    { width: 667, height: 375 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await openNewSale(page);
    await page.getByLabel("Customer last name", { exact: true }).fill("Landscape");
    await page.getByLabel(/Stock number/).fill(`LANDSCAPE-${viewport.width}`);
    await page.getByLabel("Front gross", { exact: true }).fill("2300");
    await page.getByLabel("Total F&I gross", { exact: true }).fill("1200");

    const preview = page.locator(".sale-commission-preview");
    const footer = page.locator(".sale-form__footer");
    const footerEstimate = footer.locator(".sale-footer-breakdown");
    await expect(preview).toBeHidden();
    await expect(footerEstimate.locator(":scope > span > small")).toHaveText(["Front", "F&I", "Sale total"]);
    const estimateText = await footerEstimate.locator(":scope > span > strong").allTextContents();
    const estimateValues = estimateText.map((value) => Number(value.replace(/[$,]/g, "")));
    expect(estimateValues).toHaveLength(3);
    expect(estimateValues[0]).toBeGreaterThan(0);
    expect(estimateValues[1]).toBe(240);
    expect(estimateValues[2]).toBe(estimateValues[0] + estimateValues[1]);

    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const sheet = document.querySelector<HTMLElement>(".sale-sheet");
      const scrollArea = document.querySelector<HTMLElement>(".sale-form__scroll");
      return {
        canvasWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        sheet: bounds(".sale-sheet"),
        footer: bounds(".sale-form__footer"),
        state: bounds(".sale-form__save-state"),
        estimate: bounds(".sale-footer-breakdown"),
        actions: bounds(".sale-form__footer-actions"),
        close: bounds(".sale-sheet > button.absolute"),
        sheetOverflow: (sheet?.scrollWidth ?? 0) - (sheet?.clientWidth ?? 0),
        scrollOverflow: (scrollArea?.scrollWidth ?? 0) - (scrollArea?.clientWidth ?? 0),
        scrollClientHeight: scrollArea?.clientHeight ?? 0,
        actionHeights: [...document.querySelectorAll<HTMLElement>(".sale-form__footer-actions button")]
          .map((button) => button.getBoundingClientRect().height),
      };
    });

    expect(geometry.canvasWidth, `${viewport.width}x${viewport.height} page overflow`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.sheet?.left ?? -1).toBeGreaterThanOrEqual(-0.5);
    expect(geometry.sheet?.right ?? Infinity).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(geometry.sheet?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.viewportHeight + 0.5);
    expect(geometry.footer?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.viewportHeight + 0.5);
    expect(geometry.footer?.height ?? Infinity).toBeLessThanOrEqual(84);
    expect(geometry.scrollClientHeight).toBeGreaterThanOrEqual(250);
    expect(geometry.sheetOverflow).toBeLessThanOrEqual(1);
    expect(geometry.scrollOverflow).toBeLessThanOrEqual(1);
    expect(geometry.close?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(geometry.close?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(geometry.actionHeights.length).toBeGreaterThanOrEqual(2);
    expect(geometry.actionHeights.every((height) => height >= 44)).toBe(true);
    expect(overlaps(geometry.state!, geometry.estimate!), "save status stays above amounts").toBe(false);
    expect(overlaps(geometry.state!, geometry.actions!), "save status stays above actions").toBe(false);
    expect(overlaps(geometry.estimate!, geometry.actions!), "amounts and actions remain separate").toBe(false);

    const scrollArea = page.locator(".sale-form__scroll");
    await scrollArea.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByLabel("Notes optional")).toBeInViewport();
    await expect(footer.getByRole("button", { name: "Add sale", exact: true })).toBeInViewport();

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations, `${viewport.width}x${viewport.height} accessibility`).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`sale-landscape-${viewport.width}x${viewport.height}.png`), fullPage: false });

    await footer.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
  }
});

test("compact Sales cards keep one concise edit control while metrics stay semantic", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Covered once with a fixed phone viewport.");
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewSale(page);
  await page.getByLabel("Customer last name", { exact: true }).fill("Cardcheck");
  await page.getByLabel(/Stock number/).fill("CARD-CHECK-001");
  await page.getByLabel("Vehicle optional", { exact: true }).fill("2024 Ford Escape Active");
  await page.getByLabel("Front gross", { exact: true }).fill("2300");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("1200");
  await page.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();

  const toastClose = page.locator("[data-sonner-toast] [data-close-button]").first();
  await expect(toastClose).toBeVisible();
  const toastCloseBox = await toastClose.boundingBox();
  expect(toastCloseBox?.width ?? 0).toBeGreaterThanOrEqual(43.9);
  expect(toastCloseBox?.height ?? 0).toBeGreaterThanOrEqual(43.9);

  await page.locator("nav").getByRole("button", { name: "Sales", exact: true }).filter({ visible: true }).click();
  const card = page.locator(".sale-card").filter({ hasText: "CARD-CHECK-001" });
  const identity = card.getByRole("button", {
    name: "Edit sale for Cardcheck, 2024 Ford Escape Active, stock CARD-CHECK-001",
    exact: true,
  });
  await expect(identity).toBeVisible();
  await expect(identity.locator("dl")).toHaveCount(0);
  await expect(card.locator(":scope > .sale-card__main > dl")).toHaveCount(1);

  await identity.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
  await page.locator(".sale-sheet > button.absolute").click();
  await expect(identity).toBeFocused();

  const metrics = await card.locator("dl").boundingBox();
  expect(metrics).not.toBeNull();
  await page.mouse.click(metrics!.x + metrics!.width / 2, metrics!.y + metrics!.height / 2);
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
  await page.locator(".sale-sheet > button.absolute").click();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});
