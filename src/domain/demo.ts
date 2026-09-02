import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import { monthKeyFromDate, todayDateOnly } from "@/domain/date";
import type { PayPlan, Sale } from "@/domain/types";

const vehicles = [
  "2023 Ford Escape Active",
  "2022 Ford F-150 XLT",
  "2024 Ford Bronco Sport",
  "2021 Ford Explorer Limited",
  "2023 Ford Edge SEL",
  "2022 Chevrolet Equinox LT",
  "2021 Jeep Grand Cherokee",
  "2024 Ford Maverick XLT",
];

// A varied year makes every report meaningful: quieter months, the 35% retro
// threshold, every volume-bonus milestone, and a useful F&I mix.
const yearlyDeliveryVolumes = [8, 11, 15, 20, 25, 30, 35, 18, 12, 15, 20, 25];

/** GitHub Pages is intentionally a richer, fictional walkthrough than local builds. */
export const IS_PUBLIC_DEMO_BUILD = import.meta.env.VITE_PUBLIC_DEMO === "true";
export const AUTOLOAD_PUBLIC_DEMO = IS_PUBLIC_DEMO_BUILD
  && import.meta.env.VITE_PUBLIC_DEMO_AUTOLOAD !== "false";
export const DEMO_DATASET_LABEL = IS_PUBLIC_DEMO_BUILD ? "2-year" : "full-year";
export const DEMO_DATASET_TITLE = IS_PUBLIC_DEMO_BUILD ? "Two-year" : "Full-year";
export const DEMO_HISTORIC_PLAN_VERSION = "Sample 2024–26 plan";

type DemoDatasetScope = "full-year" | "two-year";

