import { expect, test } from "@playwright/test";

const widths = [320, 390, 410, 440, 460, 480, 520, 720, 721, 1180] as const;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
});

test("Volume bonuses keep every control and running total inside the panel", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "desktop-chrome", "This test supplies its own boundary-width matrix.");

  await page.setViewportSize({ width: widths[0], height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByLabel("Salesperson name *").fill("Bonus layout test");
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  await page.getByRole("button", { name: "Volume bonuses", exact: true }).click();

  const table = page.locator(".bonus-tier-table");
  await expect(table).toBeVisible();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });

    const geometry = await table.evaluate((schedule) => {
      const scheduleStyle = getComputedStyle(schedule);
      const rows = [...schedule.querySelectorAll<HTMLElement>(".bonus-tier-row")];
      const inputs = [...schedule.querySelectorAll<HTMLInputElement>("input")];
      const totals = [...schedule.querySelectorAll<HTMLElement>(".bonus-tier-total")];
      const visible = (element: HTMLElement) => getComputedStyle(element).display !== "none";
      const rect = (element: Element) => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };

      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        table: rect(schedule),
        tableContentWidth: schedule.clientWidth
          - Number.parseFloat(scheduleStyle.paddingLeft)
          - Number.parseFloat(scheduleStyle.paddingRight),
        tableClientWidth: schedule.clientWidth,
        tableScrollWidth: schedule.scrollWidth,
        headerVisible: visible(schedule.querySelector<HTMLElement>(".bonus-tier-table__header")!),
        rows: rows.map((row) => ({
          bounds: rect(row),
          clientWidth: row.clientWidth,
          scrollWidth: row.scrollWidth,
          fieldsBottom: Math.max(...[...row.querySelectorAll<HTMLElement>(".bonus-tier-field")].map((field) => field.getBoundingClientRect().bottom)),
          totalTop: row.querySelector<HTMLElement>(".bonus-tier-total")!.getBoundingClientRect().top,
        })),
        inputs: inputs.map(rect),
        totals: totals.map((total) => {
          const label = total.querySelector<HTMLElement>(".bonus-tier-total__label");
          const value = total.querySelector<HTMLElement>(".bonus-tier-total__value");
          const note = total.querySelector<HTMLElement>("small");
          return {
            bounds: rect(total),
            label: label && visible(label) ? rect(label) : null,
            value: value ? rect(value) : null,
            note: note ? rect(note) : null,
          };
        }),
        fieldLabelsVisible: rows.every((row) => {
          const labels = [...row.querySelectorAll<HTMLElement>(".bonus-tier-field__label")];
          return labels.length === 2 && labels.every(visible);
        }),
      };
    });

    const inside = (
      inner: { left: number; right: number; top: number; bottom: number },
      outer: { left: number; right: number; top: number; bottom: number },
    ) => inner.left >= outer.left - 1
      && inner.right <= outer.right + 1
      && inner.top >= outer.top - 1
      && inner.bottom <= outer.bottom + 1;

    expect(geometry.documentWidth, `${width}px document overflow`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.tableScrollWidth, `${width}px bonus table overflow`).toBeLessThanOrEqual(geometry.tableClientWidth + 1);
    expect(geometry.rows, `${width}px includes all six bonus levels`).toHaveLength(6);
    expect(geometry.inputs, `${width}px includes both controls for all six levels`).toHaveLength(12);
    expect(geometry.totals, `${width}px includes all six running totals`).toHaveLength(6);
    expect(geometry.rows.every((row) => inside(row.bounds, geometry.table)), `${width}px rows remain inside the bonus table`).toBe(true);
    expect(geometry.rows.every((row) => row.scrollWidth <= row.clientWidth + 1), `${width}px rows do not clip their content`).toBe(true);
    expect(geometry.inputs.every((input) => inside(input, geometry.table)), `${width}px inputs remain fully inside the bonus table`).toBe(true);
    expect(geometry.inputs.every((input) => input.height >= 44), `${width}px inputs retain 44px targets`).toBe(true);
    expect(geometry.inputs.every((input) => input.width >= 72), `${width}px numeric values retain useful editing room`).toBe(true);
    expect(geometry.totals.every((total) => inside(total.bounds, geometry.table)), `${width}px total rows remain fully inside the bonus table`).toBe(true);
    expect(geometry.totals.every((total) => total.value && inside(total.value, total.bounds)), `${width}px total values remain inside their row`).toBe(true);
    expect(geometry.totals.every((total) => !total.label || !total.value || total.label.right <= total.value.left + 1), `${width}px total labels and values do not collide`).toBe(true);
    expect(geometry.totals.every((total) => !total.note || (total.value && inside(total.note, total.value))), `${width}px optional bonus notes stay with their value`).toBe(true);

    if (geometry.tableContentWidth <= 560) {
      expect(geometry.headerVisible, `${width}px compact rows replace the wide header`).toBe(false);
      expect(geometry.fieldLabelsVisible, `${width}px compact rows keep visible field labels`).toBe(true);
      expect(geometry.totals.every((total) => total.label !== null), `${width}px compact rows label every running total`).toBe(true);
      expect(geometry.rows.every((row) => row.totalTop >= row.fieldsBottom), `${width}px totals follow both editing fields`).toBe(true);
    } else {
      expect(geometry.headerVisible, `${width}px wide rows keep their shared header`).toBe(true);
      expect(geometry.fieldLabelsVisible, `${width}px wide rows do not duplicate field labels`).toBe(false);
      expect(geometry.totals.every((total) => total.label === null), `${width}px wide rows do not duplicate total labels`).toBe(true);
    }

    await page.screenshot({ path: testInfo.outputPath(`volume-bonuses-${width}.png`), fullPage: false });
  }

  await page.setViewportSize({ width: 460, height: 900 });
  const firstBonus = page.getByLabel("Tier 1 bonus added at milestone", { exact: true });
  await firstBonus.fill("325");
  await firstBonus.blur();
  await expect(page.getByText("All changes saved. Settings save automatically.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Volume bonuses", exact: true }).click();
  await expect(firstBonus).toHaveValue("325");
});
