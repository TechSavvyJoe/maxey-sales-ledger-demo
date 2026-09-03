import { bench, describe, vi } from "vitest";
import { calculateMonth, calculateYear, DEFAULT_PAY_PLAN } from "@/domain/commission";
import { buildDemoSales, createPublicDemoHistoricPlan } from "@/domain/demo";
import { calculateMonthReportAnalytics, calculatePeriodReportAnalytics } from "@/domain/reportAnalytics";
import { calculateWeeklyPerformance } from "@/domain/weeklyPerformance";

// Run on demand: pnpm exec vitest bench --run src/domain/calculations.bench.ts
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-02T16:00:00.000Z"));
const demoSales = buildDemoSales("2026-09", "2026-09-02", "two-year");
const plans = [createPublicDemoHistoricPlan("2026-09-02"), DEFAULT_PAY_PLAN];
const month = calculateMonth(demoSales, "2026-08", plans);
const year = calculateYear(demoSales, 2026, plans, {});

describe("two-year public demo calculations", () => {
  bench("monthly commission", () => { calculateMonth(demoSales, "2026-08", plans); });
  bench("yearly commission", () => { calculateYear(demoSales, 2026, plans, {}); });
  bench("monthly report analytics", () => { calculateMonthReportAnalytics(month); });
  bench("yearly report analytics", () => { calculatePeriodReportAnalytics(year); });
  bench("weekly performance", () => {
    calculateWeeklyPerformance({
      summary: month,
      monthlyGoal: 20,
      daysOff: [],
      todayDate: "2026-09-02",
    });
  });
});
