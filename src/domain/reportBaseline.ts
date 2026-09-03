import { calculateMonth } from "@/domain/commission";
import { monthLabel, shiftMonth } from "@/domain/date";
import { hasPayPlanCoverage } from "@/domain/payPlan";
import { calculatePeriodReportAnalytics } from "@/domain/reportAnalytics";
import type { PayPlan, Sale } from "@/domain/types";

/** Compare per-sale results using pooled deals, never an average of monthly percentages. */
export function calculatePersonalReportBaseline(
  sales: Sale[],
  selectedMonth: string,
  payPlans: PayPlan[],
  scope: "recent" | "year",
  todayMonth: string,
) {
  const requestedMonths = scope === "recent"
    ? [-3, -2, -1].map((offset) => shiftMonth(selectedMonth, offset))
    : Array.from({ length: Number(selectedMonth.slice(5, 7)) }, (_, index) =>
      `${Number(selectedMonth.slice(0, 4)) - 1}-${String(index + 1).padStart(2, "0")}`,
    );
  const coveredMonths = requestedMonths.filter((month) => month < todayMonth && hasPayPlanCoverage(payPlans, month));
  const summaries = coveredMonths.map((month) => calculateMonth(sales, month, payPlans));
  const analytics = calculatePeriodReportAnalytics(summaries);
  const start = coveredMonths[0];
  const end = coveredMonths.at(-1);
  return {
    analytics: selectedMonth > todayMonth || !analytics.population.deliveredDealCount ? null : analytics,
    monthKeys: coveredMonths,
    label: start && end
      ? `${monthLabel(start, "short")}${start === end ? "" : `–${monthLabel(end, "short")}`} · ${scope === "recent" ? "prior completed months" : "same months last year"}`
      : "No earlier covered months",
  };
}
