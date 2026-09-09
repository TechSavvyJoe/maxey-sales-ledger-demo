/// <reference types="node" />
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Workbook } from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateMonth } from "@/domain/commission";
import { buildDemoSales, createPublicDemoHistoricPlan } from "@/domain/demo";
import { getPayPlanSchedule } from "@/domain/payPlan";
import { calculateWeeklyPerformance } from "@/domain/weeklyPerformance";
import type { Sale } from "@/domain/types";
import { createDefaultSettings } from "@/persistence/localDatabase";
import { buildPortableWorkbook, preparePortableWorkbook, type PortableWorkbookSnapshot } from "./portableWorkbook";

const NOW = new Date("2026-09-09T16:00:00.000Z");
function sale(id: string, date = "2026-08-01", overrides: Partial<Sale> = {}): Sale {
  return { id, profileId: "primary", saleDate: date, customerLastName: `Customer ${id}`, vehicleDescription: "2023 Ford Escape", stockNumber: id, status: "delivered", unitCreditBasis: 1000, frontGrossCents: 230000, fiGrossCents: 120000, serviceContractSold: true, tireWheelSold: false, gapSold: false, paymentMethod: "dealer_financed", notes: "Fictional test record", revision: 1, createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z`, ...overrides };
}
function fixture(): PortableWorkbookSnapshot {
  const settings = createDefaultSettings(NOW);
  settings.payPlanHistory = [createPublicDemoHistoricPlan("2026-09-09")];
  settings.selectedMonth = "2026-09";
  settings.monthlyGoal = 20;
  settings.monthlyCommissionGoalCents = 1500000;
  settings.daysOffByMonth = { "2026-08": ["2026-08-04"], "2026-09": ["2026-09-02"] };
  settings.deliveryGoalsByMonth = { "2026-08": 25 };
  settings.commissionGoalsByMonth = { "2026-08": 1800000 };
  settings.actualPaidByMonth = { "2026-08": 1200000, "2025-03": 0 };
  const sales = Array.from({ length: 15 }, (_, i) => sale(`A-${i + 1}`, `2026-08-${String(i + 1).padStart(2, "0")}`, { paymentMethod: ["dealer_financed", "cash", "outside_financing"][i % 3] as Sale["paymentMethod"], fiGrossCents: i === 1 ? null : i === 2 ? 0 : 120001, tireWheelSold: i % 3 === 0, gapSold: i % 4 === 0 }));
  sales[0].frontGrossCents = -40000;
  sales[1].unitCreditBasis = 500; sales[1].frontGrossCents = 0;
  sales[2].frontCommissionOverrideCents = 55000;
  sales[3].frontGrossCents = null;
  sales[4].frontCommissionOverrideCents = 0;
  sales.push(sale("NEG-1", "2024-01-02", { frontGrossCents: -1, fiGrossCents: -1 }), sale("NEG-2", "2024-01-03", { frontGrossCents: 0, fiGrossCents: 0 }));
  sales.push(sale("PENDING-1", "2026-08-22", { status: "pending" }), sale("DUP-1", "2026-08-23", { stockNumber: "SAME" }), sale("DUP-2", "2025-06-23", { stockNumber: "SAME" }));
  sales.push(sale("INVALID", "not-a-date"), sale("FUTURE", "2026-12-11"), sale("DELETED", "2026-08-17", { deletedAt: NOW.toISOString() }));
  sales.push(sale("SEPT-1", "2026-09-01", { fiGrossCents: null }), sale("SUNDAY", "2026-09-06", { fiGrossCents: null }), sale("SEPT-2", "2026-09-08", { fiGrossCents: null }));
  return { settings, sales, auditEvents: [{ id: 1, profileId: "primary", action: "sale.created", entityId: "A-1", summary: "Saved fictional record", occurredAt: NOW.toISOString(), details: { revision: 1 } }] };
}
function rowFor(book: Workbook, sheet: string, col: number, value: string): number {
  let found = 0;
  book.getWorksheet(sheet)!.eachRow((row, index) => { if (index >= 6 && row.getCell(col).value === value) found = index; });
  if (!found) throw new Error(`No row for ${sheet} ${value}`);
  return found;
}
function cached(book: Workbook, sheet: string, cell: string) { return book.getWorksheet(sheet)!.getCell(cell).result; }
function formulaManifest(book: Workbook) {
  const results: Record<string, Record<string, string | number>> = {};
  for (const sheet of book.worksheets) {
    const cells: Record<string, string | number> = {};
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.formula) {
        if (typeof cell.result !== "number" && typeof cell.result !== "string") throw new Error(`Uncached formula ${sheet.name}!${cell.address}`);
        cells[cell.address] = cell.result;
      }
    }));
    results[sheet.name] = cells;
  }
  return results;
}

describe("independent full-history Excel export", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it("preserves every active/deleted record and uses the app’s exact monthly commission results", async () => {
    const snapshot = fixture(), original = structuredClone(snapshot);
    const book = await buildPortableWorkbook(snapshot, NOW);
    expect(snapshot).toEqual(original);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["Start here", "Sales", "Deleted sales", "Monthly", "Yearly", "Weekly", "Products", "Payment mix", "Product combinations", "Commissions", "Milestones", "Pay plans", "Bonus tiers", "Work schedule", "Saved settings", "Activity", "Metric guide"]));
    expect(book.getWorksheet("Start here")!.getCell("A16").hyperlink).toBe("#'Report'!A1");
    expect(book.getWorksheet("Start here")!.getCell("A26").text).toBe("Report");
    expect(book.getWorksheet("Sales")!.rowCount - 5).toBe(snapshot.sales.filter((item) => !item.deletedAt).length);
    expect(book.getWorksheet("Deleted sales")!.getCell("P6").value).toBe("DELETED");
    for (const month of ["2024-01", "2025-06", "2026-08", "2026-09", "2026-12"]) {
      const summary = calculateMonth(snapshot.sales, month, getPayPlanSchedule(snapshot.settings), snapshot.settings.actualPaidByMonth[month] ?? null);
      const row = rowFor(book, "Monthly", 1, month);
      for (const [col, value] of [["C", summary.deliveredCount], ["F", summary.frontGrossCents / 100], ["G", summary.fiGrossCents / 100], ["J", summary.frontCommissionCents / 100], ["K", summary.fiCommissionCents / 100], ["M", summary.bonusIncludedCents / 100], ["N", summary.estimatedCommissionCents / 100]] as const) {
        expect(cached(book, "Monthly", `${col}${row}`)).toBeCloseTo(value, 8);
        expect(book.getWorksheet("Monthly")!.getCell(`${col}${row}`).formula).toBeTruthy();
      }
      for (const item of summary.calculatedSales) {
        const sourceRow = rowFor(book, "Sales", 15, item.sale.id);
        expect(cached(book, "Commissions", `M${sourceRow}`)).toBe(item.frontCommissionCents / 100);
        expect(cached(book, "Commissions", `N${sourceRow}`)).toBeCloseTo(item.fiCommissionCents / 100, 8);
        expect(cached(book, "Commissions", `V${sourceRow}`)).toBe((item.milestone?.extraEarningsUnlockedCents ?? 0) / 100);
      }
    }
    for (const id of ["DUP-1", "DUP-2", "INVALID", "FUTURE"]) expect(book.getWorksheet("Sales")!.getCell(`X${rowFor(book, "Sales", 15, id)}`).value).toBe(0);
    const half = rowFor(book, "Sales", 15, "A-2"), manual = rowFor(book, "Sales", 15, "A-3"), zero = rowFor(book, "Sales", 15, "A-5");
    expect(cached(book, "Commissions", `M${half}`)).toBe(150);
    expect(cached(book, "Commissions", `M${manual}`)).toBe(550);
    expect(cached(book, "Commissions", `M${zero}`)).toBe(0);
    expect(book.getWorksheet("Commissions")!.getCell(`N${half}`).formula).toContain("ROUND");
    // Financing-segment product penetration uses that payment type, not every delivery.
    const finance = book.getWorksheet("Payment mix")!.getRow(6);
    expect(finance.getCell(1).value).toBe("All history");
    expect(finance.getCell(2).value).toBe("Finance");
    expect(finance.getCell(14).result).toBe(Number(finance.getCell(13).result) / Number(finance.getCell(3).result));
    expect(finance.getCell(14).formula).toBe("IF(C6>0,M6/C6,\"\")");
    expect(Object.values(formulaManifest(book)).reduce((count, values) => count + Object.keys(values).length, 0)).toBeGreaterThan(1000);
  }, 20000);

  it("keeps blank F&I and missing payroll distinct from entered zero, with safe negative-half-cent averages", async () => {
    const snapshot = fixture();
    snapshot.sales = [sale("NEG-1", "2024-01-02", { frontGrossCents: -1, fiGrossCents: -1 }), sale("NEG-2", "2024-01-03", { frontGrossCents: 0, fiGrossCents: 0 }), sale("UNKNOWN", "2026-09-01", { fiGrossCents: null })];
    const book = await buildPortableWorkbook(snapshot, NOW);
    const unknown = rowFor(book, "Sales", 15, "UNKNOWN"), sept = rowFor(book, "Monthly", 1, "2026-09"), jan = rowFor(book, "Monthly", 1, "2024-01"), year = rowFor(book, "Yearly", 1, "2026"), noPayrollYear = rowFor(book, "Yearly", 1, "2024");
    expect(book.getWorksheet("Sales")!.getCell(`H${unknown}`).value).toBeNull();
    expect(cached(book, "Monthly", `Z${sept}`)).toBe("");
    expect(cached(book, "Yearly", `P${year}`)).toBe("");
    expect(cached(book, "Yearly", `K${noPayrollYear}`)).toBe("");
    expect(cached(book, "Monthly", `Y${jan}`)).toBe(0);
    expect(book.getWorksheet("Monthly")!.getCell(`Y${jan}`).formula).toContain("INT(ROUND(");
  }, 20000);

  it("matches weekly checkpoints on a closing Sunday while excluding Sunday deliveries only from weekly counts", async () => {
    vi.setSystemTime(new Date("2026-09-06T16:00:00Z"));
    const snapshot = fixture();
    snapshot.settings.payPlan.fiRateBps = 5000;
    snapshot.sales.find((item) => item.id === "SEPT-1")!.fiGrossCents = -1;
    snapshot.sales.find((item) => item.id === "SUNDAY")!.fiGrossCents = 0;
    const book = await buildPortableWorkbook(snapshot);
    const summary = calculateMonth(snapshot.sales, "2026-09", getPayPlanSchedule(snapshot.settings));
    const weeks = calculateWeeklyPerformance({ summary, monthlyGoal: 20, daysOff: snapshot.settings.daysOffByMonth["2026-09"], todayDate: "2026-09-06" });
    const rows: number[] = [];
    book.getWorksheet("Weekly")!.eachRow((row, index) => { if (row.getCell(1).value === "2026-09") rows.push(index); });
    weeks.weeks.forEach((week, index) => {
      expect(cached(book, "Weekly", `D${rows[index]}`)).toBe(week.deliveredCount);
      expect(cached(book, "Weekly", `N${rows[index]}`)).toBe(week.goal.cumulativeDeliveredCount);
      expect(cached(book, "Weekly", `O${rows[index]}`)).toBe(week.goal.deliveriesNeededByWeekEnd ?? "");
    });
    expect(book.getWorksheet("Weekly")!.getCell(`N${rows[0]}`).formula).toContain("'Sales'!$AC$");
    expect(book.getWorksheet("Weekly")!.getCell(`O${rows[0]}`).formula).toContain("WEEKDAY");
    const output = process.env.PORTABLE_WORKBOOK_SAMPLE_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "Sales-Ledger-Sunday-Correction-Edges.xlsx"), Buffer.from(await book.xlsx.writeBuffer()));
      await writeFile(join(output, "sunday-formula-cache-manifest.json"), JSON.stringify(formulaManifest(book), null, 2));
    }
  }, 20000);

  it("uses literal customer text, internal links only, frozen headings and a readable serialized workbook", async () => {
    const snapshot = fixture();
    snapshot.sales[0].customerLastName = '=HYPERLINK("https://invalid.example","not a formula")';
    snapshot.sales[0].notes = "+SUM(1,2)\n@External value";
    const book = await buildPortableWorkbook(snapshot), row = rowFor(book, "Sales", 15, "A-1");
    const buffer = await book.xlsx.writeBuffer();
    const loaded = new Workbook(); await loaded.xlsx.load(buffer);
    expect(loaded.getWorksheet("Sales")!.getCell(`A${row}`).value).toBe(snapshot.sales[0].customerLastName);
    expect(loaded.getWorksheet("Sales")!.getCell(`A${row}`).formula).toBeUndefined();
    expect(loaded.getWorksheet("Sales")!.getCell(`N${row}`).value).toBe(snapshot.sales[0].notes);
    expect(loaded.getWorksheet("Sales")!.views[0]).toMatchObject({ state: "frozen", ySplit: 5, xSplit: 3 });
    expect(loaded.getWorksheet("Sales")!.autoFilter).toBeTruthy();
    expect(loaded.getWorksheet("Sales")!.pageSetup.printTitlesRow).toBe("1:5");
    loaded.worksheets.forEach((sheet) => sheet.eachRow((r) => r.eachCell((cell) => { if (cell.hyperlink) expect(cell.hyperlink).toMatch(/^#/); if (cell.formula) expect(cell.formula).not.toMatch(/\[|https?:\/\//i); })));
    expect(cached(loaded, "Start here", "B14")).toBe(cached(book, "Start here", "B14"));
  }, 20000);

  it("does not invent a pace on the closing Sunday when the entire current week was off", async () => {
    vi.setSystemTime(new Date("2026-09-06T16:00:00Z"));
    const snapshot = fixture();
    snapshot.settings.daysOffByMonth["2026-09"] = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    const book = await buildPortableWorkbook(snapshot);
    const rows: number[] = [];
    book.getWorksheet("Weekly")!.eachRow((row, index) => { if (row.getCell(1).value === "2026-09") rows.push(index); });
    expect(cached(book, "Weekly", `D${rows[0]}`)).toBe(1);
    expect(cached(book, "Weekly", `K${rows[0]}`)).toBe(0);
    expect(cached(book, "Weekly", `P${rows[0]}`)).toBe("");
    expect(book.getWorksheet("Weekly")!.getCell(`P${rows[0]}`).formula).toContain("NOT(AND(");
    const output = process.env.PORTABLE_WORKBOOK_SAMPLE_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "Sales-Ledger-No-Workdays-Edge.xlsx"), Buffer.from(await book.xlsx.writeBuffer()));
      await writeFile(join(output, "no-workdays-formula-cache-manifest.json"), JSON.stringify(formulaManifest(book), null, 2));
    }
  }, 20000);

  it("fails clearly instead of omitting sales or payroll/goals outside plan coverage", async () => {
    const snapshot = fixture(); snapshot.sales.push(sale("EARLY", "2023-12-01"));
    await expect(buildPortableWorkbook(snapshot)).rejects.toThrow(/do not cover 2023-12/);
    snapshot.sales.pop(); snapshot.settings.actualPaidByMonth["2023-12"] = 10000;
    await expect(buildPortableWorkbook(snapshot)).rejects.toThrow(/payroll, goals or days off in 2023-12/);
  });

  it("supports a fresh empty workspace and prepares the complete binary download", async () => {
    const snapshot: PortableWorkbookSnapshot = { settings: createDefaultSettings(NOW), sales: [], auditEvents: [] };
    const prepared = await preparePortableWorkbook(snapshot, NOW);
    expect(prepared.file.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(prepared.fileName).toMatch(/^Sales-Ledger-All-Data-.+-2026-09-09\.xlsx$/);
    expect(prepared.file.size).toBeGreaterThan(10000);
    const book = new Workbook(); await book.xlsx.load(await prepared.file.arrayBuffer());
    expect(cached(book, "Start here", "B10")).toBe(0);
  }, 20000);

  it("generates a three-year realistic formula-backed sample and verification manifests on request", async () => {
    const snapshot = fixture(); snapshot.sales = buildDemoSales("2026-09", "2026-09-09", "three-year");
    const book = await buildPortableWorkbook(snapshot, NOW);
    expect(snapshot.sales.length).toBeGreaterThan(400);
    expect(book.getWorksheet("Yearly")!.rowCount).toBe(8);
    const output = process.env.PORTABLE_WORKBOOK_SAMPLE_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "Sales-Ledger-Three-Year-Synthetic.xlsx"), Buffer.from(await book.xlsx.writeBuffer()));
      await writeFile(join(output, "formula-cache-manifest.json"), JSON.stringify(formulaManifest(book), null, 2));
      const edge = await buildPortableWorkbook(fixture(), NOW);
      await writeFile(join(output, "Sales-Ledger-Edge-Cases.xlsx"), Buffer.from(await edge.xlsx.writeBuffer()));
      await writeFile(join(output, "edge-formula-cache-manifest.json"), JSON.stringify(formulaManifest(edge), null, 2));
    }
  }, 30000);
});
