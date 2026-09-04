import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectPayout(page: Page, front: string, fi: string, total: string) {
  await expect(page.locator(".sale-commission-components dd > strong")).toHaveText([front, fi, total]);
  await expect(page.locator(".sale-footer-breakdown > span > strong")).toHaveText([front, fi, total]);
}

async function reopenSale(page: Page) {
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: "Actions for stock MINI-RELEASE-TEST", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
}

test("compiled Mini settings and personal spiff payouts survive save, reload, and automatic recalculation", async ({ page }, testInfo) => {
  // All writes are through the UI in a fresh isolated browser profile. No source-module shortcuts.
  await page.clock.setFixedTime(new Date("2026-09-03T16:00:00.000Z"));
  await page.goto("./");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Customer last name", { exact: true }).fill("Example");
  await page.getByLabel(/Stock number/).fill("MINI-RELEASE-TEST");
  await page.getByLabel("Vehicle", { exact: false }).fill("2024 Ford Escape");
  await page.getByLabel("Front gross", { exact: true }).fill("-316.61");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");
  await expectPayout(page, "$300.00", "$120.00", "$420.00");
  await page.getByRole("checkbox", { name: "Split deal", exact: true }).check();
  await expectPayout(page, "$150.00", "$120.00", "$270.00");
  const manual = page.getByRole("checkbox", { name: "Spiff / manual front commission", exact: true });
  await manual.check();
  const amount = page.getByLabel("Your front commission", { exact: true });
  await expect(amount).toBeFocused();
  await amount.pressSequentially("0500");
  await expect(amount).toHaveValue("0500");
  await amount.press("Tab");
  await expect(amount).toHaveValue("500.00");
  await expectPayout(page, "$500.00", "$120.00", "$620.00");
  await page.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
  await page.reload();
  await reopenSale(page);
  await expect(amount).toHaveValue("500.00");
  await expectPayout(page, "$500.00", "$120.00", "$620.00");
  await page.locator(".sale-form__footer").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByLabel("Salesperson name *").fill("Mini Example");
  await page.getByRole("button", { name: /^Pay plan/ }).click();
  const mini = page.getByLabel("Mini", { exact: true });
  await expect(mini).toHaveValue("300");
  await mini.fill("00400");
  await mini.press("Tab");
  await expect(mini).toHaveValue("400");
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.getByRole("status")).toContainText("All changes saved. Settings save automatically.");
  await page.reload();
  await reopenSale(page);
  // Changing Mini never changes an explicitly entered personal payout.
  await expectPayout(page, "$500.00", "$120.00", "$620.00");
  await manual.uncheck();
  await expectPayout(page, "$200.00", "$120.00", "$320.00");
  await page.getByRole("checkbox", { name: "Split deal", exact: true }).uncheck();
  await expectPayout(page, "$400.00", "$120.00", "$520.00");
  await page.locator(".sale-form__footer").getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();
  await page.reload();
  await reopenSale(page);
  await expect(manual).not.toBeChecked();
  await expect(page.getByLabel("Front gross", { exact: true })).toHaveValue("-316.61");
  await expectPayout(page, "$400.00", "$120.00", "$520.00");
  await expect(page.locator(".sale-footer-method")).toHaveText("Mini");
  expect(await page.locator(".sale-sheet").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await testInfo.attach("compiled-mini-sale", { body: await page.screenshot(), contentType: "image/png" });
});
