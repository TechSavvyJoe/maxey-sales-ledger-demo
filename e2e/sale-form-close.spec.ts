import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openNewSale(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeVisible();
}

test("opens on the fast entry path with optional details collapsed", async ({ page }) => {
  await openNewSale(page);

  const lastName = page.getByLabel("Customer last name");
  await expect(lastName).toBeFocused();
  await expect(page.getByRole("button", { name: /^Delivered\./ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Pending\./ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Void\./ })).toHaveCount(0);
  await expect(page.getByLabel("Delivery date")).toBeVisible();
  await expect(page.getByLabel(/Stock number/)).toBeVisible();
  await expect(page.getByLabel("Front gross")).toBeVisible();
  await expect(page.getByLabel(/Total F&I gross/)).toBeVisible();

  const moreDetails = page.locator("details.sale-more-details");
  const detailsSummary = moreDetails.locator("summary");
  await expect(moreDetails).not.toHaveAttribute("open", "");
  await expect(detailsSummary).toContainText("Full deal");
  await expect(page.getByLabel("Vehicle optional")).toBeHidden();
  await expect(page.getByLabel("Notes optional")).toBeHidden();

  const footerEstimate = page.locator(".sale-form__footer-estimate");
  await expect(footerEstimate).toContainText("$0.00");
  await page.getByLabel(/Stock number/).fill("FAST-ENTRY-1");
  await page.getByLabel("Front gross").fill("2500");
  await page.getByLabel(/Total F&I gross/).fill("600");
  await expect(footerEstimate).toContainText("$870.00");

  await detailsSummary.click();
  await expect(moreDetails).toHaveAttribute("open", "");
  await expect(page.getByLabel("Vehicle optional")).toBeVisible();
  const splitDeal = page.getByRole("checkbox", { name: "Split deal (½ credit)", exact: true });
  await expect(splitDeal).toBeVisible();
  await expect(splitDeal).not.toBeChecked();
  await splitDeal.check();
  await expect(detailsSummary).toContainText("Half deal");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("split credit saves as half a deal and can be restored to full credit after reopening", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await openNewSale(page);
  await page.getByLabel("Customer last name").fill("Example");
  await page.getByLabel(/Stock number/).fill("SPLIT-CREDIT-1");
  await page.getByLabel("Front gross", { exact: true }).fill("2500");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");

  const moreDetails = page.locator("details.sale-more-details");
  const detailsSummary = moreDetails.locator("summary");
  const splitDeal = page.getByRole("checkbox", { name: "Split deal (½ credit)", exact: true });
  const unitCredit = page.getByLabel("Custom", { exact: true });
  const footerEstimate = page.locator(".sale-form__footer-estimate");
  await detailsSummary.click();
  await expect(splitDeal).not.toBeChecked();
  await expect(unitCredit).toHaveValue("1");
  await splitDeal.check();
  await expect(unitCredit).toHaveValue("0.5");
  await expect(detailsSummary).toContainText("Half deal");
  await expect(footerEstimate).toContainText("$870.00");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();

  async function reopenSavedSale() {
    await page.reload();
    await page.getByRole("button", { name: "Sales", exact: true }).first().click();
    await page.getByRole("button", { name: "Actions for stock SPLIT-CREDIT-1", exact: true }).first().click();
    await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
  }

  await reopenSavedSale();
  await expect(moreDetails).toHaveAttribute("open", "");
  await expect(splitDeal).toBeChecked();
  await expect(unitCredit).toHaveValue("0.5");
  await expect(detailsSummary).toContainText("Half deal");
  await expect(footerEstimate).toContainText("$870.00");
  await splitDeal.uncheck();
  await expect(unitCredit).toHaveValue("1");
  await expect(detailsSummary).toContainText("Full deal");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();

  await reopenSavedSale();
  await expect(detailsSummary).toContainText("Full deal");
  await detailsSummary.click();
  await expect(splitDeal).not.toBeChecked();
  await expect(unitCredit).toHaveValue("1");
  await expect(page.getByLabel("Front gross", { exact: true })).toHaveValue("2500.00");
  await expect(page.getByLabel("Total F&I gross", { exact: true })).toHaveValue("600.00");
  await expect(footerEstimate).toContainText("$870.00");
});

test("a pristine sale form closes immediately", async ({ page }) => {
  await openNewSale(page);
  const saleDialog = page.getByRole("dialog", { name: "Add sale" });
  await saleDialog.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeHidden();
});

test("every dirty close path requires confirmation and preserves entries while continuing", async ({ page }) => {
  await openNewSale(page);
  const saleDialog = page.getByRole("dialog", { name: "Add sale" });
  const lastName = page.getByLabel("Customer last name");
  await lastName.fill("Miller");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Continue editing" }).click();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeVisible();
  await expect(lastName).toHaveValue("Miller");

  await saleDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue editing" }).click();
  await expect(lastName).toHaveValue("Miller");

  await page.mouse.click(20, 200);
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Continue editing" }).click();
  await expect(lastName).toHaveValue("Miller");

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();

  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await expect(page.getByText("Miller")).toBeHidden();
});

test("successful save closes without a discard loop", async ({ page }) => {
  await openNewSale(page);
  await page.getByLabel("Customer last name").fill("Saved");
  await page.getByLabel(/Stock number/).fill("SAVE-CLOSE-1");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();

  await expect(page.getByText("Sale added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Discard unsaved changes?" })).toBeHidden();
  await expect(page.getByText("SAVE-CLOSE-1").first()).toBeVisible();
});
