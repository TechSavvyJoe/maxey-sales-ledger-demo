// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateMonth, DEFAULT_PAY_PLAN } from "@/domain/commission";
import { calculateMonthReportAnalytics } from "@/domain/reportAnalytics";
import type { Sale } from "@/domain/types";
import { FiReportCenter } from "./FiReportCenter";

function sale(index: number): Sale {
  const sequence = String(index + 1).padStart(3, "0");
  const day = String((index % 28) + 1).padStart(2, "0");
  const timestamp = `2026-08-${day}T12:00:00.000Z`;
  return {
    id: `fi-report-sale-${sequence}`,
    profileId: "primary",
    saleDate: `2026-08-${day}`,
    customerLastName: `Customer ${sequence}`,
    stockNumber: `STK-${sequence}`,
    vehicleDescription: `${2021 + (index % 5)} Ford Escape ${sequence}`,
    status: "delivered",
    unitCreditBasis: 1_000,
    frontGrossCents: 230_000,
    fiGrossCents: 120_000,
    serviceContractSold: index % 2 === 0,
    tireWheelSold: index % 4 === 0,
    gapSold: index % 3 === 0,
    paymentMethod: index % 10 < 7 ? "dealer_financed" : index % 10 < 9 ? "cash" : "outside_financing",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
    source: "demo",
  };
}

