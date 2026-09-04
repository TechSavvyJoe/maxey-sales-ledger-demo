import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { format, parseISO } from "date-fns";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { useWorkspaceToast } from "@/hooks/useWorkspaceToast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeading, ReviewState, SectionHeader, StatusBadge } from "@/components/shared";
import { attentionSummary, getAttentionRecords } from "@/domain/attention";
import { calculateMonth, calculateYear, getBonusMilestone } from "@/domain/commission";
import { formatSaleDate, monthLabel, shiftMonth, todayDateOnly, yearForMonth } from "@/domain/date";
import { getPaymentMethod, paymentMethodLabel } from "@/domain/financing";
import {
  getCommissionGoalForMonth,
  getDeliveryGoalForMonth,
} from "@/domain/goals";
import { formatCurrency, formatCurrencyInput, formatPercent, parseCurrencyToCents } from "@/domain/money";
import type { AppDestination, ReportDestinationTab } from "@/domain/navigation";
import { calculateWorkdayPace } from "@/domain/pacing";
import {
  calculateCommissionRunRate,
  calculateEarningsGoalProgress,
} from "@/domain/performance";
import { getPayPlanForMonth, getPayPlanSchedule, hasPayPlanCoverage } from "@/domain/payPlan";
import { calculatePersonalReportBaseline } from "@/domain/reportBaseline";
import {
  calculateMonthReportAnalytics,
  calculatePeriodReportAnalytics,
  calculateReportAnalytics,
  compareReportAnalytics,
  type ReportMetricComparison,
  type ReportRateComparison,
} from "@/domain/reportAnalytics";
import type { AuditEvent, CalculatedSale, ProfileSettings, Sale } from "@/domain/types";
import {
  calculateWeeklyPerformance,
  type StoreWeekPerformance,
} from "@/domain/weeklyPerformance";
import { exportMonthlyCsv, exportSalesWorkbook } from "@/lib/files";
import { cn } from "@/lib/utils";
import { formatVehiclePace } from "@/lib/vehiclePace";
import { FiReportCenter, ReportSaleIdentity, ReportSaleMetadata } from "./FiReportCenter";
import { ReportMilestoneIndicator, ReportMilestones } from "./ReportMilestones";
import "./reports-density.css";
import "./reports-v2.css";

interface ReportsPageProps {
  sales: Sale[];
  /** Retained for API compatibility; private recovery backups now live in Settings. */
  auditEvents: AuditEvent[];
  settings: ProfileSettings;
  onSaveSettings: (settings: ProfileSettings) => Promise<ProfileSettings>;
  /** Retained for API compatibility; Settings records successful private backups. */
  onBackupExported: () => Promise<void>;
  initialTab?: ReportDestinationTab;
  onNavigate: (destination: AppDestination, options?: { preserveFocus?: boolean }) => void;
  onDirtyChange: (dirty: boolean) => void;
  onOpenSale: (sale: Sale) => void;
}

function openSaleFromReportRow(event: MouseEvent<HTMLElement>, sale: Sale, onOpenSale: (sale: Sale) => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof Element) || target.closest("button, a, input, select, textarea, summary, [role='button'], [role='link'], [contenteditable='true']")) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && (event.currentTarget.contains(selection.anchorNode) || event.currentTarget.contains(selection.focusNode))) return;
  event.currentTarget.querySelector<HTMLButtonElement>(".report-open-sale")?.focus({ preventScroll: true });
  onOpenSale(sale);
}

function ReportMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="report-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

interface ReportSubjectOption {
  value: string;
  label: string;
}

