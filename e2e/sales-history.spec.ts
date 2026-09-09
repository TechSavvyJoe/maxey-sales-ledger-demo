import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("older sales stay findable, readable and recoverable across desktop and phone layouts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test owns its viewport matrix.");
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date("2026-09-09T16:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    const base = {
      profileId: "primary", customerLastName: "Example Montgomery-Worthington",
      vehicleDescription: "2021 Ford Explorer Platinum with extended vehicle description",
      status: "delivered", unitCreditBasis: 1000, frontGrossCents: 200_000, fiGrossCents: 100_000,
      notes: "", createdAt: "2026-01-03T12:00:00Z", updatedAt: "2026-01-03T12:00:00Z", revision: 1,
    };
    await db.sales.bulkPut([
      { ...base, id: "history-active", saleDate: "2026-01-03", stockNumber: "TEST-HISTORY-01" },
      { ...base, id: "history-current", customerLastName: "Example Current", saleDate: "2026-09-01", stockNumber: "TEST-HISTORY-02" },
      { ...base, id: "history-deleted", customerLastName: "Example Deleted", saleDate: "2026-01-04", stockNumber: "TEST-HISTORY-03", deletedAt: "2026-08-02T12:00:00Z" },
    ]);
  });
  await page.reload();
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.locator("nav").getByRole("button", { name: "Sales", exact: true }).filter({ visible: true }).click();
  const scope = page.getByRole("group", { name: "Sales time range" });
  await expect(scope.getByRole("button", { name: "September 2026", pressed: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search sales" }).fill("TEST-HISTORY-01");
  await expect(page.getByRole("heading", { name: "No matching sales" })).toBeVisible();
  await page.getByRole("button", { name: "Search all months" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("TEST-HISTORY-01");

  for (const width of [320, 440, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const identity = page.locator(".row-primary-action, .sale-card__identity").filter({ visible: true }).first();
    await expect(identity).toContainText("Example Montgomery-Worthington");
    await expect(identity).toContainText("2021 Ford Explorer Platinum with extended vehicle description");
    await expect(page.locator('time[datetime="2026-01-03"]').filter({ visible: true })).toHaveText("01/03/2026");
    const geometry = await page.locator(".sales-page").evaluate((element) => {
      const visible = (node: Element) => node.getBoundingClientRect().height > 0;
      const text = [...element.querySelectorAll<HTMLElement>(".row-primary-action strong, .row-primary-action small, .sale-card__identity strong, .sale-card__vehicle")].filter(visible);
      return {
        pageWidth: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
        controls: [...element.querySelectorAll(".sales-history-scope button")].map((button) => button.getBoundingClientRect().height),
        text: text.map((node) => ({ whiteSpace: getComputedStyle(node).whiteSpace,
          textOverflow: getComputedStyle(node).textOverflow, width: node.clientWidth, contentWidth: node.scrollWidth })),
        dates: [...element.querySelectorAll<HTMLTimeElement>(".sales-table time")].filter(visible).map((node) => ({
          right: node.getBoundingClientRect().right, cellRight: node.closest("td")!.getBoundingClientRect().right,
        })),
        actions: [...element.querySelectorAll<HTMLButtonElement>(".sales-table tbody td:last-child > button")].filter(visible).map((node) => ({
          right: node.getBoundingClientRect().right, containerRight: node.closest(".sales-table-wrap")!.getBoundingClientRect().right,
        })),
      };
    });
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.controls.every((height) => height >= 44)).toBe(true);
    for (const text of geometry.text) {
      expect(text.whiteSpace).toBe("normal");
      expect(text.textOverflow).not.toBe("ellipsis");
      expect(text.contentWidth).toBeLessThanOrEqual(text.width + 1);
    }
    for (const date of geometry.dates) expect(date.right).toBeLessThanOrEqual(date.cellRight - 7);
    for (const action of geometry.actions) expect(action.right).toBeLessThanOrEqual(action.containerRight);
    await page.screenshot({ path: testInfo.outputPath(`sales-history-${width}.png`), fullPage: true });
    if (width === 320 || width === 1440) {
      const accessibility = await new AxeBuilder({ page }).include(".sales-page")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(accessibility.violations).toEqual([]);
    }
  }

  await scope.getByRole("button", { name: "September 2026" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "No matching sales" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(scope.getByRole("button", { name: "All months" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(scope.getByRole("button", { name: "All months", pressed: true })).toBeFocused();

  await page.getByRole("button", { name: /^Recently deleted/ }).click();
  await expect(page.getByRole("heading", { name: "No matching deleted sales" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Recently deleted/, pressed: true })).toBeVisible();
  await expect(page.getByText("Example Deleted", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore", exact: true }).filter({ visible: true })).toBeVisible();
});
