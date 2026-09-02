import type { AppView } from "@/domain/types";

export type SalesDestinationFilter = "all" | "review" | "deleted";
export type ReportDestinationTab = "monthly" | "week" | "year" | "payroll";
export type SettingsDestinationSection = "profile" | "schedule" | "pay-plan" | "data";

export type AppDestination =
  | { view: "dashboard" }
  | { view: "sales"; filter?: SalesDestinationFilter }
  | { view: "reports"; tab?: ReportDestinationTab }
  | { view: "settings"; section?: SettingsDestinationSection };

export function destinationForView(view: AppView): AppDestination {
  return { view } as AppDestination;
}
