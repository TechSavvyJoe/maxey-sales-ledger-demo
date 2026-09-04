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
  CLOUD_BUILD,
  subscribeStorageChanges,
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
  const mountedRef = useRef(true);
  const refreshSequence = useRef(0);
  const appliedSequence = useRef(0);
  const latestAppliedData = useRef<Awaited<ReturnType<typeof loadTrackerData>> | null>(null);
  const hasLoadedData = useRef(false);
  const committedSaleVersions = useRef(new Map<string, Sale>());
  const committedSettingsVersion = useRef<ProfileSettings | null>(null);

  const applyCommittedSale = useCallback((committed: Sale) => {
    const priorAck = committedSaleVersions.current.get(committed.id);
    if (!priorAck || priorAck.revision <= committed.revision) committedSaleVersions.current.set(committed.id, committed);
    const merge = (current: Sale[]) => current.some((item) => item.id === committed.id)
      ? current.map((item) => item.id === committed.id && item.revision <= committed.revision ? committed : item)
      : [committed, ...current];
    if (mountedRef.current) setSales(merge);
    if (latestAppliedData.current) latestAppliedData.current = {
      ...latestAppliedData.current, sales: merge(latestAppliedData.current.sales),
    };
  }, []);

  const assertActiveWorkspace = useCallback(() => {
    if (!mountedRef.current) throw new Error("This workspace is no longer open. Sign in and open the sale again before making changes.");
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return null;
    const sequence = ++refreshSequence.current;
    try {
      if (AUTOLOAD_PUBLIC_DEMO && !CLOUD_BUILD) {
        startupRef.current ??= initializePublishedDemo().catch((caughtError) => {
          startupRef.current = null;
          throw caughtError;
        });
        await startupRef.current;
      }
      const loaded = await loadTrackerData();
      if (!mountedRef.current) return null;
      const protectedSettings = committedSettingsVersion.current
        && loaded.settings.updatedAt < committedSettingsVersion.current.updatedAt
        ? committedSettingsVersion.current : loaded.settings;
      const protectedSales = CLOUD_BUILD ? loaded.sales.map((item) => {
        const committed = committedSaleVersions.current.get(item.id);
        return committed && item.revision < committed.revision ? committed : item;
      }) : loaded.sales;
      if (CLOUD_BUILD) {
        const loadedIds = new Set(loaded.sales.map((item) => item.id));
        committedSaleVersions.current.forEach((committed, id) => {
          if (!loadedIds.has(id)) protectedSales.push(committed);
        });
      }
      const data = { ...loaded, settings: protectedSettings, sales: protectedSales };
      const previous = latestAppliedData.current;
      // A newer pending listener must not discard a completed post-save read.
      // Server revision is authoritative; request order only breaks ties (or
      // orders local reads). Never hand a discarded snapshot back to an editor.
      const older = data.cloudRevision !== undefined && previous?.cloudRevision !== undefined
        ? data.cloudRevision < previous.cloudRevision
          || (data.cloudRevision === previous.cloudRevision && sequence < appliedSequence.current)
        : sequence < appliedSequence.current;
      if (older) return previous;
      appliedSequence.current = Math.max(appliedSequence.current, sequence);
      latestAppliedData.current = data;
      hasLoadedData.current = true;
      setSettings(data.settings);
      setSales(data.sales);
      setAuditEvents(data.auditEvents);
      setError(null);
      setIsLoading(false);
      return data;
    } catch (caught) {
      if (!mountedRef.current || sequence !== refreshSequence.current) return null;
      // A later connection failure must not unmount a dirty sale editor.
      if (CLOUD_BUILD && hasLoadedData.current) return null;
      const accessDenied = typeof caught === "object" && caught !== null && "code" in caught && caught.code === "permission-denied";
      setError(CLOUD_BUILD
        ? accessDenied ? "This account does not have access to the private pilot yet. Ask the app owner to activate it, then reload."
          : caught instanceof Error ? caught.message : "Your cloud ledger could not be opened. Check your connection and account access."
        : "Your saved sales could not be opened in this browser.");
      return null;
    } finally {
      if (mountedRef.current && sequence === refreshSequence.current) setIsLoading(false);
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
    mountedRef.current = true;
    // refresh owns initialization and its error boundary. Chaining a separate
    // initialization promise here left rejected opens unhandled and loading
    // forever.
    void Promise.resolve().then(refresh);
    const stopCloud = subscribeStorageChanges(() => void refresh(), () => {
      if (mountedRef.current && !hasLoadedData.current) setError("Your cloud ledger could not be opened. Check your connection and ask the app owner to check your pilot access.");
    });
    if (!CLOUD_BUILD && "BroadcastChannel" in window) {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current.addEventListener("message", () => void refresh());
    }
    return () => {
      mountedRef.current = false;
      stopCloud();
      channelRef.current?.close();
    };
  }, [refresh]);

  const saveSale = useCallback(
    async (sale: Sale, isNew: boolean, originalVersion?: SaleVersionToken) => {
      assertActiveWorkspace();
      let expectedVersion: SaleVersionToken | undefined = originalVersion;
      if (!isNew && !expectedVersion) {
        const expectedRevision = sale.revision - 1;
        const acknowledged = committedSaleVersions.current.get(sale.id);
        const baseline = acknowledged?.revision === expectedRevision ? acknowledged : (latestAppliedData.current?.sales ?? sales).find(
          (storedSale) => storedSale.id === sale.id && storedSale.revision === expectedRevision,
        );
        expectedVersion = baseline
          ? { revision: baseline.revision, updatedAt: baseline.updatedAt }
          : { revision: expectedRevision, updatedAt: "" };
      }
      const committed = await persistSale(sale, isNew, expectedVersion);
      applyCommittedSale(committed);
      await refresh();
      broadcast();
      return committed;
    },
    [applyCommittedSale, assertActiveWorkspace, broadcast, refresh, sales],
  );

  const deleteSale = useCallback(
    async (sale: Sale) => {
      assertActiveWorkspace();
      const deleted = await softDeleteSale(sale);
      applyCommittedSale(deleted);
      await refresh();
      broadcast();
      return deleted;
    },
    [applyCommittedSale, assertActiveWorkspace, broadcast, refresh],
  );

  const undoDelete = useCallback(
    async (sale: Sale) => {
      assertActiveWorkspace();
      const restored = await restoreSale(sale);
      applyCommittedSale(restored);
      await refresh();
      broadcast();
      return restored;
    },
    [applyCommittedSale, assertActiveWorkspace, broadcast, refresh],
  );

  const saveSettings = useCallback(
    async (nextSettings: ProfileSettings) => {
      assertActiveWorkspace();
      const committed = await persistSettings(nextSettings);
      if (!committedSettingsVersion.current || committedSettingsVersion.current.updatedAt <= committed.updatedAt) {
        committedSettingsVersion.current = committed;
      }
      if (mountedRef.current) {
        setSettings((current) => current && current.updatedAt > committed.updatedAt ? current : committed);
        if (latestAppliedData.current && latestAppliedData.current.settings.updatedAt <= committed.updatedAt) {
          latestAppliedData.current = { ...latestAppliedData.current, settings: committed };
        }
      }
      await refresh();
      broadcast();
      return committed;
    },
    [assertActiveWorkspace, broadcast, refresh],
  );

  const saveContext = useCallback(
    async (
      changes: Partial<
        Pick<ProfileSettings, "selectedMonth" | "selectedView" | "onboardingDismissed">
      >,
    ) => {
      assertActiveWorkspace();
      if (!settings) return;
      const updated = await updateSelectedContext(settings, changes);
      if (!mountedRef.current) return;
      setSettings(updated);
      broadcast();
    },
    [assertActiveWorkspace, broadcast, settings],
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
