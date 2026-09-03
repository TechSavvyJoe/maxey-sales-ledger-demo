import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function loadMiniFixtures(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-15T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  // Fictional fixtures only, in Playwright's fresh isolated browser database.
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db, createDefaultSettings } = await import(modulePath);
    if (await db.sales.count()) throw new Error("Mini fixture needs an empty isolated workspace.");
    const now = "2026-09-15T16:00:00.000Z";
    const settings = createDefaultSettings(new Date(now));
    const augustPlan = { ...settings.payPlan, effectiveMonth: "2026-08", version: "August", minimumFrontCommissionCents: 30_000 };
    const septemberPlan = { ...augustPlan, effectiveMonth: "2026-09", version: "September" };
    await db.settings.put({ ...settings, salespersonName: "Mini Test", payPlan: septemberPlan, payPlanHistory: [augustPlan, septemberPlan], onboardingDismissed: true });
    const base = {
      profileId: "primary", customerLastName: "Example", vehicleDescription: "2024 Ford Escape",
      status: "delivered", unitCreditBasis: 1_000, frontGrossCents: 0, fiGrossCents: 0,
      serviceContractSold: false, tireWheelSold: false, gapSold: false, paymentMethod: "cash",
      notes: "", createdAt: now, updatedAt: now, revision: 1, source: "manual",
    };
    await db.sales.bulkAdd([
      { ...base, id: "mini-negative", stockNumber: "MINI-NEG", saleDate: "2026-09-01", frontGrossCents: -31_661, fiGrossCents: 60_000 },
      { ...base, id: "mini-split", stockNumber: "MINI-SPLIT", saleDate: "2026-09-02", unitCreditBasis: 500 },
      { ...base, id: "mini-manual", stockNumber: "MINI-MANUAL", saleDate: "2026-09-03", frontGrossCents: null, frontCommissionOverrideCents: 50_000, fiGrossCents: 10_000 },
      { ...base, id: "mini-august", stockNumber: "MINI-AUG", saleDate: "2026-08-03" },
    ]);
  });
  await page.reload();
  await expect(page.locator(".dashboard-page")).toBeVisible();
}

async function openPayPlan(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Pay plan/ }).click();
  await expect(page.getByLabel("Mini", { exact: true })).toBeVisible();
}

test("Mini settings safely preview and save the effective range while manual payouts and earlier plans stay intact", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chrome", "Desktop and phone cover this focused settings flow.");
  await loadMiniFixtures(page);
  await openPayPlan(page);
  const mini = page.getByLabel("Mini", { exact: true });
  await expect(mini).toHaveValue("300");
  await mini.focus();
  await mini.press("ControlOrMeta+A");
  await mini.press("Backspace");
  await mini.pressSequentially("00400");
  await expect(mini).toBeFocused();
  await expect(mini).toHaveValue("00400");
  await mini.press("Tab");
  await expect(mini).toHaveValue("400");
  await expect(page.locator(".pay-plan-impact")).toContainText("September 2026 onward");
  await expect(page.locator(".pay-plan-impact")).toContainText("+$150");
  await expect(page.locator(".pay-plan-caveat")).toContainText("Manual/spiff payouts do not change");

  const metrics = await mini.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  expect(metrics.height).toBeGreaterThanOrEqual(44);
  expect(metrics.overflow).toBe(false);
  await testInfo.attach("mini-settings", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await expect(new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze().then((result) => result.violations)).resolves.toEqual([]);

  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.locator(".settings-dirty-state")).toBeHidden();
  await page.reload();
  await openPayPlan(page);
  await expect(mini).toHaveValue("400");
  const saved = await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    return { settings: await db.settings.get("primary"), sale: await db.sales.get("mini-manual") };
  });
  expect(saved.settings.payPlan.minimumFrontCommissionCents).toBe(40_000);
  expect(saved.settings.payPlanHistory.find((plan: { effectiveMonth: string }) => plan.effectiveMonth === "2026-08").minimumFrontCommissionCents).toBe(30_000);
  expect(saved.sale.frontCommissionOverrideCents).toBe(50_000);

  await mini.fill("");
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(mini).toHaveAttribute("aria-invalid", "true");
  await expect(mini).toBeFocused();
  await expect(page.locator("#settings-mini-error")).toContainText("Mini must be");
});

test("Dashboard, sales, reports, and payroll preserve signed gross but use Mini and exact personal payouts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chrome", "Desktop and phone cover report layouts.");
  await loadMiniFixtures(page);
  const breakdown = page.locator(".dashboard-v2-commission-details");
  await expect(breakdown).toContainText("$950");
  await expect(breakdown).toContainText("$140");
  await expect(breakdown).toContainText("$1,090");
  await expect(breakdown).toContainText("2 Mini");
  await expect(breakdown).toContainText("1 manual/spiff");
  await expect(page.locator(".dashboard-v2-review")).toContainText("Everything is up to date");
  await expect(page.getByRole("region", { name: "Monthly goal and commission outlook" })).not.toContainText("Awaiting front gross");
  await expect(page.getByRole("region", { name: "Monthly goal and commission outlook" })).toContainText("Projection from entered gross");
  await expect(page.getByRole("region", { name: "Monthly goal and commission outlook" })).toContainText("Partial projection");

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  const negative = page.locator(".sales-table tbody tr:visible, .sale-card:visible").filter({ hasText: "MINI-NEG" });
  await expect(negative).toContainText("-$317");
  await expect(negative).toContainText("$420");
  await expect(negative).toContainText("Mini");
  await expect(negative).not.toContainText("Negative correction");

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.locator("#month-comparison > summary").click();
  await expect(page.locator("#month-comparison dl > div").filter({ hasText: "Front gross" })).toContainText("Awaiting front gross");
  await expect(page.locator("#month-comparison dl > div").filter({ hasText: "Monthly estimate" })).toContainText("+$790");
  const subjects = page.getByRole("tablist", { name: "Monthly report subject" });
  await subjects.getByRole("tab", { name: "Commission", exact: true }).click();
  const calculation = page.getByRole("region", { name: "Estimated earnings calculation" });
  await expect(calculation).toContainText("$950.00");
  await expect(calculation).toContainText("2 Mini · 1 manual/spiff");
  await expect(calculation).toContainText("$1,090.00");
  await subjects.getByRole("tab", { name: "F&I", exact: true }).click();
  const money = page.locator(".fi-report-center:visible .fi-center-money-grid");
  await expect(money).toContainText("-$317");
  await expect(money.locator("dl > div").filter({ hasText: "Commissionable front gross" }).locator("dd")).toHaveText("$0");
  await expect(money).toContainText("2 Mini · 1 manual/spiff");
  await testInfo.attach("mini-commission-report", { body: await money.screenshot(), contentType: "image/png" });
  await page.getByRole("tab", { name: "Paid versus estimate", exact: true }).click();
  await expect(page.locator(".payroll-layout")).not.toContainText("Estimate incomplete");
  await expect(page.locator(".payroll-layout")).toContainText("$1,090");

  await page.getByRole("tab", { name: "Full-year report", exact: true }).click();
  await page.getByRole("tablist", { name: "Year report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  const yearMoney = page.locator(".fi-report-center:visible .fi-center-money-grid");
  await expect(yearMoney).toContainText("3 Mini · 1 manual/spiff");
  await expect(yearMoney).toContainText("$1,390");
});
