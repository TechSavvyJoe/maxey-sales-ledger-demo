import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function openWorkSchedule(page: Page) {
  await page.getByRole("button", { name: /^Days off/ }).click();
  const schedule = page.locator(".work-schedule-details");
  if ((await schedule.getAttribute("open")) === null) {
    await schedule.locator("summary").click();
  }
}

async function openDataSettings(page: Page) {
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await expect(page.locator(".data-settings")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("safety backup remains confirmable and a validated restore completes", async ({ page }, testInfo) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByLabel("Salesperson name *").fill("Restore Test");
  await openWorkSchedule(page);
  await page.getByRole("button", {
    name: "Monday, August 3 — working. Select to mark day off.",
  }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.getByText("Settings saved and calculations refreshed.").last()).toBeVisible();
  const closeToasts = page.getByRole("button", { name: "Close toast" });
  await closeToasts.evaluateAll((buttons) => buttons.forEach((button) => (button as HTMLButtonElement).click()));
  await page.waitForTimeout(100);

  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Customer last name").fill("Original");
  await page.getByLabel(/Stock number/).fill("RESTORE-ORIGINAL");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openWorkSchedule(page);
  await openDataSettings(page);
  const backupDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Download backup/ }).click();
  const backupDownload = await backupDownloadPromise;
  const backupPath = await backupDownload.path();
  expect(backupPath).not.toBeNull();

  await openWorkSchedule(page);
  await page.getByRole("button", { name: /Clear Aug .*days off/ }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.getByText("Settings saved and calculations refreshed.").last()).toBeVisible();
  await closeToasts.evaluateAll((buttons) => buttons.forEach((button) => (button as HTMLButtonElement).click()));
  await page.waitForTimeout(100);

  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel("Customer last name").fill("Newer");
  await page.getByLabel(/Stock number/).fill("RESTORE-NEWER");
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openDataSettings(page);
  await page
    .getByLabel("Select a Sales Ledger backup file to restore")
    .setInputFiles(backupPath!);

  const restoreDialog = page.getByRole("dialog", { name: "Restore this full backup?" });
  await expect(restoreDialog).toBeVisible();
  await expect(restoreDialog.getByText("1", { exact: true })).toBeVisible();

  const safetyDownloadPromise = page.waitForEvent("download");
  await restoreDialog.getByRole("button", { name: "Download current safety backup first" }).click();
  await safetyDownloadPromise;

  await expect(restoreDialog).toBeVisible();
  const safetyConfirmation = restoreDialog.getByRole("checkbox", {
    name: "I found the downloaded safety backup and can open it",
  });
  await expect(safetyConfirmation).toBeEnabled();
  await safetyConfirmation.check();
  await restoreDialog.getByRole("button", { name: "Replace with backup" }).click();

  await expect(page.getByText("Backup restored with 1 sales.")).toBeVisible();
  await expect(restoreDialog).toBeHidden();

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await openWorkSchedule(page);
  await expect(page.getByRole("button", {
    name: "Monday, August 3 — day off. Select to mark working.",
  })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  const salesSurface = testInfo.project.name === "desktop-chrome"
    ? page.locator(".sales-table-wrap")
    : page.locator(".sales-card-list");
  await expect(salesSurface.getByText("RESTORE-ORIGINAL")).toBeVisible();
  await expect(salesSurface.getByText("RESTORE-NEWER")).toBeHidden();
});
