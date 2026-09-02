import { expect, test } from "@playwright/test";

test("full-year demonstration data stays safe, makes Year reports useful, and reloads cleanly", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "The data contract is viewport-independent.");
  await page.clock.setFixedTime(new Date("2026-09-02T16:00:00.000Z"));
  await page.goto("/");
  await page.getByRole("button", { name: "Explore full-year demo", exact: true }).click();
  await expect(page.getByText("Full-year demonstration loaded.")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await expect(page.getByText("235 demonstration sales are loaded")).toBeVisible();

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("button", { name: /Delivered 12/ })).toBeVisible();
  await expect(page.getByText("Delivery date is in the future")).toHaveCount(0);

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tab", { name: "Full-year report", exact: true }).click();
  await expect(page.getByText("9 months through the selected month; later months are marked Upcoming")).toBeVisible();
  await page.getByRole("tablist", { name: "Year report subject" }).getByRole("tab", { name: "Monthly results", exact: true }).click();
  const yearTable = page.getByRole("region", { name: "2026 through selected month performance table" });
  await expect(yearTable.getByRole("rowheader")).toHaveCount(12);
  await expect(yearTable.getByRole("rowheader", { name: "Jan 2026", exact: true })).toBeVisible();
  await expect(yearTable.getByRole("rowheader", { name: "Dec 2026", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await page.getByRole("button", { name: "Remove demo data", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove demo data", exact: true }).click();
  await expect(page.getByText("235 demonstration sales removed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load full-year demo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load full-year demo", exact: true }).click();
  await expect(page.getByText("235 previously removed records were restored.")).toBeVisible();
});
