import { expect, test } from "@playwright/test";
import type { AuditEvent, Sale } from "../src/domain/types";

test("the public link opens with three years of sample history and resets it in one click", async ({ page }, testInfo) => {
  test.skip(process.env.VITE_PUBLIC_DEMO_AUTOLOAD !== "true", "Run with public demo autoload enabled.");
  test.skip(testInfo.project.name !== "desktop-chrome", "The first visit contract is viewport-independent.");
  await page.clock.setFixedTime(new Date("2026-09-02T16:00:00.000Z"));
  await page.goto("/");
  const expected = await page.evaluate(async () => {
    const modulePath = "/src/domain/demo.ts";
    const { buildDemoSales } = await import(modulePath);
    const sales = buildDemoSales("2026-09", "2026-09-02", "three-year") as { saleDate: string; status: string }[];
    return {
      total: sales.length,
      julyDelivered: sales.filter((sale) => sale.saleDate.startsWith("2026-07") && sale.status === "delivered").length,
    };
  });
  const demoNotice = page.getByRole("complementary", { name: "Demo data active" });
  await expect(demoNotice).toContainText("Sample history is ready");
  await expect(demoNotice).toContainText(`${expected.total} fictional sales`);
  await expect(demoNotice).toContainText("Jan 2024 through today");
  await expect(page.getByRole("button", { name: "Load sample history", exact: true })).toHaveCount(0);
  const period = page.getByRole("button", { name: /Choose reporting month/ });
  await expect(period).toHaveAccessibleName("Choose reporting month. Currently August 2026");
  await page.getByRole("button", { name: "Show July 2026", exact: true }).click();
  await expect(period).toHaveAccessibleName("Choose reporting month. Currently July 2026");

  await page.reload();
  await expect(demoNotice).toContainText(`${expected.total} fictional sales`);
  await expect(period).toHaveAccessibleName("Choose reporting month. Currently July 2026");

  const changed = await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    const sales = await db.sales.toArray() as Sale[];
    const edited = sales.find((sale) => !sale.deletedAt)!;
    const removed = sales.find((sale) => sale.id !== edited.id && !sale.deletedAt)!;
    await db.sales.bulkPut([
      { ...edited, frontGrossCents: 9_999_999, notes: "Changed during demo", revision: edited.revision + 1 },
      { ...removed, deletedAt: "2026-09-02T16:00:00.000Z", revision: removed.revision + 1 },
    ]);
    return { editedId: edited.id, removedId: removed.id, originalFront: edited.frontGrossCents };
  });
  await page.reload();
  await expect(demoNotice).toContainText(`${expected.total - 1} fictional sales`);
  await page.getByRole("button", { name: "Reset sample data to its original records", exact: true }).click();
  await expect(page.getByText("Sample data reset.", { exact: true })).toBeVisible();
  await expect(demoNotice).toContainText(`${expected.total} fictional sales`);
  await expect(period).toHaveAccessibleName("Choose reporting month. Currently July 2026");
  expect(await page.evaluate(async ({ editedId, removedId }) => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    const edited = await db.sales.get(editedId) as Sale;
    const removed = await db.sales.get(removedId) as Sale;
    return { frontGrossCents: edited.frontGrossCents, notes: edited.notes, removedDeletedAt: removed.deletedAt ?? null };
  }, changed)).toEqual({
    frontGrossCents: changed.originalFront,
    notes: "Demonstration record — safe to remove from active views.",
    removedDeletedAt: null,
  });

  await page.getByRole("button", { name: "Sales", exact: true }).first().click();
  await expect(page.getByRole("button", { name: `Delivered ${expected.julyDelivered}`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Void/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await page.getByRole("button", { name: "Remove sample data", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove sample data", exact: true }).click();
  await expect(page.getByText(`${expected.total} sample sales removed.`)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Demo data active" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Data & backups/ }).click();
  await expect(page.getByRole("button", { name: "Load sample history", exact: true })).toBeVisible();
});

test("an existing public demo refreshes its sample profile once without reviving deleted sales", async ({ page }, testInfo) => {
  test.skip(process.env.VITE_PUBLIC_DEMO_AUTOLOAD !== "true", "Run with public demo autoload enabled.");
  test.skip(testInfo.project.name !== "desktop-chrome", "The migration contract is viewport-independent.");
  await page.clock.setFixedTime(new Date("2026-09-02T16:00:00.000Z"));
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Demo data active" })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    const sales = await db.sales.toArray() as Sale[];
    const first = sales.find((sale) => sale.saleDate.startsWith("2026-08"))!;
    const second = sales.find((sale) => sale.id !== first.id)!;
    const deleted = { ...second, deletedAt: "2026-09-02T16:00:00.000Z", updatedAt: "2026-09-02T16:00:00.000Z", revision: second.revision + 1 };
    const obsolete = { ...first, id: "demo-2026-08-999-delivered", stockNumber: "DEMO-202608-1000" };
    await db.transaction("rw", db.sales, db.auditEvents, async () => {
      // Simulate the previous published profile, keeping its real load audit.
      await db.auditEvents.where("action").equals("demo.loaded").modify((event: AuditEvent) => {
        if (event.details) delete event.details.demoProfileVersion;
      });
      await db.sales.bulkPut([{ ...first, frontGrossCents: 9_000_000, fiGrossCents: 8_000_000 }, deleted, obsolete]);
    });
    return { total: sales.length, first, deleted, obsolete };
  });

  await page.reload();
  await expect(page.getByRole("complementary", { name: "Demo data active" })).toContainText(`${fixture.total - 1} fictional sales`);
  const migrated = await page.evaluate(async ({ firstId, deletedId, obsoleteId }) => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    return {
      first: await db.sales.get(firstId),
      deleted: await db.sales.get(deletedId),
      obsolete: await db.sales.get(obsoleteId),
      markers: (await db.auditEvents.toArray() as AuditEvent[]).filter((event) => Boolean(event.details?.demoProfileVersion)).length,
    };
  }, { firstId: fixture.first.id, deletedId: fixture.deleted.id, obsoleteId: fixture.obsolete.id });
  expect(migrated.first.frontGrossCents).toBe(fixture.first.frontGrossCents);
  expect(migrated.first.fiGrossCents).toBe(fixture.first.fiGrossCents);
  expect(migrated.deleted).toEqual(fixture.deleted);
  expect(migrated.obsolete.deletedAt).toBeTruthy();
  expect(migrated.markers).toBe(1);

  const editedSnapshot = await page.evaluate(async (id) => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    await db.sales.update(id, { notes: "Keep this demo edit after refresh", frontGrossCents: 123_400 });
    return { sales: await db.sales.toArray(), auditEvents: await db.auditEvents.toArray() };
  }, fixture.first.id);
  await page.clock.setFixedTime(new Date("2026-09-10T16:00:00.000Z"));
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Demo data active" })).toContainText(`${fixture.total - 1} fictional sales`);
  expect(await page.evaluate(async () => {
    const modulePath = "/src/persistence/database.ts";
    const { db } = await import(modulePath);
    return { sales: await db.sales.toArray(), auditEvents: await db.auditEvents.toArray() };
  })).toEqual(editedSnapshot);
});
