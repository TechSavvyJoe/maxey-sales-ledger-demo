import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { calculateMonth } from "@/domain/commission";
import { getMinimumFrontCommissionCents, getPayPlanSchedule } from "@/domain/payPlan";
import type { Sale } from "@/domain/types";
import { buildSalesDetailExportRows, createBackupEnvelope, createMonthlyCsvContent, exportSalesWorkbook, formatReportWorkbookNumbers, parseBackupFile, sha256 } from "@/lib/files";
import { previewLegacyWorkbook } from "@/lib/legacyImport";
import { createDefaultSettings } from "@/persistence/database";

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("xlsx", async (importOriginal) => ({ ...await importOriginal<typeof import("xlsx")>(), writeFile }));

const sale: Sale = {
  id: "mini-export", profileId: "primary", saleDate: "2026-08-10",
  customerLastName: "Example", stockNumber: "MINI-1", vehicleDescription: "Example vehicle",
  status: "delivered", unitCreditBasis: 500, frontGrossCents: -31_661, fiGrossCents: 60_000,
  paymentMethod: "outside_financing", serviceContractSold: true, tireWheelSold: false, gapSold: false,
  notes: "", createdAt: "2026-08-10T12:00:00Z", updatedAt: "2026-08-10T12:00:00Z", revision: 1,
};
const settings = () => createDefaultSettings(new Date("2026-08-20T12:00:00Z"));
const jsonFile = (value: unknown) => new File([JSON.stringify(value)], "backup.json", { type: "application/json" });
function workbookFile(rows: unknown[][], sheetName = "Enter Sales") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "commission.xlsx");
}

describe("mini and manual commission backup integrity", () => {
  it.each([undefined, null, 0, 50_000, 100_000_000])("preserves manual amount %s without changing gross", async (amount) => {
    const original = { ...sale, frontCommissionOverrideCents: amount };
    const envelope = await createBackupEnvelope(settings(), [original], []);
    const parsed = await parseBackupFile(jsonFile(envelope));
    expect(parsed.data.sales[0].frontCommissionOverrideCents).toBe(amount);
    expect(parsed.data.sales[0].frontGrossCents).toBe(-31_661);
    expect(parsed.data.sales[0].unitCreditBasis).toBe(500);
    expect(parsed.data.profile.payPlan.minimumFrontCommissionCents).toBe(30_000);
  });

  it.each([0, 40_000])("retains explicit Mini %s in current and historical plans", async (mini) => {
    const profile = settings();
    profile.payPlan.minimumFrontCommissionCents = mini;
    profile.payPlanHistory[0].minimumFrontCommissionCents = mini;
    const parsed = await parseBackupFile(jsonFile(await createBackupEnvelope(profile, [sale], [])));
    expect(parsed.data.profile.payPlan.minimumFrontCommissionCents).toBe(mini);
    expect(parsed.data.profile.payPlanHistory[0].minimumFrontCommissionCents).toBe(mini);
  });

  it("validates the original legacy checksum before defaulting omitted Mini to $300", async () => {
    const envelope = await createBackupEnvelope(settings(), [sale], []);
    delete envelope.data.profile.payPlan.minimumFrontCommissionCents;
    envelope.data.profile.payPlanHistory.forEach((plan) => delete plan.minimumFrontCommissionCents);
    envelope.checksum = await sha256(JSON.stringify(envelope.data));
    const parsed = await parseBackupFile(jsonFile(envelope));
    expect(getMinimumFrontCommissionCents(parsed.data.profile.payPlan)).toBe(30_000);
    expect(parsed.data.sales[0]).not.toHaveProperty("frontCommissionOverrideCents");
    expect(parsed.data.sales[0].frontGrossCents).toBe(-31_661);
  });

  it.each([-1, 0.5, NaN, Infinity, 100_000_001, Number.MAX_SAFE_INTEGER + 1])("refuses to create a backup with invalid manual amount %s", async (amount) => {
    await expect(createBackupEnvelope(settings(), [{ ...sale, frontCommissionOverrideCents: amount }], []))
      .rejects.toThrow(/Cannot create backup/);
  });

  it.each([-1, 0.5, NaN, Infinity, 100_000_001])("refuses to create a backup with invalid Mini %s", async (amount) => {
    const profile = settings();
    profile.payPlan.minimumFrontCommissionCents = amount;
    await expect(createBackupEnvelope(profile, [sale], [])).rejects.toThrow(/Cannot create backup/);
  });

  it("rejects checksum-valid malformed override data rather than silently dropping it", async () => {
    const envelope = await createBackupEnvelope(settings(), [sale], []);
    for (const invalid of [-1, 0.5, 100_000_001, "500"]) {
      (envelope.data.sales[0] as unknown as Record<string, unknown>).frontCommissionOverrideCents = invalid;
      envelope.checksum = await sha256(JSON.stringify(envelope.data));
      await expect(parseBackupFile(jsonFile(envelope))).rejects.toThrow(/valid Sales Ledger backup/);
    }
  });

  it("detects any override alteration after backup creation", async () => {
    const envelope = await createBackupEnvelope(settings(), [{ ...sale, frontCommissionOverrideCents: 50_000 }], []);
    envelope.data.sales[0].frontCommissionOverrideCents = 65_000;
    await expect(parseBackupFile(jsonFile(envelope))).rejects.toThrow(/incomplete or changed/);
  });
});

