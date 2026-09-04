import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

type FixtureMode = "standard" | "mini-manual" | "partial";

async function seedMilestones(page: Page, count = 15, mode: FixtureMode = "standard") {
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  // This is Playwright's fresh, isolated fake database, never the user's tab.
  await page.evaluate(async ({ saleCount, fixtureMode }) => {
    const databasePath = "/src/persistence/database.ts";
    const { db } = await import(databasePath);
    const settings = await db.settings.get("primary");
    await db.settings.put({ ...settings, selectedMonth: "2026-08", selectedView: "sales" });
    await db.sales.bulkPut(Array.from({ length: saleCount }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return {
        id: `milestone-sale-${day}`,
        profileId: "primary",
        saleDate: `2026-08-${day}`,
        customerLastName: `Example ${day}`,
        stockNumber: `MILESTONE-${day}`,
        vehicleDescription: "2024 Ford Escape",
        status: "delivered",
        unitCreditBasis: 1000,
        frontGrossCents: fixtureMode === "partial" && index === 0 ? null
          : fixtureMode === "mini-manual" && (index === 0 || index === 10) ? -31661 : 250000,
        frontCommissionOverrideCents: fixtureMode === "mini-manual" && index === 1 ? 50000 : null,
        fiGrossCents: fixtureMode === "partial" && index === 10 ? null : 60000,
        serviceContractSold: true,
        tireWheelSold: false,
        gapSold: false,
        paymentMethod: "cash",
        dealerFinanced: false,
        notes: "Fictional milestone QA example",
        createdAt: `2026-08-${day}T16:00:00.000Z`,
        updatedAt: `2026-08-${day}T16:00:00.000Z`,
        revision: 1,
        source: "manual",
      };
    }));
  }, { saleCount: count, fixtureMode: mode });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
}

function milestoneButton(page: Page, ordinal: number) {
  return page.getByRole("button", { name: `View delivery ${ordinal} milestone for Example ${String(ordinal).padStart(2, "0")}`, exact: true });
}

async function expectMilestone(page: Page, extra: string, retro: string | null, bonus: string, impact: string) {
  const summary = page.locator(".sale-milestone-summary");
  await expect(summary.getByRole("heading", { name: "Extra earnings unlocked", exact: true })).toBeVisible();
  await expect(summary.locator(".sale-milestone-summary__heading > strong")).toHaveText(extra);
  if (retro === null) await expect(summary.getByText("Prior-sales rate increase", { exact: false })).toHaveCount(0);
  else await expect(summary.locator("dl > div").filter({ hasText: "Prior-sales rate increase" }).locator("dd")).toHaveText(retro);
  await expect(summary.locator("dl > div").filter({ hasText: "Added volume bonus" }).locator("dd")).toHaveText(bonus);
  await expect(summary.locator(".sale-milestone-summary__total dd")).toHaveText(impact);
  await expect(summary).toContainText("Already included in monthly totals");
}

