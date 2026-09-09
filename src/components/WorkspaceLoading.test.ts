/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceLoading } from "./WorkspaceLoading";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("initial workspace opening recovery", () => {
  it("keeps fast loading brief and never reloads automatically", () => {
    const reload = vi.fn();
    const view = render(createElement(WorkspaceLoading, { isOnline: true, isCloud: true, onReload: reload }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Opening your sales workspace");
    expect(screen.getByRole("status")).toHaveTextContent("Loading your sales and totals…");
    expect(screen.queryByRole("button")).toBeNull();
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.queryByRole("button")).toBeNull();
    view.unmount();
    act(() => vi.advanceTimersByTime(30_000));
    expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("offers a labeled native reload button after ten seconds without claiming a save", () => {
    const reload = vi.fn();
    render(createElement(WorkspaceLoading, { isOnline: true, isCloud: true, onReload: reload }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status")).toHaveTextContent("Your workspace is taking longer to open");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/Your sales have not finished loading/)).toBeVisible();
    const button = screen.getByRole("button", { name: "Reload app" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "button");
    button.focus();
    expect(button).toHaveFocus();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.queryByText(/all changes saved|saved securely|workspace ready/i)).toBeNull();
  });

  it("explains an offline cloud opening immediately and updates when the connection returns", () => {
    const view = render(createElement(WorkspaceLoading, { isOnline: false, isCloud: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Reconnect to open your workspace");
    expect(screen.getByText(/Your cloud workspace needs an internet connection/)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    view.rerender(createElement(WorkspaceLoading, { isOnline: true, isCloud: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading your sales and totals…");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("button", { name: "Reload app" })).toBeVisible();
    view.rerender(createElement(WorkspaceLoading, { isOnline: false, isCloud: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Reconnect to open your workspace");
    expect(screen.getByRole("button", { name: "Reload app" })).toBeVisible();
    view.rerender(createElement(WorkspaceLoading, { isOnline: true, isCloud: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Your workspace is taking longer to open");
  });

  it("does not claim browser-stored sales require an internet connection", () => {
    render(createElement(WorkspaceLoading, { isOnline: false, isCloud: false }));
    expect(screen.getByRole("status")).toHaveTextContent("Opening your sales workspace");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status")).toHaveTextContent("Your workspace is taking longer to open");
    expect(screen.queryByText(/needs an internet connection|Reconnect to open/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeEnabled();
  });
});
