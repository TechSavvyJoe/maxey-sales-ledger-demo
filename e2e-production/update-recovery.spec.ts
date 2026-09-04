import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The production service worker precaches lazy chunks. Block it here so the
// request abort below models an expired chunk instead of reading a valid copy
// from Cache Storage before Playwright can observe the request.
test.use({ serviceWorkers: "block" });

const reportsChunk = /\/assets\/ReportsPage-.*\.js(?:\?.*)?$/;

test("an open tab with an expired lazy page shows a safe reload action instead of going blank", async ({ page }) => {
  await page.route(reportsChunk, (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();

  await expect(page.getByRole("heading", { name: "A new version is ready", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload Sales Ledger", exact: true })).toBeVisible();
  await expect(page.getByText(/saved sales remain in place/i)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("ReportsPage-");
  expect((await new AxeBuilder({ page }).include(".app-recovery").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  await page.unroute(reportsChunk);
  await page.getByRole("button", { name: "Reload Sales Ledger", exact: true }).click();
  await expect(page.locator(".reports-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "A new version is ready", exact: true })).toHaveCount(0);
});
