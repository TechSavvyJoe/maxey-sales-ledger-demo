import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateMonth, DEFAULT_PAY_PLAN } from "@/domain/commission";
import type { Sale } from "@/domain/types";
import { ReportMilestoneIndicator, ReportMilestones } from "./ReportMilestones";

function deliveredSales(count = 11): Sale[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `milestone-view-${index + 1}`, profileId: "primary", saleDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    customerLastName: `Example ${index + 1}`, stockNumber: `VIEW-${index + 1}`, vehicleDescription: "2024 Example vehicle",
    status: "delivered", unitCreditBasis: 1000, frontGrossCents: 230_000, fiGrossCents: 120_000,
    notes: "", createdAt: "2026-08-20T12:00:00Z", updatedAt: "2026-08-20T12:00:00Z", revision: 1,
  }));
}

describe("milestone report presentation", () => {
  it("shows recognizable customer and vehicle, full delivery date, separate amounts, and inclusion explanation", () => {
    const calculatedSales = calculateMonth(deliveredSales(), "2026-08", DEFAULT_PAY_PLAN).calculatedSales;
    const html = renderToStaticMarkup(createElement(ReportMilestones, { calculatedSales, includeLastNames: true, onOpenSale: () => {} }));
    expect(html).toContain("Example 11");
    expect(html).toContain("2024 Example vehicle");
    expect(html).toContain("08/11/2026");
    expect(html).toContain("Delivery 11");
    expect(html).toContain("$1,045.00");
    expect(html).toContain("$1,450.00");
    expect(html).toContain("$2,495.00");
    expect(html).toContain("Already included in the month’s estimate");
    expect(html).toContain("Don’t add again");
    expect(html).toContain("<button");
    expect(html).toContain("Open milestone sale:");
  });

  it("marks only milestone sales and does not reveal names when hidden", () => {
    const calculatedSales = calculateMonth(deliveredSales(), "2026-08", DEFAULT_PAY_PLAN).calculatedSales;
    expect(renderToStaticMarkup(createElement(ReportMilestoneIndicator, { item: calculatedSales[0] }))).toBe("");
    expect(renderToStaticMarkup(createElement(ReportMilestoneIndicator, { item: calculatedSales[10] }))).toContain("Milestone · Delivery 11");
    const html = renderToStaticMarkup(createElement(ReportMilestones, { calculatedSales, includeLastNames: false, onOpenSale: () => {} }));
    expect(html).not.toContain("Example 11");
    expect(html).toContain("2024 Example vehicle");
  });

  it("retains custom fractional front rates in the milestone label", () => {
    const calculatedSales = calculateMonth(deliveredSales(), "2026-08", { ...DEFAULT_PAY_PLAN, acceleratedFrontRateBps: 3555 }).calculatedSales;
    expect(renderToStaticMarkup(createElement(ReportMilestoneIndicator, { item: calculatedSales[10] }))).toContain("35.55% front rate");
  });

  it("distinguishes missing amounts from zero and offers a clear pre-milestone empty state", () => {
    const sales = deliveredSales();
    sales[0].frontGrossCents = null;
    sales[10].fiGrossCents = null;
    const calculatedSales = calculateMonth(sales, "2026-08", DEFAULT_PAY_PLAN).calculatedSales;
    const html = renderToStaticMarkup(createElement(ReportMilestones, { calculatedSales, includeLastNames: true, onOpenSale: () => {} }));
    expect(html).toContain("Partial impact");
    expect(html).toContain("this sale’s F&amp;I gross");
    expect(html).toContain("front gross on 1 earlier sale");
    expect(renderToStaticMarkup(createElement(ReportMilestones, { calculatedSales: [], includeLastNames: true, onOpenSale: () => {} }))).toContain("No earnings milestone reached this month");
  });
});
