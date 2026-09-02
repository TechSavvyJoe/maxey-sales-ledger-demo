import { addMonths, format, getDaysInMonth, isValid, parseISO, startOfMonth } from "date-fns";

const DETROIT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Detroit",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function detroitDateOnly(now: Date): string {
  const parts = DETROIT_DATE_FORMATTER.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not determine the current Detroit date.");
  return `${year}-${month}-${day}`;
}

export function currentMonthKey(now = new Date()): string {
  return detroitDateOnly(now).slice(0, 7);
}

export function monthKeyFromDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : "";
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
}

export function shiftMonth(monthKey: string, amount: number): string {
  return format(addMonths(parseISO(`${monthKey}-01`), amount), "yyyy-MM");
}

export function monthLabel(monthKey: string, style: "long" | "short" = "long"): string {
  const parsed = parseISO(`${monthKey}-01`);
  return isValid(parsed)
    ? format(parsed, style === "long" ? "MMMM yyyy" : "MMM yyyy")
    : monthKey;
}

export function monthName(monthNumber: number): string {
  return format(new Date(2024, monthNumber, 1), "MMM");
}

export function yearForMonth(monthKey: string): number {
  return Number(monthKey.slice(0, 4));
}

export function daysInMonthKey(monthKey: string): number {
  return getDaysInMonth(parseISO(`${monthKey}-01`));
}

export function elapsedDaysForMonth(monthKey: string, now = new Date()): number {
  const selectedStart = startOfMonth(parseISO(`${monthKey}-01`));
  const currentStart = startOfMonth(now);
  if (selectedStart.getTime() < currentStart.getTime()) return daysInMonthKey(monthKey);
  if (selectedStart.getTime() > currentStart.getTime()) return 1;
  return now.getDate();
}

export function todayDateOnly(now = new Date()): string {
  return detroitDateOnly(now);
}
