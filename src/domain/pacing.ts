import { getDay, parseISO } from "date-fns";
import { daysInMonthKey, isValidDateOnly } from "@/domain/date";

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface WorkScheduleDay {
  date: string;
  dayNumber: number;
  weekdayIndex: number;
  isSunday: boolean;
}

export type PaceStatus = "complete" | "future" | "not-started" | "no-workdays" | "on-pace" | "behind" | "goal-reached";

export interface WorkdayPace {
  status: PaceStatus;
  scheduledWorkdays: number;
  elapsedWorkdays: number;
  remainingWorkdays: number;
  daysOff: string[];
  projectedDeliveries: number | null;
  deliveriesPerElapsedWorkday: number | null;
  expectedDeliveriesToDate: number;
  deliveriesToGoal: number;
  requiredPerRemainingWorkday: number | null;
}

function dateForDay(monthKey: string, dayNumber: number): string {
  return `${monthKey}-${String(dayNumber).padStart(2, "0")}`;
}

export function isSunday(date: string): boolean {
  return isValidDateOnly(date) && getDay(parseISO(date)) === 0;
}

export function getWorkScheduleDays(monthKey: string): WorkScheduleDay[] {
  if (!MONTH_KEY_PATTERN.test(monthKey)) return [];
  return Array.from({ length: daysInMonthKey(monthKey) }, (_, index) => {
    const dayNumber = index + 1;
    const date = dateForDay(monthKey, dayNumber);
    const weekday = getDay(parseISO(date));
    return {
      date,
      dayNumber,
      weekdayIndex: weekday === 0 ? 6 : weekday - 1,
      isSunday: weekday === 0,
    };
  });
}

export function normalizeDaysOffForMonth(monthKey: string, dates: unknown): string[] {
  if (!MONTH_KEY_PATTERN.test(monthKey) || !Array.isArray(dates)) return [];
  return [...new Set(
    dates.filter(
      (date): date is string =>
        typeof date === "string"
        && date.startsWith(`${monthKey}-`)
        && isValidDateOnly(date)
        && !isSunday(date),
    ),
  )].sort();
}

export function normalizeDaysOffByMonth(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, string[]> = {};
  for (const [monthKey, dates] of Object.entries(value)) {
    const validDates = normalizeDaysOffForMonth(monthKey, dates);
    if (validDates.length) normalized[monthKey] = validDates;
  }
  return normalized;
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10;
}

export function calculateWorkdayPace({
  monthKey,
  deliveredCount,
  monthlyGoal,
  daysOff,
  todayDate,
}: {
  monthKey: string;
  deliveredCount: number;
  monthlyGoal: number;
  daysOff: unknown;
  todayDate: string;
}): WorkdayPace {
  const normalizedDaysOff = normalizeDaysOffForMonth(monthKey, daysOff);
  const dayOffSet = new Set(normalizedDaysOff);
  const scheduledDates = getWorkScheduleDays(monthKey)
    .filter((day) => !day.isSunday && !dayOffSet.has(day.date))
    .map((day) => day.date);
  const todayMonth = todayDate.slice(0, 7);
  const isPast = monthKey < todayMonth;
  const isFuture = monthKey > todayMonth;
  const elapsedWorkdays = isPast
    ? scheduledDates.length
    : isFuture
      ? 0
      : scheduledDates.filter((date) => date <= todayDate).length;
  const remainingWorkdays = scheduledDates.length - elapsedWorkdays;
  const deliveriesToGoal = Math.max(monthlyGoal - deliveredCount, 0);
  const deliveriesPerElapsedWorkday = elapsedWorkdays > 0
    ? deliveredCount / elapsedWorkdays
    : null;
  const rawProjection = isPast
    ? deliveredCount
    : isFuture || deliveriesPerElapsedWorkday === null
      ? null
      : deliveriesPerElapsedWorkday * scheduledDates.length;
  const projectedDeliveries = rawProjection === null ? null : roundToOne(rawProjection);
  const expectedDeliveriesToDate = scheduledDates.length > 0
    ? monthlyGoal * (elapsedWorkdays / scheduledDates.length)
    : 0;
  const requiredPerRemainingWorkday = deliveriesToGoal === 0
    ? 0
    : remainingWorkdays > 0
      ? deliveriesToGoal / remainingWorkdays
      : null;

  let status: PaceStatus;
  if (isPast) status = "complete";
  else if (deliveriesToGoal === 0) status = "goal-reached";
  else if (scheduledDates.length === 0) status = "no-workdays";
  else if (isFuture) status = "future";
  else if (projectedDeliveries === null) status = "not-started";
  else status = rawProjection !== null && rawProjection >= monthlyGoal ? "on-pace" : "behind";

  return {
    status,
    scheduledWorkdays: scheduledDates.length,
    elapsedWorkdays,
    remainingWorkdays,
    daysOff: normalizedDaysOff,
    projectedDeliveries,
    deliveriesPerElapsedWorkday,
    expectedDeliveriesToDate,
    deliveriesToGoal,
    requiredPerRemainingWorkday,
  };
}
