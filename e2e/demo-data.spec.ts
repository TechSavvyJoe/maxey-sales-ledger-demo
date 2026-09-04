import { expect, test } from "@playwright/test";

test("three-year demonstration data ends today, supports historic views, and reloads cleanly", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "The data contract is viewport-independent.");
  await page.clock.setFixedTime(new Date("2026-09-02T16:00:00.000Z"));
  await page.goto("/");
  const expected = await page.evaluate(async () => {
    const modulePath = "/src/domain/demo.ts";
    const { buildDemoSales } = await import(modulePath);
    const sales = buildDemoSales("2026-09", "2026-09-02", "three-year") as { saleDate: string; status: string }[];
    return { total: sales.length, delivered: sales.filter((sale) => sale.saleDate.startsWith("2026-09") && sale.status === "delivered").length };
  });
  await page.getByRole("button", { name: "Load sample history", exact: true }).click();
  await expect(page.getByText("Sample history loaded.")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await expect(page.getByText(`Sample history: ${expected.total} fictional sales`)).toBeVisible();
  await expect(page.locator(".demo-data-callout").getByText(/Jan 2024 through today/)).toBeVisible();

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("button", { name: `Delivered ${expected.delivered}`, exact: true })).toBeVisible();
  await expect(page.getByText("Delivery date is in the future")).toHaveCount(0);

  await page.getByRole("button", {
    name: "Choose reporting month. Currently September 2026",
    exact: true,
  }).click();
  await page.getByRole("button", { name: "Show months in 2025", exact: true }).click();
  await page.getByRole("button", { name: "Show months in 2024", exact: true }).click();
  const monthsIn2024 = page.getByRole("group", { name: "Months in 2024" });
  await monthsIn2024.getByRole("button", { name: /^Jan/ }).click();
  await expect(page.getByRole("button", {
    name: "Choose reporting month. Currently January 2024",
    exact: true,
  })).toBeVisible();

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tab", { name: "Full-year report", exact: true }).click();
  await expect(page.getByText(/1 month through the selected month/)).toBeVisible();
  await page.getByRole("tablist", { name: "Year report subject" })
    .getByRole("tab", { name: "Monthly results", exact: true })
    .click();
  const yearCards = page.getByLabel("2024 monthly performance list", { exact: true });
  await expect(yearCards.getByRole("heading", { name: "Jan 2024", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await page.getByRole("button", { name: "Remove sample data", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove sample data", exact: true }).click();
  await expect(page.getByText(`${expected.total} sample sales removed.`)).toBeVisible();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await expect(page.getByRole("button", { name: "Load sample history", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load sample history", exact: true }).click();
  await expect(page.getByText(new RegExp(`${expected.total} previously removed records were restored`))).toBeVisible();
});
