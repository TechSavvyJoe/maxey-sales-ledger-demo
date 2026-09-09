import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";
import { addPortableReportSheet } from "./portableReportSheet";

function monthlyBook() {
  const book = new Workbook();
  const monthly = book.addWorksheet("Monthly");
  monthly.getCell("A6").value = "2025-01";
  monthly.getCell("A7").value = "2026-09";
  monthly.getCell("C7").value = { formula: "12+8", result: 20 };
  monthly.getCell("I7").value = 0.35;
  monthly.getCell("J7").value = { formula: "10000+100", result: 10100 };
  monthly.getCell("K7").value = 2400;
  monthly.getCell("M7").value = 2100;
  monthly.getCell("N7").value = 14600;
  monthly.getCell("O7").value = null;
  monthly.getCell("P7").value = { formula: '""', result: "" };
  monthly.getCell("AH7").value = 12;
  monthly.getCell("AL7").value = 0.6;
  monthly.getCell("AN7").value = 10;
  monthly.getCell("AO7").value = 4;
  monthly.getCell("AP7").value = 6;
  return book;
}

describe("independent Excel monthly report", () => {
  it("opens the selected saved month with cached results, awaiting blanks and correct percentages", () => {
    const book = monthlyBook();
    addPortableReportSheet(book, "2026-09");
    const report = book.getWorksheet("Report")!;
    expect(report.getCell("B4").value).toBe("2026-09");
    expect(report.getCell("E7").result).toBe(20);
    expect(report.getCell("E19").result).toBe(0.35);
    expect(report.getCell("E20").result).toBe(10100);
    expect(report.getCell("E21").result).toBe(2400);
    expect(report.getCell("E22").result).toBe(2100);
    expect(report.getCell("E23").result).toBe(14600);
    expect(report.getCell("E24").result).toBe("");
    expect(report.getCell("E25").result).toBe("");
    expect(report.getCell("E31").result).toBe(0.6);
    expect(report.getCell("E32").result).toBe(12);
    expect(report.getCell("E36").result).toBe(0.5);
    expect(report.getCell("E37").result).toBe(0.2);
    expect(report.getCell("E38").result).toBe(0.3);
  });

  it("offers an offline month dropdown and every metric looks up that choice", () => {
    const book = monthlyBook();
    addPortableReportSheet(book, "2026-09");
    const report = book.getWorksheet("Report")!;
    expect(report.getCell("B4").dataValidation).toMatchObject({ type: "list", allowBlank: false, formulae: ["ReportMonths"] });
    expect(book.definedNames.getRanges("ReportMonths").ranges).toEqual(["Monthly!$A$6:$A$7"]);
    let formulas = 0;
    report.eachRow((row) => row.eachCell((cell) => {
      if (!cell.formula) return;
      formulas += 1;
      expect(cell.formula).toContain("MATCH($B$4");
      expect(cell.formula).not.toMatch(/https?:|\[\d+\]|TODAY|XLOOKUP/i);
    }));
    expect(formulas).toBeGreaterThan(30);
    expect(report.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(report.pageSetup.printArea).toBe("A1:F52");
    // ExcelJS's public types omit the row-break metadata exposed at runtime.
    expect((report as unknown as { rowBreaks: { id: number }[] }).rowBreaks)
      .toEqual([expect.objectContaining({ id: 29 })]);
  });

  it("falls back to the earliest exported month and leaves undefined ratios blank", () => {
    const book = monthlyBook();
    addPortableReportSheet(book, "2030-01");
    const report = book.getWorksheet("Report")!;
    expect(report.getCell("B4").value).toBe("2025-01");
    expect(report.getCell("E36").result).toBe("");
  });
});
