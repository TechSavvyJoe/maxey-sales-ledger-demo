import { z } from "zod";
import { attentionSummary, getAttentionRecords } from "@/domain/attention";
import { calculateMonth, calculateYear, getBonusMilestone } from "@/domain/commission";
import { isValidDateOnly, monthKeyFromDate, monthLabel, todayDateOnly, yearForMonth } from "@/domain/date";
import { dealerFinancingOutcome, normalizeSaleFinancing, paymentMethodLabel } from "@/domain/financing";
import { getCommissionGoalForMonth, getDeliveryGoalForMonth } from "@/domain/goals";
import { formatCurrency, formatPercent, formatUnitCredit } from "@/domain/money";
import { calculateWorkdayPace, isSunday } from "@/domain/pacing";
import {
  calculateCommissionRunRate,
  calculateMonthlyPerformance,
  calculatePeriodPerformance,
} from "@/domain/performance";
import {
  calculateMonthReportAnalytics,
  calculateReportAnalytics,
} from "@/domain/reportAnalytics";
import { calculateFiPenetration, calculateWeeklyPerformance } from "@/domain/weeklyPerformance";
import { getPayPlanForMonth, getPayPlanSchedule, validatePayPlan } from "@/domain/payPlan";
import type {
  AuditEvent,
  BackupEnvelope,
  CalculatedSale,
  PayPlan,
  ProfileSettings,
  Sale,
} from "@/domain/types";
import type { ReportAnalytics } from "@/domain/reportAnalytics";
import type { WorkBook } from "xlsx";

// The production CSP intentionally disallows string compilation. Zod's
// jitless mode keeps validation on its interpreter path and avoids a blocked
// `Function()` capability probe in strict-CSP browsers.
z.config({ jitless: true });

const APP_VERSION = "1.9.0";
const MAX_BACKUP_BYTES = 12 * 1024 * 1024;
const MAX_BACKUP_SALES = 25_000;
const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month.");
const dateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date and time.");

const daysOffByMonthSchema = z.record(
  monthKeySchema,
  z.array(z.string()).max(31, "A month cannot contain more than 31 days off."),
).default({}).superRefine((months, context) => {
  if (Object.keys(months).length > 600) {
    context.addIssue({ code: "custom", message: "Too many months of work-schedule data." });
  }
  for (const [monthKey, dates] of Object.entries(months)) {
    const seen = new Set<string>();
    dates.forEach((date, index) => {
      const path = [monthKey, index];
      if (!isValidDateOnly(date) || !date.startsWith(`${monthKey}-`)) {
        context.addIssue({ code: "custom", path, message: "A day off must be a real date in its saved month." });
      } else if (isSunday(date)) {
        context.addIssue({ code: "custom", path, message: "Sundays are already closed and cannot be saved as days off." });
      }
      if (seen.has(date)) {
        context.addIssue({ code: "custom", path, message: "A day off cannot be listed twice." });
      }
      seen.add(date);
    });
  }
}).transform((months) => Object.fromEntries(
  Object.entries(months)
    .filter(([, dates]) => dates.length > 0)
    .map(([monthKey, dates]) => [monthKey, [...dates].sort()]),
));

const saleSchema = z.object({
  id: z.string().min(1).max(160),
  profileId: z.string().min(1).max(80),
  saleDate: z.string().refine(isValidDateOnly, "Invalid sale date."),
  customerLastName: z.string().max(60),
  stockNumber: z.string().max(40),
  vehicleDescription: z.string().max(120),
  // Void stays accepted here so an older recovery file is never stranded.
  // Initialization moves those legacy records into Recently deleted.
  status: z.enum(["delivered", "pending", "void"]),
  unitCreditBasis: z.number().int().min(0).max(2_000),
  frontGrossCents: z.number().int().min(-100_000_000).max(100_000_000).nullable(),
  fiGrossCents: z.number().int().min(-100_000_000).max(100_000_000).nullable(),
  serviceContractSold: z.boolean().optional(),
  tireWheelSold: z.boolean().optional(),
  gapSold: z.boolean().optional(),
  dealerFinanced: z.boolean().optional(),
  paymentMethod: z.enum(["dealer_financed", "cash", "outside_financing"]).optional(),
  notes: z.string().max(500),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  revision: z.number().int().min(1),
  deletedAt: dateTimeSchema.optional(),
  source: z.enum(["manual", "legacy-xlsx", "json-restore", "demo"]).optional(),
  sourceReference: z.string().max(240).optional(),
}).transform((sale) => normalizeSaleFinancing(sale));

const payPlanSchema: z.ZodType<PayPlan> = z.object({
  version: z.string().min(1).max(120),
  effectiveMonth: monthKeySchema,
  baseFrontRateBps: z.number().int().min(0).max(10_000),
  acceleratedFrontRateBps: z.number().int().min(0).max(10_000),
  acceleratedThresholdExclusive: z.number().int().min(0).max(100),
  fiRateBps: z.number().int().min(0).max(10_000),
  bonusTiers: z.array(
    z.object({
      minimumDelivered: z.number().int().min(1).max(100),
      amountCents: z.number().int().min(0).max(10_000_000),
    }),
  ).max(20),
}).superRefine((payPlan, context) => {
  for (const issue of validatePayPlan(payPlan).issues) {
    context.addIssue({ code: "custom", message: issue });
  }
});

