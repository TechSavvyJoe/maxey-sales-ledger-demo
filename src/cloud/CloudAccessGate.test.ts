/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import { CloudAccessGate } from "./CloudAccessGate";

type Profile = { uid: string; enabled: boolean; createdAt: string };
type Snapshot = { metadata: { fromCache: boolean; hasPendingWrites: boolean }; exists: () => boolean; data: () => Profile };
const mock = vi.hoisted(() => ({
  profiles: new Map<string, Profile>(), listener: null as ((snapshot: Snapshot) => void) | null,
  error: null as (() => void) | null, unsubscribe: vi.fn(), signOut: vi.fn(), path: "", failRead: false,
}));
function profileSnapshot(path: string): Snapshot {
  const profile = mock.profiles.get(path);
  return {
    metadata: { fromCache: false, hasPendingWrites: false },
    exists: () => profile !== undefined,
    data: () => profile ?? { uid: "", enabled: false, createdAt: "" },
  };
}
vi.mock("firebase/firestore", () => ({
  doc: (_firestore: unknown, ...segments: string[]) => { mock.path = segments.join("/"); return mock.path; },
  getDocFromServer: async (path: string) => {
    if (mock.failRead) throw new Error("offline");
    return profileSnapshot(path);
  },
  setDoc: async (path: string, data: Profile) => { mock.profiles.set(path, data); },
  onSnapshot: (_ref: unknown, _options: unknown, listener: (snapshot: Snapshot) => void, error: () => void) => {
    mock.listener = listener; mock.error = error; return mock.unsubscribe;
  },
}));
vi.mock("./CloudAuthGate", () => ({ AuthFrame: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
const show = (uid = "synthetic-owner") => render(createElement(CloudAccessGate, {
  firestore: {} as Firestore, uid, email: "example@example.invalid", signOut: mock.signOut,
}, createElement("div", {}, "Private ledger")));
function status(profile?: Profile, fromCache = false) {
  act(() => mock.listener?.({ metadata: { fromCache, hasPendingWrites: false }, exists: () => profile !== undefined, data: () => profile ?? { uid: "", enabled: false, createdAt: "" } }));
}
beforeEach(() => { vi.clearAllMocks(); mock.profiles.clear(); mock.failRead = false; mock.signOut.mockResolvedValue(undefined); });
afterEach(() => cleanup());
describe("private workspace access", () => {
  it("creates a server-acknowledged personal workspace on first sign-in", async () => {
    show();
    expect(await screen.findByText("Private ledger")).toBeTruthy();
    const profile = mock.profiles.get("pilotUsers/synthetic-owner");
    expect(profile).toMatchObject({ uid: "synthetic-owner", enabled: true });
    expect(profile?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("opens an existing personal workspace without changing its enrollment", async () => {
    mock.profiles.set("pilotUsers/synthetic-owner", { uid: "synthetic-owner", enabled: true, createdAt: "2026-09-04T12:00:00.000Z" });
    show();
    expect(await screen.findByText("Private ledger")).toBeTruthy();
    expect(mock.profiles.get("pilotUsers/synthetic-owner")?.createdAt).toBe("2026-09-04T12:00:00.000Z");
  });

  it("does not mistake connectivity failure for an unavailable workspace", async () => {
    mock.failRead = true;
    show();
    expect(await screen.findByRole("heading", { name: "Let’s reconnect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    mock.failRead = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Private ledger")).toBeTruthy();
  });

  it("closes the mounted workspace only when a server profile is deliberately disabled", async () => {
    show();
    expect(await screen.findByText("Private ledger")).toBeTruthy();
    status({ uid: "synthetic-owner", enabled: false, createdAt: "2026-09-04T12:00:00.000Z" });
    expect(screen.queryByText("Private ledger")).toBeNull();
    expect(screen.getByRole("heading", { name: "This workspace is unavailable" })).toBeTruthy();
  });

  it("unsubscribes and never carries a workspace into a different account", async () => {
    const view = show();
    expect(await screen.findByText("Private ledger")).toBeTruthy();
    const old = mock.listener;
    view.rerender(createElement(CloudAccessGate, {
      firestore: {} as Firestore, uid: "another-user", email: "other@example.invalid", signOut: mock.signOut,
    }, createElement("div", {}, "Different ledger")));
    expect(await screen.findByText("Different ledger")).toBeTruthy();
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
    act(() => old?.(profileSnapshot("pilotUsers/synthetic-owner")));
    expect(screen.queryByText("Private ledger")).toBeNull();
  });
});
