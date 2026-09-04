/** @vitest-environment jsdom */
import { Component, createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { isStaleModuleError } from "./appErrorRecovery";

class BrokenView extends Component<{ error: unknown }> {
  render(): ReactNode {
    throw this.props.error;
  }
}

function renderFailure(error: unknown) {
  return render(createElement(AppErrorBoundary, null, createElement(BrokenView, { error })));
}

describe("AppErrorBoundary", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => undefined); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("turns an expired lazy page into a clear reload screen instead of a blank app", () => {
    renderFailure(new TypeError("Failed to fetch dynamically imported module: /assets/ReportsPage-old.js"));
    expect(screen.getByRole("heading", { name: "A new version is ready" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload Sales Ledger" })).toBeTruthy();
    expect(screen.getByText(/saved sales remain in place/i)).toBeTruthy();
  });

  it("uses a safe recovery screen for other render failures without showing technical details", () => {
    renderFailure(new Error("private@example.com token=secret"));
    expect(screen.getByRole("heading", { name: "Sales Ledger needs to reload" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/private@example.com|token=secret/);
  });

  it("shows the recovery screen even when a descendant throws a falsy value", () => {
    renderFailure(null);
    expect(screen.getByRole("heading", { name: "Sales Ledger needs to reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload Sales Ledger" })).toBeTruthy();
  });

  it("recognizes the common browser messages for replaced build chunks", () => {
    expect(isStaleModuleError(new Error("Importing a module script failed"))).toBe(true);
    expect(isStaleModuleError(new Error("ChunkLoadError: Loading chunk 7 failed"))).toBe(true);
    expect(isStaleModuleError(new Error("ordinary render error"))).toBe(false);
  });
});
