import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FlaskConical, RefreshCw } from "lucide-react";
import { ThemeProvider } from "next-themes";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { SaleFormSheet } from "@/features/sales/SaleFormSheet";
import {
  buildDemoSales,
  createPublicDemoHistoricPlan,
  DEMO_DATASET_TITLE,
  demoRangeDescription,
  IS_PUBLIC_DEMO_BUILD,
} from "@/domain/demo";
import { monthKeyFromDate, monthLabel, todayDateOnly } from "@/domain/date";
import {
  destinationForView,
  type AppDestination,
} from "@/domain/navigation";
import type { AppView, Sale } from "@/domain/types";
import { getPayPlanSchedule, hasPayPlanCoverage } from "@/domain/payPlan";
import { useAutomaticBackup } from "@/hooks/useAutomaticBackup";
import { useTrackerData } from "@/hooks/useTrackerData";
import { loadDemoSales, recordBackupExport } from "@/persistence/database";
import { isSaleWriteConflictError } from "@/persistence/errors";
import { activateWaitingServiceWorker } from "@/registerServiceWorker";

const Dashboard = lazy(async () => ({
  default: (await import("@/features/dashboard/Dashboard")).Dashboard,
}));
const SalesPage = lazy(async () => ({
  default: (await import("@/features/sales/SalesPage")).SalesPage,
}));
const ReportsPage = lazy(async () => ({
  default: (await import("@/features/reports/ReportsPage")).ReportsPage,
}));
const SettingsPage = lazy(async () => ({
  default: (await import("@/features/settings/SettingsPage")).SettingsPage,
}));

const SESSION_CONTEXT_KEY = "maxey-sales-ledger-tab-context-v1";

interface TabContext {
  selectedMonth: string;
  selectedView: AppView;
}

function PageLoading() {
  return (
    <div className="page-loading" role="status">
      <span />
      <span />
      <span />
      <span className="sr-only">Loading workspace section…</span>
    </div>
  );
}

