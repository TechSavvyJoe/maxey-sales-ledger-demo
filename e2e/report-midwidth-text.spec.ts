import { expect, test, type Locator } from "@playwright/test";

async function expectContainedText(scope: Locator) {
  const measurements = await scope.locator(".report-sale-identity__primary, .report-sale-identity__vehicle, .report-open-sale, .report-sale-card > header > .status-badge").filter({ visible: true }).evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { text: element.textContent, content: element.scrollWidth, width: element.clientWidth, textOverflow: style.textOverflow };
  }));
  for (const item of measurements) {
    expect(item.content, `${item.text} fits its report cell`).toBeLessThanOrEqual(item.width + 1);
    expect(item.textOverflow).not.toBe("ellipsis");
  }
}

test("Reports keeps longer sale identities and controls readable at intermediate widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test owns its viewport matrix.");
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date("2026-09-09T16:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    if (await db.sales.count()) throw new Error("This test requires an empty isolated ledger.");
    const base = {
      profileId: "primary", customerLastName: "Example Montgomery-Worthington",
      vehicleDescription: "2021 Ford Explorer Platinum 4WD with Premium Technology Package",
      status: "delivered", unitCreditBasis: 1000, frontGrossCents: 230_000, fiGrossCents: 120_000,
      notes: "Synthetic interface test", createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z", revision: 1,
      serviceContractSold: true, tireWheelSold: true, gapSold: true,
    };
    await db.sales.bulkPut([
      { ...base, id: "report-long-finance", saleDate: "2026-09-01", stockNumber: "TEST-REPORT-2026-09-01-LONG", paymentMethod: "dealer_financed" },
      { ...base, id: "report-long-cash", saleDate: "2026-09-02", stockNumber: "TEST-REPORT-2026-09-02-LONG", paymentMethod: "cash" },
      { ...base, id: "report-long-outside", saleDate: "2026-09-03", stockNumber: "TEST-REPORT-2026-09-03-LONG", paymentMethod: "outside_financing" },
    ]);
  });
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "Reports", exact: true }).filter({ visible: true }).click();
  const findings: unknown[] = [];
  for (const width of [440, 520, 640, 641, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("tab", { name: "Monthly report", exact: true }).click();
    const subjects = page.getByRole("tablist", { name: "Monthly report subject" });
    await subjects.getByRole("tab", { name: "Sales", exact: true }).click();
    await expectContainedText(page.locator(".report-sales-detail"));
    await page.locator(".report-sales-detail").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`report-sales-long-${width}.png`), fullPage: false });

    await subjects.getByRole("tab", { name: "F&I", exact: true }).click();
    const center = page.locator(".fi-report-center").filter({ visible: true }).first();
    await center.getByRole("tab", { name: "Deals", exact: true }).click();
    const evidence = center.locator(".fi-center-evidence");
    await evidence.getByRole("combobox", { name: "Show", exact: true }).selectOption("serviceContract");
    await expect(evidence.locator(".fi-center-filter-summary")).toContainText("Service contract / warranty sold");
    await expectContainedText(evidence);
    for (const unitLabel of await evidence.locator(".fi-evidence-card > header > span").filter({ visible: true }).all()) {
      await expect(unitLabel).toHaveText("1 unit");
    }
    const controls = await evidence.locator(".fi-center-evidence-controls").evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth,
      inputs: [...element.querySelectorAll("input, select")].map((input) => ({height: input.getBoundingClientRect().height, width: input.getBoundingClientRect().width})),
    }));
    expect(controls.content, `${width}px evidence controls fit`).toBeLessThanOrEqual(controls.width + 1);
    for (const input of controls.inputs) expect(input.height).toBeGreaterThanOrEqual(44);
    await evidence.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`report-evidence-long-${width}.png`), fullPage: false });
    findings.push({ width, controls });

    await page.getByRole("tab", { name: "Weekly performance report", exact: true }).click();
    await expect(page.locator(".week-selector")).toBeVisible();
    await page.getByRole("tab", { name: "Full-year report", exact: true }).click();
    const yearTabs = page.getByRole("tablist", { name: "Year report subject" });
    for (const tab of await yearTabs.getByRole("tab").all()) {
      const box = await tab.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth, height: element.getBoundingClientRect().height }));
      expect(box.content).toBeLessThanOrEqual(box.width + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const pageWidth = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.width + 1);
  }
  await testInfo.attach("report-intermediate-layout", { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
});

