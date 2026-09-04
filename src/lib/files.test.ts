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
  formatReportWorkbookNumbers,
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
  it("keeps awaiting gross blank in portable rows while preserving entered zero", () => {
    expect(reportRowForSale({ ...testSale(), frontGrossCents: null, fiGrossCents: null }).slice(6, 8))
      .toEqual(["", ""]);
    expect(reportRowForSale({ ...testSale(), frontGrossCents: 0, fiGrossCents: 0 }).slice(6, 8))
      .toEqual(["$0", "$0"]);
    expect(reportRowForSale(testSale()).slice(6, 8)).toEqual(["$1,000", "$200"]);
  });

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
    expect(privateCsv).toContain('"Financed"');
    expect(privateCsv).toContain('"Payment Method"');
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
      Financed: "Yes",
      "Payment Method": "Finance",
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

    expect(tables.financingRows).toHaveLength(5);
    expect(tables.financingRows[0]).toMatchObject({
      "Financing Outcome": "Finance",
      Deals: 1,
      "Total F&I Gross": 200,
      "Recorded F&I Gross per Group Deal (PVR)": 200,
      "Product Penetration Denominator (Group Deals)": 1,
      "GAP Penetration within Financing Group": 0,
      "Service Contract / Warranty Sold": 1,
    });
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({
      Metric: "Recorded F&I gross per delivered sale (PVR)",
      Value: 140,
    }));
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({
      Metric: "Estimated F&I commission per delivered sale",
      Value: 28,
    }));
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({
      Metric: "GAP penetration - all delivered sales",
      Value: 0.5,
    }));
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({
      Metric: "GAP penetration - Finance sales",
      Value: 0,
    }));
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({
      Metric: "Finance sales (GAP report base)",
      Value: 1,
    }));
    expect(JSON.stringify(tables)).not.toMatch(/positive.*F&I.*gross/i);

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
    expect(tables.dataQualityRows).not.toContainEqual(expect.objectContaining({
      Metric: "Void records",
    }));
    expect(JSON.stringify(tables)).not.toMatch(/credited gross|gross breakdown/i);
  });

  it("exports missing F&I gross as blank PVR while retaining entered zero and coverage", () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const missingSale = { ...testSale(), dealerFinanced: true, fiGrossCents: null };
    const missingTables = buildReportAnalyticsExportTables(calculateMonthReportAnalytics(
      calculateMonth([missingSale], "2026-08", getPayPlanSchedule(settings)),
    ));
    expect(missingTables.financingRows[0]).toMatchObject({
      "Total F&I Gross": "",
      "Recorded F&I Gross per Group Deal (PVR)": "",
      "F&I Gross Coverage": 0,
    });
    expect(missingTables.dataQualityRows).toContainEqual(expect.objectContaining({
      Metric: "Estimated F&I commission per delivered sale",
      Value: "",
    }));

    const zeroTables = buildReportAnalyticsExportTables(calculateMonthReportAnalytics(
      calculateMonth([{ ...missingSale, fiGrossCents: 0 }], "2026-08", getPayPlanSchedule(settings)),
    ));
    expect(zeroTables.financingRows[0]).toMatchObject({
      "Total F&I Gross": 0,
      "Recorded F&I Gross per Group Deal (PVR)": 0,
      "F&I Gross Coverage": 1,
    });
  });

  it("round-trips numeric percentages and currency without changing counts or formulas", async () => {
    const XLSX = await import("xlsx");
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const analytics = calculateMonthReportAnalytics(calculateMonth([
      { ...testSale(), dealerFinanced: true, gapSold: true },
      { ...testSale(), id: "other", stockNumber: "OTHER", dealerFinanced: false, fiGrossCents: null },
    ], "2026-08", getPayPlanSchedule(settings)));
    const tables = buildReportAnalyticsExportTables(analytics);
    const workbook = XLSX.utils.book_new();
    const summary = XLSX.utils.aoa_to_sheet([
      ["Metric", "Value"],
      ["Finance Penetration", 0.5],
      ["Total F&I gross", 200],
      ["F&I amount missing", 1],
      ["Tracked products per delivered sale (PPD)", 0.5],
      ["Cash sales", 2],
      ["Outside-financed sales", 3],
      ["Cash / outside not specified", 4],
    ]);
    summary.B2.f = "1/2";
    XLSX.utils.book_append_sheet(workbook, summary, "Monthly Summary");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(tables.financingRows), "Financing");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(tables.dataQualityRows), "Data Quality");

    formatReportWorkbookNumbers(workbook);
    const restored = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), {
      type: "buffer",
      cellNF: true,
    });
    const restoredSummary = restored.Sheets["Monthly Summary"];
    expect(restoredSummary.B2).toMatchObject({ t: "n", v: 0.5, f: "1/2", z: "0.0%", w: "50.0%" });
    expect(restoredSummary.B3).toMatchObject({ t: "n", v: 200, w: "$200.00" });
    expect(restoredSummary.B4).toMatchObject({ t: "n", v: 1, z: "General" });
    expect(restoredSummary.B5).toMatchObject({ t: "n", v: 0.5, z: "0.00", w: "0.50" });
    expect(restoredSummary.B6).toMatchObject({ t: "n", v: 2, z: "General" });
    expect(restoredSummary.B7).toMatchObject({ t: "n", v: 3, z: "General" });
    expect(restoredSummary.B8).toMatchObject({ t: "n", v: 4, z: "General" });

    const financeHeaders = Object.keys(tables.financingRows[0]);
    const financeCell = (header: string) => restored.Sheets.Financing[
      XLSX.utils.encode_cell({ r: 1, c: financeHeaders.indexOf(header) })
    ];
    expect(financeCell("Share of Delivered Deals")).toMatchObject({ v: 0.5, z: "0.0%" });
    expect(financeCell("Product Penetration Denominator (Group Deals)")).toMatchObject({ v: 1, z: "General" });
    expect(financeCell("Recorded F&I Gross per Group Deal (PVR)")).toMatchObject({ v: 200, w: "$200.00" });

    const qualityCell = (metric: string) => restored.Sheets["Data Quality"][
      XLSX.utils.encode_cell({ r: tables.dataQualityRows.findIndex((row) => row.Metric === metric) + 1, c: 2 })
    ];
    expect(qualityCell("F&I gross coverage")).toMatchObject({ v: 0.5, z: "0.0%" });
    expect(qualityCell("Total F&I gross missing")).toMatchObject({ v: 1, z: "General" });
    expect(qualityCell("Recorded F&I gross per delivered sale (PVR)")).toMatchObject({ v: 100, w: "$100.00" });
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

  it.each([
    ["dealer_financed", true],
    ["cash", false],
    ["outside_financing", false],
  ] as const)("preserves %s through backups and reconciles its legacy financing answer", async (paymentMethod, dealerFinanced) => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const sale: Sale = { ...testSale(), paymentMethod, dealerFinanced: !dealerFinanced };
    const envelope = await createBackupEnvelope(settings, [sale], []);
    expect(envelope.data.sales[0]).toMatchObject({ paymentMethod, dealerFinanced });
    expect(sale.dealerFinanced).toBe(!dealerFinanced);

    // A checksum-valid recovery copy may still contain an older, conflicting boolean.
    envelope.data.sales[0].dealerFinanced = !dealerFinanced;
    envelope.checksum = await sha256(JSON.stringify(envelope.data));
    const parsed = await parseBackupFile(jsonFile(envelope));
    expect(parsed.data.sales[0]).toMatchObject({ paymentMethod, dealerFinanced });
  });

  it("keeps legacy No financing separate from explicit cash and outside financing", async () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const sales: Sale[] = [
      { ...testSale(), id: "legacy-no", dealerFinanced: false },
      { ...testSale(), id: "legacy-yes", dealerFinanced: true },
      { ...testSale(), id: "legacy-unmarked" },
    ];
    const restored = await parseBackupFile(jsonFile(await createBackupEnvelope(settings, sales, [])));
    expect(restored.data.sales.map((sale) => sale.paymentMethod)).toEqual([undefined, undefined, undefined]);
    expect(restored.data.sales.map((sale) => sale.dealerFinanced)).toEqual([false, true, undefined]);
    expect(reportRowForSale(restored.data.sales[0])[12]).toBe("Cash / outside not specified");
    expect(reportRowForSale(restored.data.sales[1])[12]).toBe("Finance");
    expect(reportRowForSale(restored.data.sales[2])[12]).toBe("Not marked");
  });

  it("rejects a checksum-valid backup containing an unsupported payment method", async () => {
    const envelope = await createBackupEnvelope(
      createDefaultSettings(new Date("2026-08-20T12:00:00.000Z")), [testSale()], [],
    );
    (envelope.data.sales[0] as unknown as Record<string, unknown>).paymentMethod = "some-other-method";
    envelope.checksum = await sha256(JSON.stringify(envelope.data));
    await expect(parseBackupFile(jsonFile(envelope))).rejects.toThrow(/valid Sales Ledger backup/i);
  });

  it("exports all payment groups without reclassifying older sales or changing financial numbers", async () => {
    const XLSX = await import("xlsx");
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const sales: Sale[] = [
      { ...testSale(), id: "dealer", stockNumber: "P-1", paymentMethod: "dealer_financed", dealerFinanced: false },
      { ...testSale(), id: "cash", stockNumber: "P-2", paymentMethod: "cash", dealerFinanced: true, fiGrossCents: 0 },
      { ...testSale(), id: "outside", stockNumber: "P-3", paymentMethod: "outside_financing", dealerFinanced: true, fiGrossCents: 12_345 },
      { ...testSale(), id: "legacy-no", stockNumber: "P-4", dealerFinanced: false, fiGrossCents: null },
      { ...testSale(), id: "unknown", stockNumber: "P-5", fiGrossCents: null },
    ];
    const csv = createMonthlyCsvContent(sales, settings, "2026-08", false);
    const csvBook = XLSX.read(csv, { type: "string" });
    const csvRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(csvBook.Sheets[csvBook.SheetNames[0]]);
    // Same-day deliveries have a stable entry-time/id order. Verify each
    // payment outcome stays attached to its sale, independently of row order.
    const csvByStock = Object.fromEntries(csvRows.map((row) => [row["Stock Number"], row]));
    expect(Object.keys(csvByStock).sort()).toEqual(["P-1", "P-2", "P-3", "P-4", "P-5"]);
    expect(csvByStock["P-1"]).toMatchObject({ "Payment Method": "Finance", Financed: "Yes" });
    expect(csvByStock["P-2"]).toMatchObject({ "Payment Method": "Cash", Financed: "No", "Total F&I Gross": 0 });
    expect(csvByStock["P-3"]).toMatchObject({ "Payment Method": "Outside Finance", Financed: "No", "Total F&I Gross": 123.45, "Front Gross": 1000 });
    expect(csvByStock["P-4"]).toMatchObject({ "Payment Method": "Cash / outside not specified", Financed: "No" });
    expect(csvByStock["P-5"]).toMatchObject({ "Payment Method": "Not marked", Financed: "Not marked" });

    const summary = calculateMonth(sales, "2026-08", getPayPlanSchedule(settings));
    const detail = buildSalesDetailExportRows(summary.calculatedSales, false);
    expect(detail.map((row) => row["Payment Method"])).toEqual(csvRows.map((row) => row["Payment Method"]));
    expect(Object.fromEntries(detail.map((row) => [row["Stock Number"], row["Total F&I Gross"]])))
      .toEqual({ "P-1": 200, "P-2": 0, "P-3": 123.45, "P-4": "", "P-5": "" });
    const tables = buildReportAnalyticsExportTables(calculateMonthReportAnalytics(summary));
    expect(tables.financingRows.map((row) => row.Deals)).toEqual([1, 1, 1, 1, 1]);
    expect(tables.financingRows.reduce((sum, row) => sum + Number(row.Deals), 0)).toBe(5);
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({ Section: "Payment method", Metric: "Cash sales", Value: 1 }));
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({ Section: "Payment method", Metric: "Outside-financed sales", Value: 1 }));
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({ Section: "Payment method", Metric: "Cash / outside not specified", Value: 1 }));
    expect(tables.dataQualityRows).toContainEqual(expect.objectContaining({ Section: "Payment method", Metric: "Payment method not marked", Value: 1 }));
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

  it("refuses to create a backup with an invalid actual-paid amount", async () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    settings.actualPaidByMonth = {
      "2026-08": Number.POSITIVE_INFINITY,
    } as unknown as typeof settings.actualPaidByMonth;

    await expect(createBackupEnvelope(settings, [testSale()], []))
      .rejects.toThrow(/Cannot create backup/);
  });

  it("keeps older Void backup records parseable so initialization can move them to Recently deleted", async () => {
    const settings = createDefaultSettings(new Date("2026-08-20T12:00:00.000Z"));
    const legacyVoid = { ...testSale(), status: "void" as const };

    const envelope = await createBackupEnvelope(settings, [legacyVoid], []);
    const parsed = await parseBackupFile(jsonFile(envelope));

    expect(parsed.data.sales[0]).toMatchObject({ status: "void", stockNumber: "B-0001" });
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
