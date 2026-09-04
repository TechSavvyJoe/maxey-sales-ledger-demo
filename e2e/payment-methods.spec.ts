import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("payment methods save, survive reload, and separate financing reports", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chrome", "Desktop and phone cover the input workflow.");
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00Z"));
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  for (const [index, method] of ["Finance", "Cash", "Outside Finance"].entries()) {
    await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
    await page.getByLabel("Delivery date").fill("2026-08-31");
    await page.getByLabel(/Stock number/).fill(`PAY-${index}`);
    await page.getByLabel("Customer last name").fill("Example");
    await page.getByLabel("Front gross").fill("1000");
    // F&I dollars may be entered later without losing the payment choice.
    if (index !== 2) await page.getByLabel("Total F&I gross", { exact: true }).fill("500");
    const radio = page.getByRole("radio", { name: method, exact: true });
    await radio.check();
    await expect(radio).toBeChecked();
    if (index === 2) {
      const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(audit.violations).toEqual([]);
    }
    await page.getByRole("button", { name: "Add sale", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add sale", exact: true })).toBeHidden();
  }
  await page.reload();
  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await page.getByRole("button", { name: "Actions for stock PAY-2", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit sale", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Outside Finance", exact: true })).toBeChecked();
  await expect(page.getByLabel("Total F&I gross", { exact: true })).toHaveValue("");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  const center = page.locator(".fi-report-center").first();
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "Finance Penetration" })).toContainText("1 of 3 sales");
  await expect(center.locator(".fi-center-kpi").filter({ hasText: "F&I gross per sale (PVR)" })).toContainText("$1,300 total recorded");
  await center.getByRole("tab", { name: "Financing", exact: true }).click();
  const financing = center.locator('[id$="-financing-panel"]');
  await expect(financing).not.toContainText("Cash / outside not specified");
  for (const method of ["Finance", "Cash", "Outside Finance"]) {
    const cards = financing.locator(".fi-center-phone-disclosures");
    if (await cards.isVisible()) {
      await expect(cards.locator("details").filter({ has: page.getByText(method, { exact: true }) }).locator("summary")).toContainText("1 of 3 deals");
    } else {
      await expect(financing.locator("tbody tr").filter({ has: page.getByRole("rowheader", { name: method, exact: true }) }).first()).toContainText("33%");
    }
  }
});
