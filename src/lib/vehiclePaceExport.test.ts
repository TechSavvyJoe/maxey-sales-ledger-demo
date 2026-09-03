import { afterEach, describe, expect, it, vi } from "vitest";
import { utils, type WorkBook } from "xlsx";
import { calculateWorkdayPace } from "@/domain/pacing";
import type { Sale } from "@/domain/types";
import { exportSalesWorkbook } from "@/lib/files";
import { createDefaultSettings } from "@/persistence/database";

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }));
vi.mock("xlsx", async (importOriginal) => ({
  ...await importOriginal<typeof import("xlsx")>(),
  writeFile,
}));

const now = new Date("2026-09-03T16:00:00.000Z");
const sales: Sale[] = [1, 2].map((day) => ({
  id: `whole-pace-${day}`, profileId: "primary", saleDate: `2026-09-0${day}`,
  customerLastName: "Example", stockNumber: `PACE-${day}`, vehicleDescription: "Ford Escape",
  status: "delivered", unitCreditBasis: day === 1 ? 500 : 1_000,
  frontGrossCents: 12_345, fiGrossCents: 1_234, serviceContractSold: day === 1,
  tireWheelSold: false, gapSold: false, paymentMethod: day === 1 ? "dealer_financed" : "cash",
  notes: "", createdAt: now.toISOString(), updatedAt: now.toISOString(), revision: 1, source: "manual",
}));

afterEach(() => { vi.useRealTimers(); writeFile.mockClear(); });

describe("whole-vehicle pacing in workbook exports", () => {
  it.each([[10, 1, 2, 1], [40, 2, 5, -3]])(
    "exports whole-car pacing for a %s-delivery goal without rounding other metrics",
    async (goal, needed, expected, difference) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const settings = { ...createDefaultSettings(now), monthlyGoal: goal };
      await exportSalesWorkbook(sales, settings, "2026-09", false);
      const workbook = writeFile.mock.calls[0][0] as WorkBook;
      const summary = utils.sheet_to_json<unknown[]>(workbook.Sheets["Monthly Summary"], { header: 1 });
      const metric = (label: string) => summary.find((row) => row[0] === label)?.[1];
      expect(metric("Projected deliveries")).toBe(18);
      expect(metric("Deliveries needed per remaining workday")).toBe(needed);
      expect(metric("Credited units")).toBe(1.5);
      const weekly = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Weekly Performance"]);
      expect(weekly.find((row) => row.State === "Current")).toMatchObject({
        "Expected by Now": expected,
        "Pace Difference": difference,
        "Tracked Products per Delivered Sale (PPD)": 0.5,
        "Finance Penetration": 0.5,
      });
      const detail = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Sales Detail"]);
      expect(detail.find((row) => row["Stock Number"] === "PACE-1"))
        .toMatchObject({ "Front Gross": 123.45, "Total F&I Gross": 12.34, "Unit Credit": 0.5 });
      // Presentation must not feed the rounded count back into income projections.
      expect(calculateWorkdayPace({ monthKey: "2026-09", deliveredCount: 2,
        monthlyGoal: goal, daysOff: [], todayDate: "2026-09-03" }).projectedDeliveries).toBe(17.3);
    },
  );

  it("keeps future-month status text and blank future weekly checkpoints", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    await exportSalesWorkbook([], createDefaultSettings(now), "2026-10", false);
    const workbook = writeFile.mock.calls[0][0] as WorkBook;
    const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets["Monthly Summary"], { header: 1 });
    expect(rows.find((row) => row[0] === "Projected deliveries")?.[1]).toBe("Not started");
    expect(rows.find((row) => row[0] === "Deliveries needed per remaining workday")?.[1]).toBe(1);
    const weekly = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["Weekly Performance"]);
    expect(weekly.every((row) => row["Expected by Now"] === "" && row["Pace Difference"] === "")).toBe(true);
  });

  it.each([[2, 0], [40, "—"]])("distinguishes met goals from unavailable remaining-workday pace", async (goal, expected) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T16:00:00.000Z"));
    await exportSalesWorkbook(sales, { ...createDefaultSettings(now), monthlyGoal: goal }, "2026-09", false);
    const workbook = writeFile.mock.calls[0][0] as WorkBook;
    const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets["Monthly Summary"], { header: 1 });
    expect(rows.find((row) => row[0] === "Finished deliveries")?.[1]).toBe(2);
    expect(rows.find((row) => row[0] === "Deliveries needed per remaining workday")?.[1]).toBe(expected);
  });
});
