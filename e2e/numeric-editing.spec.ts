import { expect, test, type Dialog, type Locator, type Page } from "@playwright/test";

type SettingsCategory = "Profile & goals" | "Pay plan" | "Volume bonuses";

async function openSettings(page: Page, category: SettingsCategory = "Profile & goals") {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: new RegExp(`^${category}`) }).click();
}

async function clearWithKeyboard(input: Locator) {
  await input.focus();
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
}

async function typeNumber(input: Locator, text: string, normalized = text) {
  await clearWithKeyboard(input);
  await input.pressSequentially(text);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(text);
  await input.press("Tab");
  await expect(input).toHaveValue(normalized);
}

async function saveSettings(page: Page) {
  const save = page.getByRole("button", { name: "Save settings", exact: true }).first();
  if (await save.isEnabled()) await save.click();
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  await expect(page.locator(".settings-validation-summary")).toBeHidden();
}

async function openPayroll(page: Page) {
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tab", { name: "Paid versus estimate", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add sale", exact: true }).first()).toBeVisible();
});

test("goals, rates, and bonus amounts support clear-and-type edits and persist canonical numbers", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Numeric Test");
  await typeNumber(page.getByLabel(/delivery goal/), "00025", "25");
  await typeNumber(page.getByLabel(/commission goal/), "009000.50", "9000.5");

  await openSettings(page, "Pay plan");
  await typeNumber(page.getByLabel("Base front rate", { exact: true }), "030.5", "30.5");
  await typeNumber(page.getByLabel("Higher front rate", { exact: true }), "035.5", "35.5");
  await typeNumber(page.getByLabel("Higher rate starts above", { exact: true }), "010", "10");
  await typeNumber(page.getByLabel("F&I rate", { exact: true }), "020.25", "20.25");

  await openSettings(page, "Volume bonuses");
  await typeNumber(page.getByLabel("Tier 1 bonus added at milestone", { exact: true }), "00375.50", "375.5");
  await expect(page.getByLabel("Tier 2 bonus added at milestone", { exact: true })).toHaveValue("800");
  await saveSettings(page);

  await page.reload();
  await openSettings(page);
  await expect(page.getByLabel(/delivery goal/)).toHaveValue("25");
  await expect(page.getByLabel(/commission goal/)).toHaveValue("9000.5");
  await openSettings(page, "Pay plan");
  await expect(page.getByLabel("Base front rate", { exact: true })).toHaveValue("30.5");
  await expect(page.getByLabel("Higher front rate", { exact: true })).toHaveValue("35.5");
  await expect(page.getByLabel("Higher rate starts above", { exact: true })).toHaveValue("10");
  await expect(page.getByLabel("F&I rate", { exact: true })).toHaveValue("20.25");
  await openSettings(page, "Volume bonuses");
  await expect(page.getByLabel("Tier 1 bonus added at milestone", { exact: true })).toHaveValue("375.5");
});

test("editing a bonus minimum one character at a time keeps focus and its sibling values", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Numeric Test");
  await openSettings(page, "Volume bonuses");
  const minimum = page.getByLabel("Tier 1 minimum delivered", { exact: true });
  const sibling = page.getByLabel("Tier 2 bonus added at milestone", { exact: true });
  await minimum.focus();
  await minimum.press("End");
  await minimum.press("Backspace");
  await expect(minimum).toBeFocused();
  await expect(minimum).toHaveValue("1");
  await minimum.pressSequentially("2");
  await expect(minimum).toBeFocused();
  await expect(minimum).toHaveValue("12");
  await typeNumber(sibling, "0800.5", "800.5");
  await minimum.focus();
  await minimum.press("End");
  await minimum.press("Backspace");
  await expect(minimum).toBeFocused();
  await expect(minimum).toHaveValue("1");
  await minimum.pressSequentially("2");
  await expect(minimum).toBeFocused();
  await expect(sibling).toHaveValue("800.5");

  await openSettings(page, "Pay plan");
  await openSettings(page, "Volume bonuses");
  await expect(minimum).toHaveValue("12");
  await expect(sibling).toHaveValue("800.5");
  await saveSettings(page);
  await page.reload();
  await openSettings(page, "Volume bonuses");
  await expect(minimum).toHaveValue("12");
  await expect(sibling).toHaveValue("800.5");
});

