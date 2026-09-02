import { useCallback, useEffect, useRef, useState } from "react";
import { AUTOLOAD_PUBLIC_DEMO } from "@/domain/demo";
import type { AuditEvent, ProfileSettings, Sale } from "@/domain/types";
import {
  initializePublishedDemo,
  loadTrackerData,
  persistSale,
  persistSettings,
  restoreSale,
  softDeleteSale,
  updateSelectedContext,
} from "@/persistence/database";
import type { SaleVersionToken } from "@/persistence/errors";

const CHANNEL_NAME = "maxey-sales-command-center-updates";

export function useTrackerData() {
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const startupRef = useRef<Promise<unknown> | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (AUTOLOAD_PUBLIC_DEMO) {
        startupRef.current ??= initializePublishedDemo().catch((caughtError) => {
          startupRef.current = null;
          throw caughtError;
        });
        await startupRef.current;
      }
      const data = await loadTrackerData();
      setSettings(data.settings);
      setSales(data.sales);
      setAuditEvents(data.auditEvents);
      setError(null);
      return data;
    } catch {
      setError("Your saved sales could not be opened in this browser.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const broadcast = useCallback(() => {
    channelRef.current?.postMessage({ type: "refresh", at: Date.now() });
  }, []);

  const refreshAfterExternalMutation = useCallback(async () => {
    const data = await refresh();
    broadcast();
    return data;
  }, [broadcast, refresh]);

  useEffect(() => {
    // refresh owns initialization and its error boundary. Chaining a separate
    // initialization promise here left rejected opens unhandled and loading
    // forever.
    void Promise.resolve().then(refresh);
    if ("BroadcastChannel" in window) {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current.addEventListener("message", () => void refresh());
    }
    return () => channelRef.current?.close();
  }, [refresh]);

  const saveSale = useCallback(
    async (sale: Sale, isNew: boolean) => {
      let expectedVersion: SaleVersionToken | undefined;
      if (!isNew) {
        const expectedRevision = sale.revision - 1;
        const baseline = sales.find(
          (storedSale) => storedSale.id === sale.id && storedSale.revision === expectedRevision,
        );
        expectedVersion = baseline
          ? { revision: baseline.revision, updatedAt: baseline.updatedAt }
          : { revision: expectedRevision, updatedAt: "" };
      }
      await persistSale(sale, isNew, expectedVersion);
      await refresh();
      broadcast();
    },
    [broadcast, refresh, sales],
  );

  const deleteSale = useCallback(
    async (sale: Sale) => {
      const deleted = await softDeleteSale(sale);
      await refresh();
      broadcast();
      return deleted;
    },
    [broadcast, refresh],
  );

  const undoDelete = useCallback(
    async (sale: Sale) => {
      const restored = await restoreSale(sale);
      await refresh();
      broadcast();
      return restored;
    },
    [broadcast, refresh],
  );

  const saveSettings = useCallback(
    async (nextSettings: ProfileSettings) => {
      await persistSettings(nextSettings);
      await refresh();
      broadcast();
    },
    [broadcast, refresh],
  );

  const saveContext = useCallback(
    async (
      changes: Partial<
        Pick<ProfileSettings, "selectedMonth" | "selectedView" | "onboardingDismissed">
      >,
    ) => {
      if (!settings) return;
      const updated = await updateSelectedContext(settings, changes);
      setSettings(updated);
      broadcast();
    },
    [broadcast, settings],
  );

  return {
    settings,
    sales,
    auditEvents,
    isLoading,
    error,
    refresh,
    refreshAfterExternalMutation,
    saveSale,
    deleteSale,
    undoDelete,
    saveSettings,
    saveContext,
  };
}
