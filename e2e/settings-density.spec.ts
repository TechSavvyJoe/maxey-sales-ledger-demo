import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "large display", width: 2560, height: 1_440, maxPageHeight: 1_440 },
  { name: "wide desktop", width: 1920, height: 1_080, maxPageHeight: 1_200 },
  { name: "large laptop", width: 1440, height: 900, maxPageHeight: 1_200 },
  { name: "small monitor", width: 1280, height: 800, maxPageHeight: 1_200 },
  { name: "legacy boundary above", width: 1181, height: 800, maxPageHeight: 1_200 },
  { name: "legacy boundary", width: 1180, height: 800, maxPageHeight: 1_200 },
  { name: "compact laptop", width: 1024, height: 768, maxPageHeight: 1_350 },
  { name: "compact landscape", width: 844, height: 390, maxPageHeight: 1_350 },
  { name: "portrait tablet", width: 768, height: 900, maxPageHeight: 1_350 },
  { name: "tablet boundary", width: 720, height: 844, maxPageHeight: 1_500 },
  { name: "phone", width: 390, height: 844, maxPageHeight: 1_650 },
  { name: "small phone", width: 320, height: 568, maxPageHeight: 1_800 },
] as const;

const settingsCategories = [
  { name: /^Profile & goals/, panel: "#settings-panel-profile" },
  { name: /^Days off/, panel: "#settings-panel-schedule" },
  { name: /^Pay plan/, panel: "#settings-panel-pay-plan" },
  { name: /^Volume bonuses/, panel: "#settings-panel-bonuses" },
  { name: /^Data & backups/, panel: "#settings-panel-data" },
] as const;

