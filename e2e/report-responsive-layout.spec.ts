import { expect, test } from "@playwright/test";

async function expectCompleteNavigationLabels(locator: import("@playwright/test").Locator, labels: string[]) {
  const buttons = locator.getByRole("tab");
  await expect(buttons).toHaveCount(labels.length);
  for (const label of labels) {
    const button = buttons.filter({ hasText: label }).first();
    await expect(button).toHaveText(label);
    const geometry = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        parentLeft: element.parentElement!.getBoundingClientRect().left,
        parentRight: element.parentElement!.getBoundingClientRect().right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflow: style.overflow,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    expect(geometry.height, `${label} keeps a full-size touch target`).toBeGreaterThanOrEqual(44);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.parentLeft - 1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.parentRight + 1);
    expect(geometry.scrollWidth, `${label} is not clipped`).toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect(geometry.textOverflow).not.toBe("ellipsis");
    expect(geometry.whiteSpace).not.toBe("nowrap");
  }
}

async function expectRepresentationFollowsContainer(
  container: import("@playwright/test").Locator,
  table: import("@playwright/test").Locator,
  cards: import("@playwright/test").Locator,
  cardsAtOrBelow: number,
) {
  const available = await container.evaluate((element) => {
    const style = getComputedStyle(element);
    return element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
  });
  if (available <= cardsAtOrBelow) {
    await expect(table, `table is replaced at ${available}px of actual report space`).toBeHidden();
    await expect(cards, `cards are used at ${available}px of actual report space`).toBeVisible();
    const layout = await cards.evaluate((element) => ({ available: element.clientWidth, content: element.scrollWidth }));
    expect(layout.content).toBeLessThanOrEqual(layout.available + 1);
  } else {
    await expect(table, `table remains available at ${available}px of actual report space`).toBeVisible();
    await expect(cards, `duplicate cards stay hidden at ${available}px of actual report space`).toBeHidden();
    const layout = await table.evaluate((element) => ({ available: element.clientWidth, content: element.scrollWidth }));
    expect(layout.content).toBeLessThanOrEqual(layout.available + 1);
  }
}

test("report destinations remain fully readable at compact and 200%-zoom-equivalent widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test covers its own viewport matrix.");
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();

  for (const width of [320, 360, 390, 410, 440, 460, 480, 481, 520, 640]) {
    await page.setViewportSize({ width, height: 900 });
    const subjectTabs = page.getByRole("tablist", { name: "Monthly report subject" });
    await expectCompleteNavigationLabels(subjectTabs, ["Overview", "Sales", "F&I", "Commission"]);
    const subjectGeometry = await subjectTabs.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      controls: [...element.querySelectorAll("button")].map((button) => ({
        top: button.getBoundingClientRect().top,
        width: button.getBoundingClientRect().width,
      })),
    }));
    expect(subjectGeometry.height, `${width}px uses a compact, single-row subject switcher`).toBeLessThanOrEqual(54);
    expect(new Set(subjectGeometry.controls.map((button) => Math.round(button.top))).size).toBe(1);
    for (const control of subjectGeometry.controls) expect(control.width).toBeGreaterThanOrEqual(44);
    await subjectTabs.getByRole("tab", { name: "F&I", exact: true }).click();
    const fiTabs = page.locator(".fi-report-center").first().getByRole("tablist", { name: "F&I report sections" });
    await expectCompleteNavigationLabels(fiTabs, ["Overview", "Products", "Financing", "Combinations", "Deals"]);
    expect(await fiTabs.evaluate((element) => element.getBoundingClientRect().height),
      `${width}px fits all five F&I sections into two rows`).toBeLessThanOrEqual(102);
    const widthState = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(widthState.document, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(widthState.viewport + 1);
    if ([320, 410, 460].includes(width)) await page.screenshot({ path: testInfo.outputPath(`compact-report-tabs-${width}.png`), fullPage: false });
  }
});

