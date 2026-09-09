// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@/persistence/localDatabase";
import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import type { Sale } from "@/domain/types";
import { SalesPage } from "./SalesPage";

const oldSale: Sale = {
  id: "history-old", profileId: "primary", saleDate: "2026-01-03", customerLastName: "Example Historical",
  stockNumber: "TEST-OLD-01", vehicleDescription: "2021 Ford Explorer Platinum with a long vehicle description",
  status: "delivered", unitCreditBasis: 1000, frontGrossCents: 200_000, fiGrossCents: 100_000,
  notes: "", createdAt: "2026-01-03T12:00:00Z", updatedAt: "2026-01-03T12:00:00Z", revision: 1,
};
const currentSale = { ...oldSale, id: "history-current", saleDate: "2026-09-01", stockNumber: "TEST-CURRENT",
  customerLastName: "Example Current", vehicleDescription: "2024 Ford Escape" };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T18:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function openSales(sales = [oldSale, currentSale]) {
  const oldPlan = { ...DEFAULT_PAY_PLAN, fiRateBps: 1000, baseFrontRateBps: 2000 };
  const currentPlan = { ...DEFAULT_PAY_PLAN, effectiveMonth: "2026-09", baseFrontRateBps: 3500 };
  const settings = { ...createDefaultSettings(), selectedMonth: "2026-09", payPlan: currentPlan,
    payPlanHistory: [oldPlan, currentPlan] };
  const onEditSale = vi.fn();
  const onRestoreSale = vi.fn(async () => {});
  render(createElement(SalesPage, { sales, settings, onEditSale, onRestoreSale,
    onAddSale: vi.fn(), onDeleteSale: vi.fn(async () => {}) }));
  return { onEditSale, onRestoreSale };
}

describe("Sales history discovery", () => {
  it("starts in the selected month and finds older customer, vehicle and stock in All months", () => {
    const { onEditSale } = openSales();
    expect(screen.getByRole("button", { name: "September 2026", pressed: true })).toBeVisible();
    expect(screen.queryByText("Example Historical")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All months" }));
    expect(screen.getByRole("button", { name: "All months", pressed: true })).toBeVisible();
    for (const query of [" historical ", "explorer platinum", "TEST-OLD-01"]) {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search sales" }), { target: { value: query } });
      const table = screen.getByRole("region", { name: "All months sales table" });
      expect(within(table).getByText("Example Historical")).toBeVisible();
      expect(within(table).queryByText("Example Current")).toBeNull();
      expect(within(table).getByText("01/03/2026")).toBeVisible();
      expect(within(table).getByText(oldSale.vehicleDescription)).toBeVisible();
      expect(within(table).getByText("$500")).toBeVisible();
    }
    fireEvent.click(within(screen.getByRole("region", { name: "All months sales table" })).getByRole("button", { name: /Example Historical/ }));
    expect(onEditSale).toHaveBeenCalledWith(oldSale);
    fireEvent.click(screen.getByRole("button", { name: "September 2026" }));
    expect(screen.getByText("No matching sales")).toBeVisible();
  });

  it("can expand an empty selected-month search while retaining the query", () => {
    openSales([oldSale]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Historical" } });
    expect(screen.getByText("No matching sales")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Search all months" }));
    expect(screen.getByRole("searchbox")).toHaveValue("Historical");
    expect(screen.getAllByText("Example Historical")).toHaveLength(2);
  });

  it("clears empty search and status filters without unexpectedly leaving All months", () => {
    openSales();
    fireEvent.click(screen.getByRole("button", { name: "All months" }));
    fireEvent.click(screen.getByRole("button", { name: /^Pending/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No matching sales")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "All months", pressed: true })).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getAllByText("Example Historical")).toHaveLength(2);
    expect(screen.getAllByText("Example Current")).toHaveLength(2);
  });

  it("searches Recently deleted across months and clearing its query keeps deleted scope", () => {
    const deleted = { ...oldSale, deletedAt: "2026-08-02T12:00:00Z" };
    const { onRestoreSale } = openSales([deleted, currentSale]);
    fireEvent.click(screen.getByRole("button", { name: /^Recently deleted/ }));
    expect(screen.getByText("No recently deleted sales")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "TEST-OLD-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Search all months" }));
    const table = screen.getByRole("region", { name: "All months recently deleted sales table" });
    expect(within(table).getByText("Example Historical")).toBeVisible();
    expect(within(table).getByText("08/02/2026")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No matching deleted sales")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: /^Recently deleted/, pressed: true })).toBeVisible();
    fireEvent.click(within(screen.getByRole("region", { name: "All months recently deleted sales table" })).getByRole("button", { name: "Restore" }));
    expect(onRestoreSale).toHaveBeenCalledWith(deleted);
  });

  it("shows unavailable old-month commission as unknown with a review explanation", () => {
    openSales([{ ...oldSale, saleDate: "2025-01-03" }]);
    fireEvent.click(screen.getByRole("button", { name: "All months" }));
    const table = screen.getByRole("region", { name: "All months sales table" });
    expect(within(table).getByText("Example Historical")).toBeVisible();
    expect(within(table).getByText("Add a pay plan for this month in Settings")).toBeVisible();
    expect(within(table).getByText("—")).toBeVisible();
    expect(within(table).queryByText("$0")).toBeNull();
  });
});
