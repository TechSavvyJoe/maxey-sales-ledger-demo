import { expect, test } from "@playwright/test";

test("built application, styles, and lazy pages remain usable after an offline reload", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  const dealershipLogo = page.getByAltText("Bob Maxey Ford of Howell").first();
  await expect(dealershipLogo).toBeVisible();
  expect(await dealershipLogo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await dealershipLogo.getAttribute("src")).toContain("brand/bob-maxey-ford-howell.png");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  await page.reload();
  await expect(page.getByRole("button", { name: "Add sale", exact: true }).first()).toBeVisible();
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Add sale", exact: true }).first()).toBeVisible();
  await expect(page.getByAltText("Bob Maxey Ford of Howell").first()).toBeVisible();

  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel(/Customer last name/).fill("Offline");
  await page.getByLabel(/Stock number/).fill("OFFLINE-001");
  await page.getByLabel("Front gross").fill("2000");
  await page.getByLabel("Vehicle optional").fill("2024 Ford Escape");
  await page.locator(".sale-form__footer").getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /sales$/i })).toBeVisible();
  await expect(page.getByText("OFFLINE-001").first()).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Profile & goals" })).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /reports$/i })).toBeVisible();
  const reportMark = page.locator('img[src*="sales-ledger-mark"]:visible').first();
  await expect(reportMark).toBeVisible();
  expect(await reportMark.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Open report exports", exact: true }).click();
  await page.getByRole("button", { name: "Monthly CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/sales-\d{4}-\d{2}\.csv$/);
});
