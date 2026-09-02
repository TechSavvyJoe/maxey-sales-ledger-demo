import type { ReactNode } from "react";
import {
  BarChart3,
  CarFront,
  CloudOff,
  LayoutDashboard,
  Plus,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PeriodSwitcher } from "@/components/PeriodSwitcher";
import { getEarliestPayPlanMonth, getPayPlanSchedule } from "@/domain/payPlan";
import type { AppView, ProfileSettings } from "@/domain/types";
import { cn } from "@/lib/utils";

const navigation: Array<{
  id: AppView;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sales", label: "Sales", icon: CarFront },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
];

interface AppShellProps {
  settings: ProfileSettings;
  monthsWithSales: Set<string>;
  isOnline: boolean;
  onViewChange: (view: AppView) => void;
  onMonthChange: (monthKey: string, options?: { preserveFocus?: boolean }) => void;
  onAddSale: () => void;
  children: ReactNode;
}

export function AppShell({
  settings,
  monthsWithSales,
  isOnline,
  onViewChange,
  onMonthChange,
  onAddSale,
  children,
}: AppShellProps) {
  const earliestPayPlanMonth = getEarliestPayPlanMonth(getPayPlanSchedule(settings));
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="product-lockup">
          <img
            src={`${import.meta.env.BASE_URL}brand/sales-ledger-mark-reversed.svg`}
            alt=""
            width="40"
            height="40"
          />
          <span>
            <strong>Sales Ledger</strong>
            <small>Sales &amp; commission</small>
          </span>
        </div>
        <nav className="sidebar-nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={cn("sidebar-nav__item", settings.selectedView === item.id && "is-active")}
                aria-current={settings.selectedView === item.id ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => onViewChange(item.id)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-profile">
            <strong>{settings.salespersonName || "My sales workspace"}</strong>
            <span>{settings.storeName}</span>
          </div>
          <a
            className="dealership-logo-link"
            href="https://www.bobmaxeyfordhowell.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit Bob Maxey Ford of Howell official website (opens in a new tab)"
            title="Bob Maxey Ford of Howell official website"
          >
            <img
              src={`${import.meta.env.BASE_URL}brand/bob-maxey-ford-howell.png`}
              alt="Bob Maxey Ford of Howell"
              width="790"
              height="330"
            />
          </a>
          <span className={cn("storage-state", !isOnline && "is-offline")}>
            {isOnline ? <span className="online-dot" aria-hidden="true" /> : <CloudOff aria-hidden="true" />}
            {isOnline ? "Sales data ready" : "Offline — sales data ready"}
          </span>
          <small>Data stays in this browser profile</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <a
            className="topbar-product"
            href="https://www.bobmaxeyfordhowell.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit Bob Maxey Ford of Howell official website (opens in a new tab)"
            title="Bob Maxey Ford of Howell official website"
          >
            <img
              className="topbar-product__dealer-logo"
              src={`${import.meta.env.BASE_URL}brand/bob-maxey-ford-howell.png`}
              alt=""
              width="790"
              height="330"
            />
            <strong>Sales Ledger</strong>
          </a>
          <PeriodSwitcher
            selectedMonth={settings.selectedMonth}
            earliestMonth={earliestPayPlanMonth}
            monthsWithSales={monthsWithSales}
            onChange={onMonthChange}
          />
          <Button type="button" className="add-sale-button" aria-label="Add sale" onClick={onAddSale}>
            <Plus aria-hidden="true" />
            <span className="add-sale-button__label">Add<span className="add-sale-button__suffix"> sale</span></span>
          </Button>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={cn("mobile-nav__item", settings.selectedView === item.id && "is-active")}
              aria-current={settings.selectedView === item.id ? "page" : undefined}
              onClick={() => onViewChange(item.id)}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