async function monthTotal(page: Page) {
  return page.evaluate(async () => {
    const databasePath = "/src/persistence/database.ts";
    const commissionPath = "/src/domain/commission.ts";
    const payPlanPath = "/src/domain/payPlan.ts";
    const { db } = await import(databasePath);
    const { calculateMonth } = await import(commissionPath);
    const { getPayPlanSchedule } = await import(payPlanPath);
    return calculateMonth(await db.sales.toArray(), "2026-08", getPayPlanSchedule(await db.settings.get("primary"))).estimatedCommissionCents;
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet-chrome", "Desktop and phone cover the focused milestone feature.");
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("milestone links explain prior-sales uplift and added bonus without inflating sale or month totals", async ({ page }, testInfo) => {
  await seedMilestones(page);
  // 15 x ($875 front + $120 F&I) + $1,100 cumulative bonus = $16,025.
  expect(await monthTotal(page)).toBe(1602500);
  const firstMilestone = milestoneButton(page, 11);
  await expect(firstMilestone).toContainText("+$1,550");
  const targetBounds = await firstMilestone.boundingBox();
  expect(targetBounds?.height).toBeGreaterThanOrEqual(44);
  await firstMilestone.click();
  await expect(page.getByRole("textbox", { name: /Stock number/ })).toHaveValue("MILESTONE-11");
  await expectMilestone(page, "$1,550.00", "$1,250.00", "$300.00", "$2,545.00");
  await expect(page.locator(".sale-footer-breakdown > span > strong")).toHaveText(["$875.00", "$120.00", "$995.00"]);
  await expect(page.locator(".sale-milestone-summary")).not.toContainText("partial estimate");
  expect(await page.locator(".sale-sheet").evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.locator(".sale-milestone-summary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("sale-milestone.png") });
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("dialog", { name: "Edit sale" }).getByRole("button", { name: "Close" }).click();
  await expect(firstMilestone).toBeFocused();

  await milestoneButton(page, 15).click();
  await expectMilestone(page, "$800.00", null, "$800.00", "$1,795.00");
  await expect(page.locator(".sale-footer-breakdown > span > strong")).toHaveText(["$875.00", "$120.00", "$995.00"]);
  await page.getByRole("button", { name: /^Pending\./ }).click();
  await expect(page.locator(".sale-milestone-summary")).toHaveCount(0);
  await page.getByRole("button", { name: /^Delivered\./ }).click();
  await page.getByRole("textbox", { name: /Stock number/ }).fill("");
  await expect(page.locator(".sale-milestone-summary")).toHaveCount(0);
  expect(await monthTotal(page)).toBe(1602500);
});

test("minis and manual payouts do not invent prior-sales uplift and changing the milestone's payout only changes its own impact", async ({ page }) => {
  await seedMilestones(page, 11, "mini-manual");
  await milestoneButton(page, 11).click();
  // Eight normal prior sales add $125 each. The earlier mini and manual payout add $0 uplift.
  await expectMilestone(page, "$1,300.00", "$1,000.00", "$300.00", "$1,720.00");
  await expect(page.locator(".sale-footer-breakdown > span > strong")).toHaveText(["$300.00", "$120.00", "$420.00"]);
  await page.getByRole("checkbox", { name: "Spiff / manual front commission", exact: true }).check();
  await expect(page.locator(".sale-milestone-summary")).toHaveCount(0);
  await page.getByLabel("Your front commission", { exact: true }).fill("700");
  await expectMilestone(page, "$1,300.00", "$1,000.00", "$300.00", "$2,120.00");
  await expect(page.locator(".sale-footer-breakdown > span > strong")).toHaveText(["$700.00", "$120.00", "$820.00"]);
  await page.getByRole("checkbox", { name: "Split deal", exact: true }).check();
  await expectMilestone(page, "$1,300.00", "$1,000.00", "$300.00", "$2,120.00");
});

test("missing gross is identified as partial and the milestone updates when earlier numbers arrive", async ({ page }) => {
  await seedMilestones(page, 11, "partial");
  await expect(milestoneButton(page, 11)).toContainText("+$1,425 so far");
  await milestoneButton(page, 11).click();
  await expectMilestone(page, "$1,425.00", "$1,125.00", "$300.00", "$2,300.00");
  await expect(page.locator(".sale-milestone-summary")).toContainText("partial estimate");
  await expect(page.locator(".sale-milestone-summary")).toContainText("front gross is missing on 1 earlier sale");
  await page.getByLabel("Total F&I gross", { exact: true }).fill("600");
  await expectMilestone(page, "$1,425.00", "$1,125.00", "$300.00", "$2,420.00");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit sale", exact: true })).toBeHidden();

  await page.evaluate(async () => {
    const databasePath = "/src/persistence/database.ts";
    const { db } = await import(databasePath);
    await db.sales.update("milestone-sale-01", { frontGrossCents: 250000 });
  });
  await page.reload();
  await expect(milestoneButton(page, 11)).toContainText("+$1,550");
  await expect(milestoneButton(page, 11)).not.toContainText("so far");
  await milestoneButton(page, 11).click();
  await expectMilestone(page, "$1,550.00", "$1,250.00", "$300.00", "$2,545.00");
  await expect(page.locator(".sale-milestone-summary")).not.toContainText("partial estimate");
});
