import { monthKeyFromDate, todayDateOnly } from "@/domain/date";
import type { Sale } from "@/domain/types";

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
// threshold, every volume-bonus milestone, and future planning records.
const yearlyDeliveryVolumes = [8, 11, 15, 20, 25, 30, 35, 18, 12, 15, 20, 25];

function yearMonths(monthKey: string): string[] {
  const year = monthKey.slice(0, 4);
  return Array.from(
    { length: 12 },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
  );
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
  // Training data must never represent a future delivery as a completed deal.
  // It also uses Monday-Saturday dates so weekly pacing reflects a normal
  // dealership workweek. Current-month deliveries are kept on elapsed days.
  const workingDays = monthKey === monthKeyFromDate(asOfDate) && status === "delivered"
    ? demoWorkingDays(monthKey, asOfDate)
    : demoWorkingDays(monthKey);
  const day = workingDays[index % workingDays.length];
  const dayText = String(day).padStart(2, "0");
  const timestamp = `${monthKey}-${dayText}T15:00:00.000Z`;
  const isDelivered = status === "delivered";
  const serviceContractSold = isDelivered && index % 2 === 0;
  const tireWheelSold = isDelivered && index % 4 === 0;
  const gapSold = isDelivered && index % 3 === 0;
  return {
    id: `demo-${monthKey}-${index}-${status}`,
    profileId: "primary",
    saleDate: `${monthKey}-${dayText}`,
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

export function buildDemoSales(selectedMonth: string, asOfDate = todayDateOnly()): Sale[] {
  const currentMonth = monthKeyFromDate(asOfDate);
  const selectedMonthIsFuture = selectedMonth > monthKeyFromDate(asOfDate);
  return yearMonths(selectedMonth).flatMap((monthKey, monthIndex) => {
    // Keep the selected month consistent with the focused walkthrough: 12
    // delivered examples and one follow-up, unless that month has not begun.
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

    // The current month needs a useful pace view without inventing future
    // deliveries. Its delivered examples are date-clamped in createDemoSale.
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
