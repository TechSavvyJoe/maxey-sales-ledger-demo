import { expect, test } from "@playwright/test";

test("settings refresh across tabs without silently overwriting newer edits", async ({ context, page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();

  const secondPage = await context.newPage();
  await secondPage.goto("/");
  await secondPage.getByRole("button", { name: "Settings", exact: true }).first().click();

  const firstName = page.getByLabel("Salesperson name *");
  const secondName = secondPage.getByLabel("Salesperson name *");
  await secondName.fill("First external update");
  await secondPage.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(secondPage.getByText("Settings saved and calculations refreshed.")).toBeVisible();

  await expect(firstName).toHaveValue("First external update");
  await expect(page.getByText(/Unsaved settings changes/)).toBeHidden();

  const firstGoal = page.getByLabel(/delivery goal/);
  await firstGoal.fill("20");
  await secondName.fill("Newer external update");
  await secondPage.getByRole("button", { name: "Save settings", exact: true }).first().click();

  await expect(page.getByRole("alert").filter({ hasText: "Settings changed in another tab" })).toBeVisible();
  await expect(firstGoal).toHaveValue("20");
  await expect(page.getByRole("button", { name: "Save settings", exact: true }).first()).toBeDisabled();

  await page.getByRole("button", { name: "Load latest settings" }).click();
  await expect(firstName).toHaveValue("Newer external update");
  await expect(firstGoal).toHaveValue("15");
  await expect(page.getByText("Latest settings loaded.")).toBeVisible();
  await expect(page.getByText(/Unsaved settings changes/)).toBeHidden();
  const saveButtons = page.getByRole("button", { name: "Save settings", exact: true });
  if (testInfo.project.name.startsWith("mobile")) {
    await expect(saveButtons).toHaveCount(0);
  } else {
    await expect(saveButtons.first()).toBeEnabled();
  }
});