async function openSettings(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

async function ensureDemoData(page: Page) {
  await openSettings(page);
  if (!(await page.locator(".workspace-notice--demo").isVisible())) {
    await page.getByRole("button", { name: "Data & backups", exact: true }).click();
    const loadButton = page.getByRole("button", { name: /^(?:Load sample history|Load full-year demo)$/ });
    await expect(loadButton).toBeVisible();
    await loadButton.click();
    await expect(page.locator(".workspace-notice--demo")).toBeVisible();
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("collapsed Settings fits compactly without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");

  const measurements: Array<Record<string, number | string>> = [];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openSettings(page);

    await expect(page.locator(".settings-category-panel:visible")).toHaveCount(1);
    await expect(page.locator("#settings-panel-profile")).toBeVisible();

    const metrics = await page.evaluate(() => ({
      pageHeight: document.documentElement.scrollHeight,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    measurements.push({
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
      pageHeight: metrics.pageHeight,
    });

    expect(metrics.pageHeight, `${viewport.name} Settings page height`).toBeLessThanOrEqual(
      viewport.maxPageHeight,
    );
    expect(metrics.pageWidth, `${viewport.name} horizontal overflow`).toBe(metrics.viewportWidth);

    const categoryHeights = await page.locator(".settings-category-button").evaluateAll(
      (buttons) => buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(categoryHeights.every((height) => height >= 44)).toBe(true);
  }

  await testInfo.attach("settings-density-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});

test("Settings categories and compact disclosures remain keyboard discoverable and axe-clean", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies a phone viewport.");
  await page.setViewportSize({ width: 320, height: 568 });
  await openSettings(page);

  for (const category of settingsCategories) {
    const button = page.getByRole("button", { name: category.name });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(page.locator(category.panel)).toBeVisible();
  }

  const profileCategory = page.getByRole("button", { name: "Profile & goals", exact: true });
  await profileCategory.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Days off", exact: true })).toBeFocused();
  await expect(page.locator("#settings-panel-schedule")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Data & backups", exact: true })).toBeFocused();
  await expect(page.locator("#settings-panel-data")).toBeVisible();

  await page.getByRole("button", { name: /^Days off/ }).click();
  const schedule = page.locator(".work-schedule-details");
  await schedule.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(schedule).toHaveAttribute("open", "");
  const dayTargets = await page.locator(".work-schedule-day").evaluateAll(
    (days) => days.map((day) => day.getBoundingClientRect().height),
  );
  expect(dayTargets.every((height) => height >= 44)).toBe(true);

  await page.getByRole("button", { name: /^Data & backups/ }).click();
  for (const selector of [".privacy-settings", ".activity-settings"]) {
    const details = page.locator(selector);
    const summary = details.locator(":scope > summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).not.toHaveAttribute("open", "");
  }

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("short landscape shows the first profile control above the fold with demo data", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies a compact landscape viewport.");
  await page.setViewportSize({ width: 844, height: 390 });
  await ensureDemoData(page);
  await page.getByRole("button", { name: "Profile & goals", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));

  const geometry = await page.evaluate(() => {
    const firstInput = document.querySelector<HTMLInputElement>("#salesperson-name")!.getBoundingClientRect();
    const noticeButton = document.querySelector<HTMLElement>(".workspace-notice--demo button")!.getBoundingClientRect();
    const categoryButtons = [...document.querySelectorAll<HTMLElement>(".settings-category-button")]
      .map((button) => button.getBoundingClientRect().height);
    return {
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      firstInput: { top: firstInput.top, bottom: firstInput.bottom, height: firstInput.height },
      noticeButtonHeight: noticeButton.height,
      categoryButtons,
      idleStatusVisible: document.querySelector<HTMLElement>(".settings-dirty-state")!.offsetParent !== null,
    };
  });

  expect(geometry.scrollY).toBe(0);
  expect(geometry.firstInput.top).toBeGreaterThanOrEqual(0);
  expect(geometry.firstInput.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.firstInput.height).toBeGreaterThanOrEqual(44);
  expect(geometry.noticeButtonHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.categoryButtons.every((height) => height >= 44)).toBe(true);
  expect(geometry.idleStatusVisible).toBe(false);
});

test("large-screen Days off uses an intentional centered calendar workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own desktop viewport matrix.");

  for (const viewport of [
    { name: "large laptop", width: 1440, height: 900 },
    { name: "wide desktop", width: 1920, height: 1080 },
    { name: "large display", width: 2560, height: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    await openSettings(page);
    await page.getByRole("button", { name: "Days off", exact: true }).click();
    await page.locator(".work-schedule-details > summary").click();

    const geometry = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".settings-category-content")!.getBoundingClientRect();
      const schedule = document.querySelector<HTMLElement>(".schedule-settings")!.getBoundingClientRect();
      const details = document.querySelector<HTMLElement>(".work-schedule-details")!.getBoundingClientRect();
      const calendar = document.querySelector<HTMLElement>(".work-schedule-grid")!.getBoundingClientRect();
      return {
        content: { left: content.left, right: content.right, width: content.width },
        schedule: { left: schedule.left, right: schedule.right, width: schedule.width },
        details: { width: details.width },
        calendar: { width: calendar.width },
      };
    });

    expect(geometry.schedule.width, `${viewport.name} schedule reading width`).toBeLessThanOrEqual(860);
    expect(geometry.schedule.width, `${viewport.name} schedule remains useful`).toBeGreaterThanOrEqual(760);
    expect(
      Math.abs(
        (geometry.schedule.left - geometry.content.left)
        - (geometry.content.right - geometry.schedule.right),
      ),
      `${viewport.name} schedule is centered`,
    ).toBeLessThan(1);
    expect(
      geometry.calendar.width / geometry.details.width,
      `${viewport.name} calendar uses the disclosure interior`,
    ).toBeGreaterThan(0.9);
  }
});

test("ultrawide Settings keeps navigation, surfaces, and profile controls in one bounded workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own ultrawide viewport matrix.");

  for (const viewport of [
    { name: "wide desktop", width: 1920, height: 1080 },
    { name: "large display", width: 2560, height: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    await openSettings(page);

    const geometry = await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>(".settings-page")!.getBoundingClientRect();
      const notice = document.querySelector<HTMLElement>(".workspace-notice")?.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>(".settings-category-nav")!.getBoundingClientRect();
      const content = document.querySelector<HTMLElement>(".settings-category-content")!.getBoundingClientRect();
      const inputs = ["#salesperson-name", "#store-name"]
        .map((selector) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect().width);
      return {
        workspace: { left: workspace.left, right: workspace.right, width: workspace.width },
        notice: notice ? { left: notice.left, right: notice.right, width: notice.width } : null,
        nav: { left: nav.left, right: nav.right, width: nav.width },
        content: { left: content.left, right: content.right, width: content.width },
        inputs,
      };
    });

    expect(geometry.workspace.width, `${viewport.name} Settings reading width`).toBeLessThanOrEqual(1280);
    expect(geometry.workspace.width, `${viewport.name} Settings workspace remains substantial`).toBeGreaterThanOrEqual(1180);
    expect(geometry.nav, `${viewport.name} category strip follows the workspace`).toEqual(geometry.workspace);
    expect(geometry.content, `${viewport.name} content follows the workspace`).toEqual(geometry.workspace);
    if (geometry.notice) {
      expect(geometry.notice, `${viewport.name} demo notice follows the workspace`).toEqual(geometry.workspace);
    }
    expect(geometry.inputs.every((width) => width <= 650), `${viewport.name} profile input line lengths`).toBe(true);
  }
});

test("all five Settings destinations remain readable at 320px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies a small-phone viewport.");
  await page.setViewportSize({ width: 320, height: 700 });
  await openSettings(page);

  const labels = await page.locator(".settings-category-button__label--compact").evaluateAll((elements) => (
    elements.map((element) => {
      const label = element as HTMLElement;
      const button = label.closest("button")!.getBoundingClientRect();
      const rect = label.getBoundingClientRect();
      return {
        text: label.textContent?.trim(),
        fontSize: Number.parseFloat(getComputedStyle(label).fontSize),
        fitsWidth: label.scrollWidth <= label.clientWidth + 1,
        staysInsideButton: rect.left >= button.left - 0.5
          && rect.right <= button.right + 0.5
          && rect.top >= button.top - 0.5
          && rect.bottom <= button.bottom + 0.5,
      };
    })
  ));

  expect(labels.map(({ text }) => text)).toEqual(["Profile", "Days off", "Pay plan", "Bonuses", "Data"]);
  expect(labels.every(({ fontSize }) => fontSize >= 11)).toBe(true);
  expect(labels.every(({ fitsWidth }) => fitsWidth)).toBe(true);
  expect(labels.every(({ staysInsideButton }) => staysInsideButton)).toBe(true);
  await expect(page.locator(".settings-category-button")).toHaveCount(5);
});

test("Settings uses one stable category strip and expanded sections never leave layout holes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");
  test.slow();

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openSettings(page);

    const navigation = await page.evaluate(() => {
      const workspace = document.querySelector<HTMLElement>(".settings-page")!.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>(".settings-category-nav")!.getBoundingClientRect();
      const content = document.querySelector<HTMLElement>(".settings-category-content")!.getBoundingClientRect();
      const buttons = [...document.querySelectorAll<HTMLElement>(".settings-category-button")]
        .map((button) => button.getBoundingClientRect());
      return {
        workspaceWidth: workspace.width,
        nav: { left: nav.left, right: nav.right, top: nav.top, bottom: nav.bottom, height: nav.height },
        content: { left: content.left, top: content.top },
        buttons: buttons.map((rect) => ({ left: rect.left, top: rect.top, height: rect.height })),
      };
    });

    expect(navigation.nav.bottom, `${viewport.name} category strip precedes content`).toBeLessThanOrEqual(
      navigation.content.top + 1,
    );
    expect(Math.max(...navigation.buttons.map(({ top }) => top)) - Math.min(...navigation.buttons.map(({ top }) => top)),
      `${viewport.name} category strip never wraps`).toBeLessThan(1);
    expect(navigation.nav.height, `${viewport.name} category strip remains compact`).toBeLessThanOrEqual(72);
    expect(navigation.buttons.every(({ height }) => height >= 44), `${viewport.name} category targets`).toBe(true);

    await page.getByRole("button", { name: "Data & backups", exact: true }).click();
    const privacy = page.locator(".privacy-settings");
    const activity = page.locator(".activity-settings");

    for (const state of ["collapsed", "privacy", "both", "activity"] as const) {
      if (state === "privacy") await privacy.locator(":scope > summary").click();
      if (state === "both") await activity.locator(":scope > summary").click();
      if (state === "activity") await privacy.locator(":scope > summary").click();

      const stack = await page.locator("#settings-panel-data > *").evaluateAll((children) => (
        children.map((child) => {
          const rect = child.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width };
        })
      ));
      expect(stack.length).toBe(4);
      expect(stack.every((rect) => Math.abs(rect.left - stack[0].left) < 1),
        `${viewport.name} ${state} sections share one left edge`).toBe(true);
      expect(stack.every((rect) => Math.abs(rect.width - stack[0].width) < 1),
        `${viewport.name} ${state} sections share one width`).toBe(true);
      for (let index = 1; index < stack.length; index += 1) {
        const gap = stack[index].top - stack[index - 1].bottom;
        expect(gap, `${viewport.name} ${state} stack gap ${index}`).toBeGreaterThanOrEqual(8);
        expect(gap, `${viewport.name} ${state} stack gap ${index}`).toBeLessThanOrEqual(16);
      }
    }

    await page.getByRole("button", { name: "Days off", exact: true }).click();
    const schedule = page.locator(".work-schedule-details");
    const beforeSchedule = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".settings-category-nav")!.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>("#settings-panel-schedule")!.getBoundingClientRect();
      const details = document.querySelector<HTMLElement>(".work-schedule-details")!.getBoundingClientRect();
      return {
        nav: { left: nav.left, width: nav.width, height: nav.height },
        panel: { left: panel.left, width: panel.width },
        details: { left: details.left, width: details.width },
      };
    });
    await schedule.locator(":scope > summary").click();
    await expect(schedule).toHaveAttribute("open", "");
    const afterSchedule = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".settings-category-nav")!.getBoundingClientRect();
      const panel = document.querySelector<HTMLElement>("#settings-panel-schedule")!.getBoundingClientRect();
      const details = document.querySelector<HTMLElement>(".work-schedule-details")!.getBoundingClientRect();
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        nav: { left: nav.left, width: nav.width, height: nav.height },
        panel: { left: panel.left, width: panel.width },
        details: { left: details.left, width: details.width },
      };
    });
    expect(afterSchedule.pageWidth, `${viewport.name} expanded schedule overflow`).toBe(afterSchedule.viewportWidth);
    expect(afterSchedule.nav, `${viewport.name} expanded schedule keeps category strip fixed`).toEqual(beforeSchedule.nav);
    expect(afterSchedule.panel, `${viewport.name} expanded schedule keeps panel bounds`).toEqual(beforeSchedule.panel);
    expect(afterSchedule.details, `${viewport.name} expanded schedule keeps calendar bounds`).toEqual(beforeSchedule.details);
    const scheduleTargets = await page.locator(".work-schedule-day").evaluateAll(
      (days) => days.map((day) => day.getBoundingClientRect().height),
    );
    expect(scheduleTargets.every((height) => height >= 44), `${viewport.name} schedule touch targets`).toBe(true);
  }
});

