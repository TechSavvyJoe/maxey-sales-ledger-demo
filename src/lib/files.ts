import { z } from "zod";
import { attentionSummary, getAttentionRecords } from "@/domain/attention";
import { calculateMonth, calculateYear, getBonusMilestone } from "@/domain/commission";
import { isValidDateOnly, monthKeyFromDate, monthLabel, todayDateOnly, yearForMonth } from "@/domain/date";
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
  status: z.enum(["delivered", "pending", "void"]),
  unitCreditBasis: z.number().int().min(0).max(2_000),
  frontGrossCents: z.number().int().min(-100_000_000).max(100_000_000).nullable(),
  fiGrossCents: z.number().int().min(-100_000_000).max(100_000_000).nullable(),
  serviceContractSold: z.boolean().optional(),
  tireWheelSold: z.boolean().optional(),
  gapSold: z.boolean().optional(),
  dealerFinanced: z.boolean().optional(),
  notes: z.string().max(500),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  revision: z.number().int().min(1),
  deletedAt: dateTimeSchema.optional(),
  source: z.enum(["manual", "legacy-xlsx", "json-restore", "demo"]).optional(),
  sourceReference: z.string().max(240).optional(),
});

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
    "Front Rate",
    "Front Commission",
    "F&I Commission",
    "Sale-level Core Commission (Monthly Bonus Excluded)",
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
    csvText(trackedOutcomeLabel(item.sale.dealerFinanced)),
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
    "Positive Total F&I Gross Deals": row.positiveFiGrossDealCount,
    "Average Total F&I Gross per Deal": dollarsOrBlank(row.averageFiGrossPerDealCents),
    "Service Contract / Warranty Sold": row.products.serviceContract.yesCount,
    "Service Contract / Warranty Penetration":
      rateOrBlank(row.products.serviceContract.penetrationRate),
    "Tire & Wheel Sold": row.products.tireWheel.yesCount,
    "Tire & Wheel Penetration": rateOrBlank(row.products.tireWheel.penetrationRate),
    "GAP Sold": row.products.gap.yesCount,
    "GAP Penetration": rateOrBlank(row.products.gap.penetrationRate),
    "Any Product Deals": row.products.anyProduct.qualifyingDealCount,
    "Any Product Penetration": rateOrBlank(row.products.anyProduct.penetrationRate),
    "Products Sold": row.products.totalProductUnitsSold,
    "Products per Deal": row.products.averageProductsPerDeliveredDeal ?? "",
    "Financing Scope":
      "Financing groups are mutually exclusive. Dealer financed is a financing outcome, not an F&I product.",
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
    { Section: "Population", Metric: "Void records", Value: analytics.population.voidRecordCount, Interpretation: "Not included in delivered-deal penetration." },
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
    { Section: "Outcome tracking", Metric: "All-outcome tracking completion", Value: totalAllOutcomeSlots > 0 ? (analytics.quality.recordedProductOutcomeCount + analytics.quality.recordedFinanceOutcomeCount) / totalAllOutcomeSlots : "", Interpretation: "Recorded product and financing outcomes divided by all possible fields." },
    { Section: "Gross coverage", Metric: "Front gross entered", Value: analytics.quality.frontGrossEnteredCount, Interpretation: "Valid delivered deals with a front gross amount." },
    { Section: "Gross coverage", Metric: "Front gross missing", Value: analytics.quality.frontGrossMissingCount, Interpretation: "Valid delivered deals without a front gross amount." },
    { Section: "Gross coverage", Metric: "Total F&I gross entered", Value: analytics.quality.fiGrossEnteredCount, Interpretation: "Valid delivered deals with a total F&I gross amount." },
    { Section: "Gross coverage", Metric: "Total F&I gross missing", Value: analytics.quality.fiGrossMissingCount, Interpretation: "Valid delivered deals without a total F&I gross amount." },
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
    "Dealer Financed": trackedOutcomeLabel(item.sale.dealerFinanced),
    "Front Rate": item.frontRateBps / 10_000,
    "Front Commission": item.frontCommissionCents / 100,
    "F&I Commission": item.fiCommissionCents / 100,
    "Core Commission": item.estimatedCommissionCents / 100,
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
    ["Front gross per delivery", selectedPerformance.frontGrossPerDeliveryCents === null ? "" : selectedPerformance.frontGrossPerDeliveryCents / 100],
    ["F&I gross per delivery", selectedPerformance.fiGrossPerDeliveryCents === null ? "" : selectedPerformance.fiGrossPerDeliveryCents / 100],
    ["Positive F&I gross deliveries", `${selectedPerformance.positiveFiGrossCount} of ${selectedPerformance.deliveredCount}`],
    ["F&I amount entered", `${selectedPerformance.fiAmountEnteredCount} of ${selectedPerformance.deliveredCount}`],
    ["Service contract / warranty penetration", formatPenetration(selectedFiMetrics.serviceContractSoldCount, selectedFiMetrics.deliveredCount)],
    ["Tire & Wheel penetration", formatPenetration(selectedFiMetrics.tireWheelSoldCount, selectedFiMetrics.deliveredCount)],
    ["GAP penetration", formatPenetration(selectedFiMetrics.gapSoldCount, selectedFiMetrics.deliveredCount)],
    ["Dealer financing penetration", formatPenetration(selectedFiMetrics.dealerFinancedCount, selectedFiMetrics.deliveredCount)],
    ["Service contract / warranty not marked", selectedFi.serviceContract.unrecordedCount],
    ["Tire & Wheel not marked", selectedFi.tireWheel.unrecordedCount],
    ["GAP not marked", selectedFi.gap.unrecordedCount],
    ["Dealer financing not marked", selectedFi.dealerFinanced.unrecordedCount],
    ["Any tracked F&I product penetration", formatPenetration(selectedFiMetrics.anyTrackedProductSoldCount, selectedFiMetrics.deliveredCount)],
    ["Tracked F&I products sold", selectedFiMetrics.trackedProductsSoldCount],
    ["Tracked products per valid delivery", selectedFiMetrics.deliveredCount === 0 ? "" : selectedFiMetrics.trackedProductsSoldCount / selectedFiMetrics.deliveredCount],
    ["Deals with two or more tracked products", selectedAnalytics.products.twoOrMoreProducts.qualifyingDealCount],
    ["Deals with all three tracked products", selectedAnalytics.products.allThreeProducts.qualifyingDealCount],
    ["Confirmed no-product deals", selectedAnalytics.products.confirmedNoProductDealCount],
    ["Deals with incomplete product tracking", selectedAnalytics.products.incompletelyTrackedDealCount],
    ["Front rate", selected.frontRateBps / 10_000],
    ["Front commission", selected.frontCommissionCents / 100],
    ["F&I commission", selected.fiCommissionCents / 100],
    ["Core estimated commission", selected.coreCommissionCents / 100],
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
      "Core Commission": week.estimatedCoreCommissionCents / 100,
      "Service Contract / Warranty Sold": week.fi.serviceContract.soldCount,
      "Tire & Wheel Sold": week.fi.tireWheel.soldCount,
      "GAP Sold": week.fi.gap.soldCount,
      "Dealer Financed": week.fi.dealerFinanced.soldCount,
      "Any Product Deals": weekAnalytics.products.anyProduct.qualifyingDealCount,
      "Two or More Product Deals": weekAnalytics.products.twoOrMoreProducts.qualifyingDealCount,
      "All Three Product Deals": weekAnalytics.products.allThreeProducts.qualifyingDealCount,
      "Deals with Incomplete Product Tracking":
        weekAnalytics.products.incompletelyTrackedDealCount,
    };
  });

  const yearRows = yearly.map((month) => {
    const performance = calculateMonthlyPerformance(month);
    const fiMetrics = calculateFiPenetrationMetrics(month.calculatedSales);
    const report = calculateMonthReportAnalytics(month);
    return {
      Month: monthLabel(month.monthKey),
      Delivered: month.deliveredCount,
      "Credited Units": month.creditedUnitsBasis / 1_000,
      "Front Gross": month.frontGrossCents / 100,
      "Total F&I Gross": month.fiGrossCents / 100,
      "Front Gross per Delivery": performance.frontGrossPerDeliveryCents === null ? "" : performance.frontGrossPerDeliveryCents / 100,
      "F&I Gross per Delivery": performance.fiGrossPerDeliveryCents === null ? "" : performance.fiGrossPerDeliveryCents / 100,
      "Positive F&I Gross Deliveries": performance.positiveFiGrossCount,
      "Service Contract / Warranty Sold": fiMetrics.serviceContractSoldCount,
      "Service Contract / Warranty Penetration": penetrationRate(fiMetrics.serviceContractSoldCount, fiMetrics.deliveredCount),
      "Tire & Wheel Sold": fiMetrics.tireWheelSoldCount,
      "Tire & Wheel Penetration": penetrationRate(fiMetrics.tireWheelSoldCount, fiMetrics.deliveredCount),
      "GAP Sold": fiMetrics.gapSoldCount,
      "GAP Penetration": penetrationRate(fiMetrics.gapSoldCount, fiMetrics.deliveredCount),
      "Dealer Financed": fiMetrics.dealerFinancedCount,
      "Dealer Financing Penetration": penetrationRate(fiMetrics.dealerFinancedCount, fiMetrics.deliveredCount),
      "Any Tracked F&I Product Penetration": penetrationRate(fiMetrics.anyTrackedProductSoldCount, fiMetrics.deliveredCount),
      "Tracked F&I Products Sold": fiMetrics.trackedProductsSoldCount,
      "Two or More Product Deals": report.products.twoOrMoreProducts.qualifyingDealCount,
      "All Three Product Deals": report.products.allThreeProducts.qualifyingDealCount,
      "Confirmed No-product Deals": report.products.confirmedNoProductDealCount,
      "Deals with Incomplete Product Tracking": report.products.incompletelyTrackedDealCount,
      "Front Rate": month.frontRateBps / 10_000,
      "Plan Name": month.payPlanVersion,
      "Core Commission": month.coreCommissionCents / 100,
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
    formatCurrency(sale.frontGrossCents),
    formatCurrency(sale.fiGrossCents),
    trackedOutcomeLabel(sale.serviceContractSold),
    trackedOutcomeLabel(sale.tireWheelSold),
    trackedOutcomeLabel(sale.gapSold),
    trackedOutcomeLabel(sale.dealerFinanced),
    monthKeyFromDate(sale.saleDate),
  ];
}
