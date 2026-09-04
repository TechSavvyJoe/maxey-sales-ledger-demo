/** @vitest-environment jsdom */
import { createElement } from "react";
import type { MouseEvent } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { Action } from "sonner";
import { WorkspaceToastProvider, useWorkspaceToast } from "./useWorkspaceToast";

type ScopedToast = ReturnType<typeof useWorkspaceToast>;
function Capture({ capture }: { capture: (value: ScopedToast) => void }) {
  capture(useWorkspaceToast());
  return null;
}
function workspace(key: string, capture: (value: ScopedToast) => void) {
  return createElement(WorkspaceToastProvider, { key }, createElement(Capture, { capture }));
}
function actionFor(id: string | number): Action {
  const notification = toast.getToasts().find((value) => value.id === id);
  if (!notification || !("action" in notification) || typeof notification.action !== "object" || !notification.action || !("onClick" in notification.action)) {
    throw new Error("Expected an active notification action");
  }
  return notification.action as Action;
}
const click = {} as MouseEvent<HTMLButtonElement>;

afterEach(() => { cleanup(); toast.dismiss(); });

describe("workspace notification lifetime", () => {
  it("keeps ordinary local notifications and their actions working", () => {
    let current!: ScopedToast;
    render(workspace("local", (value) => { current = value; }));
    const undo = vi.fn();
    const id = current.success("Fictional local sale saved", { action: { label: "Undo", onClick: undo } });
    expect(toast.getToasts().map((value) => value.id)).toContain(id);
    actionFor(id).onClick(click);
    expect(undo).toHaveBeenCalledOnce();
    current.dismiss();
    expect(toast.getToasts()).toHaveLength(0);
  });

  it("removes A's notification and disables its captured Undo after B opens", () => {
    let current!: ScopedToast;
    const capture = (value: ScopedToast) => { current = value; };
    const view = render(workspace("account-a", capture));
    const undoA = vi.fn();
    const a = current;
    const id = a.success("Sale deleted", { description: "Fictional stock ACCOUNT-A", action: { label: "Undo", onClick: undoA } });
    const oldUndo = actionFor(id);
    view.rerender(workspace("account-b", capture));
    expect(toast.getToasts()).toHaveLength(0);
    const bId = current.success("Account B saved");
    oldUndo.onClick(click);
    a.error("Late account A error");
    a.dismiss();
    expect(undoA).not.toHaveBeenCalled();
    expect(toast.getToasts().map((value) => value.id)).toEqual([bId]);
  });

  it("does not publish a previous account's delayed promise completion", async () => {
    let current!: ScopedToast;
    const capture = (value: ScopedToast) => { current = value; };
    const view = render(workspace("account-a", capture));
    const a = current;
    let finish!: () => void;
    const saving = new Promise<void>((resolve) => { finish = resolve; })
      .then(() => a.success("Fictional account A save finished"));
    view.rerender(workspace("account-b", capture));
    const bId = current.info("Account B connected");
    await act(async () => { finish(); await saving; });
    expect(toast.getToasts().map((value) => value.id)).toEqual([bId]);
  });

  it("preserves standalone local-page notification support", () => {
    let current!: ScopedToast;
    render(createElement(Capture, { capture: (value) => { current = value; } }));
    const id = current.info("Standalone local message");
    expect(toast.getToasts().map((value) => value.id)).toContain(id);
  });
});