test("Shared Settings categories stay contained at intermediate widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test owns its viewport matrix.");
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date("2026-09-09T16:00:00Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    if (await db.sales.count()) throw new Error("This test requires an empty isolated ledger.");
    const settings = await db.settings.toCollection().first();
    if (!settings) throw new Error("The isolated test needs initialized settings.");
    await db.settings.put({ ...settings, salespersonName: "Example Montgomery-Worthington", payPlan: { ...settings.payPlan, version: "Used Vehicle Sales Commission Plan — September 2026" } });
  });
  await page.reload();
  await page.locator("nav").getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).click();
  const categories = page.getByRole("navigation", { name: "Settings categories", exact: true });
  for (const width of [440, 520, 640, 641, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    // These four categories are shared by local and Firebase builds. Cloud saving
    // is intentionally tested elsewhere against the compiled Firebase workspace.
    for (const [category, id] of [["Profile & goals", "profile"], ["Days off", "schedule"], ["Pay plan", "pay-plan"], ["Volume bonuses", "bonuses"]]) {
      await categories.getByRole("button", { name: category, exact: true }).click();
      const panel = page.locator(`#settings-panel-${id}`);
      await expect(panel).toBeVisible();
      await expect(page.locator(".settings-category-panel:visible")).toHaveCount(1);
      const metrics = await panel.evaluate((element) => ({
        width: element.clientWidth, content: element.scrollWidth,
        controls: [...element.querySelectorAll("input, select")].filter((control) => control.getClientRects().length).map((control) => ({
          label: control.getAttribute("aria-label") ?? control.id,
          height: control.getBoundingClientRect().height,
          right: control.getBoundingClientRect().right,
          parentRight: element.getBoundingClientRect().right,
        })),
      }));
      expect(metrics.content, `${width}px ${category} fits`).toBeLessThanOrEqual(metrics.width + 1);
      for (const control of metrics.controls) {
        expect(control.height, `${control.label} has a usable target`).toBeGreaterThanOrEqual(44);
        expect(control.right, `${control.label} stays within the settings panel`).toBeLessThanOrEqual(control.parentRight + 1);
      }
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`settings-${id}-${width}.png`), fullPage: false });
      if (id === "schedule") {
        const disclosure = panel.locator(".work-schedule-details");
        const closedHeight = await disclosure.evaluate((element) => element.getBoundingClientRect().height);
        await disclosure.locator("summary").click();
        const calendar = panel.getByRole("group", { name: "September 2026 personal days off" });
        await expect(calendar).toBeVisible();
        const calendarBox = await calendar.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
        expect(calendarBox.content).toBeLessThanOrEqual(calendarBox.width + 1);
        for (const day of await calendar.getByRole("button").all()) {
          const bounds = await day.boundingBox();
          expect(bounds?.width).toBeGreaterThanOrEqual(44);
          expect(bounds?.height).toBeGreaterThanOrEqual(44);
        }
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`settings-schedule-expanded-${width}.png`), fullPage: false });
        await disclosure.locator("summary").click();
        await expect(calendar).toBeHidden();
        const recollapsedHeight = await disclosure.evaluate((element) => element.getBoundingClientRect().height);
        expect(Math.abs(recollapsedHeight - closedHeight), "Collapsed calendar leaves no expanded space").toBeLessThanOrEqual(1);
      }
      const pageWidth = await page.evaluate(() => ({ width: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.width + 1);
    }
  }
});