function ReportSubjectTabs({
  label,
  options,
  value,
  onChange,
  idPrefix,
}: {
  label: string;
  options: readonly ReportSubjectOption[];
  value: string;
  onChange: (value: string) => void;
  idPrefix: string;
}) {
  return (
    <div
      className="report-subject-tabs"
      role="tablist"
      aria-label={label}
      data-tab-count={options.length}
      onKeyDown={(event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const currentIndex = options.findIndex((option) => option.value === value);
        let nextIndex = currentIndex;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % options.length;
        if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + options.length) % options.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = options.length - 1;
        if (nextIndex === currentIndex) return;
        const nextOption = options[nextIndex];
        onChange(nextOption.value);
        window.requestAnimationFrame(() => {
          document.getElementById(`${idPrefix}-${nextOption.value}-tab`)?.focus();
        });
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          id={`${idPrefix}-${option.value}-tab`}
          aria-controls={`${idPrefix}-${option.value}-panel`}
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const MONTH_SUBJECTS = [
  { value: "overview", label: "Overview" },
  { value: "sales", label: "Sales" },
  { value: "fi", label: "F&I" },
  { value: "commission", label: "Commission" },
] as const;

const WEEK_SUBJECTS = [
  { value: "overview", label: "Overview" },
  { value: "sales", label: "Sales" },
  { value: "fi", label: "F&I" },
] as const;

const YEAR_SUBJECTS = [
  { value: "summary", label: "Summary" },
  { value: "monthly", label: "Monthly results" },
  { value: "fi", label: "F&I" },
] as const;

function comparisonChange(
  comparison: ReportMetricComparison,
  formatValue: (value: number) => string,
): string {
  if (comparison.absoluteChange === null) return "Not comparable";
  if (comparison.absoluteChange === 0) return "No change";
  return `${comparison.absoluteChange > 0 ? "+" : ""}${formatValue(comparison.absoluteChange)}`;
}

function rateComparisonChange(comparison: ReportRateComparison): string {
  if (comparison.percentagePointChange === null) return "Not comparable";
  if (comparison.percentagePointChange === 0) return "No change";
  return `${comparison.percentagePointChange > 0 ? "+" : ""}${comparison.percentagePointChange.toFixed(1)} pts`;
}

function shortDate(date: string, includeYear = false): string {
  return format(parseISO(date), includeYear ? "MMM d, yyyy" : "MMM d");
}

function weekRange(week: Pick<StoreWeekPerformance, "startDate" | "endDate">): string {
  return week.startDate === week.endDate
    ? shortDate(week.startDate)
    : `${shortDate(week.startDate)}–${shortDate(week.endDate)}`;
}

function productLabels(sale: Sale): string[] {
  return [
    sale.serviceContractSold === true ? "Service contract" : null,
    sale.tireWheelSold === true ? "T&W" : null,
    sale.gapSold === true ? "GAP" : null,
    ["dealer_financed", "cash", "outside_financing"].includes(getPaymentMethod(sale)) ? paymentMethodLabel(sale) : null,
  ].filter((label): label is string => label !== null);
}

function ProductBadges({ sale }: { sale: Sale }) {
  const labels = productLabels(sale);
  const outcomes = [
    sale.serviceContractSold,
    sale.tireWheelSold,
    sale.gapSold,
  ];
  if (labels.length === 0) {
    return (
      <small className="report-product-empty">
        {outcomes.every((value) => value === false) ? "No tracked products" : "Product answers incomplete"}
      </small>
    );
  }
  return (
    <span role="group" className="report-product-badges" aria-label={`Tracked outcomes: ${labels.join(", ")}`}>
      {labels.map((label) => <span key={label}>{label}</span>)}
    </span>
  );
}

function defaultWeekId(weeks: StoreWeekPerformance[], todayDate: string): string {
  const current = weeks.find((week) => week.state === "current");
  if (current) return current.id;
  if (weeks.length === 0) return "";
  return weeks[0]!.monthKey < todayDate.slice(0, 7)
    ? weeks.at(-1)!.id
    : weeks[0]!.id;
}

function paceDeltaLabel(week: StoreWeekPerformance): string {
  if (week.state === "future") return "Starts later";
  if (week.goal.paceStatus === "no-workdays") return "No workdays";
  const delta = week.goal.paceDeltaToDate;
  if (Math.abs(delta) < 0.05) return "On expected pace";
  return `${formatVehiclePace(Math.abs(delta))} ${delta > 0 ? "ahead" : "behind"}`;
}

function checkpointMessage(week: StoreWeekPerformance): string {
  const checkpoint = week.goal.targetByWeekEnd;
  const weeklyShare = week.goal.targetShareForWeek;
  if (week.state === "future") {
    return checkpoint === null
      ? "This upcoming week has no scheduled workdays, so no target checkpoint is assigned."
      : `${weeklyShare ?? 0} of the monthly goal is assigned to this week, with ${checkpoint} due cumulatively by ${shortDate(week.endDate)}. No future sales are projected.`;
  }
  if (week.state === "past") {
    return checkpoint === null
      ? `This closed week has ${week.deliveredCount} recorded deliveries and no scheduled target checkpoint.`
      : `This week is closed: ${week.deliveredCount} recorded deliveries; the cumulative checkpoint was ${checkpoint}. These are final recorded results, not a projection.`;
  }
  if (checkpoint === null) return "No target checkpoint is assigned because this week has no scheduled workdays.";
  const needed = week.goal.deliveriesNeededByWeekEnd ?? 0;
  return needed === 0
    ? `You are at or above the ${checkpoint}-delivery checkpoint for ${shortDate(week.endDate)}.`
    : `${needed} more ${needed === 1 ? "delivery" : "deliveries"} needed by ${shortDate(week.endDate)} to reach the ${checkpoint}-delivery checkpoint.`;
}

export function ReportsPage({
  sales,
  settings,
  onSaveSettings,
  initialTab,
  onNavigate,
  onDirtyChange,
  onOpenSale,
}: ReportsPageProps) {
  const toast = useWorkspaceToast();
  const todayDate = todayDateOnly();
  const [activeTab, setActiveTab] = useState<ReportDestinationTab>(initialTab ?? "monthly");
  const [monthSubject, setMonthSubject] = useState<(typeof MONTH_SUBJECTS)[number]["value"]>("overview");
  const [weekSubject, setWeekSubject] = useState<(typeof WEEK_SUBJECTS)[number]["value"]>("overview");
  const [yearSubject, setYearSubject] = useState<(typeof YEAR_SUBJECTS)[number]["value"]>("summary");
  const [includeLastNames, setIncludeLastNames] = useState(true);
  const savedActualPaid = settings.actualPaidByMonth[settings.selectedMonth] ?? null;
  const [actualPaidDraft, setActualPaidDraft] = useState<{ text: string; baseCents: number | null } | null>(null);
  const draftEdited = actualPaidDraft !== null
    && parseCurrencyToCents(actualPaidDraft.text) !== actualPaidDraft.baseCents;
  // Refresh clean entries from other tabs, but never replace an unfinished edit.
  const currentPaidDraft = actualPaidDraft && (draftEdited || actualPaidDraft.baseCents === savedActualPaid)
    ? actualPaidDraft : null;
  const actualPaidInput = currentPaidDraft?.text ?? formatCurrencyInput(savedActualPaid);
  const isActualPaidDirty = parseCurrencyToCents(actualPaidInput) !== savedActualPaid;
  const actualPaidConflict = Boolean(currentPaidDraft && isActualPaidDirty && currentPaidDraft.baseCents !== savedActualPaid);
  const actualPaidRef = useRef<HTMLInputElement>(null);
  const [actualPaidError, setActualPaidError] = useState<string | null>(null);
  const [isSavingActual, setIsSavingActual] = useState(false);
  const actualSaveInFlight = useRef(false);
  const actualSaveRef = useRef<(background?: boolean) => Promise<void>>(async () => {});
  const [failedActualText, setFailedActualText] = useState<string | null>(null);
  const activeFailedActualText = isActualPaidDirty ? failedActualText : null;

  useEffect(() => {
    onDirtyChange(isActualPaidDirty);
    return () => onDirtyChange(false);
  }, [isActualPaidDirty, onDirtyChange]);

  useEffect(() => {
    if (!isActualPaidDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isActualPaidDirty]);

  const payPlanSchedule = useMemo(() => getPayPlanSchedule(settings), [settings]);
  const recentBaseline = useMemo(
    () => calculatePersonalReportBaseline(sales, settings.selectedMonth, payPlanSchedule, "recent", todayDate.slice(0, 7)),
    [sales, settings.selectedMonth, payPlanSchedule, todayDate],
  );
  const yearBaseline = useMemo(
    () => calculatePersonalReportBaseline(sales, settings.selectedMonth, payPlanSchedule, "year", todayDate.slice(0, 7)),
    [sales, settings.selectedMonth, payPlanSchedule, todayDate],
  );
  const currentPayPlan = useMemo(
    () => getPayPlanForMonth(payPlanSchedule, settings.selectedMonth),
    [payPlanSchedule, settings.selectedMonth],
  );
  const summary = useMemo(
    () =>
      calculateMonth(
        sales,
        settings.selectedMonth,
        payPlanSchedule,
        settings.actualPaidByMonth[settings.selectedMonth] ?? null,
      ),
    [payPlanSchedule, sales, settings.actualPaidByMonth, settings.selectedMonth],
  );
  const monthlyAnalytics = useMemo(
    () => calculateMonthReportAnalytics(summary),
    [summary],
  );
  const previousMonthKey = shiftMonth(settings.selectedMonth, -1);
  const previousSummary = useMemo(
    () => hasPayPlanCoverage(payPlanSchedule, previousMonthKey)
      ? calculateMonth(
          sales,
          previousMonthKey,
          payPlanSchedule,
          settings.actualPaidByMonth[previousMonthKey] ?? null,
        )
      : null,
    [payPlanSchedule, previousMonthKey, sales, settings.actualPaidByMonth],
  );
  const previousAnalytics = useMemo(
    () => previousSummary ? calculateMonthReportAnalytics(previousSummary) : null,
    [previousSummary],
  );
  const monthComparison = useMemo(
    () => previousAnalytics ? compareReportAnalytics(monthlyAnalytics, previousAnalytics) : null,
    [monthlyAnalytics, previousAnalytics],
  );
  const awaitingFiGrossCount = monthlyAnalytics.gross.fi.missingCount;
  const awaitingFrontCommissionCount = monthlyAnalytics.quality.frontCommissionMissingCount;
  const payrollEstimateIncomplete = awaitingFiGrossCount > 0 || awaitingFrontCommissionCount > 0;
  const projectionIncomplete = awaitingFiGrossCount > 0 || monthlyAnalytics.gross.front.missingCount > 0;
  const pendingEarningsLabel = awaitingFrontCommissionCount > 0
    ? awaitingFiGrossCount > 0 ? "Awaiting gross amounts" : "Awaiting front gross"
    : "Awaiting F&I gross";
  const pendingEarningsDescription = [
    awaitingFrontCommissionCount > 0 ? `Front gross is missing on ${awaitingFrontCommissionCount} ${awaitingFrontCommissionCount === 1 ? "sale" : "sales"}.` : "",
    awaitingFiGrossCount > 0 ? `Awaiting F&I gross on ${awaitingFiGrossCount} ${awaitingFiGrossCount === 1 ? "sale" : "sales"}.` : "",
  ].filter(Boolean).join(" ");
  const fiComparisonIncomplete = awaitingFiGrossCount > 0 || (previousAnalytics?.gross.fi.missingCount ?? 0) > 0;
  const frontComparisonIncomplete = monthlyAnalytics.gross.front.missingCount > 0 || (previousAnalytics?.gross.front.missingCount ?? 0) > 0;
  const commissionComparisonIncomplete = payrollEstimateIncomplete
    || (previousAnalytics?.quality.frontCommissionMissingCount ?? 0) > 0
    || (previousAnalytics?.gross.fi.missingCount ?? 0) > 0;
  const attentionRecords = useMemo(
    () => getAttentionRecords(summary.calculatedSales, todayDate),
    [summary.calculatedSales, todayDate],
  );
  const attentionBySale = useMemo(
    () => new Map(attentionRecords.map((record) => [record.id, record])),
    [attentionRecords],
  );
  const monthlyDeliveryGoal = getDeliveryGoalForMonth(settings, settings.selectedMonth);
  const monthlyCommissionGoalCents = getCommissionGoalForMonth(settings, settings.selectedMonth);
  const weeklyPerformance = useMemo(
    () => calculateWeeklyPerformance({
      summary,
      monthlyGoal: monthlyDeliveryGoal,
      daysOff: settings.daysOffByMonth[settings.selectedMonth] ?? [],
      todayDate,
    }),
    [monthlyDeliveryGoal, settings.daysOffByMonth, settings.selectedMonth, summary, todayDate],
  );
  const [selectedWeekId, setSelectedWeekId] = useState(() =>
    defaultWeekId(weeklyPerformance.weeks, todayDate),
  );

  const selectedWeek = weeklyPerformance.weeks.find((week) => week.id === selectedWeekId)
    ?? weeklyPerformance.weeks[0]
    ?? null;
  const selectedWeekSales = useMemo(() => {
    if (!selectedWeek) return [];
    return summary.calculatedSales
      .filter((item) =>
        item.sale.saleDate >= selectedWeek.startDate
        && item.sale.saleDate <= selectedWeek.endDate,
      )
      .sort((a, b) => a.sale.saleDate.localeCompare(b.sale.saleDate) || a.sale.stockNumber.localeCompare(b.sale.stockNumber));
  }, [selectedWeek, summary.calculatedSales]);
  const selectedWeekAnalytics = useMemo(
    () => calculateReportAnalytics(selectedWeekSales),
    [selectedWeekSales],
  );

  const bonusMilestone = useMemo(
    () => getBonusMilestone(summary.deliveredCount, currentPayPlan.bonusTiers),
    [currentPayPlan.bonusTiers, summary.deliveredCount],
  );
  const pace = useMemo(
    () => calculateWorkdayPace({
      monthKey: settings.selectedMonth,
      deliveredCount: summary.deliveredCount,
      monthlyGoal: monthlyDeliveryGoal,
      daysOff: settings.daysOffByMonth[settings.selectedMonth] ?? [],
      todayDate,
    }),
    [monthlyDeliveryGoal, settings.daysOffByMonth, settings.selectedMonth, summary.deliveredCount, todayDate],
  );
  const monthIsComplete = pace.status === "complete";
  const todayMonth = todayDate.slice(0, 7);
  const commissionRunRate = useMemo(
    () => calculateCommissionRunRate(summary, pace, currentPayPlan),
    [currentPayPlan, pace, summary],
  );
  const earningsGoal = useMemo(
    () => calculateEarningsGoalProgress({
      currentEstimatedCommissionCents: summary.estimatedCommissionCents,
      goalCents: monthlyCommissionGoalCents,
      remainingWorkdays: pace.remainingWorkdays,
      paceStatus: pace.status,
      runRate: commissionRunRate,
    }),
    [commissionRunRate, monthlyCommissionGoalCents, pace.remainingWorkdays, pace.status, summary.estimatedCommissionCents],
  );
  const year = yearForMonth(settings.selectedMonth);
  const hasHistoricalMonthsOutsideSelectedPeriod = settings.selectedMonth < todayMonth;
  const hasFutureMonthsInSelectedYear = `${year}-12` > todayMonth;
  const yearPeriodDescription = hasHistoricalMonthsOutsideSelectedPeriod
    ? hasFutureMonthsInSelectedYear
      ? "later historical months are outside the selected period; later months are marked Upcoming when they are still in the future"
      : "later historical months are outside the selected period"
    : "later months are marked Upcoming";
  const yearly = useMemo(
    () => calculateYear(sales, year, payPlanSchedule, settings.actualPaidByMonth),
    [payPlanSchedule, sales, settings.actualPaidByMonth, year],
  );
  const yearThroughSelectedMonth = useMemo(
    () => yearly.filter((month) => month.monthKey <= settings.selectedMonth),
    [settings.selectedMonth, yearly],
  );
  const yearAnalytics = useMemo(
    () => calculatePeriodReportAnalytics(yearThroughSelectedMonth),
    [yearThroughSelectedMonth],
  );
  const yearTrendRows = useMemo(
    () => yearThroughSelectedMonth.map((month) => ({
      month,
      analytics: calculateMonthReportAnalytics(month),
    })),
    [yearThroughSelectedMonth],
  );
  const yearAttention = useMemo(
    () => new Map(yearly.map((month) => [
      month.monthKey,
      getAttentionRecords(month.calculatedSales, todayDate).length,
    ])),
    [todayDate, yearly],
  );
  const yearTotals = yearThroughSelectedMonth.reduce(
    (totals, month) => ({
      delivered: totals.delivered + month.deliveredCount,
      frontGross: totals.frontGross + month.frontGrossCents,
      fiGross: totals.fiGross + month.fiGrossCents,
      estimated: totals.estimated + month.estimatedCommissionCents,
      actual: totals.actual + (month.actualPaidCents ?? 0),
      actualMonths: totals.actualMonths + (month.actualPaidCents === null ? 0 : 1),
    }),
    { delivered: 0, frontGross: 0, fiGross: 0, estimated: 0, actual: 0, actualMonths: 0 },
  );
  const selectedMonthIsFuture = settings.selectedMonth > todayMonth;
  const comparisonBasis = selectedMonthIsFuture
    ? "Future period — comparison starts after results are recorded"
    : settings.selectedMonth === todayMonth
      ? `${monthLabel(settings.selectedMonth)} through ${shortDate(todayDate, true)} vs full ${monthLabel(previousMonthKey)}`
      : `Final recorded ${monthLabel(settings.selectedMonth)} vs final ${monthLabel(previousMonthKey)}`;
  const projectedCommission = commissionRunRate
    ? commissionRunRate.low.estimatedCommissionCents === commissionRunRate.high.estimatedCommissionCents
      ? formatCurrency(commissionRunRate.low.estimatedCommissionCents)
      : `${formatCurrency(commissionRunRate.low.estimatedCommissionCents)}–${formatCurrency(commissionRunRate.high.estimatedCommissionCents)}`
    : "Not available yet";
  const projectedUnits = commissionRunRate
    ? commissionRunRate.low.deliveredCount === commissionRunRate.high.deliveredCount
      ? `${commissionRunRate.low.deliveredCount} projected deliveries`
      : `${commissionRunRate.low.deliveredCount}–${commissionRunRate.high.deliveredCount} projected deliveries`
    : "Starts after a valid delivery and scheduled workday";

  function changeTab(value: string) {
    const tab = value as ReportDestinationTab;
    setActiveTab(tab);
    onNavigate({ view: "reports", tab }, { preserveFocus: true });
  }

  async function saveActualPaid(background = false) {
    if (actualSaveInFlight.current || actualPaidConflict) return;
    const cents = parseCurrencyToCents(actualPaidInput);
    if (!isActualPaidDirty && activeFailedActualText === null) {
      if (!Number.isNaN(cents) && actualPaidDraft !== null) setActualPaidDraft(null);
      return;
    }
    const error = Number.isNaN(cents)
      ? "Enter dollars, such as 4500 or 4500.00."
      : cents !== null && (!Number.isSafeInteger(cents) || Math.abs(cents) > 100_000_000)
        ? "Enter an amount between -$1,000,000 and $1,000,000."
        : null;
    setActualPaidError(error);
    if (error) {
      if (!background) actualPaidRef.current?.focus();
      return;
    }
    actualSaveInFlight.current = true;
    setIsSavingActual(true);
    const submittedText = actualPaidInput;
    const submittedMonth = settings.selectedMonth;
    try {
      const committed = await onSaveSettings({
        ...settings,
        actualPaidByMonth: {
          ...settings.actualPaidByMonth,
          [settings.selectedMonth]: cents,
        },
      });
      setActualPaidDraft((current) => !current || current.text === submittedText ? null : {
        ...current, baseCents: committed.actualPaidByMonth[submittedMonth] ?? null,
      });
      setFailedActualText(null);
      if (!background) toast.success("Actual paid amount saved.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Your entry is still here. Check your connection and try again.";
      setFailedActualText(submittedText);
      setActualPaidError(message);
      if (!background) toast.error("Actual paid amount was not saved.", { description: message });
    } finally {
      actualSaveInFlight.current = false;
      setIsSavingActual(false);
    }
  }

  useEffect(() => { actualSaveRef.current = saveActualPaid; });
  useEffect(() => {
    if (!isActualPaidDirty || isSavingActual || actualPaidConflict || actualPaidInput === activeFailedActualText) return;
    const timer = window.setTimeout(() => void actualSaveRef.current(true), 1200);
    return () => window.clearTimeout(timer);
  }, [actualPaidInput, isActualPaidDirty, isSavingActual, actualPaidConflict, activeFailedActualText]);
  useEffect(() => {
    const retry = () => setFailedActualText(null);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  function downloadCsv() {
    try {
      exportMonthlyCsv(sales, settings, settings.selectedMonth, includeLastNames);
    } catch {
      toast.error("Monthly CSV could not be created.", {
        description: "Nothing was changed. Try the export again.",
      });
    }
  }

  async function downloadWorkbook() {
    try {
      await exportSalesWorkbook(sales, settings, settings.selectedMonth, includeLastNames);
    } catch {
      toast.error("Excel report could not be created.", {
        description: "Nothing was changed. Try the export again.",
      });
    }
  }

  return (
    <div className="page-stack reports-page">
      <PageHeading
        title="Reports"
        description={`${monthLabel(settings.selectedMonth)} · Sales, F&I, commission, and pace`}
        action={(
          <ReviewState
            count={attentionRecords.length}
            clearLabel="All clear"
            issueLabel="sale needs review"
          />
        )}
      />

      <Tabs value={activeTab} onValueChange={changeTab} className="report-tabs">
        <div className="report-command-bar">
          <TabsList aria-label="Report period">
            <TabsTrigger value="monthly" aria-label="Monthly report">Month</TabsTrigger>
            <TabsTrigger value="week" aria-label="Weekly performance report">Week</TabsTrigger>
            <TabsTrigger value="year" aria-label="Full-year report">Year</TabsTrigger>
            <TabsTrigger value="payroll" aria-label="Paid versus estimate">Paid vs estimate</TabsTrigger>
          </TabsList>

          <div className="report-command-actions">
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="report-export-trigger" aria-label="Open report exports">
                  <Download aria-hidden="true" />
                  <span>Export</span>
                  <ChevronDown className="report-chevron" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={7} className="report-export-popover" aria-labelledby="export-heading">
                <div className="report-export-popover__heading">
                  <span className="page-heading__eyebrow">Shareable reports</span>
                  <h2 id="export-heading">Export report data</h2>
                </div>
                <label className="include-names-control">
                  <Checkbox
                    checked={includeLastNames}
                    onCheckedChange={(checked) => setIncludeLastNames(checked === true)}
                  />
                  <span>
                    <strong>Include customer last names</strong>
                    <small>Controls names in on-screen deal detail and shareable exports. Stock numbers always stay included.</small>
                  </span>
                </label>
                <div className="export-actions">
                  <Button variant="outline" onClick={() => window.print()}>
                    <Printer aria-hidden="true" /> Print current view
                  </Button>
                  <Button variant="outline" onClick={downloadCsv}>
                    <FileText aria-hidden="true" /> Monthly CSV
                  </Button>
                  <Button variant="outline" onClick={() => void downloadWorkbook()}>
                    <FileSpreadsheet aria-hidden="true" /> Excel month + year
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <TabsContent value="monthly">
          <article className="report-document print-report">
            <header className="report-document__header">
              <span className="report-title-lockup">
                <img src={`${import.meta.env.BASE_URL}brand/sales-ledger-mark.svg`} width="44" height="44" alt="" />
                <span>
                  <small>SALES COMMISSION REPORT</small>
                  <h2>{monthLabel(settings.selectedMonth)}</h2>
                  <p>{settings.salespersonName || "Salesperson name not entered"} · {settings.storeName}</p>
                </span>
              </span>
              <span className="report-generated">
                <small>As of</small>
                <strong>{formatSaleDate(todayDate)}</strong>
              </span>
            </header>

            <ReportSubjectTabs
              label="Monthly report subject"
              options={MONTH_SUBJECTS}
              value={monthSubject}
              onChange={(value) => setMonthSubject(value as (typeof MONTH_SUBJECTS)[number]["value"])}
              idPrefix="report-month"
            />

            <div
              id="report-month-overview-panel"
              className="report-subject-panel"
              role="tabpanel"
              aria-labelledby="report-month-overview-tab"
              hidden={monthSubject !== "overview"}
            >
            <section id="month-overview" className="report-metric-grid" aria-label="Monthly report summary">
              <ReportMetric label="Delivered" value={String(summary.deliveredCount)} note={`${summary.creditedUnitsBasis / 1_000} credited units`} />
              <ReportMetric label="Front rate" value={formatPercent(summary.frontRateBps)} note="Mini or manual payout may apply" />
              <ReportMetric label="Front gross" value={formatCurrency(summary.frontGrossCents)} />
              <ReportMetric
                label="Total F&I gross"
                value={monthlyAnalytics.gross.fi.enteredCount > 0 ? formatCurrency(summary.fiGrossCents) : "—"}
                note={awaitingFiGrossCount > 0 ? `Awaiting F&I gross on ${awaitingFiGrossCount} ${awaitingFiGrossCount === 1 ? "sale" : "sales"}` : undefined}
              />
            </section>

            <details id="month-comparison" className="report-comparison">
              <summary>
                <span>
                  <strong role="heading" aria-level={2}>Compared with last month</strong>
                  <small>{comparisonBasis}</small>
                </span>
                <span className="report-comparison__summary">
                  {monthComparison && !selectedMonthIsFuture
                    ? monthComparison.deliveredDeals.absoluteChange === 0
                      ? "No change"
                      : `${comparisonChange(monthComparison.deliveredDeals, (value) => value.toLocaleString())} deliveries`
                    : "Not available"}
                </span>
                <ChevronDown className="report-chevron" aria-hidden="true" />
              </summary>
              {monthComparison && !selectedMonthIsFuture ? (
                <dl>
                  <div><dt>Valid deliveries</dt><dd><strong>{summary.deliveredCount}</strong><small>{comparisonChange(monthComparison.deliveredDeals, (value) => value.toLocaleString())}</small></dd></div>
                  <div><dt>Front gross</dt><dd><strong>{monthlyAnalytics.gross.front.enteredCount ? formatCurrency(summary.frontGrossCents) : "—"}</strong><small>{frontComparisonIncomplete ? "Awaiting front gross" : comparisonChange(monthComparison.frontGrossCents, formatCurrency)}</small></dd></div>
                  <div><dt>Total F&amp;I gross</dt><dd><strong>{monthlyAnalytics.gross.fi.enteredCount ? formatCurrency(summary.fiGrossCents) : "—"}</strong><small>{fiComparisonIncomplete ? "Awaiting F&I gross" : comparisonChange(monthComparison.fiGrossCents, formatCurrency)}</small></dd></div>
                  <div><dt>Monthly estimate</dt><dd><strong>{formatCurrency(summary.estimatedCommissionCents)}</strong><small>{commissionComparisonIncomplete ? "Comparison waits for commission amounts" : comparisonChange(monthComparison.estimatedCommissionCents, formatCurrency)}</small></dd></div>
                  <div><dt>Any product</dt><dd><strong>{monthlyAnalytics.products.anyProduct.penetrationRate === null ? "—" : `${Math.round(monthlyAnalytics.products.anyProduct.penetrationRate * 100)}%`}</strong><small>{rateComparisonChange(monthComparison.anyProductPenetrationRate)}</small></dd></div>
                  <div><dt>Finance Penetration</dt><dd><strong>{monthlyAnalytics.finance.dealerFinance.penetrationRate === null ? "—" : `${Math.round(monthlyAnalytics.finance.dealerFinance.penetrationRate * 100)}%`}</strong><small>{rateComparisonChange(monthComparison.dealerFinancePenetrationRate)}</small></dd></div>
                </dl>
              ) : (
                <p>{selectedMonthIsFuture ? "No future results are projected." : "The previous month is outside the saved pay-plan history."}</p>
              )}
            </details>

            <section className="report-pace-band" aria-label="Monthly workday pace">
              <div className="report-pace-primary">
                <span>Workday pace</span>
                <strong>
                  {pace.status === "complete"
                    ? `Finished with ${summary.deliveredCount}`
                    : pace.status === "no-workdays"
                      ? "No workdays"
                      : pace.projectedDeliveries === null
                        ? "Not started"
                        : `Pacing ${formatVehiclePace(pace.projectedDeliveries)}`}
                </strong>
              </div>
              <dl className="report-pace-stats">
                <div><dt>Scheduled</dt><dd>{pace.scheduledWorkdays}</dd></div>
                <div><dt>Elapsed</dt><dd>{pace.elapsedWorkdays}</dd></div>
                <div><dt>Remaining</dt><dd>{pace.remainingWorkdays}</dd></div>
                <div><dt>Days off</dt><dd>{pace.daysOff.length}</dd></div>
              </dl>
              <p>
                {pace.status === "future"
                  ? "Pace begins on the first scheduled workday."
                  : pace.status === "not-started"
                    ? "Pace starts after the first scheduled workday."
                    : pace.status === "no-workdays"
                      ? "No scheduled workdays this month."
                      : pace.requiredPerRemainingWorkday === null
                        ? "No scheduled workdays remain."
                        : pace.deliveriesToGoal === 0
                          ? "Monthly delivery goal reached."
                          : `${pace.deliveriesToGoal} to the ${monthlyDeliveryGoal}-delivery goal · ${formatVehiclePace(pace.requiredPerRemainingWorkday)} needed per remaining workday.`}
              </p>
            </section>

            <section className="report-commission-pace" aria-label={monthIsComplete ? "Closed-month commission result" : "Monthly commission pace and projection"}>
              <div>
                <span>Monthly estimated commission</span>
                <strong>{formatCurrency(summary.estimatedCommissionCents)}</strong>
                <small>Includes {formatCurrency(summary.bonusIncludedCents)} bonus</small>
              </div>
              <div>
                <span>{monthIsComplete ? "Month deliveries" : projectionIncomplete ? "Projection from entered gross" : "Projected month end"}</span>
                <strong>{monthIsComplete ? `${summary.deliveredCount} ${summary.deliveredCount === 1 ? "delivery" : "deliveries"}` : projectedCommission}</strong>
                <small>{monthIsComplete ? `${formatCurrency(summary.estimatedCommissionCents)} ${payrollEstimateIncomplete ? "recorded so far" : "final recorded estimate"}` : projectedUnits}</small>
              </div>
              <div>
                <span>Commission goal</span>
                <strong>{monthlyCommissionGoalCents === null ? "Not set" : formatCurrency(monthlyCommissionGoalCents)}</strong>
                <small>{earningsGoal ? `${Math.round(earningsGoal.progressPercent)}% reached` : "Optional personal target"}</small>
              </div>
              <div>
                <span>{earningsGoal ? payrollEstimateIncomplete ? "Goal gap so far" : "Still needed" : monthIsComplete ? "Month status" : "Projection basis"}</span>
                <strong>{earningsGoal ? formatCurrency(earningsGoal.remainingCents) : monthIsComplete ? "Closed" : "Current pace"}</strong>
                <small>{payrollEstimateIncomplete ? pendingEarningsLabel : monthIsComplete
                  ? earningsGoal
                    ? earningsGoal.remainingCents === 0
                      ? "Commission goal reached"
                      : "No scheduled workdays remain"
                    : "Final recorded results"
                  : earningsGoal?.requiredPerRemainingWorkdayCents === null || earningsGoal?.requiredPerRemainingWorkdayCents === undefined
                    ? "Based on scheduled workdays and your deal mix"
                    : `${formatCurrency(earningsGoal.requiredPerRemainingWorkdayCents)} needed per remaining workday`}</small>
              </div>
              <p>{payrollEstimateIncomplete ? `${pendingEarningsDescription} Earnings shown use recorded amounts so far.` : monthIsComplete
                ? "This closed month shows final recorded results. Commission remains a personal estimate until reconciled with payroll."
                : "Projection is a planning scenario, not guaranteed payroll."}{!monthIsComplete && projectionIncomplete && !payrollEstimateIncomplete ? " Some front gross is still missing, so projected new earnings use only entered gross." : ""}{!monthIsComplete ? " It uses your deal mix and Mini; one-off manual amounts are not repeated." : ""}</p>
            </section>
            </div>

            <section
              id="report-month-fi-panel"
              className="report-fi-center-shell report-subject-panel"
              role="tabpanel"
              aria-labelledby="report-month-fi-tab"
              hidden={monthSubject !== "fi"}
            >
              <FiReportCenter
                onOpenSale={onOpenSale}
                calculatedSales={summary.calculatedSales}
                analytics={monthlyAnalytics}
                baseline={recentBaseline.analytics}
                baselineLabel={recentBaseline.label}
                includeLastNames={includeLastNames}
                scopeLabel={monthLabel(settings.selectedMonth)}
                headingLevel={2}
              />
            </section>

            <div className="report-secondary-grid">
              <div
                id="report-month-commission-panel"
                className="report-subject-panel"
                role="tabpanel"
                aria-labelledby="report-month-commission-tab"
                hidden={monthSubject !== "commission"}
              >
              <details id="month-commission" className="report-disclosure report-calculation-disclosure" open>
                <summary>
                  <span>
                    <strong role="heading" aria-level={2}>Commission calculation</strong>
                    <small>Pay plan used for {monthLabel(settings.selectedMonth)}</small>
                  </span>
                  <span className="report-disclosure__value">{formatCurrency(summary.estimatedCommissionCents)}</span>
                  <ChevronDown className="report-chevron" aria-hidden="true" />
                </summary>
                <section className="report-earnings report-disclosure__body" aria-label="Estimated earnings calculation">
                  <dl>
                    <div><dt>Front commission<small>Calculated per sale · {summary.miniDealCount} Mini · {summary.manualFrontCommissionCount} manual/spiff</small></dt><dd>{formatCurrency(summary.frontCommissionCents, true)}</dd></div>
                    <div><dt>F&amp;I commission</dt><dd>{formatCurrency(summary.fiCommissionCents, true)}</dd></div>
                    <div className="subtotal"><dt>Sales commission</dt><dd>{formatCurrency(summary.coreCommissionCents, true)}</dd></div>
                    <div className="bonus-row">
                      <dt>
                        Cumulative volume bonus
                        <small>
                          {bonusMilestone
                            ? `${bonusMilestone.minimumDelivered}-delivery milestone · +${formatCurrency(bonusMilestone.addedAmountCents)} at this level · `
                            : "No milestone reached"}
                          {bonusMilestone ? `${formatCurrency(bonusMilestone.amountCents)} running total` : null}
                        </small>
                      </dt>
                      <dd>{formatCurrency(summary.potentialBonusCents, true)}</dd>
                    </div>
                    <div className="report-total"><dt>Monthly estimated commission</dt><dd>{formatCurrency(summary.estimatedCommissionCents, true)}</dd></div>
                  </dl>
                </section>
              </details>
              <ReportMilestones calculatedSales={summary.calculatedSales} includeLastNames={includeLastNames} onOpenSale={onOpenSale} />
              </div>

              <div
                id="report-month-sales-panel"
                className="report-subject-panel"
                role="tabpanel"
                aria-labelledby="report-month-sales-tab"
                hidden={monthSubject !== "sales"}
              >
              <details id="month-deals" className="report-disclosure report-sales-disclosure" open>
                <summary>
                  <span>
                    <strong role="heading" aria-level={2}>Sales detail</strong>
                    <small>{summary.calculatedSales.length} saved · {attentionRecords.length} attention {attentionRecords.length === 1 ? "item" : "items"}</small>
                  </span>
                  <span className={cn("report-disclosure__count", attentionRecords.length > 0 && "needs-review")}>{summary.calculatedSales.length}</span>
                  <ChevronDown className="report-chevron" aria-hidden="true" />
                </summary>
                <section className="report-sales-detail report-disclosure__body" aria-label="Sales detail">
                  {summary.calculatedSales.length ? (
                    <>
                      <div className="report-table-wrap" role="region" aria-label={`${monthLabel(settings.selectedMonth)} sales detail table`} tabIndex={0}>
                        <table>
                          <thead><tr><th>{includeLastNames ? "Customer / vehicle" : "Vehicle"}</th><th>Stock / date</th><th>Status</th><th>F&amp;I / financing</th><th>Front gross</th><th>Total F&amp;I gross</th><th>Sale commission</th></tr></thead>
                          <tbody>
                            {summary.calculatedSales.map((item) => {
                              const attention = attentionBySale.get(item.sale.id);
                              return (
                                <tr key={item.sale.id} className="report-openable-sale" onClick={(event) => openSaleFromReportRow(event, item.sale, onOpenSale)}>
                                  <th scope="row"><ReportSaleIdentity sale={item.sale} includeLastNames={includeLastNames} /><ReportMilestoneIndicator item={item} /></th>
                                  <td><ReportSaleMetadata sale={item.sale} onOpenSale={onOpenSale} stacked /></td>
                                  <td><StatusBadge status={item.sale.status} /></td>
                                  <td><ProductBadges sale={item.sale} /></td>
                                  <td>{item.sale.frontGrossCents === null ? "—" : formatCurrency(item.sale.frontGrossCents)}</td>
                                  <td>{item.sale.fiGrossCents === null ? "—" : formatCurrency(item.sale.fiGrossCents)}</td>
                                  <td>
                                    {formatCurrency(item.estimatedCommissionCents)}
                                    {item.frontCommissionMethod === "mini" ? <small>Mini</small> : item.frontCommissionMethod === "manual" ? <small>Manual/spiff</small> : null}
                                    {attention
                                      ? <small className="report-warning">{attentionSummary(attention)}</small>
                                      : !item.countsTowardVolume
                                        ? <small className="report-warning">Excluded</small>
                                        : null}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="report-sales-cards" aria-label={`${monthLabel(settings.selectedMonth)} sales detail list`}>
                        {summary.calculatedSales.map((item) => {
                          const attention = attentionBySale.get(item.sale.id);
                          return (
                            <article className={cn("report-sale-card report-openable-sale", attention && "needs-review")} key={item.sale.id} onClick={(event) => openSaleFromReportRow(event, item.sale, onOpenSale)}>
                              <header>
                                <div><ReportSaleIdentity sale={item.sale} includeLastNames={includeLastNames} /><ReportMilestoneIndicator item={item} /></div>
                                <StatusBadge status={item.sale.status} />
                              </header>
                              <ReportSaleMetadata sale={item.sale} onOpenSale={onOpenSale} />
                              <ProductBadges sale={item.sale} />
                              <dl>
                                <div><dt>Front</dt><dd>{item.sale.frontGrossCents === null ? "—" : formatCurrency(item.sale.frontGrossCents)}</dd></div>
                                <div><dt>Total F&amp;I</dt><dd>{item.sale.fiGrossCents === null ? "—" : formatCurrency(item.sale.fiGrossCents)}</dd></div>
                                <div><dt>Sale commission</dt><dd>{formatCurrency(item.estimatedCommissionCents)}{item.frontCommissionMethod === "mini" ? <small>Mini</small> : item.frontCommissionMethod === "manual" ? <small>Manual/spiff</small> : null}</dd></div>
                              </dl>
                              {attention
                                ? <small className="report-sale-card__flag">{attentionSummary(attention)}</small>
                                : !item.countsTowardVolume
                                  ? <small className="report-sale-card__flag">Excluded from volume</small>
                                  : null}
                            </article>
                          );
                        })}
                      </div>
                    </>
                  ) : <p className="report-empty">No sales recorded for this month.</p>}
                </section>
              </details>
              </div>
            </div>

            <footer className="report-document__footer">
              <span><ShieldCheck aria-hidden="true" /> Personal estimate — compare with payroll.</span>
              <span>Applied pay plan: {currentPayPlan.version} · effective {monthLabel(currentPayPlan.effectiveMonth)}</span>
            </footer>
          </article>
        </TabsContent>

        <TabsContent value="week">
          <section className="panel weekly-report print-report">
            <SectionHeader
              title={`${monthLabel(settings.selectedMonth)} weekly performance`}
              description={`Monday–Saturday store weeks · monthly goal ${monthlyDeliveryGoal}`}
            />
            <div className="week-selector" role="group" aria-label="Select a store week">
              {weeklyPerformance.weeks.map((week, index) => (
                <button
                  key={week.id}
                  type="button"
                  className={cn("week-selector__button", selectedWeek?.id === week.id && "is-selected", `is-${week.state}`)}
                  aria-pressed={selectedWeek?.id === week.id}
                  onClick={() => setSelectedWeekId(week.id)}
                >
                  <span>Week {index + 1}</span>
                  <small>{weekRange(week)}</small>
                  {week.state === "current" ? <em>Current</em> : null}
                </button>
              ))}
            </div>

            {weeklyPerformance.sundayDeliveryCount > 0 ? (
              <aside className="weekly-sunday-note" role="note">
                {weeklyPerformance.sundayDeliveryCount} delivered {weeklyPerformance.sundayDeliveryCount === 1 ? "record is" : "records are"} dated Sunday. It stays in monthly totals but is excluded from Monday–Saturday weekly pace.
              </aside>
            ) : null}

            {selectedWeek ? (
              <>
                <ReportSubjectTabs
                  label="Weekly report subject"
                  options={WEEK_SUBJECTS}
                  value={weekSubject}
                  onChange={(value) => setWeekSubject(value as (typeof WEEK_SUBJECTS)[number]["value"])}
                  idPrefix="report-week"
                />
                <header className="weekly-report__header">
                  <span>
                    <span className={cn("week-state-badge", `is-${selectedWeek.state}`)}>
                      {selectedWeek.state === "current" ? "Current week" : selectedWeek.state === "past" ? "Closed week" : "Upcoming week"}
                    </span>
                    <h2>Week {weeklyPerformance.weeks.findIndex((week) => week.id === selectedWeek.id) + 1} · {weekRange(selectedWeek)}</h2>
                    <p>
                      {selectedWeek.state === "current"
                        ? `Results through ${shortDate(todayDate, true)}`
                        : selectedWeek.state === "past"
                          ? "Final recorded results"
                          : "Target checkpoint only — no sales projection"}
                    </p>
                  </span>
                  <strong className="weekly-needed">
                    <span>{selectedWeek.state === "current" ? `More needed by ${shortDate(selectedWeek.endDate)}` : "This-week target share"}</span>
                    {selectedWeek.state === "current"
                      ? selectedWeek.goal.deliveriesNeededByWeekEnd ?? "—"
                      : selectedWeek.goal.targetShareForWeek ?? "—"}
                  </strong>
                </header>

                <div
                  id="report-week-overview-panel"
                  className="report-subject-panel"
                  role="tabpanel"
                  aria-labelledby="report-week-overview-tab"
                  hidden={weekSubject !== "overview"}
                >
                <section className="week-summary-grid" aria-label="Selected week results">
                  <ReportMetric label="This-week sold" value={String(selectedWeek.deliveredCount)} />
                  <ReportMetric label="Credited units" value={selectedWeek.creditedUnits.toLocaleString("en-US", { maximumFractionDigits: 2 })} />
                  <ReportMetric label="Front gross" value={formatCurrency(selectedWeek.frontGrossCents)} />
                  <ReportMetric label="Total F&I gross" value={formatCurrency(selectedWeek.fiGrossCents)} />
                  <ReportMetric label="Sales commission" value={formatCurrency(selectedWeek.estimatedCoreCommissionCents)} note="Front + F&I · monthly bonus excluded" />
                </section>

                <dl className="week-goal-strip" aria-label="Weekly and monthly goal requirements">
                  <div><dt>This-week target share</dt><dd>{selectedWeek.goal.targetShareForWeek ?? "—"}</dd></div>
                  <div><dt>Month checkpoint by {shortDate(selectedWeek.endDate)}</dt><dd>{selectedWeek.goal.targetByWeekEnd ?? "—"}</dd></div>
                  <div><dt>Remaining to monthly goal</dt><dd>{weeklyPerformance.goal.remainingToGoal}</dd></div>
                </dl>

                <section className="week-pace-panel" aria-labelledby="week-pace-heading">
                  <header>
                    <span>
                      <h2 id="week-pace-heading">Goal checkpoint</h2>
                      <small>{checkpointMessage(selectedWeek)}</small>
                    </span>
                  </header>
                  <dl>
                    <div><dt>Scheduled workdays</dt><dd>{selectedWeek.scheduledWorkdays}</dd></div>
                    <div><dt>Elapsed</dt><dd>{selectedWeek.elapsedWorkdays}</dd></div>
                    <div><dt>Remaining</dt><dd>{selectedWeek.remainingWorkdays}</dd></div>
                    <div><dt>Days off</dt><dd>{selectedWeek.daysOff.length}</dd></div>
                    <div><dt>Pace vs expected to date</dt><dd>{paceDeltaLabel(selectedWeek)}</dd></div>
                    <div><dt>Expected cumulative by now</dt><dd>{selectedWeek.state === "future" ? "—" : formatVehiclePace(selectedWeek.goal.expectedDeliveriesToDate)}</dd></div>
                    <div><dt>This-week target share</dt><dd>{selectedWeek.goal.targetShareForWeek ?? "—"}</dd></div>
                    <div><dt>Cumulative month checkpoint</dt><dd>{selectedWeek.goal.targetByWeekEnd ?? "—"}</dd></div>
                  </dl>
                </section>
                </div>

                <section
                  id="report-week-fi-panel"
                  className="weekly-fi-section report-subject-panel"
                  role="tabpanel"
                  aria-labelledby="report-week-fi-tab"
                  hidden={weekSubject !== "fi"}
                >
                  <FiReportCenter
                    onOpenSale={onOpenSale}
                    calculatedSales={selectedWeekSales}
                    analytics={selectedWeekAnalytics}
                    baseline={recentBaseline.analytics}
                    baselineLabel={recentBaseline.label}
                    includeLastNames={includeLastNames}
                    scopeLabel={`Week ${weeklyPerformance.weeks.findIndex((week) => week.id === selectedWeek.id) + 1} · ${weekRange(selectedWeek)}`}
                    headingLevel={2}
                  />
                </section>

                <div
                  id="report-week-sales-panel"
                  className="report-subject-panel"
                  role="tabpanel"
                  aria-labelledby="report-week-sales-tab"
                  hidden={weekSubject !== "sales"}
                >
                <details className="report-disclosure weekly-deals" open>
                  <summary>
                    <span>
                      <strong role="heading" aria-level={2}>Week’s deals</strong>
                      <small>{selectedWeekSales.length} saved {selectedWeekSales.length === 1 ? "record" : "records"}</small>
                    </span>
                    <span className="report-disclosure__count">{selectedWeekSales.length}</span>
                    <ChevronDown className="report-chevron" aria-hidden="true" />
                  </summary>
                  <section className="weekly-deal-list report-disclosure__body" aria-label={`${weekRange(selectedWeek)} deal list`}>
                    {selectedWeekSales.length > 0
                      ? selectedWeekSales.map((item: CalculatedSale) => {
                        const attention = attentionBySale.get(item.sale.id);
                        return (
                          <article className={cn("weekly-deal-row report-openable-sale", attention && "needs-review")} key={item.sale.id} onClick={(event) => openSaleFromReportRow(event, item.sale, onOpenSale)}>
                            <div className="weekly-deal-row__identity">
                              <ReportSaleIdentity sale={item.sale} includeLastNames={includeLastNames} />
                              <ReportMilestoneIndicator item={item} />
                              <ReportSaleMetadata sale={item.sale} onOpenSale={onOpenSale} />
                            </div>
                            <StatusBadge status={item.sale.status} />
                            <ProductBadges sale={item.sale} />
                            <dl>
                              <div><dt>Front</dt><dd>{item.sale.frontGrossCents === null ? "—" : formatCurrency(item.sale.frontGrossCents)}</dd></div>
                              <div><dt>Total F&amp;I</dt><dd>{item.sale.fiGrossCents === null ? "—" : formatCurrency(item.sale.fiGrossCents)}</dd></div>
                              <div><dt>Sale commission</dt><dd>{formatCurrency(item.estimatedCommissionCents)}{item.frontCommissionMethod === "mini" ? <small>Mini</small> : item.frontCommissionMethod === "manual" ? <small>Manual/spiff</small> : null}</dd></div>
                            </dl>
                            {attention ? <small className="weekly-deal-row__attention">{attentionSummary(attention)}</small> : null}
                          </article>
                        );
                      })
                      : <p className="report-empty">No saved deals fall in this store week.</p>}
                  </section>
                </details>
                </div>
              </>
            ) : <p className="report-empty">No Monday–Saturday store weeks are available for this month.</p>}
          </section>
        </TabsContent>

        <TabsContent value="year">
          <section className="panel year-report print-report">
            <SectionHeader
              title={`${year} through ${monthLabel(settings.selectedMonth, "short")}`}
              description={`${yearThroughSelectedMonth.length} ${yearThroughSelectedMonth.length === 1 ? "month" : "months"} through the selected month; ${yearPeriodDescription}`}
            />
            <ReportSubjectTabs
              label="Year report subject"
              options={YEAR_SUBJECTS}
              value={yearSubject}
              onChange={(value) => setYearSubject(value as (typeof YEAR_SUBJECTS)[number]["value"])}
              idPrefix="report-year"
            />
            <div
              id="report-year-summary-panel"
              className="year-total-grid report-subject-panel"
              role="tabpanel"
              aria-labelledby="report-year-summary-tab"
              hidden={yearSubject !== "summary"}
            >
              <ReportMetric label="YTD valid deliveries" value={String(yearTotals.delivered)} note={`Through ${monthLabel(settings.selectedMonth, "short")}`} />
              <ReportMetric label="YTD front gross" value={formatCurrency(yearTotals.frontGross)} />
              <ReportMetric label="YTD total F&I gross" value={formatCurrency(yearTotals.fiGross)} />
              <ReportMetric label="YTD estimated commission" value={formatCurrency(yearTotals.estimated)} note="Sum of in-scope monthly estimates with cumulative bonuses" />
            </div>
            <details
              id="report-year-fi-panel"
              className="year-fi-trend report-subject-panel"
              role="tabpanel"
              aria-labelledby="report-year-fi-tab"
              hidden={yearSubject !== "fi"}
            >
              <summary>
                <span>
                  <strong role="heading" aria-level={2}>F&amp;I by month</strong>
                  <small>Open the monthly product, financing, gross, and average results.</small>
                </span>
                <ChevronDown className="report-chevron" aria-hidden="true" />
              </summary>
              <div className="year-fi-trend__table-wrap" role="region" aria-label={`${year} monthly F&I trend table`} tabIndex={0}>
                <table>
                  <thead><tr><th>Month</th><th>Deals</th><th>Service contract / warranty</th><th>Tire &amp; Wheel</th><th>GAP · all sales</th><th>Finance Penetration</th><th>Total F&amp;I gross</th><th>F&amp;I gross / sale (PVR)</th><th>Tracked products / sale</th></tr></thead>
                  <tbody>
                    {yearTrendRows.map(({ month, analytics }) => (
                      <tr key={month.monthKey}>
                        <th scope="row">{monthLabel(month.monthKey, "short")}</th>
                        <td>{analytics.population.deliveredDealCount}</td>
                        <td>{analytics.products.serviceContract.yesCount} · {analytics.products.serviceContract.penetrationRate === null ? "—" : `${Math.round(analytics.products.serviceContract.penetrationRate * 100)}%`}</td>
                        <td>{analytics.products.tireWheel.yesCount} · {analytics.products.tireWheel.penetrationRate === null ? "—" : `${Math.round(analytics.products.tireWheel.penetrationRate * 100)}%`}</td>
                        <td>{analytics.products.gap.yesCount} · {analytics.products.gap.penetrationRate === null ? "—" : `${Math.round(analytics.products.gap.penetrationRate * 100)}%`}</td>
                        <td>{analytics.finance.dealerFinance.yesCount} · {analytics.finance.dealerFinance.penetrationRate === null ? "—" : `${Math.round(analytics.finance.dealerFinance.penetrationRate * 100)}%`}</td>
                        <td>{formatCurrency(analytics.gross.fi.totalCents)}</td>
                        <td>{analytics.gross.fi.averagePerDeliveredDealCents === null ? "—" : formatCurrency(analytics.gross.fi.averagePerDeliveredDealCents)}</td>
                        <td>{analytics.products.averageProductsPerDeliveredDeal?.toFixed(2) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="year-fi-trend__cards" aria-label={`${year} monthly F&I trend list`}>
                {yearTrendRows.map(({ month, analytics }) => (
                  <article key={month.monthKey}>
                    <header><strong>{monthLabel(month.monthKey, "short")}</strong><span>{analytics.population.deliveredDealCount} deals</span></header>
                    <dl>
                      <div><dt>Service contract / warranty</dt><dd>{analytics.products.serviceContract.yesCount} · {analytics.products.serviceContract.penetrationRate === null ? "—" : `${Math.round(analytics.products.serviceContract.penetrationRate * 100)}%`}</dd></div>
                      <div><dt>Tire &amp; Wheel</dt><dd>{analytics.products.tireWheel.yesCount} · {analytics.products.tireWheel.penetrationRate === null ? "—" : `${Math.round(analytics.products.tireWheel.penetrationRate * 100)}%`}</dd></div>
                      <div><dt>GAP</dt><dd>{analytics.products.gap.yesCount} · {analytics.products.gap.penetrationRate === null ? "—" : `${Math.round(analytics.products.gap.penetrationRate * 100)}%`}</dd></div>
                      <div><dt>Finance Penetration</dt><dd>{analytics.finance.dealerFinance.yesCount} · {analytics.finance.dealerFinance.penetrationRate === null ? "—" : `${Math.round(analytics.finance.dealerFinance.penetrationRate * 100)}%`}</dd></div>
                      <div><dt>Total F&amp;I gross</dt><dd>{formatCurrency(analytics.gross.fi.totalCents)}</dd></div>
                      <div><dt>F&amp;I gross / sale (PVR)</dt><dd>{analytics.gross.fi.averagePerDeliveredDealCents === null ? "—" : formatCurrency(analytics.gross.fi.averagePerDeliveredDealCents)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            </details>
            <div
              id="report-year-monthly-panel"
              className="report-subject-panel"
              role="tabpanel"
              aria-labelledby="report-year-monthly-tab"
              hidden={yearSubject !== "monthly"}
            >
            <p className="table-scroll-hint">Monthly results</p>
            <div className="year-table-wrap" role="region" aria-label={`${year} through selected month performance table`} tabIndex={0}>
              <table className="year-table">
                <thead><tr><th>Month</th><th>Delivered</th><th>Front gross</th><th>Total F&amp;I gross</th><th>Rate</th><th>Sales commission</th><th>Bonus included</th><th>Monthly estimate</th><th>Actual paid</th><th>Variance</th><th>Attention</th></tr></thead>
                <tbody>
                  {yearly.map((month) => {
                    const attentionCount = yearAttention.get(month.monthKey) ?? 0;
                    const isCalendarFuture = month.monthKey > todayMonth;
                    const isOutsideSelectedPeriod = month.monthKey > settings.selectedMonth;
                    const isFutureMonth = isCalendarFuture || isOutsideSelectedPeriod;
                    const endState = isCalendarFuture ? "Upcoming" : "Outside selected period";
                    return (
                      <tr key={month.monthKey} className={cn(month.monthKey === settings.selectedMonth && "is-selected-month", isFutureMonth && "is-upcoming")}>
                        <th scope="row">{monthLabel(month.monthKey, "short")}</th>
                        <td>{isFutureMonth ? "—" : month.deliveredCount}</td>
                        <td>{isFutureMonth ? "—" : formatCurrency(month.frontGrossCents)}</td>
                        <td>{isFutureMonth ? "—" : formatCurrency(month.fiGrossCents)}</td>
                        <td>{isFutureMonth ? "—" : formatPercent(month.frontRateBps)}</td>
                        <td>{isFutureMonth ? "—" : formatCurrency(month.coreCommissionCents)}</td>
                        <td>{isFutureMonth ? "—" : formatCurrency(month.bonusIncludedCents)}</td>
                        <td><strong>{isFutureMonth ? "—" : formatCurrency(month.estimatedCommissionCents)}</strong></td>
                        <td>{isFutureMonth || month.actualPaidCents === null ? "—" : formatCurrency(month.actualPaidCents)}</td>
                        <td className={cn(month.payrollVarianceCents !== null && month.payrollVarianceCents !== 0 && "has-variance")}>
                          {isFutureMonth || month.payrollVarianceCents === null ? "—" : formatCurrency(month.payrollVarianceCents)}
                        </td>
                        <td>{!isFutureMonth && attentionCount > 0
                          ? <span className="report-warning">{attentionCount}</span>
                          : isFutureMonth
                            ? <span className="year-report-card__upcoming">{endState}</span>
                            : <CheckCircle2 aria-label="No attention items" className="ready-icon" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="year-report-cards" aria-label={`${year} monthly performance list`}>
              {yearly.map((month) => {
                const attentionCount = yearAttention.get(month.monthKey) ?? 0;
                const isCalendarFuture = month.monthKey > todayMonth;
                const isOutsideSelectedPeriod = month.monthKey > settings.selectedMonth;
                const isFutureMonth = isCalendarFuture || isOutsideSelectedPeriod;
                const endState = isCalendarFuture ? "Upcoming" : "Outside selected period";
                return (
                  <article className={cn("year-report-card", month.monthKey === settings.selectedMonth && "is-selected-month", isFutureMonth && "is-upcoming")} key={month.monthKey}>
                    <header>
                      <h2>{monthLabel(month.monthKey, "short")}</h2>
                      {!isFutureMonth && attentionCount > 0
                        ? <span className="report-warning">{attentionCount} attention</span>
                        : isFutureMonth
                          ? <span className="year-report-card__upcoming">{endState}</span>
                          : <span className="year-report-card__clear"><CheckCircle2 aria-hidden="true" /> No attention items</span>}
                    </header>
                    <dl>
                      <div><dt>Delivered</dt><dd>{isFutureMonth ? "—" : month.deliveredCount}</dd></div>
                      <div><dt>Monthly estimate</dt><dd>{isFutureMonth ? "—" : formatCurrency(month.estimatedCommissionCents)}</dd></div>
                      <div><dt>Actual paid</dt><dd>{isFutureMonth || month.actualPaidCents === null ? "—" : formatCurrency(month.actualPaidCents)}</dd></div>
                      <div className={cn(!isFutureMonth && month.payrollVarianceCents !== null && month.payrollVarianceCents !== 0 && "has-variance")}><dt>Variance</dt><dd>{isFutureMonth || month.payrollVarianceCents === null ? "—" : formatCurrency(month.payrollVarianceCents)}</dd></div>
                    </dl>
                  </article>
                );
              })}
            </div>
            </div>
            <details className="report-disclosure year-fi-disclosure" open hidden={yearSubject !== "fi"}>
              <summary>
                <span>
                  <strong role="heading" aria-level={2}>Year-to-date F&amp;I detail</strong>
                  <small>Products, financing, combinations, gross, missing details, and sales</small>
                </span>
                <span className="report-disclosure__count">{yearAnalytics.population.deliveredDealCount}</span>
                <ChevronDown className="report-chevron" aria-hidden="true" />
              </summary>
              <div className="year-fi-disclosure__body">
                <FiReportCenter
                  onOpenSale={onOpenSale}
                  calculatedSales={yearThroughSelectedMonth.flatMap((month) => month.calculatedSales)}
                  analytics={yearAnalytics}
                  baseline={yearBaseline.analytics}
                  baselineLabel={yearBaseline.label}
                  includeLastNames={includeLastNames}
                  scopeLabel={`${year} through ${monthLabel(settings.selectedMonth, "short")}`}
                  compact
                  headingLevel={2}
                />
              </div>
            </details>
          </section>
        </TabsContent>

        <TabsContent value="payroll">
          <div className="payroll-layout print-report">
            <section className="panel payroll-entry">
              <SectionHeader title="Enter payroll amount" description={`Compare your ${monthLabel(settings.selectedMonth)} estimate with what you were paid`} />
              <form onSubmit={(event) => { event.preventDefault(); void saveActualPaid(); }} noValidate>
              <div className="field-group">
                <Label htmlFor="actual-paid">Commission paid</Label>
                <div className="money-input">
                  <span aria-hidden="true">$</span>
                  <Input
                    ref={actualPaidRef}
                    id="actual-paid"
                    inputMode="decimal"
                    autoComplete="off"
                    value={actualPaidInput}
                    aria-invalid={Boolean(actualPaidError)}
                    aria-describedby={`actual-paid-help${actualPaidError ? " actual-paid-error" : ""}`}
                    onChange={(event) => {
                      setActualPaidDraft({
                        text: event.target.value,
                        baseCents: isActualPaidDirty && currentPaidDraft ? currentPaidDraft.baseCents : savedActualPaid,
                      });
                      setActualPaidError(null);
                      setFailedActualText(null);
                    }}
                    onBlur={() => {
                      const cents = parseCurrencyToCents(actualPaidInput);
                      if (!Number.isNaN(cents)) {
                        setActualPaidDraft({
                          text: formatCurrencyInput(cents),
                          baseCents: currentPaidDraft ? currentPaidDraft.baseCents : savedActualPaid,
                        });
                      }
                    }}
                    placeholder="4,500.00"
                  />
                </div>
                {actualPaidError ? <p id="actual-paid-error" className="field-error" role="alert">{actualPaidError}</p> : null}
                <p id="actual-paid-help" className="field-help">Enter the amount from your payroll record. Leave blank if not entered yet; enter 0 only if you were paid $0.</p>
              </div>
              {actualPaidConflict ? (
                <div className="form-summary-error" role="alert">
                  <div>
                    <strong>Payroll changed in another tab</strong>
                    <p>Your entry is still here. Load the latest saved amount before making another change.</p>
                    <Button type="button" variant="outline" onClick={() => { setActualPaidDraft(null); setActualPaidError(null); actualPaidRef.current?.focus(); }}>
                      Load latest payroll amount
                    </Button>
                  </div>
                </div>
              ) : <p className="field-help" role="status">{isSavingActual ? "Saving payroll amount…" : actualPaidError ? "Not saved yet — review the amount above." : isActualPaidDirty ? "Payroll amount saves automatically when you finish typing." : "Payroll amount saved. Changes save automatically."}</p>}
              {(isActualPaidDirty || activeFailedActualText !== null) ? <Button type="submit" disabled={isSavingActual || actualPaidConflict}>
                {isSavingActual ? "Saving…" : activeFailedActualText !== null ? "Try saving again" : "Save now"}
              </Button> : null}
              </form>
            </section>
            <section className="panel payroll-comparison">
              <SectionHeader title="Estimate vs payroll" description={monthLabel(settings.selectedMonth)} />
              <dl>
                <div><dt>Estimated commission</dt><dd>{formatCurrency(summary.estimatedCommissionCents, true)}</dd></div>
                <div><dt>Cumulative bonus included</dt><dd>{formatCurrency(summary.bonusIncludedCents, true)}</dd></div>
                <div><dt>Payroll amount</dt><dd>{summary.actualPaidCents === null ? "Not entered" : formatCurrency(summary.actualPaidCents, true)}</dd></div>
                <div className={cn("payroll-variance", !payrollEstimateIncomplete && summary.payrollVarianceCents !== null && summary.payrollVarianceCents !== 0 && "has-variance")}>
                  <dt>Payroll minus estimate</dt>
                  <dd>{summary.payrollVarianceCents === null ? "—" : formatCurrency(summary.payrollVarianceCents, true)}</dd>
                </div>
              </dl>
              <p>
                {payrollEstimateIncomplete
                  ? `Estimate incomplete — awaiting ${awaitingFiGrossCount > 0 ? awaitingFrontCommissionCount > 0 ? "front and F&I" : "F&I" : "front"} gross.`
                  : "If the amounts differ, review missing sales, duplicate stock numbers, reversals, rounding, bonuses, and the pay plan used for the month."}
              </p>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
