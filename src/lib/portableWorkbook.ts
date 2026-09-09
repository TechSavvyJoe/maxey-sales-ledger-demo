import type { Cell, CellValue, Workbook, Worksheet } from "exceljs";
import { calculateFrontCommission, calculateMonth } from "@/domain/commission";
import { isValidDateOnly, shiftMonth, todayDateOnly } from "@/domain/date";
import { getPaymentMethod } from "@/domain/financing";
import { getCommissionGoalForMonth, getDeliveryGoalForMonth } from "@/domain/goals";
import { getMinimumFrontCommissionCents, getPayPlanForMonth, getPayPlanSchedule, hasPayPlanCoverage } from "@/domain/payPlan";
import { calculateCommissionRunRate } from "@/domain/performance";
import { calculateWorkdayPace, getWorkScheduleDays, isSunday, normalizeDaysOffForMonth } from "@/domain/pacing";
import { calculateWeeklyPerformance } from "@/domain/weeklyPerformance";
import type { AuditEvent, CalculatedSale, MonthSummary, ProfileSettings, Sale } from "@/domain/types";
import { addPortableReportSheet } from "./portableReportSheet";

export interface PortableWorkbookSnapshot { settings: ProfileSettings; sales: Sale[]; auditEvents: AuditEvent[] }

const FIRST = 6;
const MONEY = '$#,##0.00;[Red]($#,##0.00);"—"';
const INPUT_MONEY = '$#,##0.00;[Red]($#,##0.00);$0.00';
const NUMBER = '#,##0.##;[Red](#,##0.##);"—"';
const PERCENT = '0.0%;[Red](0.0%);"—"';
const BLUE = "005CB9", NAVY = "12344D", GREEN = "176148", GRAY = "52677A";
const paymentLabels: Record<ReturnType<typeof getPaymentMethod>, string> = {
  dealer_financed: "Finance", cash: "Cash", outside_financing: "Outside Finance",
  not_dealer_financed: "Cash / outside not specified", unmarked: "Not marked",
};

function column(index: number): string {
  let name = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}
function dollars(cents: number | null | undefined): number | null { return cents == null ? null : cents / 100; }
function dateCell(value: string): Date | string { return isValidDateOnly(value) ? new Date(`${value}T00:00:00.000Z`) : value; }
function yesNo(value: boolean | undefined): string { return value === undefined ? "Not marked" : value ? "Yes" : "No"; }
function sum(items: CalculatedSale[], pick: (item: CalculatedSale) => number): number { return items.reduce((total, item) => total + pick(item), 0); }
function ratio(value: number, total: number): number | string { return total > 0 ? value / total : ""; }
// The app uses Math.round for averages/projections (ties toward +Infinity),
// but commission rates use half-away-from-zero. Keep those conventions separate.
function averageFormula(totalDollars: string, denominator: string): string { return `INT(ROUND((${totalDollars})*100,0)/(${denominator})+0.5)/100`; }
function range(sheet: string, col: string, end: number): string { return `'${sheet}'!$${col}$${FIRST}:$${col}$${Math.max(FIRST, end)}`; }
function ref(sheet: string, col: string, row: number): string { return `'${sheet}'!${col}${row}`; }
function formula(cell: Cell, expression: string, result: number | string, format?: string) {
  if (typeof result === "number" && !Number.isFinite(result)) throw new Error("A workbook calculation was not finite. No file was created.");
  cell.value = { formula: expression, result: result === 0 ? 0 : result };
  cell.font = { name: "Arial", size: 10, color: { argb: expression.includes("!") ? GREEN : "182D3D" } };
  if (format) cell.numFmt = format;
}
function input(cell: Cell, value: CellValue, format?: string) {
  // ExcelJS writes a string as a string, even when it begins with =, +, - or @.
  // User text is never interpolated into a formula or hyperlink target.
  if (typeof value === "string" && value.length > 32767) throw new Error("A saved text field exceeds Excel’s cell limit. Download the JSON data file to preserve the complete text.");
  cell.value = value;
  cell.font = { name: "Arial", size: 10, color: { argb: BLUE } };
  if (format) cell.numFmt = format === MONEY ? INPUT_MONEY : format;
}
function makeSheet(book: Workbook, name: string, title: string, note: string, headers: string[], widths: number[] = []): Worksheet {
  const sheet = book.addWorksheet(name, { properties: { defaultRowHeight: 18 }, views: [{ state: "frozen", ySplit: 5, xSplit: name === "Sales" || name === "Commissions" ? 3 : 1 }], pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:5", margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } } });
  const span = Math.min(headers.length, 8);
  sheet.mergeCells(1, 1, 1, Math.max(2, span));
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { name: "Arial", size: 20, bold: true, color: { argb: "FFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  sheet.getRow(1).height = 34;
  sheet.mergeCells(2, 1, 2, Math.max(2, span));
  sheet.getCell("A2").value = note;
  sheet.getCell("A2").alignment = { wrapText: true, vertical: "middle" };
  sheet.getCell("A2").font = { name: "Arial", size: 10, color: { argb: GRAY } };
  sheet.getRow(2).height = 34;
  sheet.getCell("A3").value = { text: "← Start here", hyperlink: "#'Start here'!A1" };
  sheet.getCell("A3").font = { name: "Arial", size: 10, bold: true, color: { argb: BLUE }, underline: true };
  headers.forEach((label, i) => {
    const cell = sheet.getCell(5, i + 1);
    cell.value = label;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: NAVY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5EEF5" } };
    cell.alignment = { wrapText: true, vertical: "middle" };
    sheet.getColumn(i + 1).width = widths[i] ?? 18;
  });
  sheet.getRow(5).height = 34;
  sheet.headerFooter.oddFooter = "&LSales Ledger · Independent workbook&C&P of &N&RExported snapshot";
  return sheet;
}
function finishSheet(sheet: Worksheet, width: number) {
  const end = Math.max(FIRST, sheet.rowCount);
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: end, column: width } };
  sheet.pageSetup.printArea = `A1:${column(width)}${end}`;
  sheet.eachRow((row, index) => {
    if (index < FIRST) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: "top", wrapText: false, ...cell.alignment };
      if (index % 2 === 0 && !cell.fill?.type) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "F4F7FA" } };
      cell.border = { bottom: { style: "hair", color: { argb: "DCE5ED" } } };
    });
  });
}
async function yieldToBrowser() { await new Promise<void>((resolve) => setTimeout(resolve, 0)); }