test("clearing required numeric settings never silently saves a zero", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Numeric Test");
  await saveSettings(page);
  const fields: Array<{ category: SettingsCategory; label: string | RegExp; original: string }> = [
    { category: "Profile & goals", label: /delivery goal/, original: "15" },
    { category: "Pay plan", label: "Base front rate", original: "30" },
    { category: "Pay plan", label: "Higher front rate", original: "35" },
    { category: "Pay plan", label: "Higher rate starts above", original: "10" },
    { category: "Pay plan", label: "F&I rate", original: "20" },
    { category: "Volume bonuses", label: "Tier 1 minimum delivered", original: "11" },
    { category: "Volume bonuses", label: "Tier 1 bonus added at milestone", original: "300" },
  ];

  for (const field of fields) {
    await openSettings(page, field.category);
    const input = page.getByLabel(field.label, { exact: typeof field.label === "string" });
    await clearWithKeyboard(input);
    await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
    await expect(input).toHaveValue("");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toBeFocused();
    await expect(page.locator(".settings-validation-summary")).toBeVisible();
    await input.pressSequentially(field.original);
    await input.press("Tab");
  }

  await page.reload();
  for (const field of fields) {
    await openSettings(page, field.category);
    await expect(page.getByLabel(field.label, { exact: typeof field.label === "string" })).toHaveValue(field.original);
  }
});

test("an optional commission goal distinguishes no goal from invalid zero", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Numeric Test");
  const goal = page.getByLabel(/commission goal/);
  await typeNumber(goal, "9000.5");
  await saveSettings(page);
  await clearWithKeyboard(goal);
  await saveSettings(page);
  await page.reload();
  await openSettings(page);
  await expect(goal).toHaveValue("");

  await goal.pressSequentially("0");
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(goal).toHaveValue("0");
  await expect(goal).toHaveAttribute("aria-invalid", "true");
  await expect(goal).toBeFocused();
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await openSettings(page);
  await expect(goal).toHaveValue("");
});

test("a category click survives invalid numeric blur and same-value normalization", async ({ page }, testInfo) => {
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Numeric Test");
  await saveSettings(page);
  await openSettings(page, "Pay plan");
  const rate = page.getByLabel("Base front rate", { exact: true });
  const profileCategory = page.getByRole("button", { name: /^Profile & goals/ });
  const clickProfile = async () => {
    if (testInfo.project.name === "mobile-chrome") await profileCategory.tap();
    else await profileCategory.click();
    await expect(page.getByRole("region", { name: "Profile & goals", exact: true })).toBeVisible();
    await expect(page.locator("#settings-panel-pay-plan")).toBeHidden();
  };

  await clearWithKeyboard(rate);
  await rate.pressSequentially("101");
  await clickProfile();
  await expect(page.locator(".settings-validation-summary")).toBeHidden();

  await openSettings(page, "Pay plan");
  await clearWithKeyboard(rate);
  await rate.pressSequentially("030");
  await clickProfile();
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  await openSettings(page, "Pay plan");
  await expect(rate).toHaveValue("30");
});

test("retyping the same numeric settings leaves a clean draft that accepts another tab's update", async ({ page, context }) => {
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Numeric Test");
  await saveSettings(page);
  await page.getByLabel(/delivery goal/).focus();
  await page.getByLabel(/delivery goal/).press("Tab");
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  await typeNumber(page.getByLabel(/delivery goal/), "015", "15");
  await openSettings(page, "Pay plan");
  await typeNumber(page.getByLabel("Base front rate", { exact: true }), "030", "30");
  await openSettings(page, "Volume bonuses");
  await typeNumber(page.getByLabel("Tier 1 bonus added at milestone", { exact: true }), "0300", "300");
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  const focusedMinimum = page.getByLabel("Tier 1 minimum delivered", { exact: true });
  await focusedMinimum.focus();

  const otherPage = await context.newPage();
  await otherPage.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await otherPage.goto("/");
  await openSettings(otherPage);
  await otherPage.getByLabel("Salesperson name *").fill("External Test Update");
  await saveSettings(otherPage);
  await expect(page.getByLabel("Salesperson name *")).toHaveValue("External Test Update");
  await page.bringToFront();
  await expect(focusedMinimum).toBeFocused();
  await openSettings(page);
  await expect(page.getByLabel("Salesperson name *")).toHaveValue("External Test Update");
  await expect(page.locator(".settings-external-change")).toBeHidden();
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
});

