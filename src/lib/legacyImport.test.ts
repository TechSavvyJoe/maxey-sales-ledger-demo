import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { previewLegacyWorkbook } from "@/lib/legacyImport";

describe("legacy workbook import", () => {
  it("maps entry fields, ignores the example row, and rejects invalid rows", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Enter Sales"],
      ["Delivery / Expected Date", "Customer Last Name", "Stock #", "Vehicle", "Status", "Unit Credit", "Front Gross", "F&I Gross", "Warranty", "T&W", "GAP", "Dealer Financed", "Calculated"],
      ["8/6/2026", "SAMPLE", "STK-0001", "2021 Ford Escape", "Example", 1, 2500, 600, "Y", "Y", "Y", "Y", "ignore"],
      ["8/8/2026", "Miller", "00123", "2023 Ford F-150", "Delivered", 0.5, 3000, 800, "Yes", "X", "N", 1, "ignore"],
      ["8/9/2026", "Blank", "00124", "2023 Ford Escape", "Delivered", 1, 2500, 500, "", "", "", "", "ignore"],
      ["not a date", "Bad", "BAD", "Vehicle", "Delivered", 1, 1000, 100, "N", "N", "N", "N", "ignore"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Enter Sales");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const file = new File([bytes], "legacy.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const preview = await previewLegacyWorkbook(file);
    expect(preview.validSales).toHaveLength(2);
    expect(preview.rejectedRows).toHaveLength(1);
    expect(preview.validSales[0]).toMatchObject({
      saleDate: "2026-08-08",
      customerLastName: "Miller",
      stockNumber: "00123",
      status: "delivered",
      unitCreditBasis: 500,
      frontGrossCents: 300_000,
      fiGrossCents: 80_000,
      serviceContractSold: true,
      tireWheelSold: true,
      gapSold: false,
      dealerFinanced: true,
      source: "legacy-xlsx",
    });
    expect(preview.validSales[1]).toMatchObject({
      stockNumber: "00124",
      serviceContractSold: undefined,
      tireWheelSold: undefined,
      gapSold: undefined,
      dealerFinanced: undefined,
    });
  });

  it("rejects rows before coverage while accepting the exact earliest month", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Delivery Date", "Customer Last Name", "Stock #", "Vehicle", "Status", "Unit Credit", "Front Gross", "F&I Gross"],
      ["12/15/2025", "Older", "OLD-1", "2022 Ford Escape", "Delivered", 1, 2000, 400],
      ["1/2/2026", "Boundary", "BOUNDARY-1", "2023 Ford Escape", "Delivered", 1, 2500, 500],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Enter Sales");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const file = new File([bytes], "historical.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const preview = await previewLegacyWorkbook(file, "2026-01");
    expect(preview.validSales.map((item) => item.stockNumber)).toEqual(["BOUNDARY-1"]);
    expect(preview.rejectedRows).toEqual([
      expect.objectContaining({
        row: 2,
          reason: expect.stringMatching(/Add an older pay plan beginning 2025-12 or earlier/),
      }),
    ]);
    expect(preview.validSales[0]).toMatchObject({
      serviceContractSold: undefined,
      tireWheelSold: undefined,
      gapSold: undefined,
      dealerFinanced: undefined,
    });
  });

  it("skips undelivered workbook rows with a clear import warning", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Delivery Date", "Customer Last Name", "Stock #", "Vehicle", "Status", "Unit Credit", "Front Gross", "F&I Gross"],
      ["8/10/2026", "Delivered", "KEEP-1", "2023 Ford Escape", "Delivered", 1, 2500, 500],
      ["8/11/2026", "Void", "SKIP-1", "2023 Ford Escape", "Void", 1, 2500, 500],
      ["8/12/2026", "Unwound", "SKIP-2", "2023 Ford Escape", "Unwound", 1, 2500, 500],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Enter Sales");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const file = new File([bytes], "undelivered.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const preview = await previewLegacyWorkbook(file);

    expect(preview.validSales.map((sale) => sale.stockNumber)).toEqual(["KEEP-1"]);
    expect(preview.rejectedRows).toEqual([]);
    expect(preview.warnings).toEqual([
      expect.stringMatching(/2 undelivered rows were skipped \(row 3, row 4\).*Keep only Delivered or Pending sales/i),
    ]);
  });
});
