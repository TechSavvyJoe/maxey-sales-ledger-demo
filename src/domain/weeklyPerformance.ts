import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { daysInMonthKey, isValidDateOnly } from "@/domain/date";
import { normalizeDaysOffForMonth } from "@/domain/pacing";
import type { CalculatedSale, MonthSummary, Sale } from "@/domain/types";

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

type FiTrackedSale = Sale & {
  serviceContractSold?: boolean;
  tireWheelSold?: boolean;
  gapSold?: boolean;
  dealerFinanced?: boolean;
};

type FiProductField =
  | "serviceContractSold"
  | "tireWheelSold"
  | "gapSold"
  | "dealerFinanced";

export type StoreWeekState = "past" | "current" | "future";

export type GoalPaceStatus =
  | "complete"
  | "future"
  | "not-started"
  | "no-workdays"
  | "on-pace"
  | "behind"
  | "goal-reached";

export interface StoreWeekCalendar {
  /** Monday that owns this store week, which can fall outside the selected month. */
  id: string;
  monthKey: string;
  startDate: string;
  endDate: string;
  closedSundayDate: string;
  openDates: string[];
}

export interface PenetrationMetric {
  soldCount: number;
  eligibleDealCount: number;
  recordedCount: number;
  unrecordedCount: number;
  /** A ratio from 0 to 1. Null means there were no eligible delivered deals. */
  rate: number | null;
}

export interface FiPenetrationSummary {
  eligibleDealCount: number;
  serviceContract: PenetrationMetric;
  tireWheel: PenetrationMetric;
  gap: PenetrationMetric;
  dealerFinanced: PenetrationMetric;
  fiGrossEnteredCount: number;
  positiveFiGrossCount: number;
  totalFiGrossCents: number;
  averageFiGrossPerDeliveredCents: number | null;
}

export interface DeliveredPerformance {
  deliveredCount: number;
  creditedUnitsBasis: number;
  creditedUnits: number;
  frontGrossCents: number;
  fiGrossCents: number;
  /** Core commission from front and F&I gross. Monthly bonuses are intentionally excluded. */
  estimatedCoreCommissionCents: number;
  fi: FiPenetrationSummary;
}

export interface WeeklyGoalCheckpoint {
  targetByWeekEnd: number | null;
  targetShareForWeek: number | null;
  expectedDeliveriesToDate: number;
  cumulativeDeliveredCount: number;
  paceDeltaToDate: number;
  paceStatus: GoalPaceStatus;
  /** Only actionable for the current store week; otherwise null. */
  deliveriesNeededByWeekEnd: number | null;
}

export interface StoreWeekPerformance extends StoreWeekCalendar, DeliveredPerformance {
  state: StoreWeekState;
  scheduledWorkdays: number;
  elapsedWorkdays: number;
  remainingWorkdays: number;
  daysOff: string[];
  deliveriesPerElapsedWorkday: number | null;
  goal: WeeklyGoalCheckpoint;
}

export interface MonthlyGoalRequirements {
  monthlyGoal: number;
  status: GoalPaceStatus;
  scheduledWorkdays: number;
  elapsedWorkdays: number;
  remainingWorkdays: number;
  expectedDeliveriesToDate: number;
  deliveredToDate: number;
  paceDeltaToDate: number;
  deliveriesPerElapsedWorkday: number | null;
  remainingToGoal: number;
  requiredPerRemainingWorkday: number | null;
  currentWeekId: string | null;
  currentWeekTarget: number | null;
  neededByEndOfCurrentWeek: number | null;
  currentWeekRemainingWorkdays: number;
  remainingAfterCurrentWeekTarget: number;
}

export interface MonthlyWeeklyPerformance {
  monthKey: string;
  todayDate: string;
  daysOff: string[];
  weeks: StoreWeekPerformance[];
  monthToDate: DeliveredPerformance;
  sundayDeliveryCount: number;
  goal: MonthlyGoalRequirements;
}

function dateForDay(monthKey: string, dayNumber: number): string {
  return `${monthKey}-${String(dayNumber).padStart(2, "0")}`;
}

