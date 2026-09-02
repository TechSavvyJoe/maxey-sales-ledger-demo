import { describe, expect, it } from "vitest";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import {
  getEarliestPayPlanMonth,
  getPayPlanForMonth,
  hasPayPlanCoverage,
  payPlanStructureChanged,
  upsertPayPlan,
  validatePayPlan,
} from "@/domain/payPlan";

describe("pay-plan validation and history", () => {
  it("accepts the supplied default plan", () => {
    expect(validatePayPlan(DEFAULT_PAY_PLAN)).toEqual({ valid: true, issues: [] });
  });

  it("rejects invalid rates, thresholds, and duplicated tiers", () => {
    const result = validatePayPlan({
      ...DEFAULT_PAY_PLAN,
      baseFrontRateBps: Number.NaN,
      acceleratedFrontRateBps: 2_500,
      acceleratedThresholdExclusive: 10.5,
      bonusTiers: [
        { minimumDelivered: 11, amountCents: 30_000 },
        { minimumDelivered: 11, amountCents: 20_000 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toMatch(/Base front rate/);
    expect(result.issues.join(" ")).toMatch(/whole number/);
    expect(result.issues.join(" ")).toMatch(/unique and in ascending order/);
    expect(result.issues.join(" ")).toMatch(/cannot decrease/);
  });

  it("selects the latest effective plan without rewriting earlier months", () => {
    const january = { ...DEFAULT_PAY_PLAN, version: "2026-01 plan", effectiveMonth: "2026-01" };
    const august = {
      ...DEFAULT_PAY_PLAN,
      version: "2026-08 plan",
      effectiveMonth: "2026-08",
      baseFrontRateBps: 3_200,
    };
    const schedule = upsertPayPlan([january], august);
    expect(getPayPlanForMonth(schedule, "2026-07").version).toBe("2026-01 plan");
    expect(getPayPlanForMonth(schedule, "2026-08").version).toBe("2026-08 plan");
    expect(payPlanStructureChanged(january, august)).toBe(true);
  });

  it("never applies a future plan to a month before coverage", () => {
    const january = { ...DEFAULT_PAY_PLAN, version: "2026-01 plan", effectiveMonth: "2026-01" };
    expect(hasPayPlanCoverage([january], "2025-12")).toBe(false);
    expect(hasPayPlanCoverage([january], "2026-01")).toBe(true);
    expect(() => getPayPlanForMonth([january], "2025-12")).toThrow(
      /Add an older pay plan beginning 2025-12 or earlier/,
    );
  });

  it("adds an older plan without replacing current and later versions", () => {
    const january = { ...DEFAULT_PAY_PLAN, version: "2026-01 plan", effectiveMonth: "2026-01" };
    const august = { ...DEFAULT_PAY_PLAN, version: "2026-08 plan", effectiveMonth: "2026-08" };
    const historical = {
      ...DEFAULT_PAY_PLAN,
      version: "2025 historical plan",
      effectiveMonth: "2025-01",
      baseFrontRateBps: 2_800,
    };
    const schedule = upsertPayPlan([january, august], historical);
    expect(getEarliestPayPlanMonth(schedule)).toBe("2025-01");
    expect(getPayPlanForMonth(schedule, "2025-12").version).toBe("2025 historical plan");
    expect(getPayPlanForMonth(schedule, "2026-01").version).toBe("2026-01 plan");
    expect(getPayPlanForMonth(schedule, "2026-08").version).toBe("2026-08 plan");
  });
});
