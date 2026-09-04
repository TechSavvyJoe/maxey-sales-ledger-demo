// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { calculateMonth, DEFAULT_PAY_PLAN } from "@/domain/commission";
import type { PayPlan, Sale } from "@/domain/types";
import { MilestoneProgress } from "./MilestoneProgress";

const today = "2026-09-15";

function makeSales(count: number, month = "2026-09"): Sale[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `milestone-${month}-${index}`,
    profileId: "primary",
    saleDate: `${month}-01`,
    customerLastName: `Sample ${index + 1}`,
    stockNumber: `TEST-${month}-${index + 1}`,
    vehicleDescription: "Fictional test vehicle",
    status: "delivered",
    unitCreditBasis: 1_000,
    frontGrossCents: 230_000,
    fiGrossCents: 120_000,
    serviceContractSold: false,
    tireWheelSold: false,
    gapSold: false,
    paymentMethod: "cash",
    notes: "Test fixture",
    createdAt: `${month}-01T12:00:00.000Z`,
    updatedAt: `${month}-01T12:00:00.000Z`,
    revision: 1,
    source: "demo",
  }));
}

function show(sales: Sale[], month = "2026-09", payPlan: PayPlan = DEFAULT_PAY_PLAN) {
  return render(createElement(MilestoneProgress, {
    summary: calculateMonth(sales, month, payPlan),
    payPlan,
    todayDate: today,
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${today}T16:00:00.000Z`));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("dashboard earnings milestones", () => {
  it("shows the next delivery, incremental bonus, and only the recorded-sales retroactive increase", () => {
    show(makeSales(10));
    expect(screen.getByRole("region", { name: "Next earnings milestone" })).toBeInTheDocument();
    expect(screen.getByText("1 more delivery")).toBeInTheDocument();
    expect(screen.getByText("+$300")).toBeInTheDocument();
    expect(screen.getByText("+$1,150")).toBeInTheDocument();
    expect(screen.getByText("Rate increase on recorded sales")).toBeInTheDocument();
    expect(screen.getByText(/35% front rate, retroactive to the first sale after selling over 10/)).toBeInTheDocument();
    expect(screen.getByText("Future sale commission is separate.")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "10 of 11 deliveries toward the next earnings milestone" });
    expect(progress).toHaveAttribute("value", "10");
    expect(progress).toHaveAttribute("max", "11");
  });

  it("shows only the next additional bonus after the higher rate is already unlocked", () => {
    show(makeSales(14));
    expect(screen.getByText("1 more delivery")).toBeInTheDocument();
    expect(screen.getByText("+$800")).toBeInTheDocument();
    expect(screen.getByText("Next bonus at 15 delivered this month.")).toBeInTheDocument();
    expect(screen.queryByText("Rate increase on recorded sales")).not.toBeInTheDocument();
    expect(screen.queryByText("+$1,100")).not.toBeInTheDocument();
  });

  it("honors Minis and manual payouts instead of multiplying all gross by the rate increase", () => {
    const sales = makeSales(10).map((sale, index) => ({
      ...sale,
      frontGrossCents: index < 5 ? -25_000 : 1_000_000,
      ...(index >= 5 ? { frontCommissionOverrideCents: 50_000 } : {}),
    }));
    show(sales);
    expect(screen.getByText("+$0")).toBeInTheDocument();
    expect(screen.getByText("Mini and manual payouts honored")).toBeInTheDocument();
    expect(screen.getByText("+$300")).toBeInTheDocument();
  });

  it("qualifies a partial retroactive increase when front gross is not entered", () => {
    const sales = makeSales(10);
    sales[0].frontGrossCents = null;
    show(sales);
    expect(screen.getByText("+$1,035")).toBeInTheDocument();
    expect(screen.getByText("Rate increase excludes 1 sale with unentered front gross. Future sale commission is separate.")).toBeInTheDocument();
  });

  it("does not call a known manual payout missing gross for the rate-increase calculation", () => {
    const sales = makeSales(10);
    sales[0].frontGrossCents = null;
    sales[0].frontCommissionOverrideCents = 50_000;
    show(sales);
    expect(screen.getByText("+$1,035")).toBeInTheDocument();
    expect(screen.queryByText(/Rate increase excludes/)).not.toBeInTheDocument();
  });

  it("summarizes reached milestones for a completed month without asking for past deliveries", () => {
    show(makeSales(18, "2026-08"), "2026-08");
    expect(screen.getByRole("region", { name: "Milestones reached" })).toBeInTheDocument();
    expect(screen.getByText("18 delivered")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.getByText("$1,100")).toBeInTheDocument();
    expect(screen.getByText("Already included in this month’s estimate")).toBeInTheDocument();
    expect(screen.queryByText(/more deliver/)).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("clearly says when a completed month reached no milestone", () => {
    show(makeSales(8, "2026-08"), "2026-08");
    expect(screen.getByText("No earnings milestone was reached this month.")).toBeInTheDocument();
    expect(screen.queryByText("Top level reached")).not.toBeInTheDocument();
  });

  it("shows the top level reached without another nonexistent bonus", () => {
    show(makeSales(35));
    expect(screen.getByText("Top level reached")).toBeInTheDocument();
    expect(screen.getByText("$8,100")).toBeInTheDocument();
    expect(screen.queryByText("Additional volume bonus")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("presents a future month as upcoming rather than already earning money", () => {
    show([], "2026-10");
    expect(screen.getByRole("region", { name: "Upcoming earnings milestone" })).toBeInTheDocument();
    expect(screen.getByText("At 11 deliveries")).toBeInTheDocument();
    expect(screen.getByText("Higher front rate")).toBeInTheDocument();
    expect(screen.getByText("35%")).toBeInTheDocument();
    expect(screen.getByText("When this milestone is reached")).toBeInTheDocument();
    expect(screen.queryByText("Rate increase on recorded sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Volume bonus earned")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("uses the supplied effective pay plan instead of hard-coding Howell milestones", () => {
    const payPlan = {
      ...DEFAULT_PAY_PLAN,
      acceleratedThresholdExclusive: 8,
      acceleratedFrontRateBps: 4_000,
      bonusTiers: [{ minimumDelivered: 9, amountCents: 50_000 }],
    };
    show(makeSales(8), "2026-09", payPlan);
    expect(screen.getByText("1 more delivery")).toBeInTheDocument();
    expect(screen.getByText("+$500")).toBeInTheDocument();
    expect(screen.getByText("+$1,840")).toBeInTheDocument();
    expect(screen.getByText(/40% front rate, retroactive to the first sale after selling over 8/)).toBeInTheDocument();
  });

  it("does not render an empty milestone panel for plans without earnings milestones", () => {
    const payPlan = { ...DEFAULT_PAY_PLAN, acceleratedFrontRateBps: 3_000, bonusTiers: [] };
    const { container } = show(makeSales(5), "2026-09", payPlan);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not round a configured fractional commission rate to a different percentage", () => {
    const payPlan = { ...DEFAULT_PAY_PLAN, acceleratedFrontRateBps: 3_555 };
    show([], "2026-10", payPlan);
    expect(screen.getByText("35.55%")).toBeInTheDocument();
    expect(screen.getByText(/35.55% front rate/)).toBeInTheDocument();
  });
});
