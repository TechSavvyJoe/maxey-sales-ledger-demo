import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Gauge,
  Import,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  EmptyState,
  InlineLinkButton,
  PageHeading,
  SectionHeader,
  StatusBadge,
} from "@/components/shared";
import { attentionSummary, getAttentionRecords } from "@/domain/attention";
import { calculateMonth, calculateYear, getNextBonusMilestone } from "@/domain/commission";
import {
  currentMonthKey,
  monthLabel,
  shiftMonth,
  todayDateOnly,
  yearForMonth,
} from "@/domain/date";
import { formatCurrency, formatPercent } from "@/domain/money";
import { getCommissionGoalForMonth, getDeliveryGoalForMonth } from "@/domain/goals";
import type { AppDestination } from "@/domain/navigation";
import { calculateWorkdayPace } from "@/domain/pacing";
import {
  calculateCommissionRunRate,
  calculateEarningsGoalProgress,
  calculatePeriodPerformance,
} from "@/domain/performance";
import {
  getPayPlanForMonth,
  getPayPlanSchedule,
  hasPayPlanCoverage,
} from "@/domain/payPlan";
import type { ProfileSettings, Sale } from "@/domain/types";
import { calculateWeeklyPerformance } from "@/domain/weeklyPerformance";
import { cn } from "@/lib/utils";
import "./dashboard-density.css";
import "./dashboard-v2.css";

const TrendChart = lazy(async () => ({
  default: (await import("./TrendChart")).TrendChart,
}));

interface DashboardProps {
  sales: Sale[];
  settings: ProfileSettings;
  onAddSale: () => void;
  onLoadDemo: () => void;
  onEditSale: (sale: Sale) => void;
  onNavigate: (destination: AppDestination) => void;
  onDismissOnboarding: () => void;
}

function Difference({ current, previous, format = "number" }: { current: number; previous: number | null; format?: "number" | "currency" }) {
  if (previous === null) {
    return <span className="metric-delta">No earlier covered month</span>;
  }
  const difference = current - previous;
  const Icon = difference > 0 ? ArrowUpRight : difference < 0 ? ArrowDownRight : ArrowRight;
  const text = format === "currency" ? formatCurrency(Math.abs(difference)) : Math.abs(difference).toLocaleString();
  return (
    <span className={cn("metric-delta", difference > 0 && "is-positive", difference < 0 && "is-negative")}>
      <Icon aria-hidden="true" />
      {difference === 0 ? "No change" : `${text} ${difference > 0 ? "ahead" : "behind"}`} vs last month
    </span>
  );
}

function MetricCard({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <article className="metric-card">
      <span className="metric-card__label">{label}</span>
      <strong>{value}</strong>
      {children}
    </article>
  );
}

function useResponsiveDisclosure() {
  const userToggledRef = useRef(false);
  const [open, setOpen] = useState(() => window.matchMedia("(min-width: 721px)").matches);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 721px)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (!userToggledRef.current) setOpen(event.matches);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return {
    open,
    onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      const nextOpen = event.currentTarget.open;
      if (nextOpen === open) return;
      userToggledRef.current = true;
      setOpen(nextOpen);
    },
  };
}

