import { expect, test, type Page, type TestInfo } from "@playwright/test";

const FIXED_NOW = new Date("2026-09-01T16:00:00.000Z");

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop-chrome", "Time-state grammar is covered once.");
}

async function openClosedAugust(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.getByRole("button", { name: "Show August 2026", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Choose reporting month. Currently August 2026",
      exact: true,
    }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test("closed August dashboard shows final results instead of an active projection", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openClosedAugust(page);

  const monthlyPace = page.getByRole("region", { name: "Monthly goal and commission outlook" });
  await expect(monthlyPace).toContainText("Final recorded estimate");
  await expect(monthlyPace).toContainText("Month complete");
  await expect(monthlyPace).toContainText("Month deliveries");
  await expect(monthlyPace).toContainText("Month status");
  await expect(monthlyPace).toContainText("Closed");
  await expect(monthlyPace).not.toContainText("Commission pace and projection");
  await expect(monthlyPace).not.toContainText("Projection active");
  await expect(monthlyPace).not.toContainText("Projected month end");
  await expect(monthlyPace).not.toContainText("Projected increase");
});

test("closed August Month report labels its commission result as final", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openClosedAugust(page);
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();

  await expect(page.getByRole("tab", { name: "Monthly report", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const commissionResult = page.getByRole("region", { name: "Closed-month commission result" });
  await expect(commissionResult).toContainText("Month deliveries");
  await expect(commissionResult).toContainText("Month status");
  await expect(commissionResult).toContainText("Closed");
  await expect(commissionResult).toContainText("This closed month shows final recorded results.");
  await expect(commissionResult).not.toContainText("Projected month end");
  await expect(commissionResult).not.toContainText("Projection basis");
  await expect(commissionResult).not.toContainText("Projection is a planning scenario");
});

test("2026 Year report marks October through December as upcoming", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openClosedAugust(page);
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tab", { name: "Full-year report", exact: true }).click();

  const yearPanel = page.getByRole("tabpanel", { name: "Full-year report", exact: true });
  await expect(yearPanel).toContainText("later months are marked Upcoming");
  await yearPanel.getByRole("tablist", { name: "Year report subject" })
    .getByRole("tab", { name: "Monthly results", exact: true })
    .click();
  for (const month of ["Oct", "Nov", "Dec"]) {
    const result = yearPanel.locator(".year-table tbody tr, .year-report-card")
      .filter({ hasText: `${month} 2026`, visible: true });
    await expect(result, `${month} should be presented as a future month`).toBeVisible();
    await expect(result).toContainText("Upcoming");
    await expect(result).not.toContainText("No attention items");
    await expect(result).not.toContainText("$0");
    await expect(result.getByLabel("No attention items")).toHaveCount(0);
  }
});
