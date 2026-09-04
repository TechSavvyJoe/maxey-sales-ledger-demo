import { createContext, createElement, useContext, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { Action, ExternalToast } from "sonner";

type WorkspaceToastOptions = Omit<ExternalToast, "action" | "cancel"> & { action?: Action; cancel?: Action };
type Notify = (message: Parameters<typeof toast.success>[0], options?: WorkspaceToastOptions) => string | number;
type WorkspaceToast = Record<"success" | "error" | "info" | "warning", Notify> & Pick<typeof toast, "dismiss">;

const WorkspaceToastContext = createContext<WorkspaceToast | null>(null);

function createWorkspaceNotifications() {
  let active = true;
  const ids = new Set<string | number>();
  const guardAction = (action?: Action): Action | undefined => action && ({
    ...action,
    onClick: (event) => { if (active) action.onClick(event); },
  });
  const notify = (method: "success" | "error" | "info" | "warning"): Notify => (message, options) => {
    // Async handlers can finish after their account tree has been removed.
    if (!active) return "";
    const id = toast[method](message, options && {
      ...options,
      action: guardAction(options.action),
      cancel: guardAction(options.cancel),
      onDismiss: (value) => { if (active) options.onDismiss?.(value); },
      onAutoClose: (value) => { if (active) options.onAutoClose?.(value); },
    });
    ids.add(id);
    return id;
  };
  const scopedToast: WorkspaceToast = {
    success: notify("success"),
    error: notify("error"),
    info: notify("info"),
    warning: notify("warning"),
    dismiss: (id) => {
      if (!active) return "";
      if (id !== undefined) {
        if (ids.has(id)) toast.dismiss(id);
      } else {
        ids.forEach((ownedId) => toast.dismiss(ownedId));
      }
      return id ?? "";
    },
  };
  return {
    toast: scopedToast,
    activate: () => { active = true; },
    deactivate: () => {
      active = false;
      ids.forEach((id) => toast.dismiss(id));
      ids.clear();
    },
  };
}

/** One notification lifetime for the whole mounted workspace, including lazy pages. */
export function WorkspaceToastProvider({ children }: { children?: ReactNode }) {
  const [scope] = useState(createWorkspaceNotifications);
  useLayoutEffect(() => {
    scope.activate();
    return () => { scope.deactivate(); };
  }, [scope]);
  return createElement(WorkspaceToastContext.Provider, { value: scope.toast }, children);
}

export function useWorkspaceToast(): WorkspaceToast {
  // Standalone/local page consumers retain their normal notification behavior.
  return useContext(WorkspaceToastContext) ?? toast;
}
