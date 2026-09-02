import { expect, test, type Page, type TestInfo } from "@playwright/test";

const FIXED_NOW = new Date("2026-08-31T16:00:00.000Z");
const STOCK_NUMBER = "CONFLICT-001";

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop-chrome", "Concurrent editing is covered once on desktop.");
}

async function openWorkspace(page: Page) {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await expect(page.getByRole("main")).toBeVisible();
}

async function openSalesLog(page: Page) {
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
}

async function openSaleEditor(page: Page) {
  const row = page.locator(".sales-table tbody tr").filter({ hasText: STOCK_NUMBER });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Actions for stock ${STOCK_NUMBER}` }).click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
}

test("blocks a stale sale edit and loads the newer committed values", async ({ context, page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);

  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Delivery date").fill("2026-08-31");
  await page.getByLabel(/Customer last name/).fill("Original");
  await page.getByLabel(/Stock number/).fill(STOCK_NUMBER);
  await page.getByRole("textbox", { name: "Front gross", exact: true }).fill("2500");
  await page.getByRole("textbox", { name: "Total F&I gross", exact: true }).fill("600");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();
  await openSalesLog(page);

  const stalePage = await context.newPage();
  // Model a tab that was sleeping or missed the live refresh. IndexedDB remains
  // shared, so the database still has to reject its stale revision at commit.
  await stalePage.addInitScript(() => {
    class SilentBroadcastChannel extends EventTarget {
      readonly name: string;

      constructor(name: string) {
        super();
        this.name = name;
      }

      postMessage() {}
      close() {}
    }

    Object.defineProperty(window, "BroadcastChannel", {
      configurable: true,
      value: SilentBroadcastChannel,
    });
  });
  await openWorkspace(stalePage);
  await openSalesLog(stalePage);

  // Tab B has revision 1 in memory. Tab A then commits revision 2.
  await openSaleEditor(page);
  await page.getByRole("textbox", { name: "Front gross", exact: true }).fill("3100");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Sale updated.")).toBeVisible();

  // Tab B opens its stale copy and changes a different field.
  await openSaleEditor(stalePage);
  await stalePage.getByRole("textbox", { name: "Total F&I gross", exact: true }).fill("999");
  await stalePage.getByRole("button", { name: "Save changes", exact: true }).click();

  const conflictAlert = stalePage.getByRole("alert").filter({ hasText: "Sale not saved" });
  await expect(conflictAlert).toContainText(`${STOCK_NUMBER} changed in another tab.`);
  await expect(conflictAlert).toContainText("Your entries were not saved.");
  await expect(stalePage.getByText("Newer sale changes found.")).toBeVisible();

  // The failed draft remains available until the salesperson chooses recovery.
  await expect(stalePage.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("2500.00");
  await expect(stalePage.getByRole("textbox", { name: "Total F&I gross", exact: true })).toHaveValue("999.00");

  const committedRow = page.locator(".sales-table tbody tr").filter({ hasText: STOCK_NUMBER });
  await expect(committedRow).toContainText("$3,100");
  await expect(committedRow).toContainText("$600");
  await expect(committedRow).not.toContainText("$999");

  await stalePage.getByRole("button", { name: "Load latest", exact: true }).click();
  await expect(stalePage.getByRole("textbox", { name: "Front gross", exact: true })).toHaveValue("3100.00");
  await expect(stalePage.getByRole("textbox", { name: "Total F&I gross", exact: true })).toHaveValue("600.00");

  // Reload from IndexedDB to prove the stale $999 edit never replaced either saved value.
  await stalePage.reload();
  await expect(stalePage.getByText("Opening your sales workspace")).toBeHidden();
  await openSalesLog(stalePage);
  const persistedRow = stalePage.locator(".sales-table tbody tr").filter({ hasText: STOCK_NUMBER });
  await expect(persistedRow).toContainText("$3,100");
  await expect(persistedRow).toContainText("$600");
  await expect(persistedRow).not.toContainText("$999");
});