function addMonths(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yearMonths(monthKey: string): string[] {
  const year = monthKey.slice(0, 4);
  return Array.from(
    { length: 12 },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
  );
}

/** Includes the current month plus the prior 24 monthly buckets. */
function twoYearMonths(asOfDate: string): string[] {
  const currentMonth = monthKeyFromDate(asOfDate);
  return Array.from({ length: 25 }, (_, index) => addMonths(currentMonth, index - 24));
}

function demoWorkingDays(monthKey: string, asOfDate?: string): number[] {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => index + 1)
    .filter((day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0)
    .filter((day) => !asOfDate || `${monthKey}-${String(day).padStart(2, "0")}` <= asOfDate);
}

function currentMonthDeliveredExamples(monthKey: string, asOfDate: string): number {
  return demoWorkingDays(monthKey, asOfDate).length > 0 ? 12 : 0;
}

function createDemoSale(
  monthKey: string,
  index: number,
  asOfDate: string,
  status: Sale["status"] = "delivered",
): Sale {
  const isCurrentMonth = monthKey === monthKeyFromDate(asOfDate);
  // Training data must never represent a future delivery as a completed deal.
  // Current-month pending examples also use today rather than an imagined follow-up date.
  const saleDate = status === "pending" && isCurrentMonth
    ? asOfDate
    : (() => {
        const workingDays = isCurrentMonth && status === "delivered"
          ? demoWorkingDays(monthKey, asOfDate)
          : demoWorkingDays(monthKey);
        const day = workingDays[index % workingDays.length];
        return `${monthKey}-${String(day).padStart(2, "0")}`;
      })();
  const timestamp = `${saleDate}T15:00:00.000Z`;
  const isDelivered = status === "delivered";
  const serviceContractSold = isDelivered && index % 2 === 0;
  const tireWheelSold = isDelivered && index % 4 === 0;
  const gapSold = isDelivered && index % 3 === 0;
  return {
    id: `demo-${monthKey}-${index}-${status}`,
    profileId: "primary",
    saleDate,
    customerLastName: ["Miller", "Davis", "Taylor", "Wilson", "Clark", "Moore"][index % 6],
    stockNumber: `DEMO-${monthKey.replace("-", "")}-${String(index + 1).padStart(2, "0")}`,
    vehicleDescription: vehicles[index % vehicles.length],
    status,
    unitCreditBasis: index === 4 ? 500 : 1_000,
    frontGrossCents: isDelivered ? 145_000 + index * 28_500 : 210_000,
    fiGrossCents: isDelivered ? 35_000 + index * 7_500 : 50_000,
    serviceContractSold,
    tireWheelSold,
    gapSold,
    dealerFinanced: isDelivered && index % 3 !== 1,
    notes: "Demonstration record — safe to remove from active views.",
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
    source: "demo",
  };
}

function buildFullYearDemoSales(selectedMonth: string, asOfDate: string): Sale[] {
  const currentMonth = monthKeyFromDate(asOfDate);
  const selectedMonthIsFuture = selectedMonth > currentMonth;
  return yearMonths(selectedMonth).flatMap((monthKey, monthIndex) => {
    if (monthKey === selectedMonth) {
      const selectedStatus: Sale["status"] = selectedMonthIsFuture ? "pending" : "delivered";
      const selectedCount = selectedMonth === currentMonth && selectedStatus === "delivered"
        ? currentMonthDeliveredExamples(monthKey, asOfDate)
        : 12;
      return [
        ...Array.from(
          { length: selectedCount },
          (_, index) => createDemoSale(monthKey, index, asOfDate, selectedStatus),
        ),
        createDemoSale(monthKey, 12, asOfDate, "pending"),
      ];
    }

    if (monthKey === currentMonth) {
      return [
        ...Array.from(
          { length: currentMonthDeliveredExamples(monthKey, asOfDate) },
          (_, index) => createDemoSale(monthKey, index, asOfDate),
        ),
        createDemoSale(monthKey, 12, asOfDate, "pending"),
      ];
    }

    const status: Sale["status"] = monthKey > currentMonth ? "pending" : "delivered";
    return Array.from(
      { length: yearlyDeliveryVolumes[monthIndex] },
      (_, index) => createDemoSale(monthKey, index, asOfDate, status),
    );
  });
}

function buildTwoYearDemoSales(asOfDate: string): Sale[] {
  const currentMonth = monthKeyFromDate(asOfDate);
  return twoYearMonths(asOfDate).flatMap((monthKey) => {
    if (monthKey === currentMonth) {
      return [
        ...Array.from(
          { length: currentMonthDeliveredExamples(monthKey, asOfDate) },
          (_, index) => createDemoSale(monthKey, index, asOfDate),
        ),
        createDemoSale(monthKey, 12, asOfDate, "pending"),
      ];
    }

    const monthIndex = Number(monthKey.slice(5, 7)) - 1;
    return Array.from(
      { length: yearlyDeliveryVolumes[monthIndex] },
      (_, index) => createDemoSale(monthKey, index, asOfDate),
    );
  });
}

/**
 * The public demo uses a fictional historic plan only for its 2024–25 sample
 * records. It never changes the editable Howell plan used by local workspaces.
 */
export function createPublicDemoHistoricPlan(asOfDate = todayDateOnly()): PayPlan {
  return {
    ...structuredClone(DEFAULT_PAY_PLAN),
    version: DEMO_HISTORIC_PLAN_VERSION,
    effectiveMonth: twoYearMonths(asOfDate)[0],
  };
}

export function demoRangeDescription(asOfDate = todayDateOnly()): string {
  if (!IS_PUBLIC_DEMO_BUILD) return "a full calendar year";
  const start = twoYearMonths(asOfDate)[0];
  const [year, month] = start.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return `${label} through today`;
}

export function buildDemoSales(
  selectedMonth: string,
  asOfDate = todayDateOnly(),
  scope: DemoDatasetScope = IS_PUBLIC_DEMO_BUILD ? "two-year" : "full-year",
): Sale[] {
  return scope === "two-year"
    ? buildTwoYearDemoSales(asOfDate)
    : buildFullYearDemoSales(selectedMonth, asOfDate);
}
