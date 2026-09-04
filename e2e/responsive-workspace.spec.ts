import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const viewports = [320, 390, 720, 721, 768, 844, 1024, 1041, 1280, 1440, 1920, 2560, 3440, 3840, 5120];

async function navigate(page: Page, name: string) {
  await page.locator("nav").getByRole("button", { name, exact: true }).filter({ visible: true }).click();
  await expect(page.locator(`.${name.toLowerCase()}-page`)).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name, exact: true }).filter({ visible: true })).toHaveAttribute("aria-current", "page");
}

async function expectCanvasToFit(page: Page, label: string) {
  const dimensions = await page.evaluate(() => ({
    canvas: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.canvas, label).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test("the workspace preserves hierarchy and controls from small phones to ultrawide monitors", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  test.skip(testInfo.project.name !== "desktop-chrome" && testInfo.project.name !== "", "Own viewport matrix.");
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await navigate(page, "Settings");
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await page.getByRole("button", { name: /^(?:Load sample history|Load full-year demo)$/ }).click();
  await expect(page.getByText(/(?:Sample history|Full-year demo) loaded/)).toBeVisible();
  await expect(page.getByText(/(?:Sample history|Full-year demo) loaded/)).toBeHidden({ timeout: 10_000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // A fictional long-name record catches truncation/overflow that short demo
  // names do not exercise. This database belongs only to this test context.
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    const sales = await db.sales.toArray();
    const sale = sales.filter((entry: { saleDate: string }) => entry.saleDate.startsWith("2026-08")).sort((a: { saleDate: string }, b: { saleDate: string }) => b.saleDate.localeCompare(a.saleDate))[0];
    await db.sales.put({ ...sale, customerLastName: "Montgomery-Worthington", vehicleDescription: "2026 Ford Expedition MAX Platinum Ultimate 4WD", stockNumber: "DEMO-LONG-STOCK-2026-123456789" });
  });
  await page.reload();
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();

  for (const width of viewports) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : width < 600 ? 844 : 900 });
    await test.step(`${width}px workspace`, async () => {
      for (const name of ["Dashboard", "Sales", "Reports", "Settings"]) {
        await navigate(page, name);
        await expectCanvasToFit(page, `${name} fits at ${width}px`);
        await expect(page.locator(".period-switcher__arrow").first()).toHaveCSS("width", "44px");
        await expect(page.getByRole("button", { name: "Add sale", exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}-${width}.png`), fullPage: false });
      }
      if (width === 844) {
        const rail = await page.evaluate(() => {
          const settingsButton = [...document.querySelectorAll<HTMLButtonElement>(".sidebar-nav__item")]
            .find((button) => button.textContent?.includes("Settings"));
          const footer = document.querySelector<HTMLElement>(".sidebar-footer");
          const settingsBounds = settingsButton?.getBoundingClientRect();
          const footerBounds = footer?.getBoundingClientRect();
          return {
            viewport: window.innerHeight,
            settingsBottom: settingsBounds?.bottom ?? Number.POSITIVE_INFINITY,
            footerVisible: footer ? getComputedStyle(footer).display !== "none" : false,
            footerBottom: footerBounds?.bottom ?? 0,
          };
        });
        expect(rail.settingsBottom).toBeLessThanOrEqual(rail.viewport);
        expect(!rail.footerVisible || rail.footerBottom <= rail.viewport).toBe(true);
      }
      await navigate(page, "Reports");
      const controls = await page.locator(".report-command-bar").evaluate((bar) => {
        const tabs = bar.querySelector('[role="tablist"]')!.getBoundingClientRect();
        const actions = bar.querySelector(".report-command-actions")!.getBoundingClientRect();
        return { tabRight: tabs.right, actionLeft: actions.left, tabBottom: tabs.bottom, actionTop: actions.top };
      });
      expect(controls.tabRight <= controls.actionLeft + 1 || controls.tabBottom <= controls.actionTop + 1,
        `Report range tabs and Export do not overlap at ${width}px`).toBe(true);
      await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
      const center = page.locator(".fi-report-center").first();
      for (const subject of ["Overview", "Products", "Financing", "Combinations", "Deals"]) {
        await center.getByRole("tab", { name: subject, exact: true }).click();
        await expectCanvasToFit(page, `F&I ${subject} fits at ${width}px`);
      }
      await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "Overview", exact: true }).click();
      if ([320, 768, 1280, 3440, 5120].includes(width)) {
        for (const range of ["Weekly performance report", "Full-year report", "Paid versus estimate"]) {
          await page.locator(".report-command-bar").getByRole("tab", { name: range, exact: true }).click();
          await expectCanvasToFit(page, `${range} report fits at ${width}px`);
          await page.screenshot({ path: testInfo.outputPath(`report-${range.replaceAll(" ", "-")}-${width}.png`), fullPage: false });
        }
        await page.locator(".report-command-bar").getByRole("tab", { name: "Monthly report", exact: true }).click();
        await navigate(page, "Settings");
        for (const name of ["Days off", "Pay plan", "Volume bonuses", "Data & backups"]) {
          await page.getByRole("button", { name: new RegExp(`^${name.replace("&", "\\&")}`) }).click();
          await expectCanvasToFit(page, `${name} settings fits at ${width}px`);
          await page.screenshot({ path: testInfo.outputPath(`settings-${name.replaceAll(" ", "-")}-${width}.png`), fullPage: false });
        }
        await page.getByRole("button", { name: /^Profile & goals/ }).click();
      }
    });
  }

  await page.setViewportSize({ width: 320, height: 844 });
  for (const name of ["Dashboard", "Sales", "Reports", "Settings"]) {
    await navigate(page, name);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, `${name} small-screen accessibility`).toEqual([]);
  }
});

test("the longest month and keyboard date selection remain usable on small screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome" && testInfo.project.name !== "", "Own viewport matrix.");
  await page.clock.setFixedTime(new Date("2026-09-03T16:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();

  for (const width of [320, 360, 375, 390, 520, 640, 721]) {
    await page.setViewportSize({ width, height: 800 });
    const label = page.locator(".period-switcher__label");
    const displayedText = page.locator(".period-switcher__value").filter({ visible: true });
    const bounds = await displayedText.evaluate((element) => ({
      available: element.clientWidth,
      text: element.scrollWidth,
    }));
    expect(bounds.text, `September remains readable at ${width}px`).toBeLessThanOrEqual(bounds.available + 1);
    await label.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".period-popover")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(label).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(label).toHaveAccessibleName("Choose reporting month. Currently August 2026");
    await page.keyboard.press("ArrowRight");
    await expect(label).toHaveAccessibleName("Choose reporting month. Currently September 2026");
    await expectCanvasToFit(page, `Keyboard period selection fits at ${width}px`);
  }
});
