import { expect, test } from "@playwright/test";

test("the public link opens with demo history and respects removal after reload", async ({ page }, testInfo) => {
  test.skip(process.env.VITE_PUBLIC_DEMO_AUTOLOAD !== "true", "Run with public demo autoload enabled.");
  test.skip(testInfo.project.name !== "desktop-chrome", "The first visit contract is viewport-independent.");
  await page.clock.setFixedTime(new Date("2026-09-02T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Demo data active" })).toContainText("481 fictional records");
  await expect(page.getByRole("button", { name: "Explore 2-year demo", exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("complementary", { name: "Demo data active" })).toContainText("481 fictional records");
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("button", { name: /Delivered 12/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Void/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await page.getByRole("button", { name: "Remove demo data", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove demo data", exact: true }).click();
  await expect(page.getByText("481 demonstration sales removed.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Demo data active" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await expect(page.getByRole("button", { name: "Load 2-year demo", exact: true })).toBeVisible();
});
