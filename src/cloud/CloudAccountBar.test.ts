/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudStorageState } from "@/persistence/database";
import { CloudAccountBar } from "./CloudAccountBar";

const storage = vi.hoisted(() => ({ state: null as CloudStorageState | null }));
vi.mock("@/persistence/database", () => ({
  getCloudStorageState: () => storage.state,
  subscribeCloudStorageState: () => () => {},
}));

beforeEach(() => {
  storage.state = { uid: "example", email: "example@example.test", pending: 0, lastSavedAt: null, error: null, connectionError: null };
});
afterEach(cleanup);

function show(isOnline = true, onSignOut = vi.fn(async () => {})) {
  return render(createElement(CloudAccountBar, { account: { email: "example@example.test", onSignOut }, isOnline }));
}

describe("cloud account feedback", () => {
  it("does not claim a new account has saved a sale", () => {
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Private cloud workspace ready");
    expect(screen.queryByText(/Saved securely at/)).toBeNull();
  });

  it("keeps offline guidance visible even while a write is pending", () => {
    storage.state!.pending = 1;
    storage.state!.lastSavedAt = "2026-09-08T12:00:00.000Z";
    show(false);
    expect(screen.getByRole("status")).toHaveTextContent("Offline — reconnect to save");
    expect(screen.getByText(/Keep this tab open and reconnect/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
    expect(screen.queryByText(/Saving securely|Saved securely at/)).toBeNull();
  });

  it("does not let a background draft hide a failed save", () => {
    storage.state!.pending = 1;
    storage.state!.error = "internal backend message";
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Last save needs attention");
    expect(screen.getByText(/Review the message for the action you tried/)).toBeVisible();
    expect(screen.queryByText("internal backend message")).toBeNull();
  });

  it("explains a connection failure without telling the user to discard or reload edits", () => {
    storage.state!.connectionError = "internal backend message";
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Cloud connection needs attention");
    expect(screen.getByText(/Keep any editor open and check your connection/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /reload|refresh/i })).toBeNull();
  });

  it("keeps routine background saves quiet in the account banner", () => {
    storage.state!.pending = 1;
    storage.state!.lastSavedAt = "2026-09-08T12:00:00.000Z";
    const view = show();
    expect(screen.getByRole("status")).toHaveTextContent("Saved securely at");
    expect(screen.queryByText("Saving securely…")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
    storage.state = { ...storage.state!, pending: 0 };
    view.rerender(createElement(CloudAccountBar, { account: { email: "example@example.test", onSignOut: async () => {} }, isOnline: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved securely at");
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("prevents repeat sign-out and gives a retry after a failure", async () => {
    let reject!: (reason: Error) => void;
    const signOut = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    show(true, signOut);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    await act(async () => reject(new Error("internal backend message")));
    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign-out did not finish. Please try again.");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });
});