const profileSchema = z.object({
  id: z.string(),
  salespersonName: z.string().max(80),
  storeName: z.string().max(120),
  monthlyGoal: z.number().int().min(1).max(100),
  monthlyCommissionGoalCents: z.number().int().min(100).max(100_000_000).nullable().default(null),
  deliveryGoalsByMonth: z.record(
    monthKeySchema,
    z.number().int().min(1).max(100),
  ).refine((goals) => Object.keys(goals).length <= 600, "Too many monthly delivery goals.").default({}),
  commissionGoalsByMonth: z.record(
    monthKeySchema,
    z.number().int().min(0).max(100_000_000).nullable(),
  ).refine((goals) => Object.keys(goals).length <= 600, "Too many monthly commission goals.").default({}),
  daysOffByMonth: daysOffByMonthSchema,
  selectedMonth: monthKeySchema,
  selectedView: z.enum(["dashboard", "sales", "reports", "settings"]),
  actualPaidByMonth: z.record(
    monthKeySchema,
    z.number().int().min(-100_000_000).max(100_000_000).nullable(),
  ),
  payPlan: payPlanSchema,
  payPlanHistory: z.array(payPlanSchema).max(50).default([]),
  onboardingDismissed: z.boolean(),
  lastBackupAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

const auditEventSchema = z.object({
  id: z.number().int().optional(),
  profileId: z.string(),
  action: z.enum([
    "sale.created",
    "sale.updated",
    "sale.deleted",
    "sale.restored",
    "settings.updated",
    "import.completed",
    "restore.completed",
    "backup.exported",
    "demo.loaded",
    "demo.removed",
  ]),
  entityId: z.string().optional(),
  occurredAt: dateTimeSchema,
  summary: z.string().max(500),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

const backupDataSchema = z.object({
  profile: profileSchema,
  sales: z.array(saleSchema).max(MAX_BACKUP_SALES),
  auditEvents: z.array(auditEventSchema).max(100_000),
}).superRefine((data, context) => {
  const ids = new Set<string>();
  data.sales.forEach((sale, index) => {
    if (ids.has(sale.id)) {
      context.addIssue({ code: "custom", path: ["sales", index, "id"], message: "Duplicate sale ID." });
    }
    ids.add(sale.id);
  });
});

const backupSchema = z.object({
  format: z.literal("maxey-sales-command-center"),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  appVersion: z.string(),
  exportedAt: dateTimeSchema,
  timezone: z.literal("America/Detroit"),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  data: backupDataSchema,
});

const backupHeaderSchema = z.object({
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  data: z.unknown(),
});

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function slug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "salesperson";
}

function fileBase(settings: ProfileSettings, period: string): string {
  return `${slug(settings.salespersonName || "salesperson")}-sales-${period}`;
}

export async function createBackupEnvelope(
  settings: ProfileSettings,
  sales: Sale[],
  auditEvents: AuditEvent[],
): Promise<BackupEnvelope> {
  const parsedData = backupDataSchema.safeParse({ profile: settings, sales, auditEvents });
  if (!parsedData.success) {
    throw new Error(`Cannot create backup: ${parsedData.error.issues[0]?.message ?? "invalid local data"}`);
  }
  const data = parsedData.data;
  return {
    format: "maxey-sales-command-center",
    schemaVersion: 2,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    timezone: "America/Detroit",
    checksum: await sha256(JSON.stringify(data)),
    data,
  };
}

export interface PreparedBackupFile {
  file: File;
  fileName: string;
}

export async function prepareBackupFile(
  settings: ProfileSettings,
  sales: Sale[],
  auditEvents: AuditEvent[],
): Promise<PreparedBackupFile> {
  const envelope = await createBackupEnvelope(settings, sales, auditEvents);
  const date = envelope.exportedAt.slice(0, 10);
  const fileName = `${fileBase(settings, `backup-${date}`)}.json`;
  const file = new File([JSON.stringify(envelope, null, 2)], fileName, {
    type: "application/json",
  });

  // Validate the exact bytes offered to the browser before marking a manual
  // backup ready. Google Drive and ordinary downloads share this path.
  await parseBackupFile(file);
  return { file, fileName };
}

export function downloadPreparedBackup(prepared: PreparedBackupFile): void {
  downloadBlob(prepared.file, prepared.fileName);
}

export async function downloadBackup(
  settings: ProfileSettings,
  sales: Sale[],
  auditEvents: AuditEvent[],
): Promise<string> {
  const prepared = await prepareBackupFile(settings, sales, auditEvents);
  downloadPreparedBackup(prepared);
  return prepared.fileName;
}

export async function parseBackupFile(file: File): Promise<BackupEnvelope> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup is larger than the 12 MB safety limit.");
  const parsed: unknown = JSON.parse(await file.text());
  const header = backupHeaderSchema.safeParse(parsed);
  if (!header.success) throw new Error("This is not a valid Sales Ledger backup.");
  const expected = await sha256(JSON.stringify(header.data.data));
  if (expected !== header.data.checksum) {
    throw new Error("This backup file appears incomplete or changed. Choose a different backup.");
  }
  const result = backupSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`This is not a valid Sales Ledger backup: ${result.error.issues[0]?.message ?? "invalid format"}`);
  }
  return result.data as BackupEnvelope;
}

function csvText(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export interface FiPenetrationMetrics {
  deliveredCount: number;
  serviceContractSoldCount: number;
  tireWheelSoldCount: number;
  gapSoldCount: number;
  dealerFinancedCount: number;
  anyTrackedProductSoldCount: number;
  trackedProductsSoldCount: number;
}

export function calculateFiPenetrationMetrics(
  calculatedSales: CalculatedSale[],
): FiPenetrationMetrics {
  const penetration = calculateFiPenetration(calculatedSales);
  const delivered = calculatedSales.filter((item) => item.countsTowardVolume);
  const anyTrackedProductSoldCount = delivered.filter((item) =>
    item.sale.serviceContractSold === true ||
    item.sale.tireWheelSold === true ||
    item.sale.gapSold === true
  ).length;
  const trackedProductsSoldCount = delivered.reduce(
    (count, item) => count +
      Number(item.sale.serviceContractSold === true) +
      Number(item.sale.tireWheelSold === true) +
      Number(item.sale.gapSold === true),
    0,
  );
  return {
    deliveredCount: penetration.eligibleDealCount,
    serviceContractSoldCount: penetration.serviceContract.soldCount,
    tireWheelSoldCount: penetration.tireWheel.soldCount,
    gapSoldCount: penetration.gap.soldCount,
    dealerFinancedCount: penetration.dealerFinanced.soldCount,
    anyTrackedProductSoldCount,
    trackedProductsSoldCount,
  };
}

function formatPenetration(count: number, deliveredCount: number): string {
  if (deliveredCount === 0) return "Not available";
  return `${count} of ${deliveredCount} (${((count / deliveredCount) * 100).toFixed(1)}%)`;
}

function penetrationRate(count: number, deliveredCount: number): number | string {
  return deliveredCount === 0 ? "" : count / deliveredCount;
}

function trackedOutcomeLabel(value: boolean | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not marked";
}

function dollarsOrBlank(value: number | null | undefined): number | "" {
  return value === null || value === undefined ? "" : value / 100;
}

function monthlyCsvRows(
  sales: Sale[],
  settings: ProfileSettings,
  monthKey: string,
  includeLastNames: boolean,
): { headings: string[]; rows: string[][] } {
  const payPlanSchedule = getPayPlanSchedule(settings);
  const summary = calculateMonth(
    sales,
    monthKey,
    payPlanSchedule,
    settings.actualPaidByMonth[monthKey] ?? null,
  );
  const attentionBySale = new Map(
    getAttentionRecords(summary.calculatedSales, todayDateOnly())
      .map((record) => [record.sale.id, record]),
  );
  const headings = [
    "Sale Date",
    ...(includeLastNames ? ["Customer Last Name"] : []),
    "Stock Number",
    "Vehicle",
    "Status",
    "Included in Totals",
    "Unit Credit",
    "Front Gross",
    "Total F&I Gross",
    "Service Contract / Warranty Sold",
    "Tire & Wheel Sold",
    "GAP Sold",
    "Dealer Financed",
    "Payment Method",
    "Front Rate",
    "Front Commission",
    "F&I Commission",
    "Sale Commission (Monthly Bonus Excluded)",
    "Review Status",
  ];
  const rows = summary.calculatedSales.map((item) => [
    csvText(item.sale.saleDate),
    ...(includeLastNames ? [csvText(item.sale.customerLastName)] : []),
    csvText(item.sale.stockNumber),
    csvText(item.sale.vehicleDescription),
    csvText(item.sale.status),
    csvText(item.countsTowardVolume ? "Yes" : "No"),
    String(item.sale.unitCreditBasis / 1_000),
    item.sale.frontGrossCents === null ? "" : (item.sale.frontGrossCents / 100).toFixed(2),
    item.sale.fiGrossCents === null ? "" : (item.sale.fiGrossCents / 100).toFixed(2),
    csvText(trackedOutcomeLabel(item.sale.serviceContractSold)),
    csvText(trackedOutcomeLabel(item.sale.tireWheelSold)),
    csvText(trackedOutcomeLabel(item.sale.gapSold)),
    csvText(trackedOutcomeLabel(dealerFinancingOutcome(item.sale))),
    csvText(paymentMethodLabel(item.sale)),
    (item.frontRateBps / 100).toFixed(2),
    (item.frontCommissionCents / 100).toFixed(2),
    (item.fiCommissionCents / 100).toFixed(2),
    (item.estimatedCommissionCents / 100).toFixed(2),
    csvText(attentionBySale.has(item.sale.id)
      ? attentionSummary(attentionBySale.get(item.sale.id)!)
      : "No attention items"),
  ]);
  return { headings, rows };
}

/** Builds the exact report bytes before the browser download is offered. */
export function createMonthlyCsvContent(
  sales: Sale[],
  settings: ProfileSettings,
  monthKey: string,
  includeLastNames: boolean,
): string {
  const { headings, rows } = monthlyCsvRows(sales, settings, monthKey, includeLastNames);
  return [headings.map(csvText).join(","), ...rows.map((row) => row.join(","))].join("\r\n");
}

export function exportMonthlyCsv(
  sales: Sale[],
  settings: ProfileSettings,
  monthKey: string,
  includeLastNames: boolean,
): void {
  const csv = createMonthlyCsvContent(sales, settings, monthKey, includeLastNames);
  downloadBlob(
    new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    `${fileBase(settings, monthKey)}.csv`,
  );
}

type WorksheetCell = string | number;
type WorksheetRow = Record<string, WorksheetCell>;

export interface ReportAnalyticsExportTables {
  productPerformanceRows: WorksheetRow[];
  financingRows: WorksheetRow[];
  productMixBundleRows: WorksheetRow[];
  dataQualityRows: WorksheetRow[];
}

function rateOrBlank(rate: number | null): number | "" {
  return rate ?? "";
}

const CURRENCY_REPORT_METRICS = new Set([
  "front gross",
  "total f&i gross",
  "recorded front gross per delivered sale",
  "recorded f&i gross per delivered sale (pvr)",
  "recorded f&i gross per group deal (pvr)",
  "estimated f&i commission per delivered sale",
  "front commission",
  "f&i commission",
  "sale commission",
  "sales commission",
  "estimated commission",
  "added at qualifying milestone",
  "added at milestone",
  "running monthly total",
  "cumulative bonus earned",
  "bonus included",
  "projected month-end commission low",
  "projected month-end commission high",
  "monthly commission goal",
  "ytd estimated commission through selected month",
  "actual paid for reconciled months",
  "estimated commission for reconciled months",
  "reconciled payroll variance",
  "actual paid",
  "payroll variance",
  "variance",
]);

function reportNumberFormat(label: string): string | null {
  const metric = label.trim().toLowerCase();
  if (
    (metric.includes("penetration") && !metric.includes("denominator"))
    || metric === "front rate"
    || metric === "share of delivered deals"
    || metric === "f&i gross coverage"
    || metric === "tracked product attachment"
    || metric.endsWith("tracking completion")
  ) return "0.0%";
  if (CURRENCY_REPORT_METRICS.has(metric)) return '"$"#,##0.00;[Red]("$"#,##0.00)';
  if (metric.endsWith("(ppd)")) return "0.00";
  return null;
}

/** Changes Excel display formats only; amounts, ratios, counts, and formulas stay numeric. */
export function formatReportWorkbookNumbers(workbook: WorkBook): void {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    for (const [address, cell] of Object.entries(sheet)) {
      const match = /^([A-Z]+)([1-9]\d*)$/.exec(address);
      if (!match || cell?.t !== "n") continue;
      const [, column, row] = match;
      // Summary/definition sheets store different metrics down a single Value column.
      const labelCell = sheetName === "Monthly Summary"
        ? column === "B" ? sheet[`A${row}`] : undefined
        : sheetName === "Data Quality"
          ? column === "C" ? sheet[`B${row}`] : undefined
          : row === "1" ? undefined : sheet[`${column}1`];
      const numberFormat = typeof labelCell?.v === "string"
        ? reportNumberFormat(labelCell.v) : null;
      if (numberFormat) cell.z = numberFormat;
    }
  }
}