function mondayForDate(date: string): string {
  return format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function isClosedSunday(date: string): boolean {
  return parseISO(date).getDay() === 0;
}

function safeGoal(monthlyGoal: number): number {
  return Number.isFinite(monthlyGoal) ? Math.max(monthlyGoal, 0) : 0;
}

function sum(items: CalculatedSale[], selector: (item: CalculatedSale) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

function penetrationMetric(items: CalculatedSale[], field: FiProductField): PenetrationMetric {
  const eligibleDealCount = items.length;
  const recordedCount = items.filter(
    (item) => typeof (item.sale as FiTrackedSale)[field] === "boolean",
  ).length;
  const soldCount = items.filter((item) => (item.sale as FiTrackedSale)[field] === true).length;
  return {
    soldCount,
    eligibleDealCount,
    recordedCount,
    unrecordedCount: eligibleDealCount - recordedCount,
    rate: eligibleDealCount > 0 ? soldCount / eligibleDealCount : null,
  };
}

/**
 * Calculates product penetration only from valid Delivered deals. A half deal is
 * one delivered deal in the denominator; unit credit remains a separate metric.
 */
export function calculateFiPenetration(calculatedSales: CalculatedSale[]): FiPenetrationSummary {
  const validDelivered = calculatedSales.filter((item) => item.countsTowardVolume);
  const totalFiGrossCents = sum(validDelivered, (item) => item.sale.fiGrossCents ?? 0);
  const eligibleDealCount = validDelivered.length;
  return {
    eligibleDealCount,
    serviceContract: penetrationMetric(validDelivered, "serviceContractSold"),
    tireWheel: penetrationMetric(validDelivered, "tireWheelSold"),
    gap: penetrationMetric(validDelivered, "gapSold"),
    dealerFinanced: penetrationMetric(validDelivered, "dealerFinanced"),
    fiGrossEnteredCount: validDelivered.filter((item) => item.sale.fiGrossCents !== null).length,
    positiveFiGrossCount: validDelivered.filter((item) => (item.sale.fiGrossCents ?? 0) > 0).length,
    totalFiGrossCents,
    averageFiGrossPerDeliveredCents:
      eligibleDealCount > 0 ? Math.round(totalFiGrossCents / eligibleDealCount) : null,
  };
}

function deliveredPerformance(items: CalculatedSale[]): DeliveredPerformance {
  const validDelivered = items.filter((item) => item.countsTowardVolume);
  const creditedUnitsBasis = sum(validDelivered, (item) => item.sale.unitCreditBasis);
  return {
    deliveredCount: validDelivered.length,
    creditedUnitsBasis,
    creditedUnits: creditedUnitsBasis / 1_000,
    frontGrossCents: sum(validDelivered, (item) => item.sale.frontGrossCents ?? 0),
    fiGrossCents: sum(validDelivered, (item) => item.sale.fiGrossCents ?? 0),
    estimatedCoreCommissionCents: sum(
      validDelivered,
      (item) => item.estimatedCommissionCents,
    ),
    fi: calculateFiPenetration(validDelivered),
  };
}

/** Builds Monday-Saturday store weeks, excluding every closed Sunday. */
export function getStoreWeeksForMonth(monthKey: string): StoreWeekCalendar[] {
  if (!MONTH_KEY_PATTERN.test(monthKey)) return [];
  const groupedDates = new Map<string, string[]>();
  for (let dayNumber = 1; dayNumber <= daysInMonthKey(monthKey); dayNumber += 1) {
    const date = dateForDay(monthKey, dayNumber);
    if (isClosedSunday(date)) continue;
    const monday = mondayForDate(date);
    const dates = groupedDates.get(monday) ?? [];
    dates.push(date);
    groupedDates.set(monday, dates);
  }
  return [...groupedDates.entries()].map(([monday, openDates]) => ({
    id: monday,
    monthKey,
    startDate: openDates[0]!,
    endDate: openDates.at(-1)!,
    closedSundayDate: format(addDays(parseISO(monday), 6), "yyyy-MM-dd"),
    openDates,
  }));
}

function weekState(monthKey: string, monday: string, todayDate: string): StoreWeekState {
  const todayMonth = todayDate.slice(0, 7);
  if (monthKey < todayMonth) return "past";
  if (monthKey > todayMonth) return "future";
  const currentMonday = mondayForDate(todayDate);
  if (monday < currentMonday) return "past";
  if (monday > currentMonday) return "future";
  return "current";
}

function paceStatus({
  monthState,
  monthlyGoal,
  delivered,
  expected,
  elapsedWorkdays,
  scheduledWorkdays,
}: {
  monthState: "past" | "current" | "future";
  monthlyGoal: number;
  delivered: number;
  expected: number;
  elapsedWorkdays: number;
  scheduledWorkdays: number;
}): GoalPaceStatus {
  if (monthState === "past") return "complete";
  if (delivered >= monthlyGoal && monthlyGoal > 0) return "goal-reached";
  if (scheduledWorkdays === 0) return "no-workdays";
  if (monthState === "future") return "future";
  if (elapsedWorkdays === 0) return "not-started";
  return delivered >= expected ? "on-pace" : "behind";
}

/**
 * Produces actual-to-date weekly checkpoints and mathematical goal requirements.
 * It deliberately does not forecast future sales.
 */
export function calculateWeeklyPerformance({
  summary,
  monthlyGoal,
  daysOff,
  todayDate,
}: {
  summary: MonthSummary;
  monthlyGoal: number;
  daysOff: unknown;
  todayDate: string;
}): MonthlyWeeklyPerformance {
  if (!MONTH_KEY_PATTERN.test(summary.monthKey)) {
    throw new Error(`Invalid month key: ${summary.monthKey}`);
  }
  if (!isValidDateOnly(todayDate)) throw new Error(`Invalid date: ${todayDate}`);

  const monthKey = summary.monthKey;
  const goal = safeGoal(monthlyGoal);
  const normalizedDaysOff = normalizeDaysOffForMonth(monthKey, daysOff);
  const dayOffSet = new Set(normalizedDaysOff);
  const calendars = getStoreWeeksForMonth(monthKey);
  const scheduledDates = calendars
    .flatMap((week) => week.openDates)
    .filter((date) => !dayOffSet.has(date));
  const monthState: "past" | "current" | "future" =
    monthKey < todayDate.slice(0, 7)
      ? "past"
      : monthKey > todayDate.slice(0, 7)
        ? "future"
        : "current";
  const elapsedDates = monthState === "past"
    ? scheduledDates
    : monthState === "future"
      ? []
      : scheduledDates.filter((date) => date <= todayDate);
  const visibleDelivered = summary.calculatedSales.filter(
    (item) =>
      item.countsTowardVolume
      && item.sale.saleDate.startsWith(`${monthKey}-`)
      && (monthState === "past" || (monthState === "current" && item.sale.saleDate <= todayDate)),
  );
  const sundayDeliveryCount = visibleDelivered.filter((item) => isClosedSunday(item.sale.saleDate)).length;
  const nonSundayDelivered = visibleDelivered.filter((item) => !isClosedSunday(item.sale.saleDate));
  const monthToDate = deliveredPerformance(visibleDelivered);
  const totalScheduledWorkdays = scheduledDates.length;

  let cumulativeScheduled = 0;
  let previousTarget = 0;
  const weeks = calendars.map((calendar): StoreWeekPerformance => {
    const state = weekState(monthKey, calendar.id, todayDate);
    const weekScheduledDates = calendar.openDates.filter((date) => !dayOffSet.has(date));
    const weekDaysOff = calendar.openDates.filter((date) => dayOffSet.has(date));
    const weekElapsedDates = state === "past"
      ? weekScheduledDates
      : state === "future"
        ? []
        : weekScheduledDates.filter((date) => date <= todayDate);
    const weekItems = nonSundayDelivered.filter(
      (item) => item.sale.saleDate >= calendar.startDate && item.sale.saleDate <= calendar.endDate,
    );
    const performance = deliveredPerformance(weekItems);
    cumulativeScheduled += weekScheduledDates.length;
    const targetByWeekEnd = totalScheduledWorkdays > 0
      ? Math.min(goal, Math.ceil(goal * (cumulativeScheduled / totalScheduledWorkdays)))
      : null;
    const targetShareForWeek = targetByWeekEnd === null ? null : targetByWeekEnd - previousTarget;
    if (targetByWeekEnd !== null) previousTarget = targetByWeekEnd;

    const cumulativeElapsedThroughWeek = state === "past"
      ? cumulativeScheduled
      : state === "current"
        ? elapsedDates.filter((date) => date <= calendar.endDate).length
        : 0;
    const expectedDeliveriesToDate = totalScheduledWorkdays > 0
      ? goal * (cumulativeElapsedThroughWeek / totalScheduledWorkdays)
      : 0;
    const cumulativeItems = nonSundayDelivered.filter(
      (item) => item.sale.saleDate <= calendar.endDate,
    );
    const cumulativeDeliveredCount = state === "future"
      ? monthToDate.deliveredCount - sundayDeliveryCount
      : cumulativeItems.length;
    const deliveriesNeededByWeekEnd = state === "current" && targetByWeekEnd !== null
      ? Math.max(targetByWeekEnd - monthToDate.deliveredCount, 0)
      : null;

    return {
      ...calendar,
      ...performance,
      state,
      scheduledWorkdays: weekScheduledDates.length,
      elapsedWorkdays: weekElapsedDates.length,
      remainingWorkdays: weekScheduledDates.length - weekElapsedDates.length,
      daysOff: weekDaysOff,
      deliveriesPerElapsedWorkday:
        weekElapsedDates.length > 0 ? performance.deliveredCount / weekElapsedDates.length : null,
      goal: {
        targetByWeekEnd,
        targetShareForWeek,
        expectedDeliveriesToDate,
        cumulativeDeliveredCount,
        paceDeltaToDate: cumulativeDeliveredCount - expectedDeliveriesToDate,
        paceStatus:
          state === "future"
            ? "future"
            : cumulativeDeliveredCount >= goal && goal > 0
              ? "goal-reached"
              : cumulativeElapsedThroughWeek === 0
                ? "not-started"
                : cumulativeDeliveredCount >= expectedDeliveriesToDate
                  ? "on-pace"
                  : "behind",
        deliveriesNeededByWeekEnd,
      },
    };
  });

  const currentWeek = weeks.find((week) => week.state === "current") ?? null;
  const expectedDeliveriesToDate = totalScheduledWorkdays > 0
    ? goal * (elapsedDates.length / totalScheduledWorkdays)
    : 0;
  const remainingToGoal = Math.max(goal - monthToDate.deliveredCount, 0);
  const remainingWorkdays = totalScheduledWorkdays - elapsedDates.length;
  const neededByEndOfCurrentWeek = currentWeek?.goal.deliveriesNeededByWeekEnd ?? null;

  return {
    monthKey,
    todayDate,
    daysOff: normalizedDaysOff,
    weeks,
    monthToDate,
    sundayDeliveryCount,
    goal: {
      monthlyGoal: goal,
      status: paceStatus({
        monthState,
        monthlyGoal: goal,
        delivered: monthToDate.deliveredCount,
        expected: expectedDeliveriesToDate,
        elapsedWorkdays: elapsedDates.length,
        scheduledWorkdays: totalScheduledWorkdays,
      }),
      scheduledWorkdays: totalScheduledWorkdays,
      elapsedWorkdays: elapsedDates.length,
      remainingWorkdays,
      expectedDeliveriesToDate,
      deliveredToDate: monthToDate.deliveredCount,
      paceDeltaToDate: monthToDate.deliveredCount - expectedDeliveriesToDate,
      deliveriesPerElapsedWorkday:
        elapsedDates.length > 0 ? monthToDate.deliveredCount / elapsedDates.length : null,
      remainingToGoal,
      requiredPerRemainingWorkday:
        remainingToGoal === 0
          ? 0
          : monthState !== "past" && remainingWorkdays > 0
            ? remainingToGoal / remainingWorkdays
            : null,
      currentWeekId: currentWeek?.id ?? null,
      currentWeekTarget: currentWeek?.goal.targetByWeekEnd ?? null,
      neededByEndOfCurrentWeek,
      currentWeekRemainingWorkdays: currentWeek?.remainingWorkdays ?? 0,
      remainingAfterCurrentWeekTarget: Math.max(
        remainingToGoal - (neededByEndOfCurrentWeek ?? 0),
        0,
      ),
    },
  };
}