test("sale gross fields allow ordinary decimal typing and retain split credit on save", async ({ page }) => {
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  await page.getByLabel(/Customer last name/).fill("Numeric");
  await page.getByLabel(/Stock number/).fill("NUMERIC-001");
  await typeNumber(page.getByLabel("Front gross", { exact: true }), "0002500.75", "2500.75");
  await typeNumber(page.getByLabel("Total F&I gross", { exact: true }), ".50", "0.50");
  await expect(page.getByLabel("Custom", { exact: true })).toHaveCount(0);
  const splitDeal = page.getByRole("checkbox", { name: "Split deal", exact: true });
  await splitDeal.check();
  await page.getByRole("button", { name: "Add sale", exact: true }).click();
  await expect(page.getByText("Sale added.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: "Actions for stock NUMERIC-001", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByLabel("Front gross", { exact: true })).toHaveValue("2500.75");
  await expect(page.getByLabel("Total F&I gross", { exact: true })).toHaveValue("0.50");
  await expect(splitDeal).toBeVisible();
  await expect(splitDeal).toBeChecked();
});

test("payroll normalizes typed money, validates in place, and keeps blank distinct from zero across months", async ({ page }) => {
  await openPayroll(page);
  const paid = page.getByLabel("Commission paid", { exact: true });
  await typeNumber(paid, "0001234.50", "1234.50");
  await paid.focus();
  await paid.press("Enter");
  await expect(page.getByText("Actual paid amount saved.").first()).toBeVisible();
  await expect(paid).toBeFocused();
  await expect(paid).toHaveValue("1234.50");

  // Saving the same amount still normalizes the editor even if the stored
  // value is unchanged and no month or page navigation occurs.
  await clearWithKeyboard(paid);
  await paid.pressSequentially("0001234.50");
  await paid.press("Enter");
  await expect(paid).toHaveValue("1234.50");
  await clearWithKeyboard(paid);
  await paid.press("Enter");
  await expect(page.locator(".payroll-comparison")).toContainText("Not entered");
  await paid.pressSequentially("12..3");
  await paid.press("Enter");
  await expect(paid).toHaveAttribute("aria-invalid", "true");
  await expect(paid).toBeFocused();
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await openPayroll(page);
  await expect(paid).toHaveValue("");

  await paid.pressSequentially("0");
  await paid.press("Enter");
  await expect(paid).toHaveValue("0.00");
  await page.getByRole("button", { name: /^Show (?!months)/ }).first().click();
  await openPayroll(page);
  await expect(paid).toHaveValue("");
  await page.getByRole("button", { name: /^Show (?!months)/ }).last().click();
  await openPayroll(page);
  await expect(paid).toHaveValue("0.00");
});

test("unsaved payroll survives cancelled navigation and conflicts with newer edits in another tab", async ({ page, context }) => {
  await openPayroll(page);
  const paid = page.getByLabel("Commission paid", { exact: true });
  await paid.pressSequentially("123.45");
  const period = page.getByRole("button", { name: /Choose reporting month/ });
  const originalPeriod = await period.getAttribute("aria-label");
  const discardedPrompts: string[] = [];
  const dismiss = async (dialog: Dialog) => {
    discardedPrompts.push(dialog.message());
    await dialog.dismiss();
  };
  page.on("dialog", dismiss);
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
  await expect.poll(() => discardedPrompts.length).toBe(1);
  expect(discardedPrompts[0]).toContain("unsaved payroll");
  await expect(paid).toHaveValue("123.45");
  await page.getByRole("button", { name: /^Show (?!months)/ }).first().click();
  await expect.poll(() => discardedPrompts.length).toBe(2);
  expect(discardedPrompts[1]).toContain("reporting month");
  await expect(period).toHaveAttribute("aria-label", originalPeriod!);
  await expect(paid).toHaveValue("123.45");
  page.off("dialog", dismiss);

  const otherPage = await context.newPage();
  await otherPage.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await otherPage.goto("/");
  await openPayroll(otherPage);
  const otherPaid = otherPage.getByLabel("Commission paid", { exact: true });
  await otherPaid.pressSequentially("100");
  await otherPaid.press("Enter");
  await expect(otherPaid).toHaveValue("100.00");
  await expect(page.getByRole("alert").filter({ hasText: "Payroll changed in another tab" })).toBeVisible();
  await expect(paid).toHaveValue("123.45");
  await expect(page.getByRole("button", { name: "Try saving again", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Load latest payroll amount", exact: true }).click();
  await expect(paid).toHaveValue("100.00");

  await clearWithKeyboard(otherPaid);
  await otherPaid.pressSequentially("200");
  await otherPaid.press("Enter");
  await expect(otherPaid).toHaveValue("200.00");
  await expect(paid).toHaveValue("200.00");
  await expect(page.getByRole("alert").filter({ hasText: "Payroll changed in another tab" })).toBeHidden();
});