test("sales, F&I evidence, and year views choose tables from their actual report width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test covers its own viewport matrix.");
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await page.getByRole("button", { name: /^(?:Load sample history|Load full-year demo)$/ }).click();
  await expect(page.getByText(/(?:Sample history|Full-year demo) loaded/)).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();

  for (const width of [800, 1181, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });

    await page.getByRole("tab", { name: "Monthly report", exact: true }).click();
    const monthSubjects = page.getByRole("tablist", { name: "Monthly report subject" });
    await monthSubjects.getByRole("tab", { name: "Sales", exact: true }).click();
    const salesDetail = page.locator(".report-sales-detail");
    await expectRepresentationFollowsContainer(
      salesDetail,
      salesDetail.locator(":scope > .report-table-wrap"),
      salesDetail.locator(":scope > .report-sales-cards"),
      899,
    );

    await monthSubjects.getByRole("tab", { name: "F&I", exact: true }).click();
    const fiCenter = page.locator(".fi-report-center").first();
    await fiCenter.getByRole("tab", { name: "Deals", exact: true }).click();
    const evidence = fiCenter.locator(".fi-center-evidence");
    await expectRepresentationFollowsContainer(
      evidence,
      evidence.locator(".fi-center-evidence-table"),
      evidence.locator(".fi-center-evidence-cards"),
      819,
    );

    await page.getByRole("tab", { name: "Full-year report", exact: true }).click();
    const yearReport = page.locator(".year-report");
    const yearSubjects = page.getByRole("tablist", { name: "Year report subject" });
    await yearSubjects.getByRole("tab", { name: "Monthly results", exact: true }).click();
    await expectRepresentationFollowsContainer(
      yearReport,
      yearReport.locator(".year-table-wrap"),
      yearReport.locator(".year-report-cards"),
      959,
    );

    await yearSubjects.getByRole("tab", { name: "F&I", exact: true }).click();
    const yearFi = yearReport.locator(".year-fi-trend");
    if (await yearFi.getAttribute("open") === null) await yearFi.locator(":scope > summary").click();
    await expectRepresentationFollowsContainer(
      yearReport,
      yearReport.locator(".year-fi-trend__table-wrap"),
      yearReport.locator(".year-fi-trend__cards"),
      1049,
    );

    const pageWidth = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, available: document.documentElement.clientWidth }));
    expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.available + 1);
  }
});

