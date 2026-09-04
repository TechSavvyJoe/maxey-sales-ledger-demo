import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateMonth, calculateYear, DEFAULT_PAY_PLAN } from "@/domain/commission";
import { getNextEarningsMilestone } from "@/domain/milestones";
import type { PayPlan, Sale } from "@/domain/types";

function sales(count: number): Sale[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `milestone-${String(index + 1).padStart(2, "0")}`,
    profileId: "primary", saleDate: "2026-08-01", customerLastName: "Example",
    stockNumber: `MILESTONE-${index + 1}`, vehicleDescription: "Fictional vehicle",
    status: "delivered", unitCreditBasis: 1_000, frontGrossCents: 230_000,
    fiGrossCents: 120_000, notes: "", createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z", revision: 1, source: "demo",
  }));
}
const calculate = (records: Sale[], plan: PayPlan | PayPlan[] = DEFAULT_PAY_PLAN) =>
  calculateMonth(records, "2026-08", plan);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-03T16:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("delivery milestone attribution", () => {
  it("separates the over-10 sale's commission, earlier-sales uplift, and added bonus", () => {
    const month = calculate(sales(11));
    const trigger = month.calculatedSales[10];
    expect(trigger.estimatedCommissionCents).toBe(104_500);
    expect(trigger.milestone).toEqual({
      deliveryOrdinal: 11, unlocksHigherRate: true, frontRateBps: 3_500,
      priorSalesRetroactiveCents: 115_000, bonusAddedCents: 30_000,
      extraEarningsUnlockedCents: 145_000, totalMilestoneImpactCents: 249_500,
      missingPriorFrontGrossCount: 0, isPartial: false,
    });
    expect(month.calculatedSales.slice(0, 10).every((sale) => sale.milestone === null)).toBe(true);
    // Existing payroll totals include both the rate increase and bonus exactly once.
    expect(month.estimatedCommissionCents).toBe(1_179_500);
    expect(month.estimatedCommissionCents).toBe(
      month.calculatedSales.reduce((sum, sale) => sum + sale.estimatedCommissionCents, 0)
      + month.bonusIncludedCents,
    );
    expect(trigger.milestone!.totalMilestoneImpactCents).toBe(
      month.estimatedCommissionCents - calculate(sales(10)).estimatedCommissionCents,
    );
  });

  it.each([[11, 30_000], [15, 80_000], [20, 100_000], [25, 150_000], [30, 200_000], [35, 250_000]])(
    "attributes only the incremental bonus at delivery %i", (count, addedBonus) => {
      const before = calculate(sales(count - 1));
      const at = calculate(sales(count));
      const milestone = at.calculatedSales[count - 1].milestone!;
      expect(milestone.bonusAddedCents).toBe(addedBonus);
      expect(milestone.totalMilestoneImpactCents).toBe(at.estimatedCommissionCents - before.estimatedCommissionCents);
      expect(milestone.priorSalesRetroactiveCents).toBe(count === 11 ? 115_000 : 0);
      expect(calculate(sales(count + 1)).calculatedSales[count].milestone).toBeNull();
    },
  );

  it("does not credit later deliveries' higher-rate pay to the trigger", () => {
    const month = calculate(sales(35));
    expect(month.retroactiveUpliftCents).toBe(402_500);
    expect(month.calculatedSales[10].milestone!.priorSalesRetroactiveCents).toBe(115_000);
    expect(month.calculatedSales.reduce((sum, item) => sum + (item.milestone?.bonusAddedCents ?? 0), 0))
      .toBe(month.bonusIncludedCents);
  });

  it("honors Minis, split Minis, and exact personal spiffs in prior-sales uplift", () => {
    const records = sales(11);
    records[0].frontGrossCents = -100_000; // no uplift: $300 Mini
    records[1].frontGrossCents = 0;
    records[1].unitCreditBasis = 500; // no uplift: $150 split Mini
    records[2].frontCommissionOverrideCents = 50_000; // no uplift on manual
    records[3].frontGrossCents = 90_000; // $300 Mini -> $315 percentage: +$15
    records[4].frontGrossCents = 60_000;
    records[4].unitCreditBasis = 500; // entered gross is personal share: $180 -> $210
    records[10].frontCommissionOverrideCents = 70_000; // trigger itself stays exact manual
    const month = calculate(records);
    expect(month.calculatedSales[10].frontCommissionCents).toBe(70_000);
    expect(month.calculatedSales[10].milestone!.priorSalesRetroactiveCents).toBe(62_000);
    expect(month.calculatedSales[10].milestone!.totalMilestoneImpactCents).toBe(186_000);
    expect(month.frontGrossCents).toBe(1_660_000);
  });

  it("qualifies unknown amounts without withholding an earned bonus", () => {
    const records = sales(11);
    records[0].frontGrossCents = null;
    records[1].frontGrossCents = null;
    records[1].frontCommissionOverrideCents = 50_000;
    records[10].fiGrossCents = null;
    let trigger = calculate(records).calculatedSales[10];
    expect(trigger.milestone).toMatchObject({
      bonusAddedCents: 30_000, missingPriorFrontGrossCount: 1, isPartial: true,
      priorSalesRetroactiveCents: 92_000, totalMilestoneImpactCents: 202_500,
    });
    records[0].frontGrossCents = 230_000;
    records[10].fiGrossCents = 120_000;
    trigger = calculate(records).calculatedSales[10];
    expect(trigger.milestone).toMatchObject({ isPartial: false, missingPriorFrontGrossCount: 0 });
    records[10].frontGrossCents = null;
    expect(calculate(records).calculatedSales[10].milestone!.isPartial).toBe(true);
    records[10].frontCommissionOverrideCents = 0;
    expect(calculate(records).calculatedSales[10].milestone!.isPartial).toBe(false);
  });

  it("orders by delivery date, entry time, and stable id regardless of input order", () => {
    const records = sales(12);
    records[0].saleDate = "2026-08-02";
    records[1].createdAt = "2026-08-01T13:00:00.000Z";
    const forward = calculate(records);
    const reverse = calculate([...records].reverse());
    expect(forward.calculatedSales).toEqual(reverse.calculatedSales);
    expect(forward.calculatedSales[10].sale.id).toBe(records[1].id);
    expect(forward.calculatedSales[10].milestone).not.toBeNull();
  });

  it("reassigns milestones after backdating or removing a delivery", () => {
    const records = sales(12);
    records[11].saleDate = "2026-08-02";
    records[0].deletedAt = "2026-09-01T12:00:00Z";
    expect(calculate(records).calculatedSales[10].sale.id).toBe(records[11].id);
    expect(calculate(records).calculatedSales[10].milestone).not.toBeNull();
    records[11].saleDate = "2026-07-31";
    const month = calculate(records);
    expect(month.deliveredCount).toBe(10);
    expect(month.calculatedSales.every((item) => item.milestone === null)).toBe(true);
    expect(month.frontRateBps).toBe(3_000);
  });

  it.each(["pending", "future", "invalid", "blank-stock", "duplicate"])(
    "does not assign a milestone or ordinal to a %s sale", (invalid) => {
      const records = sales(11);
      if (invalid === "pending") records[10].status = "pending";
      if (invalid === "future") records[10].saleDate = "2026-09-30";
      if (invalid === "invalid") records[10].saleDate = "2026-08-32";
      if (invalid === "blank-stock") records[10].stockNumber = " ";
      if (invalid === "duplicate") records[10].stockNumber = records[0].stockNumber;
      const month = calculate(records);
      expect(month.calculatedSales.every((item) => item.milestone === null)).toBe(true);
      expect(month.calculatedSales.filter((item) => !item.countsTowardVolume)
        .every((item) => item.deliveryOrdinal === null)).toBe(true);
    },
  );

  it("uses delivered count rather than split unit credit for milestones", () => {
    const records = sales(11).map((sale) => ({ ...sale, unitCreditBasis: 500 }));
    expect(calculate(records).creditedUnitsBasis).toBe(5_500);
    expect(calculate(records).calculatedSales[10].milestone!.deliveryOrdinal).toBe(11);
  });

  it("uses the month's effective plan and independent custom reward thresholds", () => {
    const custom: PayPlan = { ...DEFAULT_PAY_PLAN, effectiveMonth: "2026-08", acceleratedThresholdExclusive: 4,
      acceleratedFrontRateBps: 4_000, bonusTiers: [{ minimumDelivered: 3, amountCents: 10_000 }] };
    const month = calculate(sales(5), [DEFAULT_PAY_PLAN, custom]);
    expect(month.calculatedSales[2].milestone).toMatchObject({ bonusAddedCents: 10_000, unlocksHigherRate: false });
    expect(month.calculatedSales[4].milestone).toMatchObject({ bonusAddedCents: 0, unlocksHigherRate: true,
      priorSalesRetroactiveCents: 92_000 });
    expect(calculateYear(sales(5), 2026, [DEFAULT_PAY_PLAN, custom], {})[7]).toEqual(month);
  });

  it("preserves exact existing pay totals for fractional-cent F&I allocations", () => {
    const records = sales(11).map((sale, i) => ({ ...sale, fiGrossCents: 120_001 + i }));
    const month = calculate(records);
    expect(month.calculatedSales.reduce((sum, item) => sum + item.estimatedCommissionCents, 0)
      + month.bonusIncludedCents).toBe(month.estimatedCommissionCents);
    const trigger = month.calculatedSales[10];
    expect(trigger.milestone!.totalMilestoneImpactCents).toBe(trigger.estimatedCommissionCents + 145_000);
  });
});

