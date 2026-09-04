import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { calculateMonth } from "@/domain/commission";
import { getPayPlanSchedule } from "@/domain/payPlan";
import type { Sale } from "@/domain/types";
import { buildMilestoneExportRows, buildSalesDetailExportRows, createBackupEnvelope, createMonthlyCsvContent, exportSalesWorkbook } from "@/lib/files";
import { previewLegacyWorkbook } from "@/lib/legacyImport";
import { createDefaultSettings } from "@/persistence/database";

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("xlsx", async (importOriginal) => ({ ...await importOriginal<typeof import("xlsx")>(), writeFile }));

function records(count = 15): Sale[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `milestone-${index + 1}`, profileId: "primary", saleDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    customerLastName: `Example ${index + 1}`, stockNumber: `MILESTONE-${index + 1}`, vehicleDescription: "Example vehicle",
    status: "delivered", unitCreditBasis: 1000, frontGrossCents: 230_000, fiGrossCents: 120_000,
    notes: "", createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00Z`, updatedAt: "2026-08-20T12:00:00Z", revision: 1,
  }));
}
const profile = () => createDefaultSettings(new Date("2026-08-20T12:00:00Z"));
const summaryFor = (sales: Sale[]) => calculateMonth(sales, "2026-08", getPayPlanSchedule(profile()));

describe("milestone report exports", () => {
  it("separates settled sale commission from extra unlocked and non-additive milestone impact", () => {
    const summary = summaryFor(records());
    const rows = buildMilestoneExportRows(summary.calculatedSales, true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      "Customer Last Name": "Example 11", "Delivery Number": 11, "Delivery Date": "08/11/2026",
      "Sale Commission": 1045, "Prior-sales Retroactive Commission": 1150, "Volume Bonus Added": 300,
      "Extra Earnings Unlocked (Already Included)": 1450, "Milestone Impact (Already Included)": 2495,
      "Milestone Amount Status": "Recorded amounts",
    });
    expect(rows[1]).toMatchObject({
      "Delivery Number": 15, "Sale Commission": 1045, "Prior-sales Retroactive Commission": 0,
      "Volume Bonus Added": 800, "Extra Earnings Unlocked (Already Included)": 800,
      "Milestone Impact (Already Included)": 1845,
    });
    expect(rows.every((row) => String(row["Milestone Calculation Note"]).includes("do not add again"))).toBe(true);
    expect(summary.estimatedCommissionCents).toBe(1_677_500);
  });

  it("keeps non-milestone derived money blank and exposes delivery order in Sales Detail", () => {
    const rows = buildSalesDetailExportRows(summaryFor(records()).calculatedSales, true);
    expect(rows[0]).toMatchObject({ "Delivery Number": 1, Milestone: "", "Milestone Impact (Already Included)": "" });
    expect(rows[10]).toMatchObject({ "Delivery Number": 11, "Sale Commission": 1045, "Milestone Impact (Already Included)": 2495 });
  });

  it("qualifies partial milestone amounts when prior or current gross is still unknown", () => {
    const sales = records(11);
    sales[0].frontGrossCents = null;
    sales[10].fiGrossCents = null;
    const row = buildMilestoneExportRows(summaryFor(sales).calculatedSales, true)[0];
    expect(row).toMatchObject({
      "Earlier Sales Awaiting Front Gross": 1, "Milestone Amount Status": "Partial — gross amounts pending",
      "Sale Commission": 805, "Prior-sales Retroactive Commission": 1035,
      "Extra Earnings Unlocked (Already Included)": 1335, "Milestone Impact (Already Included)": 2140,
    });
  });

  it("excludes customer names under the report privacy choice, including explanatory text", () => {
    const summary = summaryFor(records());
    for (const rows of [buildMilestoneExportRows(summary.calculatedSales, false), buildSalesDetailExportRows(summary.calculatedSales, false)]) {
      expect(rows.every((row) => !("Customer Last Name" in row))).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("Example 11");
    }
  });

  it("adds the milestone worksheet without changing commission totals or currency types", async () => {
    writeFile.mockClear();
    await exportSalesWorkbook(records(), profile(), "2026-08", true);
    const book = writeFile.mock.calls[0][0] as XLSX.WorkBook;
    const milestoneSheet = book.Sheets["Milestone Earnings"];
    expect(XLSX.utils.sheet_to_json(milestoneSheet)).toEqual(buildMilestoneExportRows(summaryFor(records()).calculatedSales, true));
    const summaryRows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Monthly Summary"], { header: 1 });
    expect(summaryRows.find((row) => row[0] === "Estimated commission")?.[1]).toBe(16_775);
    const headings = XLSX.utils.sheet_to_json<unknown[]>(milestoneSheet, { header: 1 })[0];
    const amountColumn = headings.indexOf("Milestone Impact (Already Included)");
    const cell = milestoneSheet[XLSX.utils.encode_cell({ c: amountColumn, r: 1 })];
    expect(cell.t).toBe("n");
    expect(cell.z).toContain('"$"');
  });

  it("provides an explicit empty milestone worksheet before any threshold is reached", async () => {
    writeFile.mockClear();
    await exportSalesWorkbook(records(2), profile(), "2026-08", false);
    const book = writeFile.mock.calls[0][0] as XLSX.WorkBook;
    expect(XLSX.utils.sheet_to_json(book.Sheets["Milestone Earnings"])).toContainEqual(expect.objectContaining({
      "Milestone Earnings": "No earnings milestone reached this month.",
    }));
  });

  it("exports CSV attribution but does not import it as a second commission or persist it in backups", async () => {
    const sales = records();
    const csv = createMonthlyCsvContent(sales, profile(), "2026-08", true);
    const imported = await previewLegacyWorkbook(new File([csv], "milestones.csv", { type: "text/csv" }));
    expect(imported.rejectedRows).toEqual([]);
    expect(summaryFor(imported.validSales).estimatedCommissionCents).toBe(summaryFor(sales).estimatedCommissionCents);
    for (const sale of imported.validSales) {
      expect(sale.frontCommissionOverrideCents).toBeNull();
      expect(sale).not.toHaveProperty("milestone");
      expect(sale).not.toHaveProperty("deliveryOrdinal");
    }
    const backup = await createBackupEnvelope(profile(), sales, []);
    expect(backup.data.sales.every((sale) => !("milestone" in sale) && !("deliveryOrdinal" in sale))).toBe(true);
  });
});
