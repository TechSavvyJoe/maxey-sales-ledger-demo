import type { Cell, Workbook } from "exceljs";

const MONEY = '$#,##0.00;[Red]($#,##0.00);"—"';
const NUMBER = '#,##0.##;[Red](#,##0.##);"—"';
const PERCENT = '0.0%;[Red](0.0%);"—"';
const NAVY = "12344D", BLUE = "005CB9";

/** A compact, printable month chooser alongside the complete analysis tables. */
export function addPortableReportSheet(book: Workbook, preferredMonth: string): void {
  const monthly = book.getWorksheet("Monthly");
  if (!monthly || monthly.rowCount < 6) throw new Error("Monthly reporting is required for the Excel report.");
  const last = monthly.rowCount;
  let selectedRow = 6;
  for (let row = 6; row <= last; row += 1) if (monthly.getCell(row, 1).value === preferredMonth) selectedRow = row;
  const sheet = book.addWorksheet("Report", {
    views: [{ showGridLines: false, state: "frozen", ySplit: 5 }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.2 }, printTitlesRow: "1:5" },
  });
  sheet.columns = Array.from({ length: 6 }, () => ({ width: 16 }));
  sheet.properties.defaultRowHeight = 24;
  const merged = (address: string, text: string, size = 11, color = NAVY, bold = false) => {
    sheet.mergeCells(address);
    const cell = sheet.getCell(address.split(":")[0]);
    cell.value = text;
    cell.font = { name: "Arial", size, bold, color: { argb: color } };
    cell.alignment = { wrapText: true, vertical: "middle" };
    return cell;
  };
  const band = (row: number, title: string) => {
    const cell = merged(`A${row}:F${row}`, title, 12, NAVY, true);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5EEF5" } };
    sheet.getRow(row).height = 28;
  };
  const title = merged("A1:F1", "SALES LEDGER  /  MONTHLY REPORT", 20, "FFFFFF", true);
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  sheet.getRow(1).height = 38;
  merged("A2:F2", "Sales, F&I and earnings from your saved history. Choose any exported month below.", 11, "52677A");
  sheet.getRow(2).height = 30;
  sheet.getCell("A3").value = { text: "← Start here", hyperlink: "#'Start here'!A1" };
  sheet.getCell("A3").font = { name: "Arial", size: 11, color: { argb: BLUE }, underline: true };
  sheet.getCell("A4").value = "Report month";
  sheet.getCell("A4").font = { name: "Arial", size: 11, bold: true, color: { argb: NAVY } };
  sheet.mergeCells("B4:C4");
  const chooser = sheet.getCell("B4");
  chooser.value = monthly.getCell(selectedRow, 1).value;
  chooser.font = { name: "Arial", size: 14, bold: true, color: { argb: BLUE } };
  chooser.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3C7" } };
  chooser.border = { bottom: { style: "medium", color: { argb: BLUE } } };
  chooser.alignment = { vertical: "middle" };
  book.definedNames.add(`'Monthly'!$A$6:$A$${last}`, "ReportMonths");
  chooser.dataValidation = { type: "list", allowBlank: false, formulae: ["ReportMonths"], showErrorMessage: true,
    errorStyle: "stop", errorTitle: "Choose an exported month", error: "Choose a month from the dropdown.",
    showInputMessage: true, promptTitle: "Your saved history", prompt: "Changing this month updates the report below. It does not change your app." };
  merged("D4:F4", "Use the dropdown in the yellow cell", 10, "52677A");
  sheet.getRow(4).height = 34;

  const sourceExpression = (col: string) => `INDEX('Monthly'!$${col}$6:$${col}$${last},MATCH($B$4,'Monthly'!$A$6:$A$${last},0))`;
  const sourceValue = (col: string): number | string => {
    const cell = monthly.getCell(`${col}${selectedRow}`);
    const value = cell.formula ? cell.result : cell.value;
    return typeof value === "number" || typeof value === "string" ? value : "";
  };
  const setFormula = (cell: Cell, expr: string, result: number | string, numberFormat: string) => {
    cell.value = { formula: expr, result };
    cell.numFmt = numberFormat;
    cell.font = { name: "Arial", size: 12, bold: true, color: { argb: "176148" } };
    cell.alignment = { horizontal: "right", vertical: "middle" };
  };
  const metric = (row: number, label: string, col: string, numberFormat = NUMBER, divideBy?: string) => {
    merged(`A${row}:D${row}`, label, 11);
    sheet.mergeCells(`E${row}:F${row}`);
    const expression = sourceExpression(col), value = sourceValue(col);
    const denominator = divideBy ? Number(sourceValue(divideBy)) : 0;
    setFormula(sheet.getCell(`E${row}`), divideBy
      ? `IFERROR(IF(${sourceExpression(divideBy)}>0,${expression}/${sourceExpression(divideBy)},""),"")`
      : `IFERROR(IF(${expression}="","",${expression}),"")`, divideBy ? denominator > 0 ? Number(value) / denominator : "" : value, numberFormat);
    for (let c = 1; c <= 6; c += 1) sheet.getCell(row, c).border = { bottom: { style: "hair", color: { argb: "DCE5ED" } } };
  };
  band(6, "SALES & PACE");
  metric(7, "Delivered vehicles", "C");
  metric(8, "Credited units · splits included", "D");
  metric(9, "Monthly delivery goal", "Q");
  metric(10, "Deliveries still needed", "V");
  metric(11, "Needed per remaining workday · rounded up", "W");
  metric(12, "Paced month-end deliveries · rounded up", "X");
  metric(13, "Workdays remaining", "U");
  band(15, "GROSS & COMMISSION");
  metric(16, "Front gross", "F", MONEY);
  metric(17, "Total F&I gross entered", "G", MONEY);
  metric(18, "Combined gross", "H", MONEY);
  metric(19, "Front commission rate", "I", PERCENT);
  metric(20, "Front commission · Mini and spiffs included", "J", MONEY);
  metric(21, "F&I commission", "K", MONEY);
  metric(22, "Volume bonus", "M", MONEY);
  metric(23, "Estimated total commission", "N", MONEY);
  sheet.getRow(23).height = 30;
  metric(24, "Actual paid", "O", MONEY);
  metric(25, "Paid minus estimated", "P", MONEY);
  metric(26, "Month-end commission · lower estimate", "AQ", MONEY);
  metric(27, "Month-end commission · upper estimate", "AR", MONEY);
  metric(28, "Monthly commission goal", "R", MONEY);
  band(30, "F&I & PAYMENT MIX");
  metric(31, "Finance Penetration", "AL", PERCENT);
  metric(32, "Finance deliveries", "AH");
  metric(33, "Cash deliveries", "AI");
  metric(34, "Outside Finance deliveries", "AJ");
  metric(35, "Payment method not specified", "AK");
  metric(36, "Service contract / warranty penetration", "AN", PERCENT, "C");
  metric(37, "Tire & Wheel penetration", "AO", PERCENT, "C");
  metric(38, "GAP penetration · all deliveries", "AP", PERCENT, "C");
  metric(39, "Deliveries with one or more products", "AM", NUMBER);
  metric(40, "Total products sold", "AF");
  metric(41, "Products per delivery", "AG");
  metric(42, "F&I gross per delivered vehicle", "Z", MONEY);
  metric(43, "F&I amounts entered", "AB");
  metric(44, "F&I amounts awaiting", "AC");
  band(46, "READING THIS REPORT");
  merged("A47:F48", "Commission is estimated from recorded amounts. Blank means not entered or not available; a dash in a numeric cell means zero. F&I can be entered next month. Product percentages use all counted deliveries.", 10, "52677A");
  merged("A49:F50", "Pace is fixed to the workbook’s export date. For completed months, review final recorded results. See Weekly, Products, Payment mix and Commissions for detailed analysis and Metric guide for definitions.", 10, "52677A");
  merged("A51:F52", "This independent file works without the app. Changing the report month is safe; changing sales, dates or pay-plan structure requires checking the model. Cloud syncing, sign-in and app recovery are not part of Excel.", 10, "52677A");
  // ExcelJS breaks after the chosen row. Keep the F&I heading with its data.
  sheet.getRow(29).addPageBreak();
  sheet.pageSetup.printArea = "A1:F52";
  sheet.headerFooter.oddFooter = "&LSales Ledger · Monthly report&CPage &P of &N&RIndependent export";
}
