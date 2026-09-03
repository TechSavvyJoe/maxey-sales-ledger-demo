import { expect, test, type Page, type TestInfo } from "@playwright/test";

const FIXED_NOW = new Date("2026-08-31T16:00:00.000Z");

function desktopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name !== "desktop-chrome", "Keyboard selector behavior is covered once on desktop.");
}

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
}

async function pressAndExpectDefaultPrevented(page: Page, key: "Home" | "End") {
  await page.evaluate((pressedKey) => {
    document.documentElement.dataset.selectorKeyDefaultPrevented = "";
    document.addEventListener("keydown", (event) => {
      if (event.key === pressedKey) {
        document.documentElement.dataset.selectorKeyDefaultPrevented = String(event.defaultPrevented);
      }
    }, { once: true });
  }, key);
  await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(
    () => document.documentElement.dataset.selectorKeyDefaultPrevented,
  )).toBe("true");
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
});

test("report keyboard selectors retain focus through primary, subject, and F&I navigation", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();

  const monthlyReport = page.getByRole("tab", { name: "Monthly report", exact: true });
  const weeklyReport = page.getByRole("tab", { name: "Weekly performance report", exact: true });
  const yearReport = page.getByRole("tab", { name: "Full-year report", exact: true });
  const payrollReport = page.getByRole("tab", { name: "Paid versus estimate", exact: true });

  await monthlyReport.focus();
  await page.keyboard.press("ArrowRight");
  await expect(weeklyReport).toBeFocused();
  await expect(weeklyReport).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(yearReport).toBeFocused();
  await expect(yearReport).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(monthlyReport).toBeFocused();
  await expect(monthlyReport).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(payrollReport).toBeFocused();
  await expect(payrollReport).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(monthlyReport).toBeFocused();

  const monthlySubjects = page.getByRole("tablist", { name: "Monthly report subject", exact: true });
  const subjectOverview = monthlySubjects.getByRole("tab", { name: "Overview", exact: true });
  const subjectCommission = monthlySubjects.getByRole("tab", { name: "Commission", exact: true });
  await subjectOverview.focus();
  await page.keyboard.press("End");
  await expect(subjectCommission).toBeFocused();
  await expect(subjectCommission).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(subjectOverview).toBeFocused();
  await expect(subjectOverview).toHaveAttribute("aria-selected", "true");
  await pressAndExpectDefaultPrevented(page, "Home");
  await expect(subjectOverview).toBeFocused();

  await monthlySubjects.getByRole("tab", { name: "F&I", exact: true }).click();
  const fiSections = page.getByRole("tablist", { name: "F&I report sections", exact: true });
  const fiOverview = fiSections.getByRole("tab", { name: "Overview", exact: true });
  const fiDeals = fiSections.getByRole("tab", { name: "Deals", exact: true });
  await fiOverview.focus();
  await page.keyboard.press("End");
  await expect(fiDeals).toBeFocused();
  await expect(fiDeals).toHaveAttribute("aria-selected", "true");
  await pressAndExpectDefaultPrevented(page, "End");
  await expect(fiDeals).toBeFocused();
  await page.keyboard.press("Home");
  await expect(fiOverview).toBeFocused();
  await expect(fiOverview).toHaveAttribute("aria-selected", "true");
});

test("month selector keeps focus when stepping and does not discard a draft when reselecting the current month", async ({ page }, testInfo) => {
  desktopOnly(testInfo);
  await openWorkspace(page);

  const monthTrigger = page.getByRole("button", { name: /Choose reporting month/ });
  await monthTrigger.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(monthTrigger).toBeFocused();
  await expect(monthTrigger).toHaveAccessibleName(/July 2026/);
  await page.keyboard.press("ArrowRight");
  await expect(monthTrigger).toBeFocused();
  await expect(monthTrigger).toHaveAccessibleName(/August 2026/);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const name = page.getByLabel("Salesperson name *");
  await name.fill("Draft stays here");
  await expect(page.getByText(/Unsaved settings changes/)).toBeVisible();

  let unexpectedDialog: string | null = null;
  page.on("dialog", async (dialog) => {
    unexpectedDialog = dialog.message();
    await dialog.dismiss();
  });
  await monthTrigger.click();
  await page.getByRole("button", { name: "Aug", exact: true }).click();

  await expect.poll(() => unexpectedDialog).toBeNull();
  await expect(name).toHaveValue("Draft stays here");
  await expect(page.getByText(/Unsaved settings changes/)).toBeVisible();
});