describe("commission report exports and re-imports", () => {
  it("reconciles every workbook view to actual front and F&I payouts while retaining signed gross", async () => {
    writeFile.mockClear();
    const records = [sale, { ...sale, id: "manual", stockNumber: "MANUAL", unitCreditBasis: 1_000,
      frontGrossCents: 100_000, fiGrossCents: 20_000, frontCommissionOverrideCents: 50_000 }];
    await exportSalesWorkbook(records, settings(), "2026-08", true);
    const book = writeFile.mock.calls[0][0] as XLSX.WorkBook;
    const summary = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Monthly Summary"], { header: 1 });
    const metric = (label: string) => summary.find((row) => row[0] === label)?.[1];
    expect(metric("Front gross")).toBe(683.39);
    expect(metric("Commissionable front gross")).toBe(1000);
    expect(metric("Front commission")).toBe(650);
    expect(metric("F&I commission")).toBe(160);
    expect(metric("Estimated commission")).toBe(810);
    expect(metric("Mini deals")).toBe(1);
    expect(metric("Manual / spiff deals")).toBe(1);
    expect(metric("Front commission calculation")).toMatch(/Entered gross already represents your share/);
    for (const sheetName of ["Year Summary", "Weekly Performance"]) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheetName]);
      expect(rows).toContainEqual(expect.objectContaining({
        "Front Gross": 683.39, "Commissionable Front Gross": 1000,
        "Front Commission": 650, "F&I Commission": 160,
        "Mini Deals": 1, "Manual / Spiff Deals": 1,
      }));
    }
  });

  it("exports and restores personal manual amounts through the Sales Detail workbook", async () => {
    const original = { ...sale, frontCommissionOverrideCents: 50_000 };
    const summary = calculateMonth([original], "2026-08", getPayPlanSchedule(settings()));
    const rows = buildSalesDetailExportRows(summary.calculatedSales, true);
    expect(rows[0]).toMatchObject({
      "Front Gross": -316.61, "Manual Front Commission (Personal)": 500,
      "Front Commission": 500, "F&I Commission": 120, "Sale Commission": 620,
      "Front Commission Method": "Manual / spiff (personal amount)", "Payment Method": "Outside Finance",
    });
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Sales Detail");
    formatReportWorkbookNumbers(book);
    const file = new File([XLSX.write(book, { type: "array", bookType: "xlsx" })], "export.xlsx");
    const preview = await previewLegacyWorkbook(file);
    expect(preview.rejectedRows).toEqual([]);
    expect(preview.validSales[0]).toMatchObject({
      frontGrossCents: -31_661, frontCommissionOverrideCents: 50_000, unitCreditBasis: 500,
      fiGrossCents: 60_000, paymentMethod: "outside_financing", dealerFinanced: false,
    });
    expect(calculateMonth(preview.validSales, "2026-08", getPayPlanSchedule(settings())).frontCommissionCents).toBe(50_000);
  });

  it.each([null, 0, 65_000])("round-trips CSV override %s while keeping calculated front amounts informational", async (override) => {
    const csv = createMonthlyCsvContent([{ ...sale, frontCommissionOverrideCents: override }], settings(), "2026-08", true);
    const preview = await previewLegacyWorkbook(new File([csv], "report.csv", { type: "text/csv" }));
    expect(preview.rejectedRows).toEqual([]);
    expect(preview.validSales[0]).toMatchObject({ frontGrossCents: -31_661, frontCommissionOverrideCents: override });
    expect(preview.validSales[0].paymentMethod).toBe("outside_financing");
  });

  it("ignores old calculated commission columns without an explicit manual amount", async () => {
    const preview = await previewLegacyWorkbook(workbookFile([
      ["Delivery Date", "Stock Number", "Status", "Front Gross", "Front Commission", "Sale Commission", "Estimated Commission"],
      ["08/10/2026", "OLD", "Delivered", -1000, 99999, 88888, 77777],
    ]));
    expect(preview.validSales).toHaveLength(1);
    expect(preview.validSales[0]).not.toHaveProperty("frontCommissionOverrideCents");
    const summary = calculateMonth(preview.validSales, "2026-08", getPayPlanSchedule(settings()));
    expect(summary.frontGrossCents).toBe(-100_000);
    expect(summary.frontCommissionCents).toBe(30_000);
  });

  it("rejects malformed, negative, and excessive manual currency without losing valid zero or blank", async () => {
    const preview = await previewLegacyWorkbook(workbookFile([
      ["Delivery Date", "Stock Number", "Status", "Front Gross", "Manual Front Commission (Personal)"],
      ...["oops", -1, "123.456", 1_000_000.01, "Infinity", 0, ""].map((amount, index) =>
        ["08/10/2026", `M-${index}`, "Delivered", -1000, amount]),
    ]));
    expect(preview.rejectedRows).toHaveLength(5);
    expect(preview.rejectedRows.every((row) => /Manual front commission/.test(row.reason))).toBe(true);
    expect(preview.validSales.map((row) => row.frontCommissionOverrideCents)).toEqual([0, null]);
  });
});
