import { expect, test, type Page } from "@playwright/test";

async function openSaleForm(page: Page, stockNumber: string) {
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Customer last name", { exact: true }).fill("Example");
  await page.getByLabel(/Stock number/).fill(stockNumber);
}

async function expectComponents(page: Page, front: string, fi: string, total: string) {
  const preview = page.locator(".sale-commission-preview");
  await expect(preview.locator(".sale-commission-components dt")).toHaveText([
    "Front commission", "F&I commission", "Sale total",
  ]);
  await expect(preview.locator(".sale-commission-components dd > strong")).toHaveText([front, fi, total]);
  const footer = page.locator(".sale-form__footer-estimate.sale-footer-breakdown");
  await expect(footer.locator(":scope > span > small")).toHaveText(["Front", "F&I", "Sale total"]);
  await expect(footer.locator(":scope > span > strong")).toHaveText([front, fi, total]);
  await expect(page.locator(".sale-form")).not.toContainText("Estimated month total");
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chrome", "Desktop and phone cover this focused preview change.");
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("sale preview separates front and F&I, distinguishes awaiting gross from zero, and excludes pending deliveries", async ({ page }) => {
  await openSaleForm(page, "PREVIEW-001");
  const front = page.getByLabel("Front gross", { exact: true });
  const fi = page.getByLabel("Total F&I gross", { exact: true });
  const preview = page.locator(".sale-commission-preview");

  await expectComponents(page, "—", "—", "$0.00");
  await front.fill("2500");
  await fi.fill("600");
  await expectComponents(page, "$750.00", "$120.00", "$870.00");
  await expect(preview).toContainText("30% of $2,500.00 front gross");
  await expect(preview).toContainText("20% of $600.00 F&I gross");
  await expect(preview).toContainText("monthly volume bonus is separate");

  await fi.fill("");
  await expectComponents(page, "$750.00", "—", "$750.00");
  await expect(preview).toContainText("Awaiting F&I gross");
  await expect(preview).toContainText("From gross entered so far");
  await fi.fill("0");
  await expectComponents(page, "$750.00", "$0.00", "$750.00");
  await expect(preview).not.toContainText("Awaiting F&I gross");
  await expect(preview).toContainText("20% of $0.00 F&I gross");

  await front.fill("");
  await expectComponents(page, "—", "$0.00", "$0.00");
  await expect(preview).toContainText("Awaiting front gross");
  await front.fill("2500");
  await fi.fill("600");
  await page.getByRole("button", { name: /^Pending\./ }).click();
  await expectComponents(page, "$0.00", "$0.00", "$0.00");
  await expect(preview).toContainText("Pending delivery — this sale does not count toward commission yet.");
  await page.getByRole("button", { name: /^Delivered\./ }).click();
  await expectComponents(page, "$750.00", "$120.00", "$870.00");
});

test("an existing sale uses the retroactive front rate without including the monthly volume bonus", async ({ page }) => {
  const stockNumber = "PREVIEW-RETRO-001";
  await openSaleForm(page, stockNumber);
  await page.getByLabel("Front gross", { exact: true }).fill("2500");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();

  // Add fictional peer deliveries only inside this test's isolated database.
  // Their zero gross makes it clear that the $300 monthly bonus is not this
  // sale's commission, while 11 delivered units trigger the existing 35% rule.
  await page.evaluate(async (stock) => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    const sale = await db.sales.where("stockNumber").equals(stock).first();
    if (!sale) throw new Error("The fictional preview sale was not saved.");
    await db.sales.bulkAdd(Array.from({ length: 10 }, (_, index) => ({
      ...sale,
      id: `preview-peer-${index}`,
      stockNumber: `PREVIEW-PEER-${index}`,
      frontGrossCents: 0,
      fiGrossCents: 0,
    })));
  }, stockNumber);

  await page.reload();
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: `Actions for stock ${stockNumber}`, exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeVisible();
  await expectComponents(page, "$875.00", "$120.00", "$995.00");
  const preview = page.locator(".sale-commission-preview");
  await expect(preview).toContainText("35% of $2,500.00 front gross");
  await expect(preview).toContainText("20% of $600.00 F&I gross");
  await expect(preview).toContainText("retroactive increase for selling over 10 vehicles");
  await expect(preview).not.toContainText("$1,295.00");
});
