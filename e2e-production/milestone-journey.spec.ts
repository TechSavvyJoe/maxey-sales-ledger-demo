import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function addSale(page: Page, ordinal: number) {
  // Real form workflow in a fresh isolated profile, with distinct entry timestamps.
  await page.clock.setFixedTime(new Date(Date.UTC(2026, 8, 15, 16, 0, ordinal)));
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Customer last name", { exact: true }).fill(`Example ${ordinal}`);
  await page.getByLabel(/Stock number/).fill(`MILESTONE-RELEASE-${ordinal}`);
  await page.getByLabel("Vehicle", { exact: false }).fill("2024 Ford Escape");
  await page.getByLabel("Front gross", { exact: true }).fill("2300");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("1200");
  await page.getByRole("radio", { name: "Finance", exact: true }).check();
  if (ordinal === 11) {
    await expect(page.locator(".sale-footer-breakdown > span > strong")).toHaveText(["$805.00", "$240.00", "$1,045.00"]);
    await expect(page.locator(".sale-milestone-summary__heading > strong")).toHaveText("$1,450.00");
    await expect(page.locator(".sale-milestone-summary__total dd")).toHaveText("$2,495.00");
  }
  if (ordinal === 15) {
    await expect(page.locator(".sale-milestone-summary__heading > strong")).toHaveText("$800.00");
    await expect(page.locator(".sale-milestone-summary__total dd")).toHaveText("$1,845.00");
  }
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
}

test("compiled milestone journey from next reward through delivery, reports, and exports", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(new Date("2026-09-15T16:00:00Z"));
  await page.goto("./");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  // Public builds preload fictional history. Remove it via the supported UI in
  // this isolated test profile before constructing exact threshold fixtures.
  if (await page.getByRole("complementary", { name: "Demo data active" }).count()) {
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("button", { name: /^Data & backups/ }).click();
    await page.getByRole("button", { name: "Remove demo data", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove demo data", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Demo data active" })).toHaveCount(0);
    await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  }
  await expect(page.locator(".dashboard-v2-scorecard")).toContainText("$0");
  for (let i = 1; i <= 10; i++) await addSale(page, i);
  const progress = page.locator(".milestone-progress");
  await expect(progress).toContainText("1 more delivery");
  await expect(progress).toContainText("+$300");
  await expect(progress).toContainText("+$1,150");
  await progress.scrollIntoViewIfNeeded();
  await testInfo.attach("next-milestone", { body: await progress.screenshot(), contentType: "image/png" });
  expect((await new AxeBuilder({ page }).include(".milestone-progress").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await addSale(page, 11);
  await expect(progress).toContainText("4 more deliveries");
  await expect(progress).toContainText("+$800");
  await expect(page.locator(".dashboard-v2-scorecard")).toContainText("$11,795");
  for (let i = 12; i <= 15; i++) await addSale(page, i);
  await expect(page.locator(".dashboard-v2-scorecard")).toContainText("$16,775");
  await page.reload();
  await expect(progress).toContainText("5 more deliveries");
  await expect(progress).toContainText("+$1,000");

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "Commission", exact: true }).click();
  const ledger = page.locator(".report-milestones");
  await expect(ledger.locator(".report-milestone-row")).toHaveCount(2);
  const rateSale = ledger.locator(".report-milestone-row").filter({ hasText: "Example 11" });
  await expect(rateSale).toContainText("$1,045.00");
  await expect(rateSale).toContainText("$1,450.00");
  await expect(rateSale).toContainText("$2,495.00");
  await expect(rateSale).toContainText("09/15/2026");
  await expect(ledger).toContainText("Don’t add again");
  await ledger.scrollIntoViewIfNeeded();
  expect(await ledger.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await testInfo.attach("milestone-report", { body: await ledger.screenshot(), contentType: "image/png" });
  expect((await new AxeBuilder({ page }).include(".report-milestones").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await rateSale.getByRole("button", { name: /Open milestone sale/ }).click();
  await expect(page.getByRole("textbox", { name: /Stock number/ })).toHaveValue("MILESTONE-RELEASE-11");
  await expect(page.locator(".sale-milestone-summary__total dd")).toHaveText("$2,495.00");
  await page.locator(".sale-milestone-summary").scrollIntoViewIfNeeded();
  await testInfo.attach("milestone-sale", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Open report exports", exact: true }).click();
  await page.getByRole("button", { name: "Monthly CSV", exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("Extra Earnings Unlocked (Already Included)");
  expect(csv).toContain("Milestone Impact (Already Included)");
  const row = csv.split("\n").find((line) => line.includes("MILESTONE-RELEASE-11"))!;
  expect(row).toContain("1150,300,1450,2495");
  expect(csv.split("\n").filter((line) => /MILESTONE-RELEASE-\d+/.test(line))).toHaveLength(15);
});
