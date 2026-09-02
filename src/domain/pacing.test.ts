import { describe, expect, it } from "vitest";
import {
  calculateWorkdayPace,
  getWorkScheduleDays,
  normalizeDaysOffByMonth,
  normalizeDaysOffForMonth,
} from "@/domain/pacing";

describe("workday pacing", () => {
  it("builds a Monday-first month calendar and treats every Sunday as closed", () => {
    const days = getWorkScheduleDays("2026-08");
    expect(days).toHaveLength(31);
    expect(days[0]).toMatchObject({ date: "2026-08-01", weekdayIndex: 5, isSunday: false });
    expect(days.filter((day) => day.isSunday).map((day) => day.dayNumber)).toEqual([2, 9, 16, 23, 30]);
  });

  it("normalizes duplicate, Sunday, invalid, and off-month days off", () => {
    expect(normalizeDaysOffForMonth("2026-08", [
      "2026-08-05",
      "2026-08-05",
      "2026-08-09",
      "2026-09-01",
      "not-a-date",
    ])).toEqual(["2026-08-05"]);
    expect(normalizeDaysOffByMonth({
      "2026-08": ["2026-08-05", "2026-08-09"],
      "bad-month": ["2026-08-06"],
      "2026-09": "not-an-array",
    })).toEqual({ "2026-08": ["2026-08-05"] });
  });

  it("projects the current month from scheduled workdays through today", () => {
    const pace = calculateWorkdayPace({
      monthKey: "2026-08",
      deliveredCount: 8,
      monthlyGoal: 15,
      daysOff: ["2026-08-05", "2026-08-20"],
      todayDate: "2026-08-15",
    });
    expect(pace).toMatchObject({
      status: "on-pace",
      scheduledWorkdays: 24,
      elapsedWorkdays: 12,
      remainingWorkdays: 12,
      projectedDeliveries: 16,
      deliveriesToGoal: 7,
    });
    expect(pace.expectedDeliveriesToDate).toBe(7.5);
    expect(pace.requiredPerRemainingWorkday).toBeCloseTo(7 / 12);
  });

  it("does not count today when today is a scheduled day off", () => {
    const pace = calculateWorkdayPace({
      monthKey: "2026-08",
      deliveredCount: 6,
      monthlyGoal: 15,
      daysOff: ["2026-08-15"],
      todayDate: "2026-08-15",
    });
    expect(pace.scheduledWorkdays).toBe(25);
    expect(pace.elapsedWorkdays).toBe(12);
    expect(pace.remainingWorkdays).toBe(13);
    expect(pace.projectedDeliveries).toBe(12.5);
  });

  it("uses actual deliveries for a completed month", () => {
    expect(calculateWorkdayPace({
      monthKey: "2026-07",
      deliveredCount: 18,
      monthlyGoal: 15,
      daysOff: ["2026-07-04"],
      todayDate: "2026-08-15",
    })).toMatchObject({
      status: "complete",
      elapsedWorkdays: 26,
      remainingWorkdays: 0,
      projectedDeliveries: 18,
      deliveriesToGoal: 0,
      requiredPerRemainingWorkday: 0,
    });
  });

  it("shows a future month as not started without inventing a projection", () => {
    expect(calculateWorkdayPace({
      monthKey: "2026-09",
      deliveredCount: 0,
      monthlyGoal: 15,
      daysOff: ["2026-09-05"],
      todayDate: "2026-08-15",
    })).toMatchObject({
      status: "future",
      elapsedWorkdays: 0,
      remainingWorkdays: 25,
      projectedDeliveries: null,
    });
  });

  it("handles a month with every open day marked off", () => {
    const everyOpenDay = getWorkScheduleDays("2026-08")
      .filter((day) => !day.isSunday)
      .map((day) => day.date);
    expect(calculateWorkdayPace({
      monthKey: "2026-08",
      deliveredCount: 0,
      monthlyGoal: 15,
      daysOff: everyOpenDay,
      todayDate: "2026-08-15",
    })).toMatchObject({
      status: "no-workdays",
      scheduledWorkdays: 0,
      elapsedWorkdays: 0,
      remainingWorkdays: 0,
      projectedDeliveries: null,
      requiredPerRemainingWorkday: null,
    });
  });

  it("uses the unrounded projection to decide whether the goal pace is met", () => {
    const pace = calculateWorkdayPace({
      monthKey: "2026-08",
      deliveredCount: 4,
      monthlyGoal: 5,
      daysOff: [],
      todayDate: "2026-08-25",
    });
    expect(pace.projectedDeliveries).toBe(5);
    expect(pace.status).toBe("behind");
  });

  it("handles leap-year February without counting Sundays", () => {
    const days = getWorkScheduleDays("2028-02");
    expect(days).toHaveLength(29);
    expect(days.filter((day) => !day.isSunday)).toHaveLength(25);
  });
});