function AppContent() {
  const {
    settings: persistedSettings,
    sales,
    auditEvents,
    isLoading,
    error,
    refreshAfterExternalMutation,
    saveSale,
    deleteSale,
    undoDelete,
    saveSettings,
    saveContext,
  } = useTrackerData();
  const automaticBackup = useAutomaticBackup(auditEvents);
  const [saleFormOpen, setSaleFormOpen] = useState(false);
  const [saleToEdit, setSaleToEdit] = useState<Sale | null>(null);
  const [saleFormInstance, setSaleFormInstance] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [payrollDirty, setPayrollDirty] = useState(false);
  const [destination, setDestination] = useState<AppDestination>({ view: "dashboard" });
  const [tabContext, setTabContext] = useState<TabContext | null>(null);
  const saleFormReturnFocusRef = useRef<HTMLElement | null>(null);
  const latestConflictSalesRef = useRef(new Map<string, Sale>());
  const tabContextInitializedRef = useRef(false);
  const settings = useMemo(
    () => persistedSettings
      ? { ...persistedSettings, ...(tabContext ?? {}) }
      : null,
    [persistedSettings, tabContext],
  );

  useEffect(() => {
    if (!persistedSettings || tabContextInitializedRef.current) return;
    tabContextInitializedRef.current = true;
    let saved: Partial<TabContext> = {};
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_CONTEXT_KEY) ?? "{}") as Partial<TabContext>;
    } catch {
      saved = {};
    }
    const schedule = getPayPlanSchedule(persistedSettings);
    const selectedMonth = typeof saved.selectedMonth === "string"
      && hasPayPlanCoverage(schedule, saved.selectedMonth)
      ? saved.selectedMonth
      : persistedSettings.selectedMonth;
    const selectedView: AppView = ["dashboard", "sales", "reports", "settings"].includes(saved.selectedView ?? "")
      ? saved.selectedView as AppView
      : persistedSettings.selectedView;
    setTabContext({ selectedMonth, selectedView });
  }, [persistedSettings]);

  useEffect(() => {
    if (!persistedSettings || !tabContextInitializedRef.current) return;
    const schedule = getPayPlanSchedule(persistedSettings);
    setTabContext((current) => {
      if (!current || hasPayPlanCoverage(schedule, current.selectedMonth)) return current;
      const next = { ...current, selectedMonth: persistedSettings.selectedMonth };
      try {
        sessionStorage.setItem(SESSION_CONTEXT_KEY, JSON.stringify(next));
      } catch {
        // The in-memory tab context still works when session storage is unavailable.
      }
      return next;
    });
  }, [persistedSettings]);

  useEffect(() => {
    if (!settings) return;
    const viewLabel: Record<AppView, string> = {
      dashboard: "Dashboard",
      sales: "Sales",
      reports: "Reports",
      settings: "Settings",
    };
    document.title = `${monthLabel(settings.selectedMonth)} ${viewLabel[settings.selectedView]} · Sales Ledger`;
  }, [settings]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const handleUpdate = () => {
      toast.info("A Sales Ledger update is ready.", {
        description: "Your saved sales will stay in place.",
        duration: Infinity,
        action: {
          label: "Update now",
          onClick: () => {
            navigator.serviceWorker?.addEventListener("controllerchange", () => window.location.reload(), {
              once: true,
            });
            activateWaitingServiceWorker();
          },
        },
      });
    };
    window.addEventListener("sales-ledger-update-ready", handleUpdate);
    return () => window.removeEventListener("sales-ledger-update-ready", handleUpdate);
  }, []);

  const monthsWithSales = useMemo(
    () =>
      new Set(
        sales
          .filter((sale) => !sale.deletedAt)
          .map((sale) => monthKeyFromDate(sale.saleDate))
          .filter(Boolean),
      ),
    [sales],
  );

  if (error) {
    return (
      <div className="app-fatal" role="alert">
        <AlertTriangle aria-hidden="true" />
        <h1>Sales Ledger could not open your saved workspace</h1>
        <p>{error}</p>
        <Button onClick={() => window.location.reload()}><RefreshCw aria-hidden="true" /> Reload app</Button>
        <small>If this continues, try the supported hosted URL in a current Chrome, Edge, Safari, or Firefox browser.</small>
      </div>
    );
  }

  if (isLoading || !settings) {
    return (
      <div className="app-loading" role="status">
        <img className="app-loading__mark" src={`${import.meta.env.BASE_URL}brand/sales-ledger-mark.svg`} width="48" height="48" alt="" />
        <strong>Opening your sales workspace</strong>
        <small>Loading your sales and totals…</small>
      </div>
    );
  }

  function openNewSale() {
    saleFormReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSaleToEdit(null);
    setSaleFormInstance((instance) => instance + 1);
    setSaleFormOpen(true);
  }

  function openEditSale(sale: Sale) {
    saleFormReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSaleToEdit(sale);
    setSaleFormInstance((instance) => instance + 1);
    setSaleFormOpen(true);
  }

  async function handleLoadLatestSale(saleId: string) {
    let latest = latestConflictSalesRef.current.get(saleId);
    if (!latest) {
      const refreshed = await refreshAfterExternalMutation();
      latest = refreshed?.sales.find((sale) => sale.id === saleId);
    }
    if (!latest || latest.deletedAt) {
      toast.error("Latest sale could not be loaded.", {
        description: "Close this form, reopen the sales log, and try again.",
      });
      return;
    }
    latestConflictSalesRef.current.delete(saleId);
    setSaleToEdit(latest);
    setSaleFormInstance((instance) => instance + 1);
    setSaleFormOpen(true);
    toast.success("Latest sale loaded.", {
      description: "Review the current values before making another change.",
    });
  }

  async function handleSaveSale(sale: Sale, isNew: boolean) {
    try {
      await saveSale(sale, isNew);
      latestConflictSalesRef.current.delete(sale.id);
      toast.success(isNew ? "Sale added." : "Sale updated.", {
        description: `${sale.stockNumber || "Missing stock"} · ${sale.status}`,
      });
    } catch (caughtError) {
      if (isSaleWriteConflictError(caughtError)) {
        const refreshed = await refreshAfterExternalMutation();
        const latest = refreshed?.sales.find((sale) => sale.id === caughtError.saleId);
        if (latest) latestConflictSalesRef.current.set(caughtError.saleId, latest);
        toast.error("Newer sale changes found.", {
          description: "Use Load latest in the open sale to review the saved version.",
        });
      } else {
        toast.error("Sale could not be saved.", {
          description: "Your entries are still open. Check the fields and try again.",
        });
      }
      throw caughtError;
    }
  }

  async function handleDeleteSale(sale: Sale) {
    try {
      const deleted = await deleteSale(sale);
      toast.success("Sale deleted.", {
        description: `${sale.stockNumber || "Missing stock"} was removed from calculations.`,
        action: {
          label: "Undo",
          onClick: () => void undoDelete(deleted)
            .then(() => toast.success("Sale restored."))
            .catch(() => toast.error("Sale could not be restored.", {
              description: "Open Recently deleted and try again.",
            })),
        },
      });
    } catch (caughtError) {
      toast.error("Sale could not be deleted.", {
        description: isSaleWriteConflictError(caughtError)
          ? caughtError.message
          : "The record is still in your sales log. Try again.",
      });
      if (isSaleWriteConflictError(caughtError)) await refreshAfterExternalMutation();
      throw caughtError;
    }
  }

  async function handleBackupExported() {
    await recordBackupExport();
    await refreshAfterExternalMutation();
  }

  async function handleLoadDemo() {
    if (!settings) return;
    try {
      const asOfDate = todayDateOnly();
      const result = await loadDemoSales(
        buildDemoSales(settings.selectedMonth, asOfDate),
        IS_PUBLIC_DEMO_BUILD ? { historicDemoPlan: createPublicDemoHistoricPlan(asOfDate) } : undefined,
      );
      await refreshAfterExternalMutation();
      const restoredDetail = result.restored > 0
        ? ` ${result.restored} previously removed record${result.restored === 1 ? " was" : "s were"} restored.`
        : "";
      toast.success(`${DEMO_DATASET_TITLE} demonstration loaded.`, {
        description: `${demoRangeDescription(asOfDate)} · fictional records only. Remove them anytime from Settings.${restoredDetail}`,
      });
    } catch (caughtError) {
      toast.error(
        caughtError instanceof Error
          ? `Could not load the ${DEMO_DATASET_TITLE.toLowerCase()} demo: ${caughtError.message}`
          : `Could not load the ${DEMO_DATASET_TITLE.toLowerCase()} demo.`,
      );
    }
  }

  function navigate(nextDestination: AppDestination | AppView, options?: { preserveFocus?: boolean }) {
    if (!settings) return;
    const resolved = typeof nextDestination === "string"
      ? destinationForView(nextDestination)
      : nextDestination;
    if (
      settings?.selectedView === "settings" &&
      resolved.view !== "settings" &&
      settingsDirty &&
      !window.confirm("Discard unsaved Settings changes and leave this page?")
    ) return;
    if (resolved.view !== "settings") setSettingsDirty(false);
    if (
      settings.selectedView === "reports" && resolved.view !== "reports" && payrollDirty
      && !window.confirm("Discard the unsaved payroll amount and leave Reports?")
    ) return;
    if (resolved.view !== "reports") setPayrollDirty(false);
    setTabContext((current) => {
      const next = {
        selectedMonth: current?.selectedMonth ?? settings.selectedMonth,
        selectedView: resolved.view,
      };
      try {
        sessionStorage.setItem(SESSION_CONTEXT_KEY, JSON.stringify(next));
      } catch {
        // The in-memory tab context still works when session storage is unavailable.
      }
      return next;
    });
    setDestination(resolved);
    if (options?.preserveFocus) return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }

  function setMonth(month: string, options?: { preserveFocus?: boolean }) {
    if (!settings) return;
    if (month === settings.selectedMonth) return;
    if (
      settings?.selectedView === "settings" &&
      settingsDirty &&
      !window.confirm("Discard unsaved Settings changes and change the reporting month?")
    ) return;
    if (
      settings.selectedView === "reports" && payrollDirty
      && !window.confirm("Discard the unsaved payroll amount and change the reporting month?")
    ) return;
    if (!hasPayPlanCoverage(getPayPlanSchedule(settings), month)) return;
    setSettingsDirty(false);
    setPayrollDirty(false);
    setTabContext((current) => {
      const next = {
        selectedMonth: month,
        selectedView: current?.selectedView ?? settings.selectedView,
      };
      try {
        sessionStorage.setItem(SESSION_CONTEXT_KEY, JSON.stringify(next));
      } catch {
        // The in-memory tab context still works when session storage is unavailable.
      }
      return next;
    });
    if (options?.preserveFocus) return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.getElementById("main-content")?.focus({ preventScroll: true });
    });
  }

  const demoSalesCount = sales.filter((sale) => !sale.deletedAt && sale.source === "demo").length;

  return (
    <>
      <AppShell
        settings={settings}
        monthsWithSales={monthsWithSales}
        isOnline={isOnline}
        onViewChange={(view) => navigate(view)}
        onMonthChange={setMonth}
        onAddSale={openNewSale}
      >
        {demoSalesCount > 0 ? (
          <aside className="workspace-notice workspace-notice--demo" aria-label="Demo data active">
            <FlaskConical aria-hidden="true" />
            <span>
              <strong>Demo data is active</strong>
              <small>{demoSalesCount} fictional {demoSalesCount === 1 ? "record is" : "records are"} included in totals and exports.</small>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => navigate({ view: "settings", section: "data" })}>
              Manage demo data
            </Button>
          </aside>
        ) : null}
        <Suspense fallback={<PageLoading />}>
          {settings.selectedView === "dashboard" ? (
            <Dashboard
              sales={sales}
              settings={settings}
              onAddSale={openNewSale}
              onLoadDemo={() => void handleLoadDemo()}
              onEditSale={openEditSale}
              onNavigate={navigate}
              onDismissOnboarding={() => void saveContext({ onboardingDismissed: true })}
            />
          ) : null}
          {settings.selectedView === "sales" ? (
            <SalesPage
              key={`sales-${settings.selectedMonth}-${destination.view === "sales" ? destination.filter ?? "all" : "all"}`}
              sales={sales}
              settings={settings}
              onAddSale={openNewSale}
              onEditSale={openEditSale}
              onDeleteSale={handleDeleteSale}
              onRestoreSale={undoDelete}
              initialFilter={destination.view === "sales" ? destination.filter : undefined}
            />
          ) : null}
          {settings.selectedView === "reports" ? (
            <ReportsPage
              key={`reports-${settings.selectedMonth}`}
              onOpenSale={openEditSale}
              sales={sales}
              auditEvents={auditEvents}
              settings={settings}
              onSaveSettings={saveSettings}
              onBackupExported={handleBackupExported}
              initialTab={destination.view === "reports" ? destination.tab : undefined}
              onNavigate={navigate}
              onDirtyChange={setPayrollDirty}
            />
          ) : null}
          {settings.selectedView === "settings" ? (
            <SettingsPage
              key={`settings-${settings.selectedMonth}`}
              sales={sales}
              auditEvents={auditEvents}
              settings={settings}
              onSaveSettings={saveSettings}
              onRefresh={async () => {
                await refreshAfterExternalMutation();
              }}
              onBackupExported={handleBackupExported}
              onDirtyChange={setSettingsDirty}
              automaticBackup={automaticBackup}
              initialSection={destination.view === "settings" ? destination.section : undefined}
            />
          ) : null}
        </Suspense>
      </AppShell>
      <SaleFormSheet
        key={saleFormInstance}
        open={saleFormOpen}
        saleToEdit={saleToEdit}
        settings={settings}
        sales={sales}
        returnFocusRef={saleFormReturnFocusRef}
        onOpenChange={(open) => {
          setSaleFormOpen(open);
          if (!open) setSaleToEdit(null);
        }}
        onSave={handleSaveSale}
        onLoadLatestSale={handleLoadLatestSale}
      />
      <Toaster richColors position="top-right" closeButton />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false}>
      <AppContent />
    </ThemeProvider>
  );
}
