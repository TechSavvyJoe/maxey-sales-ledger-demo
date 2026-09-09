import { calculateMonth, normalizeStock } from "@/domain/commission";
import { monthKeyFromDate } from "@/domain/date";
import { getPayPlanSchedule, hasPayPlanCoverage } from "@/domain/payPlan";
import type { CalculatedSale, ProfileSettings, Sale } from "@/domain/types";

export type SalesScope = "month" | "all-months";
export type SalesHistoryItem = CalculatedSale & { calculationUnavailable?: string };

export function matchesSaleSearch(sale: Sale, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
  return !normalizedQuery || [sale.customerLastName, sale.stockNumber, sale.vehicleDescription]
    .join(" ").toLocaleLowerCase("en-US").includes(normalizedQuery);
}

/** Calculate complete months before searching: a result retains its month's rate,
 * Mini, rounding and milestone context even when the other deliveries are hidden. */
export function calculateSalesHistory(
  sales: Sale[], settings: ProfileSettings, scope: SalesScope,
): SalesHistoryItem[] {
  const schedule = getPayPlanSchedule(settings);
  const activeSales = sales.filter((sale) => !sale.deletedAt);
  const months = scope === "month"
    ? [settings.selectedMonth]
    : [...new Set(activeSales.map((sale) => monthKeyFromDate(sale.saleDate)))];
  return months.flatMap((month): SalesHistoryItem[] => {
    if (hasPayPlanCoverage(schedule, month)) {
      return calculateMonth(sales, month, schedule, settings.actualPaidByMonth[month] ?? null).calculatedSales;
    }
    // Keep older records findable without assigning an unrelated plan or a payout.
    return activeSales.filter((sale) => monthKeyFromDate(sale.saleDate) === month).map((sale) => ({
      sale, monthKey: month, normalizedStock: normalizeStock(sale.stockNumber),
      calculationUnavailable: month ? "Add a pay plan for this month in Settings" : "Review the sale date",
      countsTowardVolume: false, deliveryOrdinal: null, milestone: null, commissionReady: false,
      frontRateBps: 0, frontCommissionCents: 0, frontCommissionMethod: "excluded",
      minimumFrontCommissionCents: 0, commissionableFrontGrossCents: 0,
      fiCommissionCents: 0, estimatedCommissionCents: 0, flags: [],
    }));
  });
}
