import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface SavedBackup {
  checksum?: string;
  data?: { sales?: Array<{
    customerLastName?: string;
    stockNumber?: string;
    frontGrossCents?: number | null;
    fiGrossCents?: number | null;
  }> };
}

async function readSavedBackup(page: Page): Promise<SavedBackup> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("Sales Ledger Backups");
    const handle = await directory.getFileHandle("Sales Ledger - Current Backup.json");
    return JSON.parse(await (await handle.getFile()).text());
  });
}

test("automatic folder backup verifies saved changes and reconnects after reload", async ({
  playwright, browserName, channel, headless, launchOptions, contextOptions,
  baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch,
  locale, timezoneId, colorScheme,
}) => {
  // Chrome 153 crashes when an OPFS directory handle is read from IndexedDB
  // in an incognito context, even on an empty page with no application code.
  // A fresh persistent profile exercises durable folder bindings as intended
  // without pinning an older browser, sharing a user's profile, or skipping tests.
  const profile = await mkdtemp(join(tmpdir(), "sales-ledger-backup-test-"));
  let context: BrowserContext | undefined;
  try {
    context = await playwright[browserName].launchPersistentContext(profile, {
      ...launchOptions, ...contextOptions, channel, headless, baseURL, viewport,
      userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId,
      colorScheme,
    });
    // Playwright applies the configured tracing to manually created contexts.
    const page = context.pages()[0] ?? await context.newPage();
    await page.clock.setFixedTime(new Date("2026-08-31T16:00:00.000Z"));
    await page.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true, value: () => navigator.storage.getDirectory(),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("button", { name: /^Data & backups/ }).click();
    const backupSection = page.getByRole("region", { name: "Automatic backup folder" });
    await backupSection.getByRole("button", { name: "Choose backup folder" }).click();
    await expect(backupSection).toContainText("Automatic backups on");
    await expect(backupSection).toContainText("Last successful backup");

    await page.getByRole("button", { name: "Add sale", exact: true }).first().click();
    await page.getByLabel(/Customer last name/).fill("BackupTest");
    await page.getByLabel(/Stock number/).fill("AUTO-BACKUP-001");
    await page.getByLabel("Front gross").fill("2000");
    await page.getByRole("button", { name: "Add sale", exact: true }).click();
    await expect(page.getByText("Sale added.")).toBeVisible();

    await expect.poll(async () => {
      const saved = await readSavedBackup(page);
      return saved.data?.sales?.some((sale) => sale.stockNumber === "AUTO-BACKUP-001") ?? false;
    }, { timeout: 10_000 }).toBe(true);
    const saved = await readSavedBackup(page);
    expect(saved.checksum).toMatch(/^[a-f0-9]{64}$/);
    const fixtures = saved.data?.sales?.filter((sale) => sale.stockNumber === "AUTO-BACKUP-001") ?? [];
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      customerLastName: "BackupTest", stockNumber: "AUTO-BACKUP-001",
      frontGrossCents: 200_000, fiGrossCents: null,
    });

    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("button", { name: /^Data & backups/ }).click();
    await expect(page.getByRole("region", { name: "Automatic backup folder" })).toContainText("Automatic backups on");
  } finally {
    try {
      await context?.close();
    } finally {
      // This directory was created solely for this test; never a user's profile.
      await rm(profile, { recursive: true, force: true });
    }
  }
});