/**
 * Translates the shared reporting model into spreadsheet-ready tables. No
 * customer identifiers are included in these aggregate tables.
 */
export function buildReportAnalyticsExportTables(
  analytics: ReportAnalytics,
): ReportAnalyticsExportTables {
  const productPerformanceRows = analytics.productRows.map((row) => ({
    Product: row.label,
    "Valid Delivered Deals": row.eligibleDealCount,
    Sold: row.soldCount,
    "Not Sold": row.noCount,
    "Not Marked": row.unmarkedCount,
    "Recorded Outcomes": row.recordedCount,
    Penetration: rateOrBlank(row.penetrationRate),
    "Tracking Completion": rateOrBlank(row.trackingCompletionRate),
  }));

  const financingRows = analytics.financingRows.map((row) => ({
    "Financing Outcome": row.label,
    "Valid Delivered Deals": row.eligibleDealCount,
    Deals: row.dealCount,
    "Share of Delivered Deals": rateOrBlank(row.shareOfDeliveredDealsRate),
    "Credited Units": row.creditedUnits,
    "Total F&I Gross": row.fiGrossEnteredCount > 0 ? row.fiGrossCents / 100 : "",
    "Deals with Total F&I Gross Entered": row.fiGrossEnteredCount,
    "Deals Missing Total F&I Gross": row.fiGrossMissingCount,
    "F&I Gross Coverage": row.dealCount > 0 ? row.fiGrossEnteredCount / row.dealCount : "",
    "Recorded F&I Gross per Group Deal (PVR)": dollarsOrBlank(row.averageFiGrossPerDealCents),
    "Product Penetration Denominator (Group Deals)": row.dealCount,
    "Service Contract / Warranty Sold": row.products.serviceContract.yesCount,
    "Service Contract / Warranty Penetration":
      rateOrBlank(row.products.serviceContract.penetrationRate),
    "Tire & Wheel Sold": row.products.tireWheel.yesCount,
    "Tire & Wheel Penetration": rateOrBlank(row.products.tireWheel.penetrationRate),
    "GAP Sold": row.products.gap.yesCount,
    "GAP Penetration within Financing Group": rateOrBlank(row.products.gap.penetrationRate),
    "At Least One Tracked Product Deals": row.products.anyProduct.qualifyingDealCount,
    "Tracked Product Attachment": rateOrBlank(row.products.anyProduct.penetrationRate),
    "Tracked Products Sold": row.products.totalProductUnitsSold,
    "Tracked Products per Group Deal (PPD)": row.products.averageProductsPerDeliveredDeal ?? "",
    "Financing Scope":
      "Payment-method groups are mutually exclusive. Older No answers remain Cash / outside not specified until a method is selected. Financing is not an F&I product.",
  }));

  const productMixBundleRows: WorksheetRow[] = [
    {
      Section: "Portfolio threshold",
      "Mix or Bundle": "Any tracked product",
      Definition: "At least one product marked Yes",
      Deals: analytics.products.anyProduct.qualifyingDealCount,
      "Valid Delivered Deals": analytics.products.anyProduct.eligibleDealCount,
      Penetration: rateOrBlank(analytics.products.anyProduct.penetrationRate),
      "Confirmed Not Qualifying": analytics.products.anyProduct.confirmedNotQualifyingDealCount,
      Undetermined: analytics.products.anyProduct.undeterminedDealCount,
      "Important Note": "Unmarked product outcomes remain undetermined, not No.",
    },
    {
      Section: "Portfolio threshold",
      "Mix or Bundle": "Two or more tracked products",
      Definition: "At least two products marked Yes",
      Deals: analytics.products.twoOrMoreProducts.qualifyingDealCount,
      "Valid Delivered Deals": analytics.products.twoOrMoreProducts.eligibleDealCount,
      Penetration: rateOrBlank(analytics.products.twoOrMoreProducts.penetrationRate),
      "Confirmed Not Qualifying": analytics.products.twoOrMoreProducts.confirmedNotQualifyingDealCount,
      Undetermined: analytics.products.twoOrMoreProducts.undeterminedDealCount,
      "Important Note": "Unmarked product outcomes remain undetermined, not No.",
    },
    {
      Section: "Portfolio threshold",
      "Mix or Bundle": "All three tracked products",
      Definition: "All three products marked Yes",
      Deals: analytics.products.allThreeProducts.qualifyingDealCount,
      "Valid Delivered Deals": analytics.products.allThreeProducts.eligibleDealCount,
      Penetration: rateOrBlank(analytics.products.allThreeProducts.penetrationRate),
      "Confirmed Not Qualifying": analytics.products.allThreeProducts.confirmedNotQualifyingDealCount,
      Undetermined: analytics.products.allThreeProducts.undeterminedDealCount,
      "Important Note": "Unmarked product outcomes remain undetermined, not No.",
    },
  ];

  const exactMixLabels: Array<[keyof typeof analytics.products.exactMix, string]> = [
    ["noProducts", "No tracked products"],
    ["serviceContractOnly", "Service contract only"],
    ["tireWheelOnly", "Tire & Wheel only"],
    ["gapOnly", "GAP only"],
    ["serviceContractAndTireWheel", "Service contract + Tire & Wheel only"],
    ["serviceContractAndGap", "Service contract + GAP only"],
    ["tireWheelAndGap", "Tire & Wheel + GAP only"],
    ["allThreeProducts", "All three products"],
    ["incompleteTracking", "Incomplete product tracking"],
  ];
  for (const [key, label] of exactMixLabels) {
    const dealCount = analytics.products.exactMix[key];
    productMixBundleRows.push({
      Section: key === "incompleteTracking" ? "Data quality" : "Exact product mix",
      "Mix or Bundle": label,
      Definition:
        key === "incompleteTracking"
          ? "At least one product outcome is not marked"
          : "Exact combination; excludes deals with unmarked product outcomes",
      Deals: dealCount,
      "Valid Delivered Deals": analytics.population.deliveredDealCount,
      Penetration:
        analytics.population.deliveredDealCount > 0
          ? dealCount / analytics.population.deliveredDealCount
          : "",
      "Confirmed Not Qualifying": "",
      Undetermined: key === "incompleteTracking" ? dealCount : "",
      "Important Note": "Exact product-mix rows are mutually exclusive.",
    });
  }

  for (const row of analytics.bundleRows) {
    productMixBundleRows.push({
      Section: "Inclusive bundle",
      "Mix or Bundle": row.label,
      Definition: "Every listed product is marked Yes; other products may also be present",
      Deals: row.dealCount,
      "Valid Delivered Deals": row.eligibleDealCount,
      Penetration: rateOrBlank(row.penetrationRate),
      "Confirmed Not Qualifying": "",
      Undetermined: "",
      "Important Note":
        "Inclusive bundles overlap. All-three deals also appear in each matching pair; do not add bundle counts.",
    });
  }

  const totalProductOutcomeSlots = analytics.quality.eligibleDealCount * 3;
  const totalAllOutcomeSlots = analytics.quality.eligibleDealCount * 4;
  const dataQualityRows: WorksheetRow[] = [
    { Section: "Population", Metric: "Analyzed records", Value: analytics.population.analyzedRecordCount, Interpretation: "All calculated records supplied to this report." },
    { Section: "Population", Metric: "Active records", Value: analytics.population.activeRecordCount, Interpretation: "Records not marked deleted." },
    { Section: "Population", Metric: "Valid delivered deals", Value: analytics.population.deliveredDealCount, Interpretation: "Denominator for product and financing penetration." },
    { Section: "Population", Metric: "Credited units", Value: analytics.population.creditedUnits, Interpretation: "Separate from delivered-deal penetration denominators." },
    { Section: "Population", Metric: "Pending records", Value: analytics.population.pendingRecordCount, Interpretation: "Not included in delivered-deal penetration." },
    { Section: "Population", Metric: "Excluded delivered records", Value: analytics.population.excludedDeliveredRecordCount, Interpretation: "Delivered rows excluded by commission-engine validity rules." },
    { Section: "Population", Metric: "Deleted records supplied", Value: analytics.population.deletedRecordCount, Interpretation: "Visible only when the caller includes deleted records." },
    { Section: "Outcome tracking", Metric: "Deals with all product outcomes marked", Value: analytics.quality.fullyTrackedProductDealCount, Interpretation: "Service contract, Tire & Wheel, and GAP are each Yes or No." },
    { Section: "Outcome tracking", Metric: "Deals with incomplete product tracking", Value: analytics.quality.incompletelyTrackedProductDealCount, Interpretation: "At least one product outcome is Not marked." },
    { Section: "Outcome tracking", Metric: "Deals with all product and financing outcomes marked", Value: analytics.quality.fullyTrackedAllOutcomesDealCount, Interpretation: "All four outcomes are explicitly Yes or No." },
    { Section: "Outcome tracking", Metric: "Deals with any unmarked outcome", Value: analytics.quality.dealsWithAnyUnmarkedOutcomeCount, Interpretation: "At least one product or financing outcome is Not marked." },
    { Section: "Outcome tracking", Metric: "Product outcome fields recorded", Value: analytics.quality.recordedProductOutcomeCount, Interpretation: `${totalProductOutcomeSlots} possible product outcome fields across valid delivered deals.` },
    { Section: "Outcome tracking", Metric: "Product outcome fields not marked", Value: analytics.quality.unmarkedProductOutcomeCount, Interpretation: "Unmarked is unknown, not No." },
    { Section: "Outcome tracking", Metric: "Product outcome tracking completion", Value: totalProductOutcomeSlots > 0 ? analytics.quality.recordedProductOutcomeCount / totalProductOutcomeSlots : "", Interpretation: "Recorded product outcomes divided by all possible product outcome fields." },
    { Section: "Outcome tracking", Metric: "Financing outcomes recorded", Value: analytics.quality.recordedFinanceOutcomeCount, Interpretation: `${analytics.quality.eligibleDealCount} possible financing outcomes.` },
    { Section: "Outcome tracking", Metric: "Financing outcomes not marked", Value: analytics.quality.unmarkedFinanceOutcomeCount, Interpretation: "Unmarked financing remains unknown." },
    { Section: "Payment method", Metric: "Cash sales", Value: analytics.finance.segments.cash.dealCount, Interpretation: "Delivered sales explicitly marked Cash. Older No financing answers are not assumed to be cash." },
    { Section: "Payment method", Metric: "Outside-financed sales", Value: analytics.finance.segments.outsideFinancing.dealCount, Interpretation: "Delivered sales explicitly marked Outside financing." },
    { Section: "Payment method", Metric: "Cash / outside not specified", Value: analytics.finance.segments.notDealerFinanced.dealCount, Interpretation: "Older delivered sales marked not dealer financed, without a cash or outside-financing choice." },
    { Section: "Payment method", Metric: "Payment method not marked", Value: analytics.finance.segments.financeOutcomeUnmarked.dealCount, Interpretation: "Delivered sales without a payment method or a legacy financing answer." },
    { Section: "Outcome tracking", Metric: "All-outcome tracking completion", Value: totalAllOutcomeSlots > 0 ? (analytics.quality.recordedProductOutcomeCount + analytics.quality.recordedFinanceOutcomeCount) / totalAllOutcomeSlots : "", Interpretation: "Recorded product and financing outcomes divided by all possible fields." },
    { Section: "Gross coverage", Metric: "Front gross entered", Value: analytics.quality.frontGrossEnteredCount, Interpretation: "Valid delivered deals with a front gross amount." },
    { Section: "Gross coverage", Metric: "Front gross missing", Value: analytics.quality.frontGrossMissingCount, Interpretation: "Valid delivered deals without a front gross amount." },
    { Section: "Gross coverage", Metric: "Total F&I gross entered", Value: analytics.quality.fiGrossEnteredCount, Interpretation: "Valid delivered deals with a total F&I gross amount." },
    { Section: "Gross coverage", Metric: "Total F&I gross missing", Value: analytics.quality.fiGrossMissingCount, Interpretation: "Valid delivered deals without a total F&I gross amount." },
    { Section: "Gross coverage", Metric: "F&I gross coverage", Value: analytics.population.deliveredDealCount > 0 ? analytics.gross.fi.enteredCount / analytics.population.deliveredDealCount : "", Interpretation: "Deals with an entered F&I amount divided by delivered deals. Entered $0 counts as complete; a blank amount does not." },
    { Section: "Performance metrics", Metric: "Recorded F&I gross per delivered sale (PVR)", Value: dollarsOrBlank(analytics.gross.fi.averagePerDeliveredDealCents), Interpretation: "Recorded total F&I gross divided by every delivered sale, including sales with $0. Missing amounts keep the result incomplete; blank when no amounts are entered. Only gross entered in this tracker is included." },
    { Section: "Performance metrics", Metric: "Estimated F&I commission per delivered sale", Value: dollarsOrBlank(analytics.commission.averageFiCommissionPerDeliveredDealCents), Interpretation: "Estimated F&I commission using each month's pay plan divided by every delivered sale. Incomplete while F&I amounts are missing." },
    { Section: "Performance metrics", Metric: "Tracked products per delivered sale (PPD)", Value: analytics.products.averageProductsPerDeliveredDeal ?? "", Interpretation: "Service contract, Tire & Wheel, and GAP marked Yes divided by all delivered sales. Dealer financing is not a product. Unmarked products can make this result incomplete." },
    { Section: "Performance metrics", Metric: "Finance Penetration", Value: rateOrBlank(analytics.finance.dealerFinance.penetrationRate), Interpretation: "Delivered sales marked financed through the dealership divided by all delivered sales. Unmarked financing stays in the denominator." },
    { Section: "Performance metrics", Metric: "GAP penetration - all delivered sales", Value: rateOrBlank(analytics.products.gap.penetrationRate), Interpretation: "GAP marked Yes divided by all delivered sales. This is an all-sales view, not a GAP-eligibility rate." },
    { Section: "Performance metrics", Metric: "GAP penetration - dealer-financed sales", Value: rateOrBlank(analytics.finance.gapOnDealerFinanced.penetrationRate), Interpretation: "GAP marked Yes on dealer-financed sales divided by all dealer-financed delivered sales. Outside-financed and unmarked-financing sales are excluded; this is not a measure of GAP eligibility." },
    { Section: "Performance metrics", Metric: "Dealer-financed sales (GAP denominator)", Value: analytics.finance.gapOnDealerFinanced.eligibleDealCount, Interpretation: "Delivered sales explicitly marked dealer financed." },
    { Section: "Performance metrics", Metric: "GAP sold on dealer-financed sales", Value: analytics.finance.gapOnDealerFinanced.yesCount, Interpretation: "Dealer-financed delivered sales with GAP marked Yes." },
    { Section: "Performance metrics", Metric: "GAP not marked on dealer-financed sales", Value: analytics.finance.gapOnDealerFinanced.unmarkedCount, Interpretation: "Missing GAP answers remain unknown and stay in the dealer-financed denominator." },
    { Section: "Calculation source", Metric: "F&I report and commission amount", Value: "Total F&I gross", Interpretation: "This authoritative deal total drives F&I money reporting and commission estimates." },
  ];

  return {
    productPerformanceRows,
    financingRows,
    productMixBundleRows,
    dataQualityRows,
  };
}