function penetrationLabel(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function Dashboard({
  sales,
  settings,
  onAddSale,
  onLoadDemo,
  onEditSale,
  onNavigate,
  onDismissOnboarding,
}: DashboardProps) {
  const insightsDisclosure = useResponsiveDisclosure();
  const trendDisclosure = useResponsiveDisclosure();
  const payPlanSchedule = useMemo(
    () => getPayPlanSchedule(settings),
    [settings],
  );
  const currentPayPlan = useMemo(
    () => getPayPlanForMonth(payPlanSchedule, settings.selectedMonth),
    [payPlanSchedule, settings.selectedMonth],
  );
  const current = useMemo(
    () =>
      calculateMonth(
        sales,
        settings.selectedMonth,
        payPlanSchedule,
        settings.actualPaidByMonth[settings.selectedMonth] ?? null,
      ),
    [payPlanSchedule, sales, settings.actualPaidByMonth, settings.selectedMonth],
  );
  const nextBonusMilestone = useMemo(
    () => getNextBonusMilestone(current.deliveredCount, currentPayPlan.bonusTiers),
    [current.deliveredCount, currentPayPlan.bonusTiers],
  );
  const previousMonthKey = shiftMonth(settings.selectedMonth, -1);
  const previous = useMemo(
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
  const yearly = useMemo(
    () =>
      calculateYear(
        sales,
        yearForMonth(settings.selectedMonth),
        payPlanSchedule,
        settings.actualPaidByMonth,
      ),
    [payPlanSchedule, sales, settings.actualPaidByMonth, settings.selectedMonth],
  );

  const activeSales = sales.filter((sale) => !sale.deletedAt);
  const showOnboarding = !settings.onboardingDismissed && activeSales.length === 0;
  const todayDate = todayDateOnly();
  const monthlyGoal = getDeliveryGoalForMonth(settings, settings.selectedMonth);
  const monthlyCommissionGoalCents = getCommissionGoalForMonth(settings, settings.selectedMonth);
  const averageCommission =
    current.deliveredCount > 0 ? Math.round(current.estimatedCommissionCents / current.deliveredCount) : 0;
  const goalProgress = Math.min(100, monthlyGoal > 0 ? (current.deliveredCount / monthlyGoal) * 100 : 0);
  const pace = calculateWorkdayPace({
    monthKey: settings.selectedMonth,
    deliveredCount: current.deliveredCount,
    monthlyGoal,
    daysOff: settings.daysOffByMonth[settings.selectedMonth] ?? [],
    todayDate,
  });
  const commissionRunRate = calculateCommissionRunRate(current, pace, currentPayPlan);
  const monthIsComplete = pace.status === "complete";
  const earningsGoal = calculateEarningsGoalProgress({
    currentEstimatedCommissionCents: current.estimatedCommissionCents,
    goalCents: monthlyCommissionGoalCents,
    remainingWorkdays: pace.remainingWorkdays,
    paceStatus: pace.status,
    runRate: commissionRunRate,
  });
  const weekly = calculateWeeklyPerformance({
    summary: current,
    monthlyGoal,
    daysOff: settings.daysOffByMonth[settings.selectedMonth] ?? [],
    todayDate,
  });
  const currentWeek = weekly.weeks.find((week) => week.state === "current") ?? null;
  const todayMonth = currentMonthKey();
  const trendThroughMonth = settings.selectedMonth < todayMonth
    ? settings.selectedMonth
    : todayMonth;
  const trendMonths = yearly.filter((month) => month.monthKey <= trendThroughMonth);
  const yearPerformance = calculatePeriodPerformance(yearly, trendThroughMonth);
  const paceChipText = pace.status === "complete"
    ? `Finished ${current.deliveredCount}`
    : pace.status === "no-workdays"
      ? "No workdays"
    : pace.status === "future" || pace.status === "not-started"
      ? "Not started"
      : `Pacing ${pace.projectedDeliveries ?? current.deliveredCount}`;
  const workdayLine = pace.status === "future"
    ? `${pace.scheduledWorkdays} scheduled workdays · ${pace.daysOff.length} ${pace.daysOff.length === 1 ? "day" : "days"} off`
    : `${pace.elapsedWorkdays} of ${pace.scheduledWorkdays} scheduled workdays elapsed · ${pace.remainingWorkdays} left${pace.daysOff.length ? ` · ${pace.daysOff.length} off` : ""}`;
  const paceGuidance = pace.status === "complete"
    ? `Month finished with ${current.deliveredCount} ${current.deliveredCount === 1 ? "delivery" : "deliveries"}`
    : pace.status === "future"
      ? "Pace begins on your first scheduled workday"
      : pace.status === "no-workdays"
        ? "No scheduled workdays this month"
      : pace.status === "not-started"
        ? "Pace starts after your first scheduled workday"
        : pace.deliveriesToGoal === 0
          ? `Goal reached · ${pace.remainingWorkdays} scheduled workdays left`
          : pace.requiredPerRemainingWorkday === null
            ? `${pace.deliveriesToGoal} to goal · No scheduled workdays remain`
            : `${pace.deliveriesToGoal} ${pace.deliveriesToGoal === 1 ? "delivery" : "deliveries"} to goal · Need ${pace.requiredPerRemainingWorkday.toFixed(1)} per remaining workday`;
  const yearDelivered = yearPerformance.deliveredCount;
  const yearCommission = yearPerformance.estimatedCommissionCents;
  const yearAverage = yearDelivered > 0 ? Math.round(yearCommission / yearDelivered) : 0;
  const chartData = trendMonths.map((month) => ({
    month: monthLabel(month.monthKey, "short").split(" ")[0],
    units: month.deliveredCount,
    commission: month.estimatedCommissionCents / 100,
    monthKey: month.monthKey,
  }));
  const attentionItems = getAttentionRecords(current.calculatedSales, todayDate);
  const primaryAttentionItem = attentionItems[0] ?? null;
  const recentSales = [...current.calculatedSales]
    .sort((a, b) => b.sale.saleDate.localeCompare(a.sale.saleDate) || b.sale.updatedAt.localeCompare(a.sale.updatedAt))
    .slice(0, 3);
  const projectedCommission = commissionRunRate
    ? commissionRunRate.low.estimatedCommissionCents === commissionRunRate.high.estimatedCommissionCents
      ? formatCurrency(commissionRunRate.low.estimatedCommissionCents)
      : `${formatCurrency(commissionRunRate.low.estimatedCommissionCents)}–${formatCurrency(commissionRunRate.high.estimatedCommissionCents)}`
    : "Not available yet";
  const projectedUnits = commissionRunRate
    ? commissionRunRate.low.deliveredCount === commissionRunRate.high.deliveredCount
      ? `${commissionRunRate.low.deliveredCount} projected deliveries`
      : `${commissionRunRate.low.deliveredCount}–${commissionRunRate.high.deliveredCount} projected deliveries`
    : "Starts after the first valid delivery and scheduled workday";
  const projectedIncrease = commissionRunRate
    ? commissionRunRate.low.estimatedCommissionCents === commissionRunRate.high.estimatedCommissionCents
      ? formatCurrency(
          Math.max(
            commissionRunRate.low.estimatedCommissionCents - current.estimatedCommissionCents,
            0,
          ),
        )
      : `${formatCurrency(Math.max(commissionRunRate.low.estimatedCommissionCents - current.estimatedCommissionCents, 0))}–${formatCurrency(Math.max(commissionRunRate.high.estimatedCommissionCents - current.estimatedCommissionCents, 0))}`
    : "—";
  const earningsPaceLabel = monthIsComplete
    ? "Month complete"
    : !earningsGoal
    ? "Projection active"
    : earningsGoal.status === "reached"
      ? "Goal reached"
      : earningsGoal.status === "on-pace"
        ? "On pace"
        : earningsGoal.status === "within-range"
          ? "Goal is within range"
          : earningsGoal.status === "behind"
            ? "Below goal pace"
            : earningsGoal.status === "complete"
              ? "Month complete"
              : "Not started";
  const earningsGuidance = monthIsComplete
    ? earningsGoal
      ? earningsGoal.remainingCents === 0
        ? `${formatCurrency(earningsGoal.goalCents)} monthly commission goal reached.`
        : `${formatCurrency(earningsGoal.remainingCents)} below the monthly commission goal; this month is closed.`
      : "Final recorded results are shown. Set a commission goal for another month to manage against a target."
    : !earningsGoal
    ? "Set an optional commission goal to compare this projection with your target."
    : earningsGoal.remainingCents === 0
      ? `${formatCurrency(earningsGoal.goalCents)} monthly commission goal reached.`
      : earningsGoal.requiredPerRemainingWorkdayCents === null
        ? `${formatCurrency(earningsGoal.remainingCents)} below the monthly commission goal; no scheduled workdays remain.`
        : `${formatCurrency(earningsGoal.remainingCents)} to goal · ${formatCurrency(earningsGoal.requiredPerRemainingWorkdayCents)} needed per remaining workday.`;

  return (
    <div className="page-stack dashboard-page dashboard-page-v2">
      <PageHeading
        title={`${monthLabel(settings.selectedMonth)} overview`}
        description={`${current.deliveredCount} delivered · ${current.pendingCount} pending · ${formatCurrency(current.estimatedCommissionCents)} estimated commission`}
      />

      <section className="metric-grid dashboard-v2-scorecard" aria-label={`${monthLabel(settings.selectedMonth)} key metrics`}>
        <MetricCard label="Month goal" value={`${current.deliveredCount} of ${monthlyGoal}`}>
          <span className="metric-note">
            {pace.deliveriesToGoal === 0
              ? "Goal reached"
              : `${pace.deliveriesToGoal} ${pace.deliveriesToGoal === 1 ? "delivery" : "deliveries"} to goal`}
          </span>
        </MetricCard>
        <MetricCard label="Estimated commission" value={formatCurrency(current.estimatedCommissionCents)}>
          <Difference
            current={current.estimatedCommissionCents}
            previous={previous?.estimatedCommissionCents ?? null}
            format="currency"
          />
        </MetricCard>
        <MetricCard label="Pace and projection" value={paceChipText}>
          <span className="metric-note">
            {monthIsComplete ? `${current.deliveredCount} final deliveries` : `${projectedUnits} · ${projectedCommission}`}
          </span>
        </MetricCard>
      </section>

      <section
        className={cn("dashboard-v2-review", attentionItems.length ? "needs-review" : "is-clear")}
        aria-labelledby="dashboard-review-heading"
      >
        <span className="dashboard-v2-review__icon" aria-hidden="true">
          {attentionItems.length ? <AlertTriangle /> : <CheckCircle2 />}
        </span>
        <span className="dashboard-v2-review__summary">
          <strong id="dashboard-review-heading">
            {attentionItems.length ? "Needs review" : "Everything is up to date"}
          </strong>
          <small>
            {attentionItems.length
              ? `${attentionItems.length} ${attentionItems.length === 1 ? "sale could" : "sales could"} change this month’s estimate.`
              : "No calculation issues or overdue pending follow-up this month."}
          </small>
        </span>
        {primaryAttentionItem ? (
          <button
            type="button"
            className="dashboard-v2-review__record"
            onClick={() => onEditSale(primaryAttentionItem.sale)}
          >
            <strong>{primaryAttentionItem.stockLabel}</strong>
            <span>{attentionSummary(primaryAttentionItem)}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="dashboard-v2-review__link"
          onClick={() => onNavigate({ view: "sales", filter: attentionItems.length ? "review" : "all" })}
        >
          {attentionItems.length ? `Review ${attentionItems.length} ${attentionItems.length === 1 ? "sale" : "sales"}` : "View sales"}
          <ArrowRight aria-hidden="true" />
        </button>
      </section>

      {showOnboarding ? (
        <section className="onboarding-banner" aria-labelledby="onboarding-title">
          <div className="onboarding-banner__icon" aria-hidden="true">
            <Sparkles />
          </div>
          <div className="onboarding-banner__content">
            <span className="eyebrow">Welcome to your private sales workspace</span>
            <h2 id="onboarding-title">Start your workspace, import a tracker, or explore the full-year demo</h2>
            <p>
              Your sales stay in this browser profile. Commission estimates update automatically by month,
              and you can export a backup anytime.
            </p>
            <div className="onboarding-banner__actions">
              <Button type="button" onClick={onAddSale}>
                <Plus aria-hidden="true" /> Add first sale
              </Button>
              <Button type="button" variant="secondary" onClick={onLoadDemo}>
                <Sparkles aria-hidden="true" /> Explore full-year demo
              </Button>
              <Button type="button" variant="outline" onClick={() => onNavigate({ view: "settings", section: "data" })}>
                <Import aria-hidden="true" /> Import Excel tracker
              </Button>
              <Button type="button" variant="ghost" onClick={onDismissOnboarding}>
                I’ll do this later
              </Button>
            </div>
          </div>
          <div className="onboarding-banner__privacy">
            <ShieldCheck aria-hidden="true" />
            <span>No login or cloud account required</span>
          </div>
        </section>
      ) : null}

      <section className="dashboard-v2-planning" aria-label="Monthly goal and commission outlook">
        <div className="dashboard-v2-planning__grid">
          <article className="dashboard-v2-plan" aria-labelledby="goal-heading">
            <div className="dashboard-pace-lane__heading">
              <span>
                <small>Month goal</small>
                <strong id="goal-heading">{current.deliveredCount} <em>of {monthlyGoal} delivered</em></strong>
              </span>
              <span className={cn(
                "pace-chip",
                pace.status === "on-pace" || pace.status === "goal-reached" ? "is-on-pace" : undefined,
                pace.status === "behind" ? "is-behind" : undefined,
              )}>
                <Gauge aria-hidden="true" /> {paceChipText}
              </span>
            </div>
            <Progress value={goalProgress} aria-label={`${Math.round(goalProgress)} percent of monthly unit goal`} />
            <div className="dashboard-pace-lane__meta">
              {currentWeek ? (
                <strong className="dashboard-week-callout">
                  This week · {currentWeek.deliveredCount} sold · {weekly.goal.neededByEndOfCurrentWeek === 0
                    ? `On target through ${currentWeek.endDate.slice(5).replace("-", "/")}`
                    : `${weekly.goal.neededByEndOfCurrentWeek} more needed by ${currentWeek.endDate.slice(5).replace("-", "/")}`}
                </strong>
              ) : null}
              <span>{paceGuidance}</span>
              <span>{workdayLine}</span>
            </div>
            <div className="dashboard-pace-lane__links">
              <button type="button" onClick={() => onNavigate({ view: "reports", tab: "week" })}>Weekly performance</button>
              <button type="button" onClick={() => onNavigate({ view: "settings", section: "schedule" })}>Edit work schedule</button>
            </div>
          </article>

          <article className="dashboard-v2-plan dashboard-v2-plan--money" aria-labelledby="earnings-pace-heading">
            <div className="dashboard-pace-lane__heading">
              <span>
                <small>Commission outlook</small>
                <strong id="earnings-pace-heading">{monthIsComplete ? "Final recorded estimate" : "Current and projected earnings"}</strong>
              </span>
              <span className={cn(
                "pace-chip",
                earningsGoal?.status === "reached" || earningsGoal?.status === "on-pace" ? "is-on-pace" : undefined,
                earningsGoal?.status === "behind" || earningsGoal?.status === "complete" && earningsGoal.remainingCents > 0 ? "is-behind" : undefined,
              )}>
                <CircleDollarSign aria-hidden="true" /> {earningsPaceLabel}
              </span>
            </div>
            <dl className="earnings-pace-grid">
              <div>
                <dt>Current estimate</dt>
                <dd><strong>{formatCurrency(current.estimatedCommissionCents)}</strong><small>{formatCurrency(current.bonusIncludedCents)} bonus included</small></dd>
              </div>
              <div>
                <dt>{monthIsComplete ? "Final month result" : "Projected month end"}</dt>
                <dd>
                  <strong>{monthIsComplete ? `${current.deliveredCount} ${current.deliveredCount === 1 ? "delivery" : "deliveries"}` : projectedCommission}</strong>
                  <small>{monthIsComplete ? `${formatCurrency(current.estimatedCommissionCents)} final recorded estimate` : projectedUnits}</small>
                </dd>
              </div>
              <div>
                <dt>{earningsGoal ? "Still needed" : monthIsComplete ? "Month status" : "Projected increase"}</dt>
                <dd>
                  <strong>{earningsGoal ? formatCurrency(earningsGoal.remainingCents) : monthIsComplete ? "Closed" : projectedIncrease}</strong>
                  <small>{monthlyCommissionGoalCents === null
                    ? monthIsComplete ? "Final recorded results" : "Goal not set"
                    : `${formatCurrency(monthlyCommissionGoalCents)} goal · ${Math.round(earningsGoal?.progressPercent ?? 0)}% reached`}</small>
                </dd>
              </div>
            </dl>
            {earningsGoal ? (
              <Progress value={earningsGoal.progressPercent} aria-label={`${Math.round(earningsGoal.progressPercent)} percent of monthly commission goal`} />
            ) : null}
            <div className="dashboard-pace-lane__footer">
              <span>{earningsGuidance}</span>
              <button type="button" onClick={() => onNavigate({ view: "settings", section: "profile" })}>{earningsGoal ? "Edit goal" : "Set a commission goal"}</button>
            </div>
          </article>
        </div>
      </section>

      <div className="dashboard-v2-detail-grid">
        <section className="panel commission-breakdown dashboard-v2-commission-details" aria-labelledby="breakdown-heading">
          <SectionHeader
            id="breakdown-heading"
            title="Commission details"
            description="What makes up the current estimate"
          />
          <div className="breakdown-list">
            <div>
              <span><i className="breakdown-dot front" />Front commission</span>
              <strong>{formatCurrency(current.frontCommissionCents)}</strong>
              <small>
                {formatCurrency(current.frontGrossCents)} front gross · {formatPercent(current.frontRateBps)} rate
                {current.frontRateBps === currentPayPlan.acceleratedFrontRateBps
                  ? ` · ${formatCurrency(current.retroactiveUpliftCents)} retroactive increase included`
                  : ` · ${formatPercent(currentPayPlan.acceleratedFrontRateBps)} applies after more than ${currentPayPlan.acceleratedThresholdExclusive} delivered`}
              </small>
            </div>
            <div>
              <span><i className="breakdown-dot fi" />F&amp;I commission</span>
              <strong>{formatCurrency(current.fiCommissionCents)}</strong>
              <small>{formatCurrency(current.fiGrossCents)} total F&amp;I gross</small>
            </div>
            <div className="bonus-line">
              <span><i className="breakdown-dot bonus" />Volume bonus</span>
              <strong>{formatCurrency(current.potentialBonusCents)}</strong>
              <small>
                {nextBonusMilestone
                  ? `Next: +${formatCurrency(nextBonusMilestone.addedAmountCents)} at ${nextBonusMilestone.minimumDelivered} · ${formatCurrency(nextBonusMilestone.amountCents)} total`
                  : `Top bonus level reached · ${formatCurrency(current.potentialBonusCents)} total`}
              </small>
            </div>
          </div>
          <div className="breakdown-total">
            <span>Estimated commission · {formatCurrency(averageCommission)} per delivery</span>
            <strong>{formatCurrency(current.estimatedCommissionCents)}</strong>
          </div>
          <InlineLinkButton onClick={() => onNavigate({ view: "reports", tab: "payroll" })}>Compare with payroll</InlineLinkButton>
        </section>

        <details
          open={insightsDisclosure.open}
          onToggle={insightsDisclosure.onToggle}
          className="panel performance-insights dashboard-disclosure"
        >
          <summary className="dashboard-disclosure__summary">
            <span>
              <strong id="performance-insights-heading" role="heading" aria-level={2}>F&amp;I performance</strong>
              <small>{weekly.monthToDate.fi.eligibleDealCount} valid delivered deals · {formatCurrency(weekly.monthToDate.fi.totalFiGrossCents)} total F&amp;I gross</small>
            </span>
            <span className="dashboard-disclosure__action" aria-hidden="true">
              <BadgeDollarSign />
              <ChevronDown className="dashboard-disclosure__chevron" />
            </span>
          </summary>
          <div className="dashboard-disclosure__content" aria-labelledby="performance-insights-heading">
            <dl className="performance-insight-grid">
              <div>
                <dt>Service contract / warranty</dt>
                <dd>
                  <strong>{penetrationLabel(weekly.monthToDate.fi.serviceContract.rate)}</strong>
                  <small>{weekly.monthToDate.fi.serviceContract.soldCount} of {weekly.monthToDate.fi.serviceContract.eligibleDealCount} valid deals{weekly.monthToDate.fi.serviceContract.unrecordedCount ? ` · ${weekly.monthToDate.fi.serviceContract.unrecordedCount} not marked` : ""}</small>
                </dd>
              </div>
              <div>
                <dt>Tire &amp; Wheel</dt>
                <dd>
                  <strong>{penetrationLabel(weekly.monthToDate.fi.tireWheel.rate)}</strong>
                  <small>{weekly.monthToDate.fi.tireWheel.soldCount} of {weekly.monthToDate.fi.tireWheel.eligibleDealCount} valid deals{weekly.monthToDate.fi.tireWheel.unrecordedCount ? ` · ${weekly.monthToDate.fi.tireWheel.unrecordedCount} not marked` : ""}</small>
                </dd>
              </div>
              <div>
                <dt>GAP</dt>
                <dd>
                  <strong>{penetrationLabel(weekly.monthToDate.fi.gap.rate)}</strong>
                  <small>{weekly.monthToDate.fi.gap.soldCount} of {weekly.monthToDate.fi.gap.eligibleDealCount} valid deals{weekly.monthToDate.fi.gap.unrecordedCount ? ` · ${weekly.monthToDate.fi.gap.unrecordedCount} not marked` : ""}</small>
                </dd>
              </div>
              <div>
                <dt>Dealer financing</dt>
                <dd>
                  <strong>{penetrationLabel(weekly.monthToDate.fi.dealerFinanced.rate)}</strong>
                  <small>{weekly.monthToDate.fi.dealerFinanced.soldCount} of {weekly.monthToDate.fi.dealerFinanced.eligibleDealCount} valid deals{weekly.monthToDate.fi.dealerFinanced.unrecordedCount ? ` · ${weekly.monthToDate.fi.dealerFinanced.unrecordedCount} not marked` : ""}</small>
                </dd>
              </div>
            </dl>
          </div>
        </details>
      </div>

      <div className="dashboard-lower-grid">
        <details open={trendDisclosure.open} onToggle={trendDisclosure.onToggle} className="panel trend-panel dashboard-disclosure">
          <summary className="dashboard-disclosure__summary">
            <span>
              <strong id="trend-heading" role="heading" aria-level={2}>{yearForMonth(settings.selectedMonth)} performance trend</strong>
              <small>{yearDelivered} deliveries · {formatCurrency(yearCommission)} estimated · {formatCurrency(yearAverage)} per vehicle</small>
            </span>
            <span className="dashboard-disclosure__action" aria-hidden="true">
              <BadgeDollarSign />
              <ChevronDown className="dashboard-disclosure__chevron" />
            </span>
          </summary>
          <div className="dashboard-disclosure__content" aria-labelledby="trend-heading">
            <Suspense fallback={<div className="trend-chart trend-chart--loading" role="status">Loading chart…</div>}>
              <TrendChart data={chartData} year={yearForMonth(settings.selectedMonth)} />
            </Suspense>
            <details className="trend-data-details">
              <summary>View monthly chart data</summary>
              <div className="trend-data-table-wrap" role="region" aria-label={`${yearForMonth(settings.selectedMonth)} chart data table`} tabIndex={0}>
                <table>
                  <caption>{yearForMonth(settings.selectedMonth)} delivered units and commission by month</caption>
                  <thead><tr><th>Month</th><th>Delivered</th><th>Estimated commission</th></tr></thead>
                  <tbody>
                    {trendMonths.map((month) => (
                      <tr key={month.monthKey}>
                        <th scope="row">{monthLabel(month.monthKey)}</th>
                        <td>{month.deliveredCount}</td>
                        <td>{formatCurrency(month.estimatedCommissionCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </details>

        <section className="panel recent-sales" aria-labelledby="recent-sales-heading">
        <SectionHeader
          id="recent-sales-heading"
          title="Recent sales"
          description={`Latest activity in ${monthLabel(settings.selectedMonth)}`}
          action={<InlineLinkButton onClick={() => onNavigate({ view: "sales", filter: "all" })}>View all</InlineLinkButton>}
        />
        {recentSales.length ? (
          <div className="recent-sales__list">
            {recentSales.map((item) => (
              <button type="button" key={item.sale.id} onClick={() => onEditSale(item.sale)}>
                <span className="recent-sales__date">
                  <strong>{item.sale.saleDate.slice(8, 10)}</strong>
                  <small>{monthLabel(item.monthKey, "short").split(" ")[0]}</small>
                </span>
                <span className="recent-sales__identity">
                  <strong>{item.sale.customerLastName || "No last name"}</strong>
                  <small>{item.sale.stockNumber || "Missing stock"} · {item.sale.vehicleDescription || "Vehicle not entered"}</small>
                </span>
                <StatusBadge status={item.sale.status} />
                <span className="recent-sales__commission">
                  <strong>{formatCurrency(item.estimatedCommissionCents)}</strong>
                  <small>estimated</small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No sales in this month yet"
            description="Add a delivered or pending vehicle to start the monthly view."
            headingLevel={3}
            action={<Button onClick={onAddSale}><Plus aria-hidden="true" /> Add sale</Button>}
          />
        )}
        </section>
      </div>
    </div>
  );
}
