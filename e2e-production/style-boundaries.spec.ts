import { expect, test, type Locator, type Page } from "@playwright/test";

async function boundary(locator: Locator, minimumContrast: number, againstParent = false) {
  const read = () => locator.first().evaluate((node, outside) => {
    const css = getComputedStyle(node);
    const sides = ["Top", "Right", "Bottom", "Left"] as const;
    const side = sides.find((value) => (
      Number.parseFloat(css[`border${value}Width`]) >= 1 && css[`border${value}Style`] === "solid"
    ));
    let background = css.backgroundColor;
    let ancestor = node.parentElement;
    if (outside && ancestor) {
      background = getComputedStyle(ancestor).backgroundColor;
      ancestor = ancestor.parentElement;
    }
    while (background === "rgba(0, 0, 0, 0)" && ancestor) {
      background = getComputedStyle(ancestor).backgroundColor;
      ancestor = ancestor.parentElement;
    }
    const luminance = (color: string) => {
      const values = (color.match(/[\d.]+/g) ?? []).slice(0, 3)
        .map(Number).map((value) => value / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const border = side ? css[`border${side}Color`] : "rgba(0, 0, 0, 0)";
    const light = luminance(background);
    const dark = luminance(border);
    const text = luminance(css.color);
    return {
      border, background, side,
      contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
      textContrast: (Math.max(light, text) + 0.05) / (Math.min(light, text) + 0.05),
    };
  }, againstParent);
  await expect.poll(async () => (await read()).contrast, {
    message: `Boundary contrast for ${await locator.first().getAttribute("class")}`,
  }).toBeGreaterThanOrEqual(minimumContrast);
  const edge = await read();
  expect(edge.side, `Explicit solid boundary for ${await locator.first().getAttribute("class")}`).toBeTruthy();
  return edge;
}

async function openView(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).first().click();
  await expect(page.locator(`.${name.toLowerCase()}-page`)).toBeVisible();
}

test("production sections and controls stay distinct on office monitors and phones", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-09-02T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.locator(".dashboard-page")).toBeVisible();
  await openView(page, "Settings");
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  const loadDemo = page.getByRole("button", { name: /^Load (2-year|full-year) demo$/ });
  if (await loadDemo.isVisible()) await loadDemo.click();
  await expect(page.locator(".demo-data-callout")).toContainText("fictional demonstration sales are loaded");

  const measurements: Array<Record<string, unknown>> = [];
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1280, height: 800 },
    { width: 800, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openView(page, "Dashboard");
    const section = await boundary(page.locator(".dashboard-v2-scorecard"), 2);
    await boundary(page.locator(".dashboard-v2-planning"), 2);
    await boundary(page.locator(".dashboard-v2-commission-details"), 2);
    await boundary(page.locator(".period-switcher"), 3);

    await openView(page, "Sales");
    await boundary(page.locator(".search-field input"), 3);
    await boundary(page.locator(".filter-chip:not(.is-active)"), 3);
    if (viewport.width > 1120) {
      await boundary(page.locator(".sales-surface"), 2);
      await boundary(page.locator(".sales-table tbody tr:first-child td"), 1.6);
      const header = await boundary(page.locator(".sales-table thead th"), 1.6);
      expect(header.textContrast, "Sales column labels must contrast with their shaded header").toBeGreaterThanOrEqual(4.5);
    } else {
      await boundary(page.locator(".sale-card"), 2);
    }

    await openView(page, "Reports");
    await boundary(page.locator(".report-command-bar"), 2);
    await boundary(page.locator('.report-command-bar [role="tab"][data-state="active"]'), 3);
    await boundary(page.locator(".report-document"), 2);
    await boundary(page.locator('.report-subject-tabs button[aria-selected="true"]'), 3);

    await openView(page, "Settings");
    await boundary(page.locator(".settings-category-nav"), 2);
    await boundary(page.getByLabel("Salesperson name", { exact: false }), 3);
    const size = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(size.content).toBe(size.viewport);
    measurements.push({ ...viewport, section });
  }
  await testInfo.attach("production-boundary-contrast", {
    body: JSON.stringify(measurements, null, 2), contentType: "application/json",
  });
});

test("production sale entry preserves focus, validation, and product selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
  const stock = page.getByLabel("Stock number", { exact: false });
  await stock.focus();
  const focus = await stock.evaluate((node) => {
    const style = getComputedStyle(node);
    return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focus.width).toBeGreaterThanOrEqual(3);
  expect(focus.style).toBe("solid");

  const product = page.getByRole("checkbox", { name: /Service contract/ }).first();
  await product.click();
  await expect(product).toBeChecked();
  await boundary(product, 3, true);
  await boundary(stock, 3);
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(stock).toHaveAttribute("aria-invalid", "true");
  await expect(stock).toHaveCSS("border-color", "rgb(180, 35, 24)");
});

test("production report print view keeps its existing paper layout", async ({ page }) => {
  await page.goto("/");
  await openView(page, "Reports");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".report-command-bar")).toBeHidden();
  expect(await page.locator(".report-document").evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe("0px");
});