/** Builds the identifier-bearing workbook table under the report privacy choice. */
export function buildSalesDetailExportRows(
  calculatedSales: CalculatedSale[],
  includeLastNames: boolean,
  todayDate = todayDateOnly(),
): WorksheetRow[] {
  const attentionBySale = new Map(
    getAttentionRecords(calculatedSales, todayDate)
      .map((record) => [record.sale.id, record]),
  );
  return calculatedSales.map((item) => ({
    "Sale Date": item.sale.saleDate,
    ...(includeLastNames ? { "Customer Last Name": item.sale.customerLastName } : {}),
    "Stock Number": item.sale.stockNumber,
    Vehicle: item.sale.vehicleDescription,
    Status: item.sale.status,
    "Included in Totals": item.countsTowardVolume ? "Yes" : "No",
    "Unit Credit": item.sale.unitCreditBasis / 1_000,
    "Front Gross": dollarsOrBlank(item.sale.frontGrossCents),
    "Total F&I Gross": dollarsOrBlank(item.sale.fiGrossCents),
    "Service Contract / Warranty Sold": trackedOutcomeLabel(item.sale.serviceContractSold),
    "Tire & Wheel Sold": trackedOutcomeLabel(item.sale.tireWheelSold),
    "GAP Sold": trackedOutcomeLabel(item.sale.gapSold),
    "Dealer Financed": trackedOutcomeLabel(dealerFinancingOutcome(item.sale)),
    "Payment Method": paymentMethodLabel(item.sale),
    "Front Rate": item.frontRateBps / 10_000,
    "Front Commission": item.frontCommissionCents / 100,
    "F&I Commission": item.fiCommissionCents / 100,
    "Sale Commission": item.estimatedCommissionCents / 100,
    "Attention Status": attentionBySale.has(item.sale.id)
      ? attentionSummary(attentionBySale.get(item.sale.id)!)
      : "No attention items",
  }));
}

