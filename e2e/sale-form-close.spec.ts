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
  await expect(page.getByRole("button", { name: "Full deal", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Half deal", exact: true }).click();
  await expect(detailsSummary).toContainText("Half deal");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
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