function renderReport(sales: Sale[] = Array.from({ length: 60 }, (_, index) => sale(index))) {
  const summary = calculateMonth(sales, "2026-08", DEFAULT_PAY_PLAN);
  return render(createElement(FiReportCenter, {
    calculatedSales: summary.calculatedSales,
    analytics: calculateMonthReportAnalytics(summary),
    includeLastNames: true,
    scopeLabel: "August 2026",
    onOpenSale: vi.fn(),
  }));
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("F&I report view performance", () => {
  it("explains an empty period without claiming complete data or offering an ineffective filter reset", () => {
    renderReport([]);

    expect(screen.queryByText("All F&I details are complete")).toBeNull();
    expect(screen.getByText("Add a delivered sale or choose a period with deliveries to see F&I results.")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Deals" }));

    expect(screen.getByText("No delivered sales in this period")).toBeVisible();
    expect(screen.queryByText("No deals match this view")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show all deals" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Find a deal" })).toBeNull();
  });

  it("explains why pending-only sales do not have delivered F&I results", () => {
    renderReport([{ ...sale(0), status: "pending" }]);

    expect(screen.queryByText("All F&I details are complete")).toBeNull();
    expect(screen.getByText("No delivered sales yet")).toBeVisible();
    expect(screen.getByText("1 pending sale is not included in F&I results. Mark each sale Delivered in Sales after delivery.")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Deals" }));

    expect(screen.getByText("No delivered sales yet")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Show all deals" })).toBeNull();
  });

  it("distinguishes excluded delivered records from a period without deliveries", () => {
    renderReport([sale(0), { ...sale(1), stockNumber: sale(0).stockNumber }]);

    expect(screen.getByText("No delivered sales count in this report yet")).toBeVisible();
    expect(screen.getByText("2 delivered sales are excluded from these totals. Review the flagged records in Sales to see what needs attention.")).toBeVisible();
    expect(screen.queryByText("All F&I details are complete")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Deals" }));

    expect(screen.getByText("No delivered sales count in this report yet")).toBeVisible();
    expect(screen.queryByText("No delivered sales in this period")).toBeNull();
  });

  it("keeps a useful reset when delivered deals exist but a search has no matches", () => {
    renderReport();
    fireEvent.click(screen.getByRole("tab", { name: "Deals" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a deal" }), { target: { value: "does-not-exist" } });

    expect(screen.getByText("No deals match this view")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show all deals" }));

    expect(screen.getByText("Showing 24 of 60 matching deals")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Find a deal" })).toHaveValue("");
  });

  it.each([true, false])("respects reduced motion=%s while moving focus to the selected evidence", (reduceMotion) => {
    renderReport();
    fireEvent.click(screen.getByRole("tab", { name: "Products" }));
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduceMotion }));

    fireEvent.click(screen.getByRole("button", { name: "View deals for Service contract / warranty" }));
    const evidenceHeading = screen.getByRole("heading", { name: "Deals behind these totals" });
    evidenceHeading.scrollIntoView = vi.fn();
    act(() => scheduledFrames.forEach((callback) => callback(0)));

    expect(evidenceHeading.scrollIntoView).toHaveBeenCalledWith({ behavior: reduceMotion ? "instant" : "smooth", block: "start" });
    expect(evidenceHeading).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Deals" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Show" })).toHaveValue("serviceContract");
  });

  it("mounts only the active report view and reveals deal evidence in bounded batches", () => {
    const { container } = renderReport();

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const productsTab = screen.getByRole("tab", { name: "Products" });
    const dealsTab = screen.getByRole("tab", { name: "Deals" });
    const productsPanel = document.getElementById(productsTab.getAttribute("aria-controls")!);
    const dealsPanel = document.getElementById(dealsTab.getAttribute("aria-controls")!);

    expect(overviewTab).toHaveAttribute("aria-selected", "true");
    expect(productsPanel).toBeEmptyDOMElement();
    expect(dealsPanel).toBeEmptyDOMElement();
    expect(screen.getByText("$72,000 total recorded · 60/60 entered")).toBeVisible();

    fireEvent.click(dealsTab);

    expect(dealsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Showing 24 of 60 matching deals")).toBeVisible();
    expect(container.querySelectorAll(".fi-center-evidence-table tbody tr")).toHaveLength(24);
    expect(container.querySelectorAll(".fi-center-evidence-cards article")).toHaveLength(24);

    fireEvent.click(screen.getByRole("button", { name: "Show 24 more" }));

    expect(screen.getByText("Showing 48 of 60 matching deals")).toBeVisible();
    expect(container.querySelectorAll(".fi-center-evidence-table tbody tr")).toHaveLength(48);
    expect(container.querySelectorAll(".fi-center-evidence-cards article")).toHaveLength(48);

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a deal" }), {
      target: { value: "STK-060" },
    });

    expect(screen.getByText("Showing 1 of 1 matching deals")).toBeVisible();
    expect(container.querySelectorAll(".fi-center-evidence-table tbody tr")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();

    fireEvent.click(productsTab);

    expect(screen.getByRole("heading", { name: "Products sold" })).toBeVisible();
    expect(dealsPanel).toBeEmptyDOMElement();
  });

  it("keeps tab keyboard navigation and panel relationships accessible", () => {
    renderReport();
    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const productsTab = screen.getByRole("tab", { name: "Products" });

    overviewTab.focus();
    fireEvent.keyDown(overviewTab, { key: "ArrowRight" });

    expect(productsTab).toHaveFocus();
    expect(productsTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById(productsTab.getAttribute("aria-controls")!)).not.toHaveAttribute("hidden");
    expect(screen.getAllByRole("tabpanel", { hidden: true }).filter((panel) => !panel.hasAttribute("hidden"))).toHaveLength(1);
  });

  it("temporarily mounts every view and every matching deal for a complete printout", () => {
    const { container } = renderReport();
    const productsTab = screen.getByRole("tab", { name: "Products" });
    const dealsTab = screen.getByRole("tab", { name: "Deals" });
    const productsPanel = document.getElementById(productsTab.getAttribute("aria-controls")!);
    const dealsPanel = document.getElementById(dealsTab.getAttribute("aria-controls")!);

    expect(productsPanel).toBeEmptyDOMElement();
    expect(dealsPanel).toBeEmptyDOMElement();

    let viewsBeforePrintReturned = 0;
    let viewsAfterPrintReturned = 0;
    const observeBeforePrint = () => {
      viewsBeforePrintReturned = container.querySelectorAll(".fi-center-view:not([hidden])").length;
    };
    const observeAfterPrint = () => {
      viewsAfterPrintReturned = container.querySelectorAll(".fi-center-view:not([hidden])").length;
    };
    window.addEventListener("beforeprint", observeBeforePrint);
    window.addEventListener("afterprint", observeAfterPrint);

    fireEvent(window, new Event("beforeprint"));

    expect(viewsBeforePrintReturned).toBe(5);
    expect(screen.getAllByRole("tabpanel")).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "Products sold" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deals behind these totals" })).toBeInTheDocument();
    expect(container.querySelectorAll(".fi-center-evidence-table tbody tr")).toHaveLength(60);
    expect(screen.getByText("Showing 60 of 60 matching deals")).toBeInTheDocument();

    fireEvent(window, new Event("afterprint"));

    expect(viewsAfterPrintReturned).toBe(1);
    expect(productsPanel).toBeEmptyDOMElement();
    expect(dealsPanel).toBeEmptyDOMElement();

    window.removeEventListener("beforeprint", observeBeforePrint);
    window.removeEventListener("afterprint", observeAfterPrint);
  });
});
