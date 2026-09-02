import { describe, expect, it } from "vitest";
import { calculateMonth } from "@/domain/commission";
import { calculateMonthReportAnalytics } from "@/domain/reportAnalytics";
import type { Sale } from "@/domain/types";
import {
  buildReportAnalyticsExportTables,
  buildSalesDetailExportRows,
  calculateFiPenetrationMetrics,
  createMonthlyCsvContent,
  createBackupEnvelope,
  parseBackupFile,
  prepareBackupFile,
  reportRowForSale,
  sha256,
} from "@/lib/files";
import { getPayPlanSchedule } from "@/domain/payPlan";
import { createDefaultSettings } from "@/persistence/database";

function testSale(): Sale {
  return {
    id: "backup-sale-1",
    profileId: "primary",
    saleDate: "2026-08-20",
    customerLastName: "Sample",
    stockNumber: "B-0001",
    vehicleDescription: "2023 Ford Escape",
    status: "delivered",
    unitCreditBasis: 1_000,
    frontGrossCents: 100_000,
    fiGrossCents: 20_000,
    notes: "",
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:00.000Z",
    revision: 1,
    source: "manual",
  };
}

function jsonFile(value: unknown): File {
  return new File([JSON.stringify(value)], "backup.json", { type: "application/json" });
}