export async function exportSalesWorkbook(
  sales: Sale[],
  settings: ProfileSettings,
  selectedMonth: string,
  includeLastNames: boolean,
): Promise<void> {
  const XLSX = await import("xlsx");
  const payPlanSchedule = getPayPlanSchedule(settings);
  const selectedPayPlan = getPayPlanForMonth(payPlanSchedule, selectedMonth);
  const selected = calculateMonth(
    sales,
    selectedMonth,
    payPlanSchedule,
    settings.actualPaidByMonth[selectedMonth] ?? null,
  );
  const year = yearForMonth(selectedMonth);
  const yearly = calculateYear(sales, year, payPlanSchedule, settings.actualPaidByMonth);
  const selectedMilestone = getBonusMilestone(
    selected.deliveredCount,
    selectedPayPlan.bonusTiers,
  );
  const monthlyDeliveryGoal = getDeliveryGoalForMonth(settings, selectedMonth);
  const monthlyCommissionGoalCents = getCommissionGoalForMonth(settings, selectedMonth);
  const pace = calculateWorkdayPace({
    monthKey: selectedMonth,
    deliveredCount: selected.deliveredCount,
    monthlyGoal: monthlyDeliveryGoal,
    daysOff: settings.daysOffByMonth[selectedMonth] ?? [],
    todayDate: todayDateOnly(),
  });
  const selectedPerformance = calculateMonthlyPerformance(selected);
  const selectedFiMetrics = calculateFiPenetrationMetrics(selected.calculatedSales);
  const selectedFi = calculateFiPenetration(selected.calculatedSales);
  const selectedAnalytics = calculateMonthReportAnalytics(selected);
  const analyticsTables = buildReportAnalyticsExportTables(selectedAnalytics);
  const weekly = calculateWeeklyPerformance({
    summary: selected,
    monthlyGoal: monthlyDeliveryGoal,
    daysOff: settings.daysOffByMonth[selectedMonth] ?? [],
    todayDate: todayDateOnly(),
  });
  const commissionRunRate = calculateCommissionRunRate(selected, pace, selectedPayPlan);
  const yearPerformance = calculatePeriodPerformance(yearly, selectedMonth);
  let priorBonusTotalCents = 0;
  const bonusScheduleRows = [...selectedPayPlan.bonusTiers]
    .sort((a, b) => a.minimumDelivered - b.minimumDelivered)
    .map((tier) => {
      const addedAmountCents = tier.amountCents - priorBonusTotalCents;
      priorBonusTotalCents = tier.amountCents;
      return {
        "Delivered Milestone": tier.minimumDelivered,
        "Added at Milestone": addedAmountCents / 100,
        "Running Monthly Total": tier.amountCents / 100,
        Note: tier.minimumDelivered === 11 ? "Demo bonus" : "",
      };
    });

  const summaryRows = [
    ["Sales Commission Report", monthLabel(selectedMonth)],
    ["Salesperson", settings.salespersonName || "Not entered"],
    ["Store", settings.storeName],
    ["Generated", new Date().toLocaleString("en-US")],
    ["Plan name", selectedPayPlan.version],
    ["Pay plan effective month", selectedPayPlan.effectiveMonth],
    ["Bonus method", "Cumulative milestone add-ons"],
    [],
    ["Metric", "Value"],
    ["Delivered", selected.deliveredCount],
    ["Credited units", selected.creditedUnitsBasis / 1_000],
    ["Monthly delivery goal", monthlyDeliveryGoal],
    ["Needed by end of current week", weekly.goal.neededByEndOfCurrentWeek ?? "Not applicable"],
    ["Scheduled workdays", pace.scheduledWorkdays],
    ["Elapsed scheduled workdays", pace.elapsedWorkdays],
    ["Remaining scheduled workdays", pace.remainingWorkdays],
    ["Personal days off", pace.daysOff.length],
    [
      pace.status === "complete"
        ? "Finished deliveries"
        : pace.status === "no-workdays"
          ? "Workday pace"
          : "Projected deliveries",
      pace.status === "no-workdays"
        ? "No scheduled workdays"
        : pace.projectedDeliveries ?? "Not started",
    ],
    [
      "Deliveries needed per remaining workday",
      pace.requiredPerRemainingWorkday === null
        ? "Not available"
        : Math.round(pace.requiredPerRemainingWorkday * 100) / 100,
    ],
    ["Front gross", selected.frontGrossCents / 100],
    ["Total F&I gross", selected.fiGrossCents / 100],
    ["Recorded front gross per delivered sale", dollarsOrBlank(selectedAnalytics.gross.front.averagePerDeliveredDealCents)],
    ["Recorded F&I gross per delivered sale (PVR)", dollarsOrBlank(selectedAnalytics.gross.fi.averagePerDeliveredDealCents)],
    ["Estimated F&I commission per delivered sale", dollarsOrBlank(selectedAnalytics.commission.averageFiCommissionPerDeliveredDealCents)],
    ["F&I amount entered", `${selectedPerformance.fiAmountEnteredCount} of ${selectedPerformance.deliveredCount}`],
    ["F&I amount missing", selectedAnalytics.gross.fi.missingCount],
    ["F&I gross coverage", selected.deliveredCount > 0 ? selectedAnalytics.gross.fi.enteredCount / selected.deliveredCount : ""],
    ["PVR basis", "Recorded F&I gross / all delivered sales, including $0 sales; incomplete until all gross is entered"],
    ["Service contract / warranty penetration", formatPenetration(selectedFiMetrics.serviceContractSoldCount, selectedFiMetrics.deliveredCount)],
    ["Tire & Wheel penetration", formatPenetration(selectedFiMetrics.tireWheelSoldCount, selectedFiMetrics.deliveredCount)],
    ["GAP penetration - all delivered sales", formatPenetration(selectedFiMetrics.gapSoldCount, selectedFiMetrics.deliveredCount)],
    ["GAP penetration - dealer-financed sales", formatPenetration(selectedAnalytics.finance.gapOnDealerFinanced.yesCount, selectedAnalytics.finance.gapOnDealerFinanced.eligibleDealCount)],
    ["Dealer-financed sales (GAP denominator)", selectedAnalytics.finance.gapOnDealerFinanced.eligibleDealCount],
    ["GAP sold on dealer-financed sales", selectedAnalytics.finance.gapOnDealerFinanced.yesCount],
    ["GAP not marked on dealer-financed sales", selectedAnalytics.finance.gapOnDealerFinanced.unmarkedCount],
    ["Finance Penetration", formatPenetration(selectedFiMetrics.dealerFinancedCount, selectedFiMetrics.deliveredCount)],
    ["Cash sales", selectedAnalytics.finance.segments.cash.dealCount],
    ["Outside-financed sales", selectedAnalytics.finance.segments.outsideFinancing.dealCount],
    ["Cash / outside not specified", selectedAnalytics.finance.segments.notDealerFinanced.dealCount],
    ["Payment method not marked", selectedAnalytics.finance.segments.financeOutcomeUnmarked.dealCount],
    ["Service contract / warranty not marked", selectedFi.serviceContract.unrecordedCount],
    ["Tire & Wheel not marked", selectedFi.tireWheel.unrecordedCount],
    ["GAP not marked", selectedFi.gap.unrecordedCount],
    ["Dealer financing not marked", selectedFi.dealerFinanced.unrecordedCount],
    ["Any tracked F&I product penetration", formatPenetration(selectedFiMetrics.anyTrackedProductSoldCount, selectedFiMetrics.deliveredCount)],
    ["Tracked F&I products sold", selectedFiMetrics.trackedProductsSoldCount],
    ["Tracked products per delivered sale (PPD)", selectedFiMetrics.deliveredCount === 0 ? "" : selectedFiMetrics.trackedProductsSoldCount / selectedFiMetrics.deliveredCount],
    ["Deals with two or more tracked products", selectedAnalytics.products.twoOrMoreProducts.qualifyingDealCount],
    ["Deals with all three tracked products", selectedAnalytics.products.allThreeProducts.qualifyingDealCount],
    ["Confirmed no-product deals", selectedAnalytics.products.confirmedNoProductDealCount],
    ["Deals with incomplete product tracking", selectedAnalytics.products.incompletelyTrackedDealCount],
    ["Front rate", selected.frontRateBps / 10_000],
    ["Front commission", selected.frontCommissionCents / 100],
    ["F&I commission", selected.fiCommissionCents / 100],
    ["Sales commission", selected.coreCommissionCents / 100],
    ["Qualifying bonus milestone", selectedMilestone?.minimumDelivered ?? "None"],
    ["Added at qualifying milestone", (selectedMilestone?.addedAmountCents ?? 0) / 100],
    ["Cumulative bonus earned", selected.potentialBonusCents / 100],
    ["Bonus included", selected.bonusIncludedCents / 100],
    ["Estimated commission", selected.estimatedCommissionCents / 100],
    ["Projected month-end deliveries low", commissionRunRate?.low.deliveredCount ?? "Not available"],
    ["Projected month-end deliveries high", commissionRunRate?.high.deliveredCount ?? "Not available"],
    ["Projected month-end commission low", commissionRunRate ? commissionRunRate.low.estimatedCommissionCents / 100 : "Not available"],
    ["Projected month-end commission high", commissionRunRate ? commissionRunRate.high.estimatedCommissionCents / 100 : "Not available"],
    ["Monthly commission goal", monthlyCommissionGoalCents === null ? "" : monthlyCommissionGoalCents / 100],
    ["YTD delivered through selected month", yearPerformance.deliveredCount],
    ["YTD estimated commission through selected month", yearPerformance.estimatedCommissionCents / 100],
    ["Actual-paid months reconciled", yearPerformance.actualPaidMonthCount],
    ["Actual paid for reconciled months", yearPerformance.actualPaidMonthCount ? yearPerformance.actualPaidCents / 100 : ""],
    ["Estimated commission for reconciled months", yearPerformance.actualPaidMonthCount ? yearPerformance.reconciledEstimateCents / 100 : ""],
    ["Reconciled payroll variance", yearPerformance.payrollVarianceCents === null ? "" : yearPerformance.payrollVarianceCents / 100],
    ["Actual paid", selected.actualPaidCents === null ? "" : selected.actualPaidCents / 100],
    ["Payroll variance", selected.payrollVarianceCents === null ? "" : selected.payrollVarianceCents / 100],
  ];

  const detailRows = buildSalesDetailExportRows(
    selected.calculatedSales,
    includeLastNames,
  );

  const weeklyRows = weekly.weeks.map((week, index) => {
    const weekAnalytics = calculateReportAnalytics(
      selected.calculatedSales.filter(
        (item) => item.sale.saleDate >= week.startDate && item.sale.saleDate <= week.endDate,
      ),
    );
    return {
      Week: `Week ${index + 1}`,
      "Date Range": `${week.startDate} to ${week.endDate}`,
      State: week.state === "current" ? "Current" : week.state === "past" ? "Closed" : "Upcoming",
      Sold: week.deliveredCount,
      "Credited Units": week.creditedUnits,
      "Scheduled Workdays": week.scheduledWorkdays,
      "Elapsed Workdays": week.elapsedWorkdays,
      "Remaining Workdays": week.remainingWorkdays,
      "Days Off": week.daysOff.length,
      "Weekly Target Share": week.goal.targetShareForWeek ?? "",
      "Cumulative Target": week.goal.targetByWeekEnd ?? "",
      "Needed by Week End": week.goal.deliveriesNeededByWeekEnd ?? "",
      "Expected by Now": week.state === "future" ? "" : week.goal.expectedDeliveriesToDate,
      "Pace Difference": week.state === "future" ? "" : week.goal.paceDeltaToDate,
      "Front Gross": week.frontGrossCents / 100,
      "Total F&I Gross": week.fiGrossCents / 100,
      "Recorded F&I Gross per Delivered Sale (PVR)": dollarsOrBlank(weekAnalytics.gross.fi.averagePerDeliveredDealCents),
      "Estimated F&I Commission per Delivered Sale": dollarsOrBlank(weekAnalytics.commission.averageFiCommissionPerDeliveredDealCents),
      "F&I Gross Entered": weekAnalytics.gross.fi.enteredCount,
      "F&I Gross Missing": weekAnalytics.gross.fi.missingCount,
      "Sales Commission": week.estimatedCoreCommissionCents / 100,
      "Service Contract / Warranty Sold": week.fi.serviceContract.soldCount,
      "Tire & Wheel Sold": week.fi.tireWheel.soldCount,
      "GAP Sold": week.fi.gap.soldCount,
      "GAP Penetration - All Delivered Sales": rateOrBlank(weekAnalytics.products.gap.penetrationRate),
      "GAP Penetration - Dealer-Financed Sales": rateOrBlank(weekAnalytics.finance.gapOnDealerFinanced.penetrationRate),
      "Dealer-Financed Sales (GAP Denominator)": weekAnalytics.finance.gapOnDealerFinanced.eligibleDealCount,
      "GAP Sold on Dealer-Financed Sales": weekAnalytics.finance.gapOnDealerFinanced.yesCount,
      "GAP Not Marked on Dealer-Financed Sales": weekAnalytics.finance.gapOnDealerFinanced.unmarkedCount,
      "Dealer Financed": week.fi.dealerFinanced.soldCount,
      "Cash Sales": weekAnalytics.finance.segments.cash.dealCount,
      "Outside-Financed Sales": weekAnalytics.finance.segments.outsideFinancing.dealCount,
      "Cash / Outside Not Specified": weekAnalytics.finance.segments.notDealerFinanced.dealCount,
      "Payment Method Not Marked": weekAnalytics.finance.segments.financeOutcomeUnmarked.dealCount,
      "Finance Penetration": rateOrBlank(weekAnalytics.finance.dealerFinance.penetrationRate),
      "Any Product Deals": weekAnalytics.products.anyProduct.qualifyingDealCount,
      "Tracked Products per Delivered Sale (PPD)": weekAnalytics.products.averageProductsPerDeliveredDeal ?? "",
      "Two or More Product Deals": weekAnalytics.products.twoOrMoreProducts.qualifyingDealCount,
      "All Three Product Deals": weekAnalytics.products.allThreeProducts.qualifyingDealCount,
      "Deals with Incomplete Product Tracking":
        weekAnalytics.products.incompletelyTrackedDealCount,
    };
  });

  const yearRows = yearly.map((month) => {
    const fiMetrics = calculateFiPenetrationMetrics(month.calculatedSales);
    const report = calculateMonthReportAnalytics(month);
    return {
      Month: monthLabel(month.monthKey),
      Delivered: month.deliveredCount,
      "Credited Units": month.creditedUnitsBasis / 1_000,
      "Front Gross": month.frontGrossCents / 100,
      "Total F&I Gross": month.fiGrossCents / 100,
      "Recorded Front Gross per Delivered Sale": dollarsOrBlank(report.gross.front.averagePerDeliveredDealCents),
      "Recorded F&I Gross per Delivered Sale (PVR)": dollarsOrBlank(report.gross.fi.averagePerDeliveredDealCents),
      "Estimated F&I Commission per Delivered Sale": dollarsOrBlank(report.commission.averageFiCommissionPerDeliveredDealCents),
      "F&I Gross Entered": report.gross.fi.enteredCount,
      "F&I Gross Missing": report.gross.fi.missingCount,
      "F&I Gross Coverage": month.deliveredCount > 0 ? report.gross.fi.enteredCount / month.deliveredCount : "",
      "Service Contract / Warranty Sold": fiMetrics.serviceContractSoldCount,
      "Service Contract / Warranty Penetration": penetrationRate(fiMetrics.serviceContractSoldCount, fiMetrics.deliveredCount),
      "Tire & Wheel Sold": fiMetrics.tireWheelSoldCount,
      "Tire & Wheel Penetration": penetrationRate(fiMetrics.tireWheelSoldCount, fiMetrics.deliveredCount),
      "GAP Sold": fiMetrics.gapSoldCount,
      "GAP Penetration - All Delivered Sales": penetrationRate(fiMetrics.gapSoldCount, fiMetrics.deliveredCount),
      "GAP Penetration - Dealer-Financed Sales": rateOrBlank(report.finance.gapOnDealerFinanced.penetrationRate),
      "Dealer-Financed Sales (GAP Denominator)": report.finance.gapOnDealerFinanced.eligibleDealCount,
      "GAP Sold on Dealer-Financed Sales": report.finance.gapOnDealerFinanced.yesCount,
      "GAP Not Marked on Dealer-Financed Sales": report.finance.gapOnDealerFinanced.unmarkedCount,
      "Dealer Financed": fiMetrics.dealerFinancedCount,
      "Cash Sales": report.finance.segments.cash.dealCount,
      "Outside-Financed Sales": report.finance.segments.outsideFinancing.dealCount,
      "Cash / Outside Not Specified": report.finance.segments.notDealerFinanced.dealCount,
      "Payment Method Not Marked": report.finance.segments.financeOutcomeUnmarked.dealCount,
      "Finance Penetration": penetrationRate(fiMetrics.dealerFinancedCount, fiMetrics.deliveredCount),
      "Any Tracked F&I Product Penetration": penetrationRate(fiMetrics.anyTrackedProductSoldCount, fiMetrics.deliveredCount),
      "Tracked F&I Products Sold": fiMetrics.trackedProductsSoldCount,
      "Tracked Products per Delivered Sale (PPD)": report.products.averageProductsPerDeliveredDeal ?? "",
      "Two or More Product Deals": report.products.twoOrMoreProducts.qualifyingDealCount,
      "All Three Product Deals": report.products.allThreeProducts.qualifyingDealCount,
      "Confirmed No-product Deals": report.products.confirmedNoProductDealCount,
      "Deals with Incomplete Product Tracking": report.products.incompletelyTrackedDealCount,
      "Front Rate": month.frontRateBps / 10_000,
      "Plan Name": month.payPlanVersion,
      "Sales Commission": month.coreCommissionCents / 100,
      "Cumulative Bonus Earned": month.potentialBonusCents / 100,
      "Bonus Included": month.bonusIncludedCents / 100,
      "Estimated Commission": month.estimatedCommissionCents / 100,
      "Actual Paid": month.actualPaidCents === null ? "" : month.actualPaidCents / 100,
      Variance: month.payrollVarianceCents === null ? "" : month.payrollVarianceCents / 100,
    };
  });

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  const detailSheet = XLSX.utils.json_to_sheet(detailRows);
  const yearSheet = XLSX.utils.json_to_sheet(yearRows);
  const weeklySheet = XLSX.utils.json_to_sheet(weeklyRows);
  const bonusScheduleSheet = XLSX.utils.json_to_sheet(bonusScheduleRows);
  const productPerformanceSheet = XLSX.utils.json_to_sheet(
    analyticsTables.productPerformanceRows,
  );
  const financingSheet = XLSX.utils.json_to_sheet(analyticsTables.financingRows);
  const productMixBundleSheet = XLSX.utils.json_to_sheet(
    analyticsTables.productMixBundleRows,
  );
  const dataQualitySheet = XLSX.utils.json_to_sheet(analyticsTables.dataQualityRows);
  summarySheet["!cols"] = [{ wch: 30 }, { wch: 28 }];
  detailSheet["!cols"] = Array.from({ length: Object.keys(detailRows[0] ?? {}).length }, () => ({ wch: 20 }));
  yearSheet["!cols"] = Array.from({ length: Object.keys(yearRows[0] ?? {}).length }, () => ({ wch: 21 }));
  weeklySheet["!cols"] = Array.from({ length: Object.keys(weeklyRows[0] ?? {}).length }, () => ({ wch: 19 }));
  bonusScheduleSheet["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 24 }, { wch: 24 }];
  productPerformanceSheet["!cols"] = Array.from(
    { length: Object.keys(analyticsTables.productPerformanceRows[0] ?? {}).length },
    (_, index) => ({ wch: index === 0 ? 30 : index === 12 ? 68 : 24 }),
  );
  financingSheet["!cols"] = Array.from(
    { length: Object.keys(analyticsTables.financingRows[0] ?? {}).length },
    (_, index) => ({ wch: index === 0 ? 24 : index === 20 ? 68 : 23 }),
  );
  productMixBundleSheet["!cols"] = Array.from(
    { length: Object.keys(analyticsTables.productMixBundleRows[0] ?? {}).length },
    (_, index) => ({ wch: index === 2 || index === 11 ? 62 : 24 }),
  );
  dataQualitySheet["!cols"] = [{ wch: 26 }, { wch: 48 }, { wch: 22 }, { wch: 78 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Monthly Summary");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Sales Detail");
  XLSX.utils.book_append_sheet(workbook, productPerformanceSheet, "Product Performance");
  XLSX.utils.book_append_sheet(workbook, financingSheet, "Financing");
  XLSX.utils.book_append_sheet(workbook, productMixBundleSheet, "Product Mix & Bundles");
  XLSX.utils.book_append_sheet(workbook, dataQualitySheet, "Data Quality");
  XLSX.utils.book_append_sheet(workbook, yearSheet, "Year Summary");
  XLSX.utils.book_append_sheet(workbook, weeklySheet, "Weekly Performance");
  XLSX.utils.book_append_sheet(workbook, bonusScheduleSheet, "Bonus Schedule");
  formatReportWorkbookNumbers(workbook);
  XLSX.writeFile(workbook, `${fileBase(settings, selectedMonth)}.xlsx`, { compression: true });
}

export function createDiagnostics(
  settings: ProfileSettings,
  sales: Sale[],
  storage: { usageBytes: number | null; quotaBytes: number | null; persisted: boolean | null },
): Blob {
  const year = yearForMonth(settings.selectedMonth);
  const payPlanSchedule = getPayPlanSchedule(settings);
  const selectedPayPlan = getPayPlanForMonth(payPlanSchedule, settings.selectedMonth);
  const months = calculateYear(sales, year, payPlanSchedule, settings.actualPaidByMonth);
  const diagnostic = {
    appVersion: APP_VERSION,
    databaseSchema: 1,
    generatedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    online: navigator.onLine,
    serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    storage,
    recordCounts: {
      activeSales: sales.filter((sale) => !sale.deletedAt).length,
      deletedSales: sales.filter((sale) => sale.deletedAt).length,
      reviewItemsThisYear: months.reduce((sum, month) => sum + month.reviewCount, 0),
    },
    selectedMonth: settings.selectedMonth,
    payPlanVersion: selectedPayPlan.version,
  };
  return new Blob([JSON.stringify(diagnostic, null, 2)], { type: "application/json" });
}

export function describeExport(settings: ProfileSettings, monthKey: string): string {
  const payPlan = getPayPlanForMonth(getPayPlanSchedule(settings), monthKey);
  return `${monthLabel(monthKey)} · ${formatPercent(payPlan.baseFrontRateBps)} base · includes cumulative volume bonus`;
}

export function reportRowForSale(sale: Sale): string[] {
  return [
    sale.saleDate,
    sale.customerLastName,
    sale.stockNumber,
    sale.vehicleDescription,
    sale.status,
    formatUnitCredit(sale.unitCreditBasis),
    sale.frontGrossCents === null ? "" : formatCurrency(sale.frontGrossCents),
    sale.fiGrossCents === null ? "" : formatCurrency(sale.fiGrossCents),
    trackedOutcomeLabel(sale.serviceContractSold),
    trackedOutcomeLabel(sale.tireWheelSold),
    trackedOutcomeLabel(sale.gapSold),
    trackedOutcomeLabel(dealerFinancingOutcome(sale)),
    paymentMethodLabel(sale),
    monthKeyFromDate(sale.saleDate),
  ];
}
