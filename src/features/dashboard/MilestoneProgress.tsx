import { useId } from "react";
import { Flag, Trophy } from "lucide-react";
import { monthLabel } from "@/domain/date";
import { getNextEarningsMilestone } from "@/domain/milestones";
import { formatCurrency, formatPercent } from "@/domain/money";
import type { MonthSummary, PayPlan } from "@/domain/types";
import "./milestone-progress.css";

interface MilestoneProgressProps {
  summary: MonthSummary;
  payPlan: PayPlan;
  todayDate: string;
}

function milestoneRate(basisPoints: number): string {
  return formatPercent(basisPoints, basisPoints % 100 === 0 ? 0 : basisPoints % 10 === 0 ? 1 : 2);
}

export function MilestoneProgress({ summary, payPlan, todayDate }: MilestoneProgressProps) {
  const headingId = useId();
  const next = getNextEarningsMilestone(summary, payPlan);
  const monthIsComplete = summary.monthKey < todayDate.slice(0, 7);
  const monthIsFuture = summary.monthKey > todayDate.slice(0, 7);
  const higherRateReached = payPlan.acceleratedFrontRateBps > payPlan.baseFrontRateBps
    && summary.deliveredCount > payPlan.acceleratedThresholdExclusive;
  const hasMilestones = payPlan.acceleratedFrontRateBps > payPlan.baseFrontRateBps
    || payPlan.bonusTiers.some((tier) => tier.amountCents > 0);
  if (!hasMilestones) return null;

  if (monthIsComplete || !next) {
    const anyReached = higherRateReached || summary.bonusIncludedCents > 0;
    return (
      <section className="milestone-progress milestone-progress--reached" aria-labelledby={headingId}>
        <div className="milestone-progress__lead">
          <h3 id={headingId}><Trophy aria-hidden="true" />Milestones reached</h3>
          <strong>{monthIsComplete ? `${summary.deliveredCount} delivered` : "Top level reached"}</strong>
          <p>{monthIsComplete ? `${monthLabel(summary.monthKey)} is complete.` : "All earnings milestones in this plan are unlocked."}</p>
        </div>
        {anyReached ? (
          <dl className="milestone-progress__rewards">
            {higherRateReached ? <div><dt>Front rate reached</dt><dd>{milestoneRate(summary.frontRateBps)}<small>Retroactive to the first sale, with Mini and manual payouts honored</small></dd></div> : null}
            {summary.bonusIncludedCents > 0 ? <div><dt>Volume bonus earned</dt><dd>{formatCurrency(summary.bonusIncludedCents)}<small>Already included in this month’s estimate</small></dd></div> : null}
          </dl>
        ) : <p className="milestone-progress__empty">No earnings milestone was reached this month.</p>}
      </section>
    );
  }

  return (
    <section className="milestone-progress" aria-labelledby={headingId}>
      <div className="milestone-progress__lead">
        <h3 id={headingId}><Flag aria-hidden="true" />{monthIsFuture ? "Upcoming earnings milestone" : "Next earnings milestone"}</h3>
        <strong>{monthIsFuture ? `At ${next.deliveryCount} deliveries` : `${next.deliveriesNeeded} more ${next.deliveriesNeeded === 1 ? "delivery" : "deliveries"}`}</strong>
        <p>{next.unlocksHigherRate
          ? `${milestoneRate(next.frontRateBps)} front rate, retroactive to the first sale after selling over ${payPlan.acceleratedThresholdExclusive}.`
          : `Next bonus at ${next.deliveryCount} delivered${monthIsFuture ? ` in ${monthLabel(summary.monthKey)}` : " this month"}.`}</p>
        {!monthIsFuture ? <progress value={summary.deliveredCount} max={next.deliveryCount} aria-label={`${summary.deliveredCount} of ${next.deliveryCount} deliveries toward the next earnings milestone`} /> : null}
      </div>
      <div className="milestone-progress__detail">
        <dl className="milestone-progress__rewards">
          {next.bonusAddedCents > 0 ? <div><dt>Additional volume bonus</dt><dd>+{formatCurrency(next.bonusAddedCents)}<small>When this milestone is reached</small></dd></div> : null}
          {next.unlocksHigherRate && summary.deliveredCount > 0 ? (
            <div><dt>Rate increase on recorded sales</dt><dd>+{formatCurrency(next.recordedRetroactiveCents)}<small>Mini and manual payouts honored</small></dd></div>
          ) : next.unlocksHigherRate ? (
            <div><dt>Higher front rate</dt><dd>{milestoneRate(next.frontRateBps)}<small>Mini and manual payouts honored</small></dd></div>
          ) : null}
        </dl>
        <p className="milestone-progress__note">
          {next.missingFrontGrossCount > 0 ? `Rate increase excludes ${next.missingFrontGrossCount} ${next.missingFrontGrossCount === 1 ? "sale" : "sales"} with unentered front gross. ` : ""}
          Future sale commission is separate.
        </p>
      </div>
    </section>
  );
}