test("switching Settings categories keeps one stable, contained flow at every target width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own viewport matrix.");
  test.slow();

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openSettings(page);

    const baseline = await page.locator(".settings-layout > *").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      }),
    );

    for (const category of settingsCategories) {
      await page.getByRole("button", { name: category.name }).click();
      const activePanel = page.locator(category.panel);
      await expect(activePanel).toBeVisible();

      const layout = await page.evaluate(() => {
        const sections = [...document.querySelectorAll<HTMLElement>(".settings-layout > *")];
        const sectionRects = sections.map((section) => section.getBoundingClientRect());
        const visiblePanel = [...document.querySelectorAll<HTMLElement>(".settings-category-panel")]
          .find((panel) => !panel.hidden);
        const panelRect = visiblePanel?.getBoundingClientRect();
        const descendants = visiblePanel
          ? [...visiblePanel.querySelectorAll<HTMLElement>(".settings-section > *")]
              .map((element) => element.getBoundingClientRect())
          : [];

        return {
          pageWidth: document.documentElement.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          sections: sectionRects.map((rect) => ({
            left: rect.left,
            right: rect.right,
            width: rect.width,
            top: rect.top,
            bottom: rect.bottom,
          })),
          panelBounds: panelRect ? { left: panelRect.left, right: panelRect.right } : null,
          descendants: descendants.map((rect) => ({ left: rect.left, right: rect.right })),
        };
      });

      expect(layout.pageWidth, `${viewport.name} ${category.panel} horizontal overflow`).toBe(
        layout.viewportWidth,
      );
      expect(layout.sections.every((rect, index) => (
        Math.abs(rect.left - baseline[index].left) < 1
        && Math.abs(rect.width - baseline[index].width) < 1
      )), `${viewport.name} ${category.panel} changed column position`).toBe(true);
      expect(layout.sections.every((rect, index, sections) => {
        if (index === sections.length - 1) return true;
        const next = sections[index + 1];
        return rect.right <= next.left + 0.5 || rect.bottom <= next.top + 0.5;
      }), `${viewport.name} ${category.panel} overlapped the following section`).toBe(true);
      expect(layout.panelBounds).not.toBeNull();
      expect(layout.descendants.every((rect) => (
        rect.left >= (layout.panelBounds?.left ?? 0) - 0.5
        && rect.right <= (layout.panelBounds?.right ?? 0) + 0.5
      )), `${viewport.name} ${category.panel} content escaped its panel`).toBe(true);
    }
  }
});

test("validation returns to the pay-plan category and focuses its field", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "Covered once with a fixed viewport.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSettings(page);
  await page.getByLabel("Salesperson name *").fill("Test Salesperson");

  await page.getByRole("button", { name: /^Pay plan/ }).click();
  const payPlan = page.locator(".pay-plan-settings");
  const baseFrontRate = page.getByLabel("Base front rate");
  await baseFrontRate.fill("101");
  await page.getByRole("button", { name: /^Profile & goals/ }).click();
  await expect(payPlan).toBeHidden();

  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(payPlan).toBeVisible();
  await expect(baseFrontRate).toBeFocused();
  await expect(page.locator("#settings-base-front-rate-error")).toHaveText(
    "Base front rate must be between 0% and 100%.",
  );
});