describe("JSON backup validation", () => {
  it("labels omitted legacy F&I outcomes as not marked in report rows", () => {
    expect(reportRowForSale(testSale()).slice(8, 12)).toEqual([
      "Not marked",
      "Not marked",
      "Not marked",
      "Not marked",
    ]);
  });

  it("exports product outcomes and total F&I gross without product-level money", () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const sale: Sale = {
      ...testSale(),
      serviceContractSold: true,
      tireWheelSold: true,
      gapSold: false,
      dealerFinanced: true,
    };

    const privateCsv = createMonthlyCsvContent([sale], settings, "2026-08", false);
    expect(privateCsv).toContain('"Total F&I Gross"');
    expect(privateCsv).toContain('"Service Contract / Warranty Sold"');
    expect(privateCsv).toContain('"Dealer Financed"');
    expect(privateCsv).not.toMatch(/credited gross|gross breakdown|unallocated F&I/i);
    expect(privateCsv).not.toContain('"Customer Last Name"');
    expect(privateCsv).not.toContain('"Sample"');
    expect(privateCsv).toContain(',200.00,"Yes","Yes","No","Yes",');

    const identifiedCsv = createMonthlyCsvContent([sale], settings, "2026-08", true);
    expect(identifiedCsv).toContain('"Customer Last Name"');
    expect(identifiedCsv).toContain('"Sample"');
  });

  it("builds analytics-rich export tables with honest gross scopes", () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const first: Sale = {
      ...testSale(),
      serviceContractSold: true,
      tireWheelSold: true,
      gapSold: false,
      dealerFinanced: true,
    };
    const second: Sale = {
      ...testSale(),
      id: "backup-sale-2",
      stockNumber: "B-0002",
      fiGrossCents: 8_000,
      serviceContractSold: false,
      tireWheelSold: false,
      gapSold: true,
      dealerFinanced: false,
    };
    const summary = calculateMonth(
      [first, second],
      "2026-08",
      getPayPlanSchedule(settings),
      null,
    );
    const tables = buildReportAnalyticsExportTables(
      calculateMonthReportAnalytics(summary),
    );
    const privateDetail = buildSalesDetailExportRows(
      summary.calculatedSales,
      false,
      "2026-08-20",
    );
    const identifiedDetail = buildSalesDetailExportRows(
      summary.calculatedSales,
      true,
      "2026-08-20",
    );

    expect(privateDetail[0]).not.toHaveProperty("Customer Last Name");
    expect(JSON.stringify(privateDetail)).not.toContain("Sample");
    expect(privateDetail[0]).toMatchObject({
      "Total F&I Gross": 200,
      "Service Contract / Warranty Sold": "Yes",
      "Tire & Wheel Sold": "Yes",
      "GAP Sold": "No",
      "Dealer Financed": "Yes",
    });
    expect(JSON.stringify(privateDetail)).not.toMatch(/credited gross|gross breakdown/i);
    expect(identifiedDetail[0]).toHaveProperty("Customer Last Name", "Sample");

    expect(tables.productPerformanceRows).toHaveLength(3);
    expect(tables.productPerformanceRows[0]).toMatchObject({
      Product: "Service contract / warranty",
      Sold: 1,
    });
    expect(tables.productPerformanceRows[0]).not.toHaveProperty(
      "Deal-level Total F&I Gross on Matching Deals (Overlapping)",
    );

    expect(tables.financingRows).toHaveLength(3);
    expect(tables.financingRows[0]).toMatchObject({
      "Financing Outcome": "Dealer financed",
      Deals: 1,
      "Total F&I Gross": 200,
      "Service Contract / Warranty Sold": 1,
    });

    expect(tables.productMixBundleRows).toContainEqual(expect.objectContaining({
      Section: "Inclusive bundle",
      "Mix or Bundle": "Service contract + Tire & Wheel",
      Deals: 1,
    }));
    expect(tables.productMixBundleRows.find((row) => row.Section === "Inclusive bundle")).not.toHaveProperty(
      "Deal-level Total F&I Gross on Matching Deals (Overlapping)",
    );
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({
      Metric: "F&I report and commission amount",
      Value: "Total F&I gross",
    }));
    expect(JSON.stringify(tables)).not.toMatch(/credited gross|gross breakdown/i);
  });

  it("prepares the exact manual-download file only after a successful round trip", async () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    settings.salespersonName = "Drive User";

    const prepared = await prepareBackupFile(settings, [testSale()], []);
    const parsed = await parseBackupFile(prepared.file);

    expect(prepared.fileName).toMatch(/^drive-user-sales-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(prepared.file.name).toBe(prepared.fileName);
    expect(parsed.data.sales[0]?.stockNumber).toBe("B-0001");
  });

  it("round-trips valid settings, plan history, and sales", async () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    settings.salespersonName = "Test User";
    settings.monthlyCommissionGoalCents = 750_000;
    settings.deliveryGoalsByMonth = { "2026-08": 18 };
    settings.commissionGoalsByMonth = { "2026-08": 900_000 };
    settings.daysOffByMonth = { "2026-08": ["2026-08-20", "2026-08-05"] };
    const sale = {
      ...testSale(),
      serviceContractSold: true,
      tireWheelSold: true,
      gapSold: false,
      dealerFinanced: true,
    };
    const envelope = await createBackupEnvelope(settings, [sale], []);
    const parsed = await parseBackupFile(jsonFile(envelope));
    expect(envelope.schemaVersion).toBe(2);
    expect(parsed.data.profile.salespersonName).toBe("Test User");
    expect(parsed.data.profile.monthlyCommissionGoalCents).toBe(750_000);
    expect(parsed.data.profile.deliveryGoalsByMonth).toEqual({ "2026-08": 18 });
    expect(parsed.data.profile.commissionGoalsByMonth).toEqual({ "2026-08": 900_000 });
    expect(parsed.data.profile.daysOffByMonth).toEqual({
      "2026-08": ["2026-08-05", "2026-08-20"],
    });
    expect(parsed.data.profile.payPlanHistory).toHaveLength(1);
    expect(parsed.data.sales[0]?.stockNumber).toBe("B-0001");
    expect(parsed.data.sales[0]).toMatchObject({
      serviceContractSold: true,
      tireWheelSold: true,
      gapSold: false,
      dealerFinanced: true,
    });
  });

  it("preserves unrecorded F&I products and defaults month-specific goals for an older backup", async () => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [testSale()],
      [],
    );
    const legacy = structuredClone(envelope) as unknown as {
      checksum: string;
      data: {
        profile: Record<string, unknown>;
        sales: Array<Record<string, unknown>>;
      };
    };
    delete legacy.data.profile.deliveryGoalsByMonth;
    delete legacy.data.profile.commissionGoalsByMonth;
    delete legacy.data.sales[0]!.serviceContractSold;
    delete legacy.data.sales[0]!.tireWheelSold;
    delete legacy.data.sales[0]!.gapSold;
    delete legacy.data.sales[0]!.dealerFinanced;
    legacy.checksum = await sha256(JSON.stringify(legacy.data));

    const parsed = await parseBackupFile(jsonFile(legacy));
    expect(parsed.data.profile.deliveryGoalsByMonth).toEqual({});
    expect(parsed.data.profile.commissionGoalsByMonth).toEqual({});
    expect(parsed.data.sales[0]?.serviceContractSold).toBeUndefined();
    expect(parsed.data.sales[0]?.tireWheelSold).toBeUndefined();
    expect(parsed.data.sales[0]?.gapSold).toBeUndefined();
    expect(parsed.data.sales[0]?.dealerFinanced).toBeUndefined();
  });

  it("calculates tracked F&I penetration from valid delivered sales only", () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const first = {
      ...testSale(),
      serviceContractSold: true,
      tireWheelSold: false,
      gapSold: true,
      dealerFinanced: true,
    };
    const second: Sale = {
      ...testSale(),
      id: "backup-sale-2",
      stockNumber: "B-0002",
      serviceContractSold: false,
      tireWheelSold: true,
      gapSold: false,
      dealerFinanced: false,
    };
    const pending: Sale = {
      ...testSale(),
      id: "backup-sale-3",
      stockNumber: "B-0003",
      status: "pending",
      serviceContractSold: true,
      tireWheelSold: true,
      gapSold: true,
      dealerFinanced: true,
    };
    const month = calculateMonth(
      [first, second, pending],
      "2026-08",
      getPayPlanSchedule(settings),
      null,
    );

    expect(calculateFiPenetrationMetrics(month.calculatedSales)).toEqual({
      deliveredCount: 2,
      serviceContractSoldCount: 1,
      tireWheelSoldCount: 1,
      gapSoldCount: 1,
      dealerFinancedCount: 1,
      anyTrackedProductSoldCount: 2,
      trackedProductsSoldCount: 3,
    });
  });

  it("accepts older backup metadata but removes it from the current pay plan", async () => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [testSale()],
      [],
    );
    const legacyEnvelope = structuredClone(envelope) as unknown as {
      checksum: string;
      data: {
        profile: {
          payPlan: Record<string, unknown>;
          payPlanHistory: Array<Record<string, unknown>>;
        };
      };
    };
    legacyEnvelope.data.profile.payPlan.bonusesConfirmed = false;
    legacyEnvelope.data.profile.payPlan.confirmationSource = "";
    legacyEnvelope.data.profile.payPlan.confirmedAt = null;
    legacyEnvelope.data.profile.payPlanHistory[0].bonusesConfirmed = false;
    legacyEnvelope.data.profile.payPlanHistory[0].confirmationSource = "";
    legacyEnvelope.data.profile.payPlanHistory[0].confirmedAt = null;
    legacyEnvelope.checksum = await sha256(JSON.stringify(legacyEnvelope.data));

    const parsed = await parseBackupFile(jsonFile(legacyEnvelope));
    expect("bonusesConfirmed" in parsed.data.profile.payPlan).toBe(false);
    expect("confirmationSource" in parsed.data.profile.payPlan).toBe(false);
    expect("confirmedAt" in parsed.data.profile.payPlan).toBe(false);
  });

  it("rejects changed content when the checksum is not updated", async () => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [testSale()],
      [],
    );
    envelope.data.sales[0]!.stockNumber = "CHANGED";
    await expect(parseBackupFile(jsonFile(envelope))).rejects.toThrow(/incomplete or changed/i);
  });

  it("rejects checksum-valid data with an invalid sale date", async () => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [testSale()],
      [],
    );
    envelope.data.sales[0]!.saleDate = "2026-99-99";
    envelope.checksum = await sha256(JSON.stringify(envelope.data));
    await expect(parseBackupFile(jsonFile(envelope))).rejects.toThrow(/Invalid sale date/i);
  });

  it("rejects checksum-valid duplicate sale IDs", async () => {
    const sale = testSale();
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [sale],
      [],
    );
    envelope.data.sales.push({ ...sale });
    envelope.checksum = await sha256(JSON.stringify(envelope.data));
    await expect(parseBackupFile(jsonFile(envelope))).rejects.toThrow(/Duplicate sale ID/i);
  });

  it("restores a schema-1 backup without work-schedule data", async () => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [testSale()],
      [],
    );
    const legacy = structuredClone(envelope) as unknown as {
      schemaVersion: 1;
      checksum: string;
      data: { profile: { daysOffByMonth?: Record<string, string[]>; monthlyCommissionGoalCents?: number | null } };
    };
    legacy.schemaVersion = 1;
    delete legacy.data.profile.daysOffByMonth;
    delete legacy.data.profile.monthlyCommissionGoalCents;
    legacy.checksum = await sha256(JSON.stringify(legacy.data));

    const parsed = await parseBackupFile(jsonFile(legacy));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.data.profile.daysOffByMonth).toEqual({});
    expect(parsed.data.profile.monthlyCommissionGoalCents).toBeNull();
  });

  it.each([
    [{ "2026-08": ["2026-08-09"] }, /Sundays are already closed/i],
    [{ "2026-08": ["2026-09-01"] }, /real date in its saved month/i],
    [{ "2026-08": ["2026-08-05", "2026-08-05"] }, /cannot be listed twice/i],
  ])("rejects invalid schema-2 work schedules", async (daysOffByMonth, message) => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [testSale()],
      [],
    );
    envelope.data.profile.daysOffByMonth = daysOffByMonth;
    envelope.checksum = await sha256(JSON.stringify(envelope.data));
    await expect(parseBackupFile(jsonFile(envelope))).rejects.toThrow(message);
  });

  it("rejects a backup from a newer unsupported schema", async () => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")),
      [testSale()],
      [],
    );
    const futureEnvelope = { ...envelope, schemaVersion: 3 };
    await expect(parseBackupFile(jsonFile(futureEnvelope))).rejects.toThrow(/valid Sales Ledger backup/i);
  });
});