describe("next earnings milestone", () => {
  it("combines the higher rate and bonus at the next shared milestone", () => {
    expect(getNextEarningsMilestone(calculate(sales(10)), DEFAULT_PAY_PLAN)).toEqual({
      deliveryCount: 11, deliveriesNeeded: 1, unlocksHigherRate: true, frontRateBps: 3_500,
      bonusAddedCents: 30_000, recordedRetroactiveCents: 115_000, missingFrontGrossCount: 0,
    });
  });

  it("excludes future-sale gross, protects Minis/spiffs, and flags missing front amounts", () => {
    const records = sales(5);
    records[0].frontGrossCents = -100;
    records[1].frontCommissionOverrideCents = 100_000;
    records[2].frontGrossCents = null;
    expect(getNextEarningsMilestone(calculate(records), DEFAULT_PAY_PLAN)).toMatchObject({
      deliveriesNeeded: 6, recordedRetroactiveCents: 23_000, missingFrontGrossCount: 1,
    });
  });

  it("shows the next incremental bonus rather than the cumulative bonus total", () => {
    expect(getNextEarningsMilestone(calculate(sales(14)), DEFAULT_PAY_PLAN)).toMatchObject({
      deliveryCount: 15, deliveriesNeeded: 1, bonusAddedCents: 80_000,
      unlocksHigherRate: false, recordedRetroactiveCents: 0,
    });
  });

  it("does not invent rewards for equal rates, flat tiers, or after the last milestone", () => {
    const custom = { ...DEFAULT_PAY_PLAN, acceleratedFrontRateBps: 3_000,
      bonusTiers: [{ minimumDelivered: 2, amountCents: 0 }, { minimumDelivered: 3, amountCents: 5_000 },
        { minimumDelivered: 4, amountCents: 5_000 }] };
    expect(getNextEarningsMilestone(calculate([], custom), custom)?.deliveryCount).toBe(3);
    expect(getNextEarningsMilestone(calculate(sales(3), custom), custom)).toBeNull();
    expect(calculate(sales(11), custom).calculatedSales.filter((item) => item.milestone)).toHaveLength(1);
    expect(getNextEarningsMilestone(calculate(sales(35)), DEFAULT_PAY_PLAN)).toBeNull();
  });
});