/** Builds an independent calculation/report workbook, not an app or cloud backup service. */
export async function buildPortableWorkbook(snapshot: PortableWorkbookSnapshot, exportedAt = new Date()): Promise<Workbook> {
  const { Workbook: ExcelWorkbook } = await import("exceljs");
  const { settings, sales } = snapshot;
  const asOfDate = todayDateOnly();
  const plans = getPayPlanSchedule(settings);
  const active = sales.filter((sale) => !sale.deletedAt).sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const sale of active) {
    if (isValidDateOnly(sale.saleDate) && !hasPayPlanCoverage(plans, sale.saleDate.slice(0, 7))) {
      throw new Error(`The saved pay plans do not cover ${sale.saleDate.slice(0, 7)}. Add the missing historical pay plan before downloading Excel. Your JSON data file remains available.`);
    }
  }
  const savedSettingMonths = [...Object.keys(settings.actualPaidByMonth), ...Object.keys(settings.daysOffByMonth), ...Object.keys(settings.deliveryGoalsByMonth ?? {}), ...Object.keys(settings.commissionGoalsByMonth ?? {})];
  for (const month of savedSettingMonths) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month) && !hasPayPlanCoverage(plans, month)) throw new Error(`Saved payroll, goals or days off in ${month} are not covered by a saved pay plan. Add that historical plan before downloading Excel. Your JSON data file remains available.`);
  }
  const relevantMonths = [settings.selectedMonth, asOfDate.slice(0, 7), ...active.filter((sale) => isValidDateOnly(sale.saleDate)).map((sale) => sale.saleDate.slice(0, 7)), ...Object.keys(settings.actualPaidByMonth), ...Object.keys(settings.daysOffByMonth), ...Object.keys(settings.deliveryGoalsByMonth ?? {}), ...Object.keys(settings.commissionGoalsByMonth ?? {})].filter((key) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key)).sort();
  const start = `${relevantMonths[0].slice(0, 4)}-01`, end = `${relevantMonths.at(-1)!.slice(0, 4)}-12`;
  const months: string[] = [];
  for (let month = start; month <= end; month = shiftMonth(month, 1)) if (hasPayPlanCoverage(plans, month)) months.push(month);
  if (months.length === 0) throw new Error("No saved pay plan covers the reporting period. Add the applicable plan before downloading Excel.");
  const summaries = months.map((month) => calculateMonth(sales, month, plans, settings.actualPaidByMonth[month] ?? null));
  const calculated = new Map(summaries.flatMap((summary) => summary.calculatedSales.map((item) => [item.sale.id, item] as const)));
  const monthRows = new Map(months.map((month, index) => [month, FIRST + index]));
  const saleRows = new Map(active.map((sale, index) => [sale.id, FIRST + index]));
  const lastSale = Math.max(FIRST, FIRST + active.length - 1), lastMonth = FIRST + months.length - 1;
  const book = new ExcelWorkbook();
  book.creator = "Sales Ledger"; book.title = "Sales Ledger · Complete saved history";
  book.subject = "Independent sales, commission and performance workbook";
  book.created = exportedAt; book.modified = exportedAt;
  book.calcProperties.fullCalcOnLoad = true;
  const index = book.addWorksheet("Start here", { views: [{ showGridLines: false }], pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  index.columns = [{ width: 33 }, { width: 45 }, { width: 35 }, { width: 30 }];
  index.mergeCells("A1:D1"); index.getCell("A1").value = "SALES LEDGER  /  YOUR COMPLETE HISTORY";
  index.getCell("A1").font = { name: "Arial", size: 22, bold: true, color: { argb: "FFFFFF" } };
  index.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; index.getRow(1).height = 40;
  index.mergeCells("A2:D2"); index.getCell("A2").value = "Your saved information and reports, available without Sales Ledger or an internet connection.";
  [ [4, "Salesperson", settings.salespersonName], [5, "Store", settings.storeName], [6, "Exported at (UTC)", exportedAt.toISOString()], [7, "Reporting period", `${months[0]} through ${months.at(-1)}`], [8, "Calculated as of (Detroit)", dateCell(asOfDate)] ].forEach(([row, label, value]) => { input(index.getCell(Number(row), 1), label as string); input(index.getCell(Number(row), 2), value as CellValue, Number(row) === 8 ? "mm/dd/yyyy" : undefined); });
  index.getCell("B8").note = "Captured date, not TODAY(). Forecasts remain an honest snapshot when this file is opened later.";

  const planSheet = makeSheet(book, "Pay plans", "Pay plans", "Saved plan history. Rates and Mini are referenced by formulas; plan selection is captured for each reporting month.", ["Effective month", "Plan name", "Base front rate", "Higher front rate", "Higher rate above", "F&I rate", "Mini"], [17, 42]);
  plans.forEach((plan, i) => [plan.effectiveMonth, plan.version, plan.baseFrontRateBps / 10000, plan.acceleratedFrontRateBps / 10000, plan.acceleratedThresholdExclusive, plan.fiRateBps / 10000, getMinimumFrontCommissionCents(plan) / 100].forEach((value, j) => input(planSheet.getCell(FIRST + i, j + 1), value, [2, 3, 5].includes(j) ? PERCENT : j === 6 ? MONEY : undefined)));
  const bonusSheet = makeSheet(book, "Bonus tiers", "Volume bonus schedule", "Bonus added is incremental; running bonus is cumulative. Monthly totals include each earned increment once.", ["Plan effective month", "Delivered milestone", "Running bonus", "Bonus added", "Plan name"]);
  let bonusRow = FIRST;
  plans.forEach((plan) => plan.bonusTiers.forEach((tier, i) => {
    input(bonusSheet.getCell(bonusRow, 1), plan.effectiveMonth); input(bonusSheet.getCell(bonusRow, 2), tier.minimumDelivered);
    input(bonusSheet.getCell(bonusRow, 3), tier.amountCents / 100, MONEY);
    formula(bonusSheet.getCell(bonusRow, 4), i === 0 ? `C${bonusRow}` : `C${bonusRow}-C${bonusRow - 1}`, (tier.amountCents - (plan.bonusTiers[i - 1]?.amountCents ?? 0)) / 100, MONEY);
    input(bonusSheet.getCell(bonusRow, 5), plan.version); bonusRow += 1;
  }));
  const lastBonus = Math.max(FIRST, bonusRow - 1);
  const schedule = makeSheet(book, "Work schedule", "Work schedule & days off", "Monday–Saturday are open. Sundays and recorded personal days off are excluded. This calendar covers the reporting period.", ["Date", "Month", "Weekday", "Personal day off", "Scheduled workday", "Elapsed as of export"]);
  let scheduleRow = FIRST;
  for (const month of months) {
    const off = new Set(normalizeDaysOffForMonth(month, settings.daysOffByMonth[month] ?? []));
    for (const day of getWorkScheduleDays(month)) {
      input(schedule.getCell(scheduleRow, 1), dateCell(day.date), "mm/dd/yyyy"); input(schedule.getCell(scheduleRow, 2), month);
      input(schedule.getCell(scheduleRow, 3), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day.weekdayIndex]);
      input(schedule.getCell(scheduleRow, 4), off.has(day.date) ? "Yes" : "No");
      schedule.getCell(scheduleRow, 4).dataValidation = { type: "list", allowBlank: false, formulae: ['"Yes,No"'], showErrorMessage: true, errorStyle: "stop", error: "Choose Yes or No." };
      formula(schedule.getCell(scheduleRow, 5), `IF(OR(WEEKDAY(A${scheduleRow},2)=7,D${scheduleRow}="Yes"),0,1)`, !day.isSunday && !off.has(day.date) ? 1 : 0, NUMBER);
      formula(schedule.getCell(scheduleRow, 6), `IF(A${scheduleRow}<='Start here'!$B$8,E${scheduleRow},0)`, !day.isSunday && !off.has(day.date) && day.date <= asOfDate ? 1 : 0, NUMBER);
      scheduleRow += 1;
    }
  }
  const lastSchedule = scheduleRow - 1;
  await yieldToBrowser();
  const saleHeaders = ["Customer last name", "Vehicle", "Stock number", "Delivery / expected date", "Status", "Deal credit", "Front gross", "Total F&I gross", "Manual front / spiff payout", "Payment method", "Service contract / warranty", "Tire & Wheel", "GAP", "Notes", "Sale ID", "Created at (UTC)", "Updated at (UTC)", "Revision", "Source", "Source reference", "Original payment value", "Original finance flag", "Month at export", "Counts at export", "Delivery order at export", "Review notes at export", "Profile ID", "Original status", "Non-Sunday date"];
  const saleSheet = makeSheet(book, "Sales", "All active saved sales", "Blue values are your saved inputs. Blank gross means not received yet, not $0. Gross is your personal share; a manual payout is not split again. Inclusion and order are verified export snapshots.", saleHeaders, [23, 36, 20, 22, 16, 13, 18, 18, 22, 26, 24, 17, 13, 48]);
  const calcHeaders = ["Customer last name", "Vehicle", "Stock number", "Delivery date", "Month", "Counted", "Delivery order", "Front rate", "F&I rate", "Mini (full deal)", "Prorated Mini", "Commissionable front gross", "Front commission", "F&I commission", "Sale commission", "Front pay method", "Front at base rate", "Front at higher rate", "Rate uplift on this sale", "Bonus unlocked", "Retro on prior sales", "Additional unlocked", "Sale + milestone impact", "Front amount missing", "F&I amount missing", "Automatic front at base", "Automatic front at higher", "Plan effective month"];
  const calcSheet = makeSheet(book, "Commissions", "Sale-by-sale commission", "Sale commission = front + F&I. Milestone impact is explanatory, not another payable amount. Negative front gross cannot reduce another sale’s pay.", calcHeaders, [23, 34, 20, 18, 15]);
  const sRange = (col: string) => range("Sales", col, lastSale), cRange = (col: string) => range("Commissions", col, lastSale);
  const bonusFormula = (planRef: string, countRef: string) => `SUMIFS(${range("Bonus tiers", "D", lastBonus)},${range("Bonus tiers", "A", lastBonus)},${planRef},${range("Bonus tiers", "B", lastBonus)},"<="&${countRef})`;
  for (let i = 0; i < active.length; i += 1) {
    const sale = active[i], row = FIRST + i, item = calculated.get(sale.id), month = item?.monthKey ?? (isValidDateOnly(sale.saleDate) ? sale.saleDate.slice(0, 7) : ""), monthlyRow = monthRows.get(month);
    const values: CellValue[] = [sale.customerLastName, sale.vehicleDescription, sale.stockNumber, dateCell(sale.saleDate), sale.status === "delivered" ? "Delivered" : sale.status === "pending" ? "Pending" : "Legacy record", sale.unitCreditBasis / 1000, dollars(sale.frontGrossCents), dollars(sale.fiGrossCents), dollars(sale.frontCommissionOverrideCents), paymentLabels[getPaymentMethod(sale)], yesNo(sale.serviceContractSold), yesNo(sale.tireWheelSold), yesNo(sale.gapSold), sale.notes, sale.id, sale.createdAt, sale.updatedAt, sale.revision, sale.source ?? "", sale.sourceReference ?? "", sale.paymentMethod ?? "", sale.dealerFinanced === undefined ? "Not marked" : sale.dealerFinanced ? "Yes" : "No", month, item?.countsTowardVolume ? 1 : 0, item?.deliveryOrdinal ?? null, item?.flags.map((flag) => flag.label).join("; ") ?? "Invalid date — excluded from calculations"];
    values.forEach((value, j) => input(saleSheet.getCell(row, j + 1), value, j === 3 ? "mm/dd/yyyy" : [6, 7, 8].includes(j) ? MONEY : j === 5 ? NUMBER : undefined));
    input(saleSheet.getCell(row, 27), sale.profileId); input(saleSheet.getCell(row, 28), sale.status);
    formula(saleSheet.getCell(row, 29), `IF(ISNUMBER(D${row}),IF(WEEKDAY(D${row},2)<>7,1,0),0)`, isValidDateOnly(sale.saleDate) && !isSunday(sale.saleDate) ? 1 : 0, NUMBER);
    [11, 12, 13].forEach((col) => { saleSheet.getCell(row, col).dataValidation = { type: "list", allowBlank: false, formulae: ['"Yes,No,Not marked"'], showErrorMessage: true, errorStyle: "stop", error: "Choose Yes, No, or Not marked." }; });
    saleSheet.getCell(row, 10).dataValidation = { type: "list", allowBlank: false, formulae: [`"${Object.values(paymentLabels).join(",")}"`], showErrorMessage: true, errorStyle: "stop", error: "Choose a listed payment method." };
    saleSheet.getCell(row, 14).alignment = { wrapText: true }; saleSheet.getRow(row).height = sale.notes.length > 80 ? 42 : 30;
    ["A", "B", "C", "D", "W", "X", "Y"].forEach((col, j) => {
      const value = values[[0, 1, 2, 3, 22, 23, 24][j]];
      if (value instanceof Date) { formula(calcSheet.getCell(row, j + 1), ref("Sales", col, row), (value.getTime() / 86400000) + 25569, "mm/dd/yyyy"); }
      else formula(calcSheet.getCell(row, j + 1), `IF(${ref("Sales", col, row)}="","",${ref("Sales", col, row)})`, (value ?? "") as string | number);
    });
    const plan = monthlyRow ? getPayPlanForMonth(plans, month) : plans[0];
    // getPayPlanForMonth returns schedule members; effective month is the stable lookup.
    const planRow = FIRST + plans.findIndex((candidate) => candidate.effectiveMonth === plan.effectiveMonth);
    formula(calcSheet.getCell(row, 8), monthlyRow ? ref("Monthly", "I", monthlyRow) : "0", item ? item.frontRateBps / 10000 : 0, PERCENT);
    formula(calcSheet.getCell(row, 9), ref("Pay plans", "F", planRow), plan.fiRateBps / 10000, PERCENT);
    formula(calcSheet.getCell(row, 10), ref("Pay plans", "G", planRow), getMinimumFrontCommissionCents(plan) / 100, MONEY);
    formula(calcSheet.getCell(row, 11), `ROUND(J${row}*${ref("Sales", "F", row)},2)`, item ? item.minimumFrontCommissionCents / 100 : getMinimumFrontCommissionCents(plan) * sale.unitCreditBasis / 100000, MONEY);
    formula(calcSheet.getCell(row, 12), `IF(F${row}=1,MAX(0,${ref("Sales", "G", row)}),0)`, dollars(item?.commissionableFrontGrossCents) ?? 0, MONEY);
    const frontPay = (rate: string, manual = true) => `IF(F${row}<>1,0,${manual ? `IF(ISNUMBER(${ref("Sales", "I", row)}),${ref("Sales", "I", row)},` : ""}IF(ISNUMBER(${ref("Sales", "G", row)}),MAX(ROUND(MAX(0,${ref("Sales", "G", row)})*${rate},2),K${row}),0)${manual ? ")" : ""})`;
    formula(calcSheet.getCell(row, 13), frontPay(`H${row}`), dollars(item?.frontCommissionCents) ?? 0, MONEY);
    const fiTotal = `ROUND(SUMIFS(${sRange("H")},${sRange("W")},E${row},${sRange("X")},1)*I${row},2)`;
    const priorFi = row === FIRST ? "0" : `SUMIFS('Commissions'!$N$${FIRST}:N${row - 1},'Commissions'!$E$${FIRST}:E${row - 1},E${row})`;
    const laterCount = `SUMIFS('Commissions'!F${row}:$F$${lastSale},'Commissions'!E${row}:$E$${lastSale},E${row})`;
    formula(calcSheet.getCell(row, 14), `IF(F${row}<>1,0,IF(${laterCount}=1,${fiTotal}-${priorFi},ROUND(N(${ref("Sales", "H", row)})*I${row},2)))`, dollars(item?.fiCommissionCents) ?? 0, MONEY);
    formula(calcSheet.getCell(row, 15), `SUM(M${row}:N${row})`, dollars(item?.estimatedCommissionCents) ?? 0, MONEY);
    const method = item?.frontCommissionMethod ?? "excluded";
    formula(calcSheet.getCell(row, 16), `IF(F${row}<>1,"Excluded",IF(ISNUMBER(${ref("Sales", "I", row)}),"Manual / spiff",IF(NOT(ISNUMBER(${ref("Sales", "G", row)})),"Awaiting gross",IF(AND(K${row}>0,ROUND(L${row}*H${row},2)<=K${row}),"Mini","Percentage"))))`, { excluded: "Excluded", manual: "Manual / spiff", awaiting: "Awaiting gross", mini: "Mini", percentage: "Percentage" }[method]);
    const low = item?.countsTowardVolume ? calculateFrontCommission(sale, plan.baseFrontRateBps, plan).frontCommissionCents / 100 : 0;
    const high = item?.countsTowardVolume ? calculateFrontCommission(sale, plan.acceleratedFrontRateBps, plan).frontCommissionCents / 100 : 0;
    formula(calcSheet.getCell(row, 17), frontPay(ref("Pay plans", "C", planRow)), low, MONEY);
    formula(calcSheet.getCell(row, 18), frontPay(ref("Pay plans", "D", planRow)), high, MONEY);
    formula(calcSheet.getCell(row, 19), `R${row}-Q${row}`, high - low, MONEY);
    formula(calcSheet.getCell(row, 28), ref("Pay plans", "A", planRow), plan.effectiveMonth);
    formula(calcSheet.getCell(row, 20), `IF(F${row}=1,SUMIFS(${range("Bonus tiers", "D", lastBonus)},${range("Bonus tiers", "A", lastBonus)},AB${row},${range("Bonus tiers", "B", lastBonus)},G${row}),0)`, dollars(item?.milestone?.bonusAddedCents) ?? 0, MONEY);
    const priorRetro = row === FIRST ? "0" : `SUMIFS('Commissions'!$S$${FIRST}:S${row - 1},'Commissions'!$E$${FIRST}:E${row - 1},E${row})`;
    formula(calcSheet.getCell(row, 21), `IF(AND(F${row}=1,G${row}=${ref("Pay plans", "E", planRow)}+1,${ref("Pay plans", "D", planRow)}>${ref("Pay plans", "C", planRow)}),${priorRetro},0)`, dollars(item?.milestone?.priorSalesRetroactiveCents) ?? 0, MONEY);
    formula(calcSheet.getCell(row, 22), `T${row}+U${row}`, dollars(item?.milestone?.extraEarningsUnlockedCents) ?? 0, MONEY);
    formula(calcSheet.getCell(row, 23), `IF(OR(V${row}>0,AND(F${row}=1,G${row}=${ref("Pay plans", "E", planRow)}+1,${ref("Pay plans", "D", planRow)}>${ref("Pay plans", "C", planRow)})),O${row}+V${row},0)`, dollars(item?.milestone?.totalMilestoneImpactCents) ?? 0, MONEY);
    formula(calcSheet.getCell(row, 24), `IF(AND(F${row}=1,NOT(ISNUMBER(${ref("Sales", "G", row)})),NOT(ISNUMBER(${ref("Sales", "I", row)}))),1,0)`, item?.countsTowardVolume && sale.frontGrossCents === null && sale.frontCommissionOverrideCents == null ? 1 : 0, NUMBER);
    formula(calcSheet.getCell(row, 25), `IF(AND(F${row}=1,NOT(ISNUMBER(${ref("Sales", "H", row)}))),1,0)`, item?.countsTowardVolume && sale.fiGrossCents === null ? 1 : 0, NUMBER);
    formula(calcSheet.getCell(row, 26), frontPay(ref("Pay plans", "C", planRow), false), item?.countsTowardVolume ? calculateFrontCommission({ ...sale, frontCommissionOverrideCents: null }, plan.baseFrontRateBps, plan).frontCommissionCents / 100 : 0, MONEY);
    formula(calcSheet.getCell(row, 27), frontPay(ref("Pay plans", "D", planRow), false), item?.countsTowardVolume ? calculateFrontCommission({ ...sale, frontCommissionOverrideCents: null }, plan.acceleratedFrontRateBps, plan).frontCommissionCents / 100 : 0, MONEY);
    if (i % 150 === 149) await yieldToBrowser();
  }
  const monthlyHeaders = ["Month", "Year", "Delivered", "Credited units", "Pending", "Front gross", "Total F&I gross", "Combined gross", "Front rate", "Front commission", "F&I commission", "Sale commission", "Volume bonus", "Estimated commission", "Actual paid", "Payroll variance", "Delivery goal", "Commission goal", "Scheduled workdays", "Elapsed workdays", "Remaining workdays", "Deliveries to goal", "Needed per workday", "Paced deliveries (rounded up)", "Front gross / delivery", "F&I gross / delivery", "Commission / delivery", "F&I amounts entered", "F&I amounts awaiting", "Mini deals", "Manual / spiff deals", "Products sold", "Products / delivery", "Finance", "Cash", "Outside Finance", "Payment not specified", "Finance Penetration", "1+ products", "Service contracts", "Tire & Wheel", "GAP", "Projected commission low", "Projected commission high", "Plan effective month", "Front amounts awaiting"];
  const monthly = makeSheet(book, "Monthly", "Monthly performance & earnings", "All represented calendar months. Blank F&I average means no amount entered; partial figures use recorded gross. Forecasts use recorded gross and pay mix, not guarantees. Actual paid is entered payroll.", monthlyHeaders);
  const monthSum = (col: string, row: number, sheet = "Commissions") => `SUMIFS(${range(sheet, col, lastSale)},${range(sheet, sheet === "Sales" ? "W" : "E", lastSale)},A${row}${sheet === "Sales" ? `,${sRange("X")},1` : ""})`;
  const monthCount = (col: string, value: string, row: number) => `COUNTIFS(${sRange("W")},A${row},${sRange("X")},1,${sRange(col)},"${value}")`;
  for (let i = 0; i < summaries.length; i += 1) {
    const summary = summaries[i], month = summary.monthKey, row = FIRST + i, plan = getPayPlanForMonth(plans, month), planRow = FIRST + plans.findIndex((candidate) => candidate.effectiveMonth === plan.effectiveMonth);
    const items = summary.calculatedSales.filter((item) => item.countsTowardVolume), count = summary.deliveredCount;
    const goal = getDeliveryGoalForMonth(settings, month), commissionGoal = getCommissionGoalForMonth(settings, month);
    const pace = calculateWorkdayPace({ monthKey: month, deliveredCount: count, monthlyGoal: goal, daysOff: settings.daysOffByMonth[month] ?? [], todayDate: asOfDate });
    const run = calculateCommissionRunRate(summary, pace, plan);
    const f = (col: number, expr: string, result: number | string, format = NUMBER) => formula(monthly.getCell(row, col), expr, result, format);
    input(monthly.getCell(row, 1), month); input(monthly.getCell(row, 2), month.slice(0, 4));
    f(3, monthSum("F", row), count); f(4, monthSum("F", row, "Sales"), summary.creditedUnitsBasis / 1000);
    f(5, `COUNTIFS(${sRange("W")},A${row},${sRange("E")},"Pending")`, summary.pendingCount);
    f(6, monthSum("G", row, "Sales"), summary.frontGrossCents / 100, MONEY); f(7, monthSum("H", row, "Sales"), summary.fiGrossCents / 100, MONEY);
    f(8, `F${row}+G${row}`, (summary.frontGrossCents + summary.fiGrossCents) / 100, MONEY);
    f(9, `IF(C${row}>${ref("Pay plans", "E", planRow)},${ref("Pay plans", "D", planRow)},${ref("Pay plans", "C", planRow)})`, summary.frontRateBps / 10000, PERCENT);
    f(10, monthSum("M", row), summary.frontCommissionCents / 100, MONEY); f(11, monthSum("N", row), summary.fiCommissionCents / 100, MONEY);
    f(12, `J${row}+K${row}`, summary.coreCommissionCents / 100, MONEY);
    formula(monthly.getCell(row, 45), ref("Pay plans", "A", planRow), plan.effectiveMonth);
    f(13, bonusFormula(`AS${row}`, `C${row}`), summary.bonusIncludedCents / 100, MONEY);
    f(14, `L${row}+M${row}`, summary.estimatedCommissionCents / 100, MONEY);
    input(monthly.getCell(row, 15), dollars(summary.actualPaidCents), MONEY);
    f(16, `IF(ISNUMBER(O${row}),O${row}-N${row},"")`, dollars(summary.payrollVarianceCents) ?? "", MONEY);
    input(monthly.getCell(row, 17), goal, NUMBER); input(monthly.getCell(row, 18), dollars(commissionGoal), MONEY);
    monthly.getCell(row, 17).note = `Source: saved ${Object.hasOwn(settings.deliveryGoalsByMonth ?? {}, month) ? "month-specific" : "default"} delivery goal.`;
    monthly.getCell(row, 18).note = `Source: saved ${Object.hasOwn(settings.commissionGoalsByMonth ?? {}, month) ? "month-specific" : "default"} commission goal. Blank means no goal.`;
    f(19, `SUMIFS(${range("Work schedule", "E", lastSchedule)},${range("Work schedule", "B", lastSchedule)},A${row})`, pace.scheduledWorkdays);
    f(20, `SUMIFS(${range("Work schedule", "F", lastSchedule)},${range("Work schedule", "B", lastSchedule)},A${row})`, pace.elapsedWorkdays);
    f(21, `S${row}-T${row}`, pace.remainingWorkdays); f(22, `MAX(Q${row}-C${row},0)`, pace.deliveriesToGoal);
    f(23, `IF(V${row}=0,0,IF(U${row}>0,ROUNDUP(V${row}/U${row},0),""))`, pace.requiredPerRemainingWorkday === null ? "" : Math.ceil(pace.requiredPerRemainingWorkday));
    f(24, `IF(A${row}<TEXT('Start here'!$B$8,"yyyy-mm"),C${row},IF(T${row}>0,ROUNDUP(ROUND(C${row}/T${row}*S${row},1),0),""))`, pace.projectedDeliveries === null ? "" : Math.ceil(pace.projectedDeliveries));
    const entered = items.filter((item) => item.sale.fiGrossCents !== null).length;
    f(25, `IF(C${row}>0,${averageFormula(`F${row}`, `C${row}`)},"")`, count ? Math.round(summary.frontGrossCents / count) / 100 : "", MONEY);
    f(26, `IF(AND(C${row}>0,AB${row}>0),${averageFormula(`G${row}`, `C${row}`)},"")`, count && entered ? Math.round(summary.fiGrossCents / count) / 100 : "", MONEY);
    f(27, `IF(C${row}>0,${averageFormula(`N${row}`, `C${row}`)},"")`, count ? Math.round(summary.estimatedCommissionCents / count) / 100 : "", MONEY);
    f(29, monthSum("Y", row), count - entered); f(28, `C${row}-AC${row}`, entered);
    f(30, `COUNTIFS(${cRange("E")},A${row},${cRange("P")},"Mini")`, summary.miniDealCount);
    f(31, `COUNTIFS(${cRange("E")},A${row},${cRange("P")},"Manual / spiff")`, summary.manualFrontCommissionCount);
    const products = items.reduce((total, item) => total + Number(item.sale.serviceContractSold === true) + Number(item.sale.tireWheelSold === true) + Number(item.sale.gapSold === true), 0);
    f(32, `AN${row}+AO${row}+AP${row}`, products); f(33, `IF(C${row}>0,AF${row}/C${row},"")`, ratio(products, count));
    const finance = items.filter((item) => getPaymentMethod(item.sale) === "dealer_financed").length;
    const cash = items.filter((item) => getPaymentMethod(item.sale) === "cash").length;
    const outside = items.filter((item) => getPaymentMethod(item.sale) === "outside_financing").length;
    f(34, monthCount("J", "Finance", row), finance); f(35, monthCount("J", "Cash", row), cash); f(36, monthCount("J", "Outside Finance", row), outside);
    f(37, `C${row}-SUM(AH${row}:AJ${row})`, count - finance - cash - outside); f(38, `IF(C${row}>0,AH${row}/C${row},"")`, ratio(finance, count), PERCENT);
    const any = items.filter((item) => item.sale.serviceContractSold || item.sale.tireWheelSold || item.sale.gapSold).length;
    f(39, `SUMPRODUCT((${sRange("W")}=A${row})*(${sRange("X")}=1)*--(((${sRange("K")}="Yes")+(${sRange("L")}="Yes")+(${sRange("M")}="Yes"))>0))`, any);
    ["serviceContractSold", "tireWheelSold", "gapSold"].forEach((key, productIndex) => f(40 + productIndex, monthCount(["K", "L", "M"][productIndex], "Yes", row), items.filter((item) => item.sale[key as "gapSold"] === true).length));
    const projection = (rounder: "ROUNDDOWN" | "ROUNDUP") => {
      const projectedCount = `MAX(C${row},${rounder}(ROUND(C${row}/T${row}*S${row},1),0))`;
      const higher = `${projectedCount}>${ref("Pay plans", "E", planRow)}`;
      const existing = `IF(${higher},${monthSum("R", row)},${monthSum("Q", row)})`;
      const automatic = `IF(${higher},${monthSum("AA", row)},${monthSum("Z", row)})`;
      const projectedFi = `G${row}+INT(ROUND(G${row}*100,0)/C${row}*(${projectedCount}-C${row})+0.5)/100`;
      return `IF(A${row}<TEXT('Start here'!$B$8,"yyyy-mm"),N${row},IF(AND(C${row}>0,T${row}>0,S${row}>0),${existing}+ROUND(${automatic}/C${row}*(${projectedCount}-C${row}),2)+ROUND((${projectedFi})*${ref("Pay plans", "F", planRow)},2)+${bonusFormula(`AS${row}`, projectedCount)},""))`;
    };
    f(43, projection("ROUNDDOWN"), pace.status === "complete" ? summary.estimatedCommissionCents / 100 : dollars(run?.low.estimatedCommissionCents) ?? "", MONEY);
    f(44, projection("ROUNDUP"), pace.status === "complete" ? summary.estimatedCommissionCents / 100 : dollars(run?.high.estimatedCommissionCents) ?? "", MONEY);
    f(46, monthSum("X", row), items.filter((item) => item.sale.frontGrossCents === null && item.sale.frontCommissionOverrideCents == null).length);
  }
  await yieldToBrowser();
  buildAnnual(book, summaries, lastMonth);
  buildWeekly(book, summaries, settings, asOfDate, lastSale, lastSchedule, monthRows);
  await yieldToBrowser();
  buildProductReports(book, summaries, lastSale);
  await yieldToBrowser();
  buildMilestones(book, active, calculated, saleRows);
  buildSavedDetails(book, snapshot);
  addPortableReportSheet(book, settings.selectedMonth);
  buildIndex(index, book, snapshot, summaries, lastMonth, asOfDate);
  for (const sheet of book.worksheets) if (sheet.name !== "Start here" && sheet.name !== "Report") finishSheet(sheet, sheet.getRow(5).cellCount);
  book.worksheets.forEach((sheet) => sheet.eachRow((row) => row.eachCell((cell) => { if (!cell.font?.name) cell.font = { ...cell.font, name: "Arial", size: cell.font?.size ?? 10 }; })));
  return book;
}

function buildAnnual(book: Workbook, summaries: MonthSummary[], lastMonth: number) {
  const headers = ["Year", "Delivered", "Credited units", "Front gross", "Total F&I gross", "Combined gross", "Front commission", "F&I commission", "Volume bonus", "Estimated commission", "Actual paid entered", "Months paid entered", "Estimate for paid months", "Payroll variance", "Front gross / delivery", "F&I gross / delivery", "Commission / delivery", "Finance Penetration", "Products / delivery"];
  const sheet = makeSheet(book, "Yearly", "Annual performance", "Payroll variance compares only months with an entered Actual paid amount. Missing payroll is not $0. Partial years remain partial.", headers);
  [...new Set(summaries.map((summary) => summary.monthKey.slice(0, 4)))].forEach((year, i) => {
    const row = FIRST + i, months = summaries.filter((summary) => summary.monthKey.startsWith(year)), total = (key: keyof MonthSummary) => months.reduce((value, month) => value + Number(month[key] ?? 0), 0);
    input(sheet.getCell(row, 1), year);
    const add = (col: number, source: string, result: number, fmt = MONEY) => formula(sheet.getCell(row, col), `SUMIFS(${range("Monthly", source, lastMonth)},${range("Monthly", "B", lastMonth)},A${row})`, result, fmt);
    add(2, "C", total("deliveredCount"), NUMBER); add(3, "D", total("creditedUnitsBasis") / 1000, NUMBER);
    [[4, "F", "frontGrossCents"], [5, "G", "fiGrossCents"], [7, "J", "frontCommissionCents"], [8, "K", "fiCommissionCents"], [9, "M", "bonusIncludedCents"], [10, "N", "estimatedCommissionCents"]].forEach(([col, source, key]) => add(Number(col), String(source), total(key as keyof MonthSummary) / 100));
    formula(sheet.getCell(row, 6), `D${row}+E${row}`, (total("frontGrossCents") + total("fiGrossCents")) / 100, MONEY);
    const paid = months.filter((month) => month.actualPaidCents !== null), paidEstimate = paid.reduce((value, month) => value + month.estimatedCommissionCents, 0);
    formula(sheet.getCell(row, 12), `COUNTIFS(${range("Monthly", "B", lastMonth)},A${row},${range("Monthly", "O", lastMonth)},"<>")`, paid.length, NUMBER);
    formula(sheet.getCell(row, 11), `IF(L${row}>0,SUMIFS(${range("Monthly", "O", lastMonth)},${range("Monthly", "B", lastMonth)},A${row}),"")`, paid.length ? total("actualPaidCents") / 100 : "", MONEY);
    formula(sheet.getCell(row, 13), `SUMIFS(${range("Monthly", "N", lastMonth)},${range("Monthly", "B", lastMonth)},A${row},${range("Monthly", "O", lastMonth)},"<>")`, paidEstimate / 100, MONEY);
    formula(sheet.getCell(row, 14), `IF(L${row}>0,K${row}-M${row},"")`, paid.length ? (total("actualPaidCents") - paidEstimate) / 100 : "", MONEY);
    const items = months.flatMap((month) => month.calculatedSales.filter((item) => item.countsTowardVolume));
    [[15, "D", "frontGrossCents"], [17, "J", "estimatedCommissionCents"]].forEach(([col, source, key]) => formula(sheet.getCell(row, Number(col)), `IF(B${row}>0,${averageFormula(`${source}${row}`, `B${row}`)},"")`, total("deliveredCount") ? Math.round(total(key as keyof MonthSummary) / total("deliveredCount")) / 100 : "", MONEY));
    const knownFiCount = items.filter((item) => item.sale.fiGrossCents !== null).length;
    formula(sheet.getCell(row, 16), `IF(AND(B${row}>0,SUMIFS(${range("Monthly", "AB", lastMonth)},${range("Monthly", "B", lastMonth)},A${row})>0),${averageFormula(`E${row}`, `B${row}`)},"")`, items.length && knownFiCount ? Math.round(total("fiGrossCents") / items.length) / 100 : "", MONEY);
    formula(sheet.getCell(row, 18), `IF(B${row}>0,SUMIFS(${range("Monthly", "AH", lastMonth)},${range("Monthly", "B", lastMonth)},A${row})/B${row},"")`, ratio(items.filter((item) => getPaymentMethod(item.sale) === "dealer_financed").length, items.length), PERCENT);
    const products = items.reduce((value, item) => value + Number(item.sale.serviceContractSold === true) + Number(item.sale.tireWheelSold === true) + Number(item.sale.gapSold === true), 0);
    formula(sheet.getCell(row, 19), `IF(B${row}>0,SUMIFS(${range("Monthly", "AF", lastMonth)},${range("Monthly", "B", lastMonth)},A${row})/B${row},"")`, ratio(products, items.length), NUMBER);
  });
}

function buildWeekly(book: Workbook, summaries: MonthSummary[], settings: ProfileSettings, asOfDate: string, lastSale: number, lastSchedule: number, monthRows: Map<string, number>) {
  const headers = ["Month", "Week starts", "Week ends", "Delivered", "Front gross", "Total F&I gross", "Front commission", "F&I commission", "Sale commission", "Scheduled workdays", "Elapsed workdays", "Remaining workdays", "Month target by week end", "Delivered month to week end", "Needed by week end", "Week delivery pace (up)", "Service contracts", "Tire & Wheel", "GAP", "Finance Penetration"];
  const sheet = makeSheet(book, "Weekly", "Weekly performance & goal checkpoints", "Monday–Saturday weeks are clipped at month boundaries. Sunday deliveries are included in monthly totals, not open-day weekly totals. Weekly commissions exclude monthly volume bonuses.", headers);
  let row = FIRST;
  for (const summary of summaries) {
    const performance = calculateWeeklyPerformance({ summary, monthlyGoal: getDeliveryGoalForMonth(settings, summary.monthKey), daysOff: settings.daysOffByMonth[summary.monthKey] ?? [], todayDate: asOfDate });
    for (const week of performance.weeks) {
      const items = summary.calculatedSales.filter((item) => item.countsTowardVolume && item.sale.saleDate >= week.startDate && item.sale.saleDate <= week.endDate), m = monthRows.get(summary.monthKey)!;
      input(sheet.getCell(row, 1), summary.monthKey); input(sheet.getCell(row, 2), dateCell(week.startDate), "mm/dd/yyyy"); input(sheet.getCell(row, 3), dateCell(week.endDate), "mm/dd/yyyy");
      const criteria = `${range("Sales", "W", lastSale)},A${row},${range("Sales", "X", lastSale)},1,${range("Sales", "D", lastSale)},">="&B${row},${range("Sales", "D", lastSale)},"<="&C${row}`;
      formula(sheet.getCell(row, 4), `COUNTIFS(${criteria})`, items.length, NUMBER);
      [[5, "Sales", "G", sum(items, (item) => item.sale.frontGrossCents ?? 0)], [6, "Sales", "H", sum(items, (item) => item.sale.fiGrossCents ?? 0)], [7, "Commissions", "M", sum(items, (item) => item.frontCommissionCents)], [8, "Commissions", "N", sum(items, (item) => item.fiCommissionCents)]].forEach(([col, source, sourceCol, cents]) => formula(sheet.getCell(row, Number(col)), `SUMIFS(${range(String(source), String(sourceCol), lastSale)},${criteria})`, Number(cents) / 100, MONEY));
      formula(sheet.getCell(row, 9), `G${row}+H${row}`, week.estimatedCoreCommissionCents / 100, MONEY);
      const workCriteria = `${range("Work schedule", "A", lastSchedule)},">="&B${row},${range("Work schedule", "A", lastSchedule)},"<="&C${row}`;
      formula(sheet.getCell(row, 10), `SUMIFS(${range("Work schedule", "E", lastSchedule)},${workCriteria})`, week.scheduledWorkdays, NUMBER);
      formula(sheet.getCell(row, 11), `SUMIFS(${range("Work schedule", "F", lastSchedule)},${workCriteria})`, week.elapsedWorkdays, NUMBER);
      formula(sheet.getCell(row, 12), `J${row}-K${row}`, week.remainingWorkdays, NUMBER);
      const cumulativeWork = `SUMIFS(${range("Work schedule", "E", lastSchedule)},${range("Work schedule", "B", lastSchedule)},A${row},${range("Work schedule", "A", lastSchedule)},"<="&C${row})`;
      formula(sheet.getCell(row, 13), `IF(${ref("Monthly", "S", m)}>0,MIN(${ref("Monthly", "Q", m)},ROUNDUP(${ref("Monthly", "Q", m)}*${cumulativeWork}/${ref("Monthly", "S", m)},0)),"")`, week.goal.targetByWeekEnd ?? "", NUMBER);
      formula(sheet.getCell(row, 14), `COUNTIFS(${range("Sales", "W", lastSale)},A${row},${range("Sales", "X", lastSale)},1,${range("Sales", "AC", lastSale)},1,${range("Sales", "D", lastSale)},"<="&C${row})`, week.goal.cumulativeDeliveredCount, NUMBER);
      const currentWeek = `AND(A${row}=TEXT('Start here'!$B$8,"yyyy-mm"),B${row}-WEEKDAY(B${row},2)='Start here'!$B$8-WEEKDAY('Start here'!$B$8,2))`;
      formula(sheet.getCell(row, 15), `IF(AND(${currentWeek},ISNUMBER(M${row})),MAX(M${row}-${ref("Monthly", "C", m)},0),"")`, week.goal.deliveriesNeededByWeekEnd ?? "", NUMBER);
      formula(sheet.getCell(row, 16), `IF(AND(C${row}<'Start here'!$B$8,NOT(${currentWeek})),D${row},IF(K${row}>0,ROUNDUP(D${row}/K${row}*J${row},0),""))`, week.state === "past" ? week.deliveredCount : week.elapsedWorkdays > 0 ? Math.ceil(week.deliveredCount / week.elapsedWorkdays * week.scheduledWorkdays) : "", NUMBER);
      ["K", "L", "M"].forEach((product, j) => formula(sheet.getCell(row, 17 + j), `COUNTIFS(${criteria},${range("Sales", product, lastSale)},"Yes")`, [week.fi.serviceContract.soldCount, week.fi.tireWheel.soldCount, week.fi.gap.soldCount][j], NUMBER));
      formula(sheet.getCell(row, 20), `IF(D${row}>0,COUNTIFS(${criteria},${range("Sales", "J", lastSale)},"Finance")/D${row},"")`, week.fi.dealerFinanced.rate ?? "", PERCENT);
      row += 1;
    }
  }
}

function buildProductReports(book: Workbook, summaries: MonthSummary[], lastSale: number) {
  const headers = ["Period", "Product / combination / payment", "Matching deliveries", "All delivered", "Penetration / share", "Total F&I gross on matching deals", "F&I amounts entered", "F&I amounts awaiting", "F&I gross / matching delivery", "F&I commission on matching deals", "Product units on matching deals", "Products / matching delivery"];
  const products = makeSheet(book, "Products", "Product volume & penetration", "One product sold = one marked Yes. Cohort gross is the WHOLE DEAL’S F&I gross, not product-specific revenue. Product rows overlap; do not add their gross totals.", headers, [18, 36]);
  const payments = makeSheet(book, "Payment mix", "Financing & payment mix", "Payment share uses all delivered. Product penetration here uses matching payment-type deliveries. Cash means no loan; Outside Finance uses the customer’s lender. Unspecified answers remain separate.", [...headers, "Service contracts sold", "Service contract penetration", "Tire & Wheel sold", "Tire & Wheel penetration", "GAP sold", "GAP penetration"], [18, 36]);
  const combinations = makeSheet(book, "Product combinations", "Product combinations", "Inclusive combinations overlap (all three also belongs to each pair). Gross is total deal F&I gross, not separate product gross. These rows are not additive.", headers, [18, 38]);
  const all = summaries.flatMap((summary) => summary.calculatedSales.filter((item) => item.countsTowardVolume));
  const years = [...new Set(summaries.map((summary) => summary.monthKey.slice(0, 4)))];
  const periods = [{ label: "All history", items: all }, ...years.map((year) => ({ label: year, items: all.filter((item) => item.monthKey.startsWith(year)) })), ...summaries.map((summary) => ({ label: summary.monthKey, items: summary.calculatedSales.filter((item) => item.countsTowardVolume) }))];
  const fieldCols = { serviceContractSold: "K", tireWheelSold: "L", gapSold: "M" } as const;
  const productDefs = [{ label: "Service contract / warranty", keys: ["serviceContractSold"] }, { label: "Tire & Wheel", keys: ["tireWheelSold"] }, { label: "GAP", keys: ["gapSold"] }] as const;
  const comboDefs = [{ label: "Service contract + Tire & Wheel", keys: ["serviceContractSold", "tireWheelSold"] }, { label: "Service contract + GAP", keys: ["serviceContractSold", "gapSold"] }, { label: "Tire & Wheel + GAP", keys: ["tireWheelSold", "gapSold"] }, { label: "All three products", keys: ["serviceContractSold", "tireWheelSold", "gapSold"] }] as const;
  let pRow = FIRST, fRow = FIRST, bRow = FIRST;
  function put(sheet: Worksheet, row: number, label: string, period: typeof periods[number], criteriaPairs: string[], matching: CalculatedSale[]) {
    input(sheet.getCell(row, 1), period.label); input(sheet.getCell(row, 2), label);
    const base = `${range("Sales", "X", lastSale)},1${period.label === "All history" ? "" : period.label.length === 4 ? `,${range("Sales", "W", lastSale)},A${row}&"-*"` : `,${range("Sales", "W", lastSale)},A${row}`}`;
    const criteria = `${base}${criteriaPairs.length ? `,${criteriaPairs.join(",")}` : ""}`;
    formula(sheet.getCell(row, 3), `COUNTIFS(${criteria})`, matching.length, NUMBER);
    formula(sheet.getCell(row, 4), `COUNTIFS(${base})`, period.items.length, NUMBER);
    formula(sheet.getCell(row, 5), `IF(D${row}>0,C${row}/D${row},"")`, ratio(matching.length, period.items.length), PERCENT);
    const gross = sum(matching, (item) => item.sale.fiGrossCents ?? 0), entered = matching.filter((item) => item.sale.fiGrossCents !== null).length;
    formula(sheet.getCell(row, 6), `SUMIFS(${range("Sales", "H", lastSale)},${criteria})`, gross / 100, MONEY);
    formula(sheet.getCell(row, 7), `COUNTIFS(${criteria},${range("Sales", "H", lastSale)},"<>")`, entered, NUMBER);
    formula(sheet.getCell(row, 8), `C${row}-G${row}`, matching.length - entered, NUMBER);
    formula(sheet.getCell(row, 9), `IF(AND(C${row}>0,G${row}>0),${averageFormula(`F${row}`, `C${row}`)},"")`, matching.length && entered ? Math.round(gross / matching.length) / 100 : "", MONEY);
    formula(sheet.getCell(row, 10), `SUMIFS(${range("Commissions", "N", lastSale)},${criteria})`, sum(matching, (item) => item.fiCommissionCents) / 100, MONEY);
    const count = matching.reduce((total, item) => total + Number(item.sale.serviceContractSold === true) + Number(item.sale.tireWheelSold === true) + Number(item.sale.gapSold === true), 0);
    formula(sheet.getCell(row, 11), ["K", "L", "M"].map((col) => `COUNTIFS(${criteria},${range("Sales", col, lastSale)},"Yes")`).join("+"), count, NUMBER);
    formula(sheet.getCell(row, 12), `IF(C${row}>0,K${row}/C${row},"")`, ratio(count, matching.length), NUMBER);
    if (sheet === payments) {
      ["serviceContractSold", "tireWheelSold", "gapSold"].forEach((key, productIndex) => {
        const countColumn = 13 + productIndex * 2, countLetter = column(countColumn), source = ["K", "L", "M"][productIndex];
        const sold = matching.filter((item) => item.sale[key as "gapSold"] === true).length;
        formula(sheet.getCell(row, countColumn), `COUNTIFS(${criteria},${range("Sales", source, lastSale)},"Yes")`, sold, NUMBER);
        formula(sheet.getCell(row, countColumn + 1), `IF(C${row}>0,${countLetter}${row}/C${row},"")`, ratio(sold, matching.length), PERCENT);
      });
    }
  }
  for (const period of periods) {
    for (const def of productDefs) put(products, pRow++, def.label, period, def.keys.flatMap((key) => [range("Sales", fieldCols[key], lastSale), '"Yes"']), period.items.filter((item) => def.keys.every((key) => item.sale[key] === true)));
    for (const def of comboDefs) put(combinations, bRow++, def.label, period, def.keys.flatMap((key) => [range("Sales", fieldCols[key], lastSale), '"Yes"']), period.items.filter((item) => def.keys.every((key) => item.sale[key] === true)));
    for (const [key, label] of Object.entries(paymentLabels)) put(payments, fRow++, label, period, [range("Sales", "J", lastSale), `"${label}"`], period.items.filter((item) => getPaymentMethod(item.sale) === key));
  }
}

function buildMilestones(book: Workbook, sales: Sale[], calculated: Map<string, CalculatedSale>, rows: Map<string, number>) {
  const sheet = makeSheet(book, "Milestones", "Deliveries that unlocked more", "Milestone membership and incomplete flags are captured at export; linked amounts recalculate. Recognition only: do not add milestone impact to monthly commission again.", ["Customer", "Vehicle", "Stock", "Delivery date", "Month", "Delivery order at export", "Normal sale commission", "Bonus added", "Prior-sale retro increase", "Additional unlocked", "Total impact", "Incomplete at export?"]);
  let row = FIRST;
  for (const sale of sales) {
    const item = calculated.get(sale.id);
    if (!item?.milestone) continue;
    const source = rows.get(sale.id)!;
    ["A", "B", "C", "D", "E", "G", "O", "T", "U", "V", "W"].forEach((col, j) => {
      const cell = book.getWorksheet("Commissions")!.getCell(`${col}${source}`);
      const value = cell.result ?? cell.value;
      formula(sheet.getCell(row, j + 1), ref("Commissions", col, source), typeof value === "number" || typeof value === "string" ? value : "", j === 3 ? "mm/dd/yyyy" : j >= 6 ? MONEY : undefined);
    });
    input(sheet.getCell(row, 12), item.milestone.isPartial ? "Yes — some gross is still awaiting" : "No"); row += 1;
  }
}

function buildSavedDetails(book: Workbook, snapshot: PortableWorkbookSnapshot) {
  const deleted = makeSheet(book, "Deleted sales", "Recently deleted / retained records", "These saved records are excluded from all workbook financial totals. Exporting does not delete or restore anything.", ["Customer last name", "Vehicle", "Stock number", "Delivery date", "Original status", "Deal credit", "Front gross", "Total F&I gross", "Manual front payout", "Payment method", "Service contract", "Tire & Wheel", "GAP", "Notes", "Deleted at (UTC)", "Sale ID", "Created at", "Updated at", "Revision", "Source", "Source reference", "Original payment value", "Original finance flag", "Profile ID"], [23, 36, 20, 19, 18, 14, 18, 18, 20, 26, 19, 15, 15, 48]);
  snapshot.sales.filter((sale) => sale.deletedAt).forEach((sale, i) => [sale.customerLastName, sale.vehicleDescription, sale.stockNumber, dateCell(sale.saleDate), sale.status, sale.unitCreditBasis / 1000, dollars(sale.frontGrossCents), dollars(sale.fiGrossCents), dollars(sale.frontCommissionOverrideCents), paymentLabels[getPaymentMethod(sale)], yesNo(sale.serviceContractSold), yesNo(sale.tireWheelSold), yesNo(sale.gapSold), sale.notes, sale.deletedAt!, sale.id, sale.createdAt, sale.updatedAt, sale.revision, sale.source ?? "", sale.sourceReference ?? "", sale.paymentMethod ?? "", yesNo(sale.dealerFinanced), sale.profileId].forEach((value, j) => input(deleted.getCell(FIRST + i, j + 1), value, j === 3 ? "mm/dd/yyyy" : [6, 7, 8].includes(j) ? MONEY : undefined)));
  const activity = makeSheet(book, "Activity", "Saved activity history", "Activity records supplied by the saved workspace. Historical sale versions and unfinished editor drafts are not included in this export.", ["Occurred at (UTC)", "Action", "Summary", "Sale / record ID", "Activity ID", "Profile ID", "Details (original JSON)"], [28, 25, 60, 32, 16, 16, 70]);
  [...snapshot.auditEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).forEach((event, i) => [event.occurredAt, event.action, event.summary, event.entityId ?? "", event.id ?? null, event.profileId, event.details ? JSON.stringify(event.details) : ""].forEach((value, j) => input(activity.getCell(FIRST + i, j + 1), value)));
  const preferences = makeSheet(book, "Saved settings", "Saved preferences & overrides", "Original settings preserve defaults, month overrides, payroll and days off. Pay plan details are in Pay plans and Bonus tiers.", ["Category", "Month / key", "Setting", "Saved value"], [23, 25, 39, 68]);
  let row = FIRST;
  const put = (category: string, key: string, label: string, value: CellValue) => { [category, key, label, value].forEach((item, col) => input(preferences.getCell(row, col + 1), item)); row += 1; };
  const profile = snapshot.settings;
  for (const [key, value] of Object.entries(profile)) {
    if (["payPlan", "payPlanHistory"].includes(key)) continue;
    if (value && typeof value === "object") {
      for (const [month, setting] of Object.entries(value)) put(key, month, ["actualPaidByMonth", "commissionGoalsByMonth"].includes(key) ? "Original amount in cents (100 cents = $1)" : key === "daysOffByMonth" ? "Original dates, comma-separated" : "Original saved value", Array.isArray(setting) ? setting.join(", ") : setting as CellValue);
    } else put("Profile", "", key, value as CellValue);
  }
  const definitions = makeSheet(book, "Metric guide", "How to read this workbook", "Definitions follow the saved Sales Ledger pay plan and reporting logic. This workbook does not provide lender decisions, accounting advice, or industry benchmarks.", ["Metric / feature", "Definition / limitation"], [35, 115]);
  const rows = [
    ["Delivered / penetration denominator", "A counted, active delivered sale is one vehicle, including a split sale. Pending, deleted, duplicate-stock, invalid-date and future-delivery records are excluded. Inclusion and chronology are captured at export, not revalidated in Excel."],
    ["Credited units", "Deal credit is separate from vehicle count. A half deal contributes 0.5 credited units and one delivered vehicle."],
    ["Front commission", "Per counted sale: manual personal payout if entered; otherwise the larger of Mini × deal credit and nonnegative personal front gross × the month’s front rate. Missing gross remains awaiting unless a manual amount exists."],
    ["Split deal gross", "Gross entered in Sales is already your personal gross share. Only Mini is prorated by deal credit. Manual / spiff payout is your personal front commission and is not split or added again."],
    ["Higher rate", "The month’s higher rate applies retroactively to all counted deliveries once the saved threshold is exceeded. See Pay plans; no pay rate or threshold is assumed from an industry average."],
    ["F&I commission rounding", "F&I commission is rounded from the month’s total recorded F&I gross. The last counted delivery receives any rounding remainder so sale commissions reconcile exactly to the month."],
    ["Mini / manual payout", "Mini is the saved minimum front commission. Manual / spiff replaces that sale’s front payout, not its F&I commission or the monthly bonus."],
    ["F&I gross and missing amounts", "Blank means not received yet; $0 is an entered zero. F&I gross totals and projections use amounts currently recorded. Awaiting counts explain incomplete information."],
    ["F&I PVR", "Total recorded F&I gross divided by all counted deliveries, including entered $0 sales. Blank when no amounts are entered. Not gross divided only by financed customers."],
    ["Finance Penetration", "Finance deliveries divided by all counted delivered vehicles. Outside Finance and Cash remain separate. Older no-dealership-finance answers are not guessed into Cash or Outside Finance."],
    ["Product penetration", "Product Yes count divided by all counted deliveries. No and Not marked are different; missing details are not inferred. Each of service contract, Tire & Wheel and GAP counts as one product unit."],
    ["Product cohort gross", "The total F&I gross from entire matching deals. It is not that product’s own gross. Product and inclusive-combination cohorts overlap and must not be added together."],
    ["Payroll variance", "Actual paid minus estimated commission. Annual variance uses only months with an entered actual-pay amount; missing payroll is never treated as zero."],
    ["Workday pace", "Monday through Saturday minus saved personal days off. Export date is fixed. Actionable vehicle counts round up; financial calculations retain cents. Sundays are closed workdays but any valid Sunday delivery remains in monthly totals."],
    ["Commission projections", "Observed automatic front-pay mix is projected at the applicable rate, with Mini protection; one-off manual spiffs are not repeated on future cars. Existing payouts are retained. F&I uses recorded gross, so missing figures can understate the outlook."],
    ["Weekly targets", "Monthly delivery goal is apportioned by scheduled workdays. Weeks are Monday–Saturday; the closing Sunday belongs to that week for goal status. Weekly counts and cumulative weekly counts exclude Sunday deliveries, but remaining goals credit all month-to-date deliveries. Weekly commission excludes monthly bonuses."],
    ["Milestone attribution", "Normal commission on the triggering sale + newly earned bonus + retro increase on earlier sales only. These impacts explain rewards and are not an extra amount to add to payable totals."],
    ["Offline use", "Open in Excel or compatible spreadsheet software without an account or connection. Formulas calculate inside exported rows. No cloud saving, sign-in, automatic sync, web-app navigation, validation or server recovery runs in this file."],
    ["Editing / continuing in Excel", "You may analyze a copy and adjust existing gross, products, Mini/rates or goal inputs. New rows, changed identities/delivery dates/statuses or new months require extending ranges and revalidating inclusion/order/plan assignments. Do not assume this snapshot is a drop-in replacement for the full app."],
    ["Export coverage", "Current saved sales, retained deleted sales, profile/settings and activity supplied at export. Historical sale versions and unfinished editor drafts are not included. The separate JSON data file is the exact structured migration copy."],
    ["Formula safety", "No macros, external workbook references, automatic external connections or user-generated formulas. Customer names, stock numbers and notes remain literal strings."],
  ];
  rows.forEach((values, i) => values.forEach((value, j) => { input(definitions.getCell(FIRST + i, j + 1), value); definitions.getCell(FIRST + i, j + 1).alignment = { wrapText: true, vertical: "top" }; definitions.getRow(FIRST + i).height = 48; }));
}

function buildIndex(sheet: Worksheet, book: Workbook, snapshot: PortableWorkbookSnapshot, summaries: MonthSummary[], lastMonth: number, asOfDate: string) {
  const total = (key: keyof MonthSummary) => summaries.reduce((value, month) => value + Number(month[key] ?? 0), 0);
  const stats = [[10, "Delivered vehicles", "C", total("deliveredCount"), NUMBER], [11, "Front commission", "J", total("frontCommissionCents") / 100, MONEY], [12, "F&I commission", "K", total("fiCommissionCents") / 100, MONEY], [13, "Volume bonuses", "M", total("bonusIncludedCents") / 100, MONEY], [14, "Estimated commission", "N", total("estimatedCommissionCents") / 100, MONEY]];
  stats.forEach(([row, label, col, value, format]) => { input(sheet.getCell(Number(row), 1), String(label)); formula(sheet.getCell(Number(row), 2), `SUM(${range("Monthly", String(col), lastMonth)})`, Number(value), String(format)); sheet.getCell(Number(row), 2).font = { name: "Arial", size: Number(row) === 14 ? 19 : 14, bold: true, color: { argb: NAVY } }; });
  sheet.mergeCells("A16:D16");
  sheet.getCell("A16").value = { text: "Open monthly report →", hyperlink: "#'Report'!A1" };
  sheet.getCell("A16").font = { name: "Arial", size: 14, bold: true, color: { argb: BLUE }, underline: true };
  sheet.getCell("A16").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E5EEF5" } };
  sheet.getCell("A16").alignment = { vertical: "middle", indent: 1 };
  sheet.getRow(16).height = 32;
  const notes = [
    `Contains ${snapshot.sales.length} saved sale records (${snapshot.sales.filter((sale) => sale.deletedAt).length} retained as deleted) and ${snapshot.auditEvents.length} activity records. Calculation date: ${asOfDate}.`,
    "OPEN OFFLINE — No login or service is needed to view this file. Keep the separate JSON data file with it for exact structured migration.",
    "FORMULA LEGEND — Blue: saved inputs. Green: formulas linking sheets. Dark: calculations. Blank financial input means awaiting, not zero.",
    "SNAPSHOT BOUNDARY — Inclusion/exclusion, delivery order, month and pay-plan assignments reflect the export. Existing financial inputs recalculate; inserting sales or changing identity/date/status requires extending and checking the model.",
    "NOT A CLOUD APP — This file does not sync or autosave to Sales Ledger. Historical record versions and unfinished editor drafts are not included. Changes made here do not change the live account.",
  ];
  notes.forEach((note, i) => { const row = 17 + i; sheet.mergeCells(row, 1, row, 4); sheet.getCell(row, 1).value = note; sheet.getCell(row, 1).font = { name: "Arial", size: 11, color: { argb: GRAY } }; sheet.getCell(row, 1).alignment = { wrapText: true, vertical: "middle" }; sheet.getRow(row).height = i === 3 ? 42 : 32; });
  sheet.getCell("A24").value = "EXPLORE YOUR WORKBOOK"; sheet.getCell("A24").font = { name: "Arial", size: 13, bold: true, color: { argb: NAVY } };
  const navigation = book.worksheets.filter((tab) => tab.name !== "Start here");
  navigation.sort((a, b) => a.name === "Report" ? -1 : b.name === "Report" ? 1 : 0);
  navigation.forEach((tab, i) => { const row = 26 + i; sheet.getCell(row, 1).value = { text: tab.name, hyperlink: `#'${tab.name}'!A1` }; sheet.getCell(row, 1).font = { name: "Arial", size: 11, bold: true, color: { argb: BLUE }, underline: true }; sheet.mergeCells(row, 2, row, 4); sheet.getCell(row, 2).value = tab.getCell("A1").text; sheet.getRow(row).height = 23; });
  sheet.pageSetup.printArea = `A1:D${26 + book.worksheets.length}`;
}

export async function preparePortableWorkbook(snapshot: PortableWorkbookSnapshot, exportedAt = new Date()): Promise<{ file: Blob; fileName: string }> {
  const workbook = await buildPortableWorkbook(snapshot, exportedAt);
  await yieldToBrowser();
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer.byteLength); bytes.set(new Uint8Array(buffer));
  const owner = snapshot.settings.salespersonName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50) || "Salesperson";
  return { file: new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileName: `Sales-Ledger-All-Data-${owner}-${todayDateOnly(exportedAt)}.xlsx` };
}
