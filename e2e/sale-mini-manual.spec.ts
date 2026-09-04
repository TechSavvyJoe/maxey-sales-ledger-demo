import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openSale(page: Page, stock: string) {
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Customer last name", { exact: true }).fill("Example");
  await page.getByLabel(/Stock number/).fill(stock);
}

async function openSavedSale(page: Page, stock: string) {
  await page.reload();
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: `Actions for stock ${stock}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
}

async function savedSale(page: Page, stock: string) {
  return page.evaluate(async (stockNumber) => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    return db.sales.where("stockNumber").equals(stockNumber).first();
  }, stock);
}

async function expectPayout(page: Page, front: string, fi: string, total: string) {
  await expect(page.locator(".sale-commission-components dd > strong")).toHaveText([front, fi, total]);
  await expect(page.locator(".sale-footer-breakdown > span > strong")).toHaveText([front, fi, total]);
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chrome", "Desktop and phone cover mini and manual payout behavior.");
  await page.clock.setFixedTime(new Date("2026-09-03T16:00:00.000Z"));
});

test("negative or low front gross earns a mini, the mini splits, and normal percentage pay remains intact", async ({ page }) => {
  await openSale(page, "MINI-AUTO-1");
  const gross = page.getByLabel("Front gross", { exact: true });
  const split = page.getByRole("checkbox", { name: "Split deal", exact: true });
  const manual = page.getByRole("checkbox", { name: "Spiff / manual front commission", exact: true });
  await expect(manual).not.toBeChecked();
  await expect(page.getByLabel("Your front commission", { exact: true })).toHaveCount(0);

  await gross.fill("-316.61");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");
  await expectPayout(page, "$300.00", "$120.00", "$420.00");
  await expect(page.locator(".sale-footer-method")).toHaveText("Mini");
  await expect(page.locator(".sale-commission-preview")).toContainText("Negative front gross affects gross reporting, not this payout.");
  await split.check();
  await expectPayout(page, "$150.00", "$120.00", "$270.00");
  await expect(page.locator(".sale-commission-preview")).toContainText("half-deal share");
  await gross.fill("500");
  await split.uncheck();
  await expectPayout(page, "$300.00", "$120.00", "$420.00");
  await gross.fill("2000");
  await expectPayout(page, "$600.00", "$120.00", "$720.00");
  await expect(page.locator(".sale-footer-method")).toHaveText("30%");
  await gross.fill("");
  await expectPayout(page, "—", "$120.00", "$120.00");
});

test("manual front payout keeps keyboard focus, validates, saves offline without resplitting, and can return to automatic", async ({ page, context }) => {
  const stock = "MINI-MANUAL-1";
  await openSale(page, stock);
  await page.getByLabel("Front gross", { exact: true }).fill("-316.61");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");
  await page.getByRole("checkbox", { name: "Split deal", exact: true }).check();
  const manual = page.getByRole("checkbox", { name: "Spiff / manual front commission", exact: true });
  await manual.check();
  const amount = page.getByLabel("Your front commission", { exact: true });
  await expect(amount).toBeFocused();
  await expectPayout(page, "—", "$120.00", "—");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(amount).toBeFocused();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter your front commission, or turn off manual payout.", { exact: true })).toBeVisible();

  await amount.pressSequentially("0500.25", { delay: 30 });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue("0500.25");
  await expectPayout(page, "$500.25", "$120.00", "$620.25");
  await amount.press("Tab");
  await expect(amount).toHaveValue("500.25");
  await amount.fill("-25");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expectPayout(page, "—", "$120.00", "—");
  await amount.fill("");
  await amount.pressSequentially("500", { delay: 30 });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue("500");
  await expectPayout(page, "$500.00", "$120.00", "$620.00");
  await expect(page.locator(".sale-footer-method")).toHaveText("Manual");

  await page.getByRole("button", { name: /^Pending\./ }).click();
  await expectPayout(page, "$0.00", "$0.00", "$0.00");
  await page.getByRole("button", { name: /^Delivered\./ }).click();
  await expectPayout(page, "$500.00", "$120.00", "$620.00");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
  await context.setOffline(false);
  expect(await savedSale(page, stock)).toMatchObject({ frontGrossCents: -31661, fiGrossCents: 60000, unitCreditBasis: 500, frontCommissionOverrideCents: 50000 });

  await openSavedSale(page, stock);
  await expect(manual).toBeChecked();
  await expect(amount).toHaveValue("500.00");
  await expectPayout(page, "$500.00", "$120.00", "$620.00");
  await amount.fill("550");
  await expect(page.getByText(/Saved (on this device|to cloud)/)).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await openSavedSale(page, stock);
  await expect(amount).toHaveValue("550.00");
  await manual.uncheck();
  await expect(amount).toHaveCount(0);
  await expectPayout(page, "$150.00", "$120.00", "$270.00");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();
  expect(await savedSale(page, stock)).toMatchObject({ frontGrossCents: -31661, fiGrossCents: 60000, frontCommissionOverrideCents: null });
  await openSavedSale(page, stock);
  await expect(manual).not.toBeChecked();
  await expectPayout(page, "$150.00", "$120.00", "$270.00");
});

test("a manual payout with unknown gross preserves blanks, permits zero, and resets for the next sale", async ({ page }) => {
  const stock = "MINI-MANUAL-BLANK";
  await openSale(page, stock);
  const manual = page.getByRole("checkbox", { name: "Spiff / manual front commission", exact: true });
  await manual.check();
  const amount = page.getByLabel("Your front commission", { exact: true });
  await amount.fill("0");
  await expectPayout(page, "$0.00", "—", "$0.00");
  await amount.fill("750");
  await expectPayout(page, "$750.00", "—", "$750.00");
  await expect(page.locator(".sale-commission-preview")).toContainText("Manual front; awaiting F&I gross");
  await expect(page.getByLabel("Front gross", { exact: true })).toHaveValue("");

  const toggleBounds = await page.locator(".sale-manual-payout-toggle").boundingBox();
  const inputBounds = await amount.boundingBox();
  expect(toggleBounds?.height).toBeGreaterThanOrEqual(44);
  expect(inputBounds?.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator(".sale-sheet").evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Add & enter next", exact: true }).click();
  await expect(page.getByLabel(/Stock number/)).toHaveValue("");
  await expect(manual).not.toBeChecked();
  await expect(amount).toHaveCount(0);
  await expectPayout(page, "—", "—", "$0.00");
  expect(await savedSale(page, stock)).toMatchObject({ frontGrossCents: null, fiGrossCents: null, frontCommissionOverrideCents: 75000 });
});
