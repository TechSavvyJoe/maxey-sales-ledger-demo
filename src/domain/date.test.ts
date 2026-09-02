import { describe, expect, it } from "vitest";
import { currentMonthKey, todayDateOnly } from "@/domain/date";

describe("Detroit calendar dates", () => {
  it("keeps the Detroit month before local midnight even after UTC changes month", () => {
    const beforeDetroitMidnight = new Date("2026-09-01T03:30:00.000Z");
    expect(todayDateOnly(beforeDetroitMidnight)).toBe("2026-08-31");
    expect(currentMonthKey(beforeDetroitMidnight)).toBe("2026-08");
  });

  it("moves to the next day at Detroit midnight", () => {
    const atDetroitMidnight = new Date("2026-09-01T04:00:00.000Z");
    expect(todayDateOnly(atDetroitMidnight)).toBe("2026-09-01");
    expect(currentMonthKey(atDetroitMidnight)).toBe("2026-09");
  });
});
