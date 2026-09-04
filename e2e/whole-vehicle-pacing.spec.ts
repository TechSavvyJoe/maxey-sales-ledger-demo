import { expect, test, type Page } from "@playwright/test";

async function setGoal(page: Page, goal: number) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Profile & goals/ }).click();
  await page.getByLabel(/delivery goal/).fill(String(goal));
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
}

test("dashboard and reports round fractional vehicle pace up without fractional required deliveries", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-03T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  // This fictional fixture is confined to Playwright's fresh browser context.
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db, createDefaultSettings } = await import(modulePath);
    if (await db.sales.count()) throw new Error("Pacing fixture needs an isolated empty workspace.");
    const settings = createDefaultSettings(new Date("2026-09-03T16:00:00.000Z"));
    await db.settings.put({ ...settings, salespersonName: "Pacing Test", monthlyGoal: 10 });
    await db.sales.bulkAdd([1, 2].map((day) => ({
      id: `whole-pace-${day}`, profileId: "primary", saleDate: `2026-09-0${day}`,
      customerLastName: "Example", stockNumber: `PACE-${day}`, vehicleDescription: "Ford Escape",
      status: "delivered", unitCreditBasis: 1_000, frontGrossCents: 100_000, fiGrossCents: 20_000,
      serviceContractSold: false, tireWheelSold: false, gapSold: false, paymentMethod: "cash",
      notes: "", createdAt: "2026-09-03T16:00:00.000Z", updatedAt: "2026-09-03T16:00:00.000Z",
      revision: 1, source: "manual",
    })));
  });
  await page.reload();
  const planning = page.getByRole("region", { name: "Monthly goal and commission outlook" });
  await expect(planning).toContainText("Pacing 18");
  await expect(planning).toContainText("Need 1 per remaining workday");
  await setGoal(page, 40);
  await expect(planning).toContainText("Need 2 per remaining workday");
  await expect(planning).toContainText("Pacing 18");

  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  const monthPace = page.getByRole("region", { name: "Monthly workday pace" });
  await expect(monthPace).toContainText("Pacing 18");
  await expect(monthPace).toContainText("2 needed per remaining workday");
  await page.getByRole("tab", { name: "Weekly performance report", exact: true }).click();
  const checkpoint = page.getByRole("region", { name: "Goal checkpoint" });
  await expect(checkpoint.locator("dl > div").filter({ hasText: "Expected cumulative by now" }).locator("dd")).toHaveText("5");
  await expect(checkpoint.locator("dl > div").filter({ hasText: "Pace vs expected to date" }).locator("dd")).toHaveText("3 behind");
});
