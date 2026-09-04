import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openNewSale(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeVisible();
}

async function openSavedSale(page: import("@playwright/test").Page, stockNumber: string) {
  await page.reload();
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: `Actions for stock ${stockNumber}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
}

// Inspect the isolated browser's persisted sale; the optional value creates a
// legacy credit fixture that can no longer be entered in the simplified form.
async function savedUnitCredit(page: import("@playwright/test").Page, stockNumber: string, legacyFixtureCredit?: number) {
  return page.evaluate(({ stock, credit }) => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("maxey-sales-command-center");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("sales", credit === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("sales");
      const lookup = store.index("stockNumber").get(stock);
      let savedCredit: number;
      lookup.onsuccess = () => {
        if (!lookup.result) {
          transaction.abort();
          return;
        }
        savedCredit = credit ?? lookup.result.unitCreditBasis;
        if (credit !== undefined) store.put({ ...lookup.result, unitCreditBasis: credit });
      };
      transaction.oncomplete = () => { database.close(); resolve(savedCredit); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Sale fixture was not found.")); };
    };
  }), { stock: stockNumber, credit: legacyFixtureCredit });
}

test("opens with vehicle, notes, and a simple split checkbox ready to use", async ({ page }) => {
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

  await expect(page.locator("details.sale-more-details")).toHaveCount(0);
  await expect(page.getByLabel("Custom", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Vehicle optional")).toBeVisible();
  await expect(page.getByLabel("Notes optional")).toBeVisible();
  const splitDeal = page.getByRole("checkbox", { name: "Split deal", exact: true });
  await expect(splitDeal).toBeVisible();
  await expect(splitDeal).not.toBeChecked();

  const footerEstimate = page.locator(".sale-form__footer-estimate");
  await expect(footerEstimate).toContainText("$0.00");
  await page.getByLabel(/Stock number/).fill("FAST-ENTRY-1");
  await page.getByLabel("Front gross").fill("2500");
  await page.getByLabel(/Total F&I gross/).fill("600");
  await expect(footerEstimate).toContainText("$870.00");

  await splitDeal.check();
  await expect(splitDeal).toBeChecked();
  await expect(footerEstimate).toContainText("$870.00");

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
  await page.getByLabel("Vehicle optional").fill("2024 Ford Escape");
  await page.getByLabel("Notes optional").fill("Demonstration sale note");
  await page.getByLabel("Front gross", { exact: true }).fill("2500");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");

  const splitDeal = page.getByRole("checkbox", { name: "Split deal", exact: true });
  const footerEstimate = page.locator(".sale-form__footer-estimate");
  await expect(splitDeal).not.toBeChecked();
  await splitDeal.check();
  await expect(splitDeal).toBeChecked();
  await expect(footerEstimate).toContainText("$870.00");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();

  expect(await savedUnitCredit(page, "SPLIT-CREDIT-1")).toBe(500);
  await openSavedSale(page, "SPLIT-CREDIT-1");
  await expect(splitDeal).toBeChecked();
  await expect(page.getByLabel("Vehicle optional")).toHaveValue("2024 Ford Escape");
  await expect(page.getByLabel("Notes optional")).toHaveValue("Demonstration sale note");
  await expect(footerEstimate).toContainText("$870.00");
  await splitDeal.uncheck();
  await expect(splitDeal).not.toBeChecked();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();

  expect(await savedUnitCredit(page, "SPLIT-CREDIT-1")).toBe(1000);
  await openSavedSale(page, "SPLIT-CREDIT-1");
  await expect(splitDeal).not.toBeChecked();
  await expect(page.getByLabel("Front gross", { exact: true })).toHaveValue("2500.00");
  await expect(page.getByLabel("Total F&I gross", { exact: true })).toHaveValue("600.00");
  await expect(footerEstimate).toContainText("$870.00");
});

test("editing a legacy quarter-credit sale preserves its credit until split is explicitly changed", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await openNewSale(page);
  await page.getByLabel("Customer last name").fill("Example");
  await page.getByLabel(/Stock number/).fill("LEGACY-CREDIT-1");
  await page.getByLabel("Front gross", { exact: true }).fill("2500");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
  await savedUnitCredit(page, "LEGACY-CREDIT-1", 250);

  await openSavedSale(page, "LEGACY-CREDIT-1");
  const splitDeal = page.getByRole("checkbox", { name: "Split deal", exact: true });
  await expect(splitDeal).not.toBeChecked();
  await expect(page.getByText("Existing credit: 0.25", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Custom", { exact: true })).toHaveCount(0);
  await page.getByLabel("Notes optional").fill("Updated demonstration note");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();
  expect(await savedUnitCredit(page, "LEGACY-CREDIT-1")).toBe(250);

  await openSavedSale(page, "LEGACY-CREDIT-1");
  await expect(page.getByText("Existing credit: 0.25", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Notes optional")).toHaveValue("Updated demonstration note");
  await splitDeal.check();
  await expect(page.getByText("Existing credit: 0.25", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();
  expect(await savedUnitCredit(page, "LEGACY-CREDIT-1")).toBe(500);
});

test("a pristine sale form closes immediately", async ({ page }) => {
  await openNewSale(page);
  const saleDialog = page.getByRole("dialog", { name: "Add sale" });
  await saleDialog.getByRole("button", { name: "Close" }).first().click();

  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "These changes have not saved yet" })).toBeHidden();
});

test("every close path saves and restores an unfinished new-sale draft", async ({ page }) => {
  await openNewSale(page);
  await page.getByLabel("Customer last name").fill("Miller");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await openNewSale(page);
  await expect(page.getByLabel("Customer last name")).toHaveValue("Miller");
  await expect(page.getByText(/unfinished sale.*restored/i)).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  const saleDialog = page.getByRole("dialog", { name: "Add sale" });
  await saleDialog.getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await openNewSale(page);
  await expect(page.getByLabel("Customer last name")).toHaveValue("Miller");

  const dialogBounds = await saleDialog.boundingBox();
  expect(dialogBounds).not.toBeNull();
  if (dialogBounds!.x > 1) {
    // A backdrop exists beside the desktop sheet, but the phone editor
    // deliberately fills the screen. Do not click a phone form field and
    // mistake that for an outside-close action.
    await page.mouse.click(dialogBounds!.x / 2, Math.min(200, dialogBounds!.height / 2));
  } else {
    await page.locator(".sale-form__footer-actions").getByRole("button", { name: "Close", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await openNewSale(page);
  await expect(page.getByLabel("Customer last name")).toHaveValue("Miller");
  await page.getByLabel(/Stock number/).fill("RESTORED-DRAFT-1");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();
  await expect(page.getByText("RESTORED-DRAFT-1").first()).toBeVisible();
});

test("adding a sale closes without a draft warning loop", async ({ page }) => {
  await openNewSale(page);
  await page.getByLabel("Customer last name").fill("Saved");
  await page.getByLabel(/Stock number/).fill("SAVE-CLOSE-1");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();

  await expect(page.getByText("Sale added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add sale" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "These changes have not saved yet" })).toBeHidden();
  await expect(page.getByText("SAVE-CLOSE-1").first()).toBeVisible();
});
