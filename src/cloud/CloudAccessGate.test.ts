/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import { CloudAccessGate } from "./CloudAccessGate";

type Snapshot = { metadata: { fromCache: boolean; hasPendingWrites: boolean }; exists: () => boolean; data: () => { enabled?: boolean } };
const mock = vi.hoisted(() => ({ listener: null as ((snapshot: Snapshot) => void) | null, error: null as (() => void) | null, unsubscribe: vi.fn(), signOut: vi.fn(), path: "" }));
vi.mock("firebase/firestore", () => ({
  doc: (_firestore: unknown, ...segments: string[]) => { mock.path = segments.join("/"); return mock.path; },
  onSnapshot: (_ref: unknown, _options: unknown, listener: (snapshot: Snapshot) => void, error: () => void) => { mock.listener = listener; mock.error = error; return mock.unsubscribe; },
}));
vi.mock("./CloudAuthGate", () => ({ AuthFrame: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
const show = () => render(createElement(CloudAccessGate, { firestore: {} as Firestore, uid: "synthetic-owner", email: "example@example.invalid", signOut: mock.signOut }, createElement("div", {}, "Private ledger")));
function status(enabled?: boolean, fromCache = false) {
  act(() => mock.listener?.({ metadata: { fromCache, hasPendingWrites: false }, exists: () => enabled !== undefined, data: () => ({ enabled }) }));
}
beforeEach(() => { vi.clearAllMocks(); mock.signOut.mockResolvedValue(undefined); });
afterEach(() => cleanup());
describe("private workspace access", () => {
  it("keeps private content unmounted until a server approval and watches only the signed-in account", () => {
    show(); expect(mock.path).toBe("pilotUsers/synthetic-owner");
    expect(screen.queryByText("Private ledger")).toBeNull();
    status(true, true); expect(screen.queryByText("Private ledger")).toBeNull();
    status(true); expect(screen.getByText("Private ledger")).toBeTruthy();
  });
  it("explains pending access without calling it a saved-workspace failure, then opens automatically", () => {
    show(); status(false);
    expect(screen.getByRole("heading").textContent).toBe("You’re signed in");
    expect(screen.getByRole("status").textContent).toMatch(/waiting for access/);
    expect(screen.queryByRole("alert")).toBeNull();
    status(true); expect(screen.getByText("Private ledger")).toBeTruthy();
    status(false); expect(screen.queryByText("Private ledger")).toBeNull();
  });
  it("does not mistake connectivity failure for a denied account", () => {
    show(); act(() => mock.error?.());
    expect(screen.getByRole("heading").textContent).toBe("Let’s reconnect");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
  it("unsubscribes and ignores late account data after leaving", () => {
    const view = show(); const old = mock.listener;
    view.unmount(); status(true); expect(mock.unsubscribe).toHaveBeenCalledOnce();
    expect(old).not.toBeNull(); expect(screen.queryByText("Private ledger")).toBeNull();
  });
  it("does not carry approval into a different user or data client", () => {
    const view = show(); status(true);
    expect(screen.getByText("Private ledger")).toBeTruthy();
    const previousListener = mock.listener;
    view.rerender(createElement(CloudAccessGate, { firestore: {} as Firestore, uid: "another-user", email: "other@example.invalid", signOut: mock.signOut }, createElement("div", {}, "Different ledger")));
    expect(screen.queryByText("Different ledger")).toBeNull();
    act(() => previousListener?.({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, data: () => ({ enabled: true }) }));
    expect(screen.queryByText("Different ledger")).toBeNull();
    status(true); expect(screen.getByText("Different ledger")).toBeTruthy();
  });
});
