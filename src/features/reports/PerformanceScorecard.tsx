import { formatCurrency } from "@/domain/money";
import type {
  OutcomePenetrationMetric,
  ReportAnalytics,
} from "@/domain/reportAnalytics";

export interface PerformanceScorecardProps {
  analytics: ReportAnalytics;
  baseline: ReportAnalytics | null;
  baselineLabel: string;
}

type MetricKind = "money" | "products" | "rate";

interface ScorecardValue {
  amount: number | null;
  eligibleDealCount: number;
  note: string;
  incomplete: boolean;
}

interface ScorecardRow {
  label: string;
  kind: MetricKind;
  read: (analytics: ReportAnalytics) => ScorecardValue;
}

function salesLabel(count: number): string {
  return `${count} ${count === 1 ? "sale" : "sales"}`;
}

function outcomeValue(metric: OutcomePenetrationMetric): ScorecardValue {
  return {
    amount: metric.penetrationRate,
    eligibleDealCount: metric.eligibleDealCount,
    note: `${metric.yesCount} of ${salesLabel(metric.eligibleDealCount)}${metric.unmarkedCount > 0 ? ` · ${metric.unmarkedCount} not marked` : ""}`,
    incomplete: metric.unmarkedCount > 0,
  };
}

function grossCoverage(analytics: ReportAnalytics): string {
  const gross = analytics.gross.fi;
  return `Gross entered on ${gross.enteredCount} of ${salesLabel(gross.eligibleDealCount)}`;
}

const ROWS: readonly ScorecardRow[] = [
  {
    label: "F&I gross per sale (PVR)",
    kind: "money",
    read: (analytics) => ({
      amount: analytics.gross.fi.averagePerDeliveredDealCents,
      eligibleDealCount: analytics.population.deliveredDealCount,
      note: grossCoverage(analytics),
      incomplete: analytics.gross.fi.missingCount > 0,
    }),
  },
  {
    label: "F&I commission per sale",
    kind: "money",
    read: (analytics) => ({
      amount: analytics.commission.averageFiCommissionPerDeliveredDealCents,
      eligibleDealCount: analytics.population.deliveredDealCount,
      note: grossCoverage(analytics),
      incomplete: analytics.gross.fi.missingCount > 0,
    }),
  },
  {
    label: "Tracked products per sale (PPD)",
    kind: "products",
    read: (analytics) => ({
      amount: analytics.products.averageProductsPerDeliveredDeal,
      eligibleDealCount: analytics.population.deliveredDealCount,
      note: `${analytics.products.totalProductUnitsSold} products across ${salesLabel(analytics.population.deliveredDealCount)}${analytics.products.incompletelyTrackedDealCount > 0 ? ` · ${analytics.products.incompletelyTrackedDealCount} incomplete` : ""}`,
      incomplete: analytics.products.incompletelyTrackedDealCount > 0,
    }),
  },
  {
    label: "Service contract penetration",
    kind: "rate",
    read: (analytics) => outcomeValue(analytics.products.serviceContract),
  },
  {
    label: "Tire & Wheel penetration",
    kind: "rate",
    read: (analytics) => outcomeValue(analytics.products.tireWheel),
  },
  {
    label: "GAP on Finance sales",
    kind: "rate",
    read: (analytics) => {
      const value = outcomeValue(analytics.finance.gapOnDealerFinanced);
      const financeMissing = analytics.finance.dealerFinance.unmarkedCount;
      return {
        ...value,
        note: `${value.note}${financeMissing > 0 ? ` · Financing not marked on ${salesLabel(financeMissing)}` : ""}`,
        incomplete: value.incomplete || financeMissing > 0,
      };
    },
  },
  {
    label: "Finance Penetration",
    kind: "rate",
    read: (analytics) => outcomeValue(analytics.finance.dealerFinance),
  },
  {
    label: "Deals with tracked products",
    kind: "rate",
    read: (analytics) => {
      const metric = analytics.products.anyProduct;
      return {
        amount: metric.penetrationRate,
        eligibleDealCount: metric.eligibleDealCount,
        note: `${metric.qualifyingDealCount} of ${salesLabel(metric.eligibleDealCount)}${metric.undeterminedDealCount > 0 ? ` · ${metric.undeterminedDealCount} incomplete` : ""}`,
        incomplete: metric.undeterminedDealCount > 0,
      };
    },
  },
];

function valueLabel(amount: number | null, kind: MetricKind): string {
  if (amount === null) return "—";
  if (kind === "money") return formatCurrency(amount, true);
  if (kind === "rate") return `${(amount * 100).toFixed(1)}%`;
  return amount.toFixed(2);
}

function changeLabel(current: ScorecardValue, baseline: ScorecardValue | null, kind: MetricKind): string {
  if (!baseline || current.eligibleDealCount === 0 || baseline.eligibleDealCount === 0) return "—";
  if (current.incomplete || baseline.incomplete) return "Incomplete entries";
  if (current.amount === null || baseline.amount === null) return "—";

  const difference = current.amount - baseline.amount;
  if (kind === "money") {
    const rounded = Math.round(difference);
    return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${formatCurrency(Math.abs(rounded), true)}`;
  }

  const scaled = kind === "rate" ? difference * 100 : difference;
  const precision = kind === "rate" ? 1 : 2;
  const rounded = Number(scaled.toFixed(precision));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(precision)}${kind === "rate" ? " pp" : ""}`;
}

function ValueCell({ value, kind, label }: { value: ScorecardValue | null; kind: MetricKind; label: string }) {
  return (
    <td data-label={label}>
      <strong>{valueLabel(value?.amount ?? null, kind)}</strong>
      {value && <small>{value.note}</small>}
    </td>
  );
}

export function PerformanceScorecard({ analytics, baseline, baselineLabel }: PerformanceScorecardProps) {
  return (
    <details className="fi-performance-comparison">
      <summary>
        <span>Compare with your recent results</span>
        <small>{baseline ? `${baselineLabel} · ${salesLabel(baseline.population.deliveredDealCount)}` : "No earlier delivered sales"}</small>
      </summary>
      <p className="fi-performance-intro">
        {baseline
          ? `Your baseline combines ${salesLabel(baseline.population.deliveredDealCount)} from ${baselineLabel}. It reflects your history, not a target.`
          : "A baseline appears when you have earlier delivered sales to compare."}
        {" "}Per-sale averages include every delivered sale, including incomplete entries. Changes appear only when the relevant entries are complete. Changes in penetration use percentage points (pp).
      </p>
      <table className="fi-performance-table">
        <caption className="sr-only">F&I performance compared with your recent results</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">This period</th>
            <th scope="col">Your baseline</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const current = row.read(analytics);
            const previous = baseline ? row.read(baseline) : null;
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <ValueCell value={current} kind={row.kind} label="This period" />
                <ValueCell value={previous} kind={row.kind} label="Your baseline" />
                <td data-label="Change">{changeLabel(current, previous, row.kind)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