test("product and finance reports fit their canvas and month arrows stay usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "This test covers its own viewport matrix.");
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await page.getByRole("button", { name: /^(?:Load sample history|Load full-year demo)$/ }).click();
  await expect(page.getByText(/(?:Sample history|Full-year demo) loaded/)).toBeVisible();
  await page.getByRole("button", { name: "Reports", exact: true }).first().click();
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  const center = page.locator(".fi-report-center").first();

  for (const width of [768, 800, 900, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    const monthLabel = page.locator(".period-switcher__value--full");
    await expect(monthLabel).toBeVisible();
    const textWidth = await monthLabel.evaluate((element) => ({ available: element.clientWidth, content: element.scrollWidth }));
    expect(textWidth.content, `The complete month and year should fit at ${width}px`).toBeLessThanOrEqual(textWidth.available + 1);
  }

  for (const width of [1300, 1240, 1181, 800, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    const arrows = await page.locator(".period-switcher__arrow").evaluateAll((buttons) => buttons.map((button) => {
      const bounds = button.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
    for (const arrow of arrows) {
      expect(arrow.width).toBe(44);
      expect(arrow.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.locator(".period-switcher").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(296);

    await center.getByRole("tab", { name: "Products", exact: true }).click();
    const products = center.locator('[id$="-products-panel"]');
    await expect(products.locator(".fi-center-product-table thead th")).toHaveCount(4);
    await expect(products.getByText(/Yes \/ No|Answers recorded|Details complete/)).toHaveCount(0);
    await expect(products.locator(".fi-product-missing")).toHaveCount(0);
    if (await products.locator(".fi-center-product-table").isVisible()) {
      const tableWidth = await products.locator(".fi-center-table-wrap").evaluate((element) => ({ available: element.clientWidth, content: element.scrollWidth }));
      expect(tableWidth.content).toBeLessThanOrEqual(tableWidth.available + 1);
    } else {
      const cards = products.locator(".fi-center-phone-disclosures");
      await expect(cards).toBeVisible();
      await expect(cards.locator(".fi-center-product-card")).toHaveCount(3);
      await expect(cards.locator("details, dl")).toHaveCount(0);
      expect(await cards.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(300);
      for (const button of await cards.getByRole("button").all()) await expect(button).toBeVisible();
    }
    await products.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`products-${width}.png`), fullPage: false });

    await center.getByRole("tab", { name: "Financing", exact: true }).click();
    const financing = center.locator('[id$="-financing-panel"]');
    const financeCards = financing.locator(".fi-center-phone-disclosures");
    if (await financing.locator(".fi-center-desktop-table").isVisible()) {
      const financeTable = financing.locator(".fi-center-desktop-table");
      const tableWidth = await financeTable.evaluate((element) => ({ available: element.clientWidth, content: element.scrollWidth }));
      expect(tableWidth.content).toBeLessThanOrEqual(tableWidth.available + 1);
      await expect(financeCards).toBeHidden();
    } else {
      await expect(financeCards).toBeVisible();
      await expect(financeCards.locator("details")).toHaveCount(3);
      await expect(financeCards.locator("summary strong")).toHaveText(["Finance", "Cash", "Outside Finance"]);
      const firstFinance = financeCards.locator("details").first();
      if (await firstFinance.getAttribute("open") === null) await firstFinance.locator("summary").click();
      await expect(firstFinance.locator("dl")).toBeVisible();
      expect(await firstFinance.locator("dl dt").first().evaluate((element) => element.getBoundingClientRect().left - element.closest("dl")!.getBoundingClientRect().left)).toBeGreaterThanOrEqual(10);
    }
    await financing.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`financing-${width}.png`), fullPage: false });
    if (width === 390) {
      for (const label of ["Cash", "Outside Finance"]) {
        const group = financeCards.locator("details").filter({ has: page.locator("summary strong").getByText(label, { exact: true }) });
        if (await group.getAttribute("open") === null) await group.locator("summary").click();
        await group.getByRole("button", { name: `View deals for ${label}`, exact: true }).click();
        const evidence = center.locator(".fi-center-evidence");
        await expect(evidence.locator(".fi-center-filter-summary strong")).toHaveText(label);
        await expect(evidence.locator(".fi-evidence-card").first()).toBeVisible();
        await expect(evidence.locator(".fi-evidence-card > dl > div").filter({ hasText: "Payment method" }).first()).toContainText(label);
        await center.getByRole("tab", { name: "Financing", exact: true }).click();
        if (await group.getAttribute("open") !== null) await group.locator("summary").click();
      }
    }
    const productsByFinance = financing.locator(".fi-center-exact-mix");
    if (await productsByFinance.getAttribute("open") === null) await productsByFinance.locator("summary").click();
    const breakdownLayout = await productsByFinance.evaluate((element) => ({ available: element.clientWidth, content: element.scrollWidth }));
    expect(breakdownLayout.content).toBeLessThanOrEqual(breakdownLayout.available + 1);
    await productsByFinance.locator("summary").click();

    const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
  }

  const nextMonth = page.locator(".period-switcher__arrow").last();
  await nextMonth.focus();
  await nextMonth.press("ArrowLeft");
  await expect(nextMonth).toBeFocused();
  await nextMonth.press("ArrowRight");
  await expect(nextMonth).toBeFocused();

  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  await center.getByRole("tab", { name: "Overview", exact: true }).click();
  const comparison = center.locator(".fi-performance-comparison");
  const guide = center.locator(".fi-metric-guide");
  await expect(comparison).not.toHaveAttribute("open", "");
  await expect(guide).not.toHaveAttribute("open", "");
  await comparison.locator("summary").click();
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await comparison.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`comparison-${width}.png`), fullPage: false });
    const layout = await comparison.evaluate((element) => ({ available: element.clientWidth, content: element.scrollWidth }));
    expect(layout.content).toBeLessThanOrEqual(layout.available + 1);
  }
  await comparison.locator("summary").click();
  await guide.locator("summary").click();
  await guide.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("metric-guide-390.png"), fullPage: false });
  await center.getByRole("tab", { name: "Products", exact: true }).click();
  await page.emulateMedia({ media: "print" });
  await expect(center.locator('[id$="-products-panel"] .fi-center-product-table')).toBeVisible();
  await expect(center.locator('[id$="-products-panel"] .fi-center-phone-disclosures')).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // Simulate one older incomplete record in this test's fictional, isolated
  // browser database. A missing answer must never become a completed No.
  await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    const sales = await db.sales.toArray();
    const sale = sales.find((entry: { status: string; saleDate: string; deletedAt?: string }) =>
      entry.status === "delivered" && entry.saleDate.startsWith("2026-08") && !entry.deletedAt,
    );
    if (!sale) throw new Error("The fictional August fixture was not loaded.");
    await db.sales.put({ ...sale, serviceContractSold: undefined });
  });
  await page.reload();
  await expect(page.getByText("Opening your sales workspace")).toBeHidden();
  await page.getByRole("tablist", { name: "Monthly report subject" }).getByRole("tab", { name: "F&I", exact: true }).click();
  await center.getByRole("tab", { name: "Products", exact: true }).click();
  const productPanel = center.locator('[id$="-products-panel"]');
  await expect(productPanel.locator(".fi-center-product-table .fi-product-missing")).toHaveText("1 answer missing");
  const affectedProduct = productPanel.locator(".fi-center-product-card").filter({ hasText: "Service contract" });
  await expect(affectedProduct.locator(".fi-product-missing")).toHaveText("1 answer missing");
  await expect(productPanel.locator(".fi-center-product-card").filter({ hasText: "Tire & Wheel" }).locator(".fi-product-missing")).toHaveCount(0);
  await expect(productPanel.locator(".fi-center-product-card").filter({ hasText: "GAP" }).locator(".fi-product-missing")).toHaveCount(0);
  await expect(productPanel.getByText(/Yes \/ No|Answers recorded|Details complete/)).toHaveCount(0);
});
