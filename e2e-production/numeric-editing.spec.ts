import { expect, test, type Locator } from "@playwright/test";

async function replaceByTyping(input: Locator, text: string) {
  await input.focus();
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await input.pressSequentially(text);
  await expect(input).toHaveValue(text);
  await expect(input).toBeFocused();
}

test("published-build number fields retain focus, normalize without refresh, and save offline", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByLabel("Salesperson name *").fill("Number Entry Demo");
  await page.getByRole("button", { name: /^Pay plan/ }).click();
  const base = page.getByLabel("Base front rate", { exact: true });
  await replaceByTyping(base, "030.25");
  await base.press("Tab");
  await expect(base).toHaveValue("30.25");

  await page.getByRole("button", { name: /^Volume bonuses/ }).click();
  const minimum = page.getByLabel("Tier 1 minimum delivered", { exact: true });
  await replaceByTyping(minimum, "012");
  await minimum.press("Backspace");
  await expect(minimum).toHaveValue("01");
  await expect(minimum).toBeFocused();
  await minimum.pressSequentially("2");
  await minimum.press("Tab");
  await expect(minimum).toHaveValue("12");
  const bonus = page.getByLabel("Tier 1 bonus added at milestone", { exact: true });
  await replaceByTyping(bonus, "00350.25");
  await bonus.press("Tab");
  await expect(bonus).toHaveValue("350.25");

  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.locator(".settings-dirty-state")).toBeHidden();
  await expect(page.locator(".settings-validation-summary")).toBeHidden();
  await expect(minimum).toHaveValue("12");
  await expect(bonus).toHaveValue("350.25");

  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Pay plan/ }).click();
  await expect(base).toHaveValue("30.25");
  await page.getByRole("button", { name: /^Volume bonuses/ }).click();
  await expect(minimum).toHaveValue("12");
  await expect(bonus).toHaveValue("350.25");
});
