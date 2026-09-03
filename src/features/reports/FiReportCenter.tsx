import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Filter,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatUnitCredit } from "@/domain/money";
import type {
  FinancingGroupKey,
  ReportAnalytics,
  ReportProductKey,
} from "@/domain/reportAnalytics";
import type { CalculatedSale, Sale } from "@/domain/types";
import { cn } from "@/lib/utils";
import "./reports-center.css";

type EvidenceFilter =
  | "all"
  | ReportProductKey
  | FinancingGroupKey
  | "anyProduct"
  | "confirmedNoProduct"
  | "twoOrMoreProducts"
  | "allThreeProducts"
  | "productUnmarked"
  | "anyOutcomeUnmarked"
  | "fiGrossMissing";

type FiReportView = "overview" | "products" | "financing" | "combinations" | "deals";

const FI_REPORT_VIEWS: ReadonlyArray<{ value: FiReportView; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "products", label: "Products" },
  { value: "financing", label: "Financing" },
  { value: "combinations", label: "Combinations" },
  { value: "deals", label: "Deals" },
];

interface EvidenceFilterOption {
  value: EvidenceFilter;
  label: string;
  matches: (sale: Sale) => boolean;
}

export interface FiReportCenterProps {
  calculatedSales: CalculatedSale[];
  analytics: ReportAnalytics;
  includeLastNames: boolean;
  scopeLabel: string;
  compact?: boolean;
  headingLevel?: 2 | 3;
}

const PRODUCT_FIELDS = [
  "serviceContractSold",
  "tireWheelSold",
  "gapSold",
] as const;

const EVIDENCE_FILTERS: readonly EvidenceFilterOption[] = [
  { value: "all", label: "All delivered sales that count", matches: () => true },
  {
    value: "serviceContract",
    label: "Service contract / warranty sold",
    matches: (sale) => sale.serviceContractSold === true,
  },
  {
    value: "tireWheel",
    label: "Tire & Wheel sold",
    matches: (sale) => sale.tireWheelSold === true,
  },
  { value: "gap", label: "GAP sold", matches: (sale) => sale.gapSold === true },
  {
    value: "dealerFinanced",
    label: "Dealer financed",
    matches: (sale) => sale.dealerFinanced === true,
  },
  {
    value: "notDealerFinanced",
    label: "Not dealer financed",
    matches: (sale) => sale.dealerFinanced === false,
  },
  {
    value: "unmarked",
    label: "Financing answer missing",
    matches: (sale) => typeof sale.dealerFinanced !== "boolean",
  },
  {
    value: "anyProduct",
    label: "At least one product sold",
    matches: (sale) => PRODUCT_FIELDS.some((field) => sale[field] === true),
  },
  {
    value: "confirmedNoProduct",
    label: "No product sold (fully marked)",
    matches: (sale) => PRODUCT_FIELDS.every((field) => sale[field] === false),
  },
  {
    value: "twoOrMoreProducts",
    label: "Two or more products sold",
    matches: (sale) => PRODUCT_FIELDS.filter((field) => sale[field] === true).length >= 2,
  },
  {
    value: "allThreeProducts",
    label: "All three products sold",
    matches: (sale) => PRODUCT_FIELDS.every((field) => sale[field] === true),
  },
  {
    value: "productUnmarked",
    label: "At least one product answer missing",
    matches: (sale) => PRODUCT_FIELDS.some((field) => typeof sale[field] !== "boolean"),
  },
  {
    value: "anyOutcomeUnmarked",
    label: "Any product or financing answer missing",
    matches: (sale) =>
      PRODUCT_FIELDS.some((field) => typeof sale[field] !== "boolean")
      || typeof sale.dealerFinanced !== "boolean",
  },
  {
    value: "fiGrossMissing",
    label: "Total F&I gross missing",
    matches: (sale) => sale.fiGrossCents === null,
  },
] as const;

function rateLabel(rate: number | null, fractionDigits = 0): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(fractionDigits)}%`;
}

function amountLabel(amount: number | null, entered = true): string {
  return !entered || amount === null ? "—" : formatCurrency(amount);
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function outcomeLabel(value: boolean | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Missing";
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="fi-center-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
  action,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="fi-center-section" aria-labelledby={id}>
      <header className="fi-center-section__header">
        <div>
          <h3 id={id}>{title}</h3>
          <p>{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function ViewDealsButton({
  filter,
  label,
  visibleLabel,
  onSelect,
}: {
  filter: EvidenceFilter;
  label: string;
  visibleLabel?: string;
  onSelect: (filter: EvidenceFilter) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="fi-center-view-button"
      onClick={() => onSelect(filter)}
      aria-label={visibleLabel ? `${visibleLabel}: ${label}` : `View deals for ${label}`}
    >
      {visibleLabel ?? "View deals"}
    </Button>
  );
}

function ProductOutcomeBadges({ sale }: { sale: Sale }) {
  return (
    <span className="fi-evidence-outcomes" aria-label="Product outcomes">
      <span data-state={outcomeLabel(sale.serviceContractSold)}>
        Service {outcomeLabel(sale.serviceContractSold)}
      </span>
      <span data-state={outcomeLabel(sale.tireWheelSold)}>
        T&amp;W {outcomeLabel(sale.tireWheelSold)}
      </span>
      <span data-state={outcomeLabel(sale.gapSold)}>
        GAP {outcomeLabel(sale.gapSold)}
      </span>
    </span>
  );
}

export function FiReportCenter({
  calculatedSales,
  analytics,
  includeLastNames,
  scopeLabel,
  compact = false,
  headingLevel = 2,
}: FiReportCenterProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const idPrefix = useId().replaceAll(":", "");
  const [activeView, setActiveView] = useState<FiReportView>("overview");
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("all");
  const [evidenceSearch, setEvidenceSearch] = useState("");
  const evidenceHeadingRef = useRef<HTMLHeadingElement>(null);

  const eligibleDeals = useMemo(
    () => calculatedSales.filter(
      (item) =>
        !item.sale.deletedAt
        && item.sale.status === "delivered"
        && item.countsTowardVolume,
    ),
    [calculatedSales],
  );

  const selectedFilter = EVIDENCE_FILTERS.find((item) => item.value === evidenceFilter)
    ?? EVIDENCE_FILTERS[0];
  const filteredDeals = useMemo(() => {
    const query = evidenceSearch.trim().toLocaleLowerCase();
    return eligibleDeals.filter((item) => {
      if (!selectedFilter.matches(item.sale)) return false;
      if (!query) return true;
      const searchable = [
        item.sale.stockNumber,
        item.sale.vehicleDescription,
        includeLastNames ? item.sale.customerLastName : "",
      ].join(" ").toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [eligibleDeals, evidenceSearch, includeLastNames, selectedFilter]);

  const selectEvidence = (filter: EvidenceFilter) => {
    setActiveView("deals");
    setEvidenceFilter(filter);
    setEvidenceSearch("");
    window.requestAnimationFrame(() => {
      evidenceHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      evidenceHeadingRef.current?.focus({ preventScroll: true });
    });
  };

  const productTrackingRate = analytics.quality.eligibleDealCount === 0
    ? null
    : analytics.quality.recordedProductOutcomeCount
      / (analytics.quality.eligibleDealCount * PRODUCT_FIELDS.length);
  const financeTrackingRate = analytics.finance.dealerFinance.trackingCompletionRate;
  const hasMissingDetails = analytics.quality.unmarkedProductOutcomeCount > 0
    || analytics.quality.unmarkedFinanceOutcomeCount > 0
    || analytics.quality.fiGrossMissingCount > 0
    || analytics.quality.frontGrossMissingCount > 0;

  const exactMixRows = [
    ["No products", analytics.products.exactMix.noProducts],
    ["Service contract / warranty only", analytics.products.exactMix.serviceContractOnly],
    ["Tire & Wheel only", analytics.products.exactMix.tireWheelOnly],
    ["GAP only", analytics.products.exactMix.gapOnly],
    ["Service contract + Tire & Wheel only", analytics.products.exactMix.serviceContractAndTireWheel],
    ["Service contract + GAP only", analytics.products.exactMix.serviceContractAndGap],
    ["Tire & Wheel + GAP only", analytics.products.exactMix.tireWheelAndGap],
    ["All three products", analytics.products.exactMix.allThreeProducts],
    ["Missing product answers", analytics.products.exactMix.incompleteTracking],
  ] as const;

  return (
    <div className={cn("fi-report-center", compact && "is-compact")}>
      <header className="fi-center-heading">
        <div>
          <span className="fi-center-eyebrow">F&amp;I performance</span>
          <Heading>Products, financing, and total F&amp;I gross</Heading>
          <p>
            {scopeLabel} · Percentages are based on {countLabel(analytics.population.deliveredDealCount, "delivered sale")} that count.
          </p>
        </div>
        <span className="fi-center-scope-badge">{scopeLabel}</span>
      </header>

      <div
        className="fi-center-jump-nav"
        role="tablist"
        aria-label="F&I report sections"
        onKeyDown={(event) => {
          if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const currentIndex = FI_REPORT_VIEWS.findIndex((view) => view.value === activeView);
          let nextIndex = currentIndex;
          if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % FI_REPORT_VIEWS.length;
          if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + FI_REPORT_VIEWS.length) % FI_REPORT_VIEWS.length;
          if (event.key === "Home") nextIndex = 0;
          if (event.key === "End") nextIndex = FI_REPORT_VIEWS.length - 1;
          if (nextIndex === currentIndex) return;
          const nextView = FI_REPORT_VIEWS[nextIndex];
          setActiveView(nextView.value);
          window.requestAnimationFrame(() => {
            document.getElementById(`${idPrefix}-${nextView.value}-tab`)?.focus();
          });
        }}
      >
        {FI_REPORT_VIEWS.map((view) => (
          <button
            key={view.value}
            type="button"
            role="tab"
            id={`${idPrefix}-${view.value}-tab`}
            aria-controls={`${idPrefix}-${view.value}-panel`}
            aria-selected={activeView === view.value}
            tabIndex={activeView === view.value ? 0 : -1}
            onClick={() => setActiveView(view.value)}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="fi-center-kpis" aria-label="F&I summary">
        <Metric
          label="Total F&I gross"
          value={formatCurrency(analytics.gross.fi.totalCents)}
          note={`${analytics.gross.fi.enteredCount} of ${analytics.gross.fi.eligibleDealCount} deals entered`}
        />
        <Metric
          label="1+ products sold"
          value={rateLabel(analytics.products.anyProduct.penetrationRate)}
          note={`${analytics.products.anyProduct.qualifyingDealCount} of ${analytics.products.anyProduct.eligibleDealCount} deals`}
        />
        <Metric
          label="Dealer-financed sales"
          value={rateLabel(analytics.finance.dealerFinance.penetrationRate)}
          note={`${analytics.finance.dealerFinance.yesCount} of ${analytics.finance.dealerFinance.eligibleDealCount} deals`}
        />
        <Metric
          label="Avg. products per sale"
          value={analytics.products.averageProductsPerDeliveredDeal?.toFixed(2) ?? "—"}
          note={`${analytics.products.totalProductUnitsSold} product units sold`}
        />
        <Metric
          label="Est. F&I commission"
          value={formatCurrency(analytics.commission.fiCommissionCents)}
          note={`${rateLabel(analytics.gross.fi.positiveAmountPenetrationRate)} of deals have positive F&I gross`}
        />
      </div>

      <div
        id={`${idPrefix}-products-panel`}
        className="fi-center-view"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-products-tab`}
        hidden={activeView !== "products"}
      >
        <Section
          id={`${idPrefix}-products`}
          title="Products sold"
          description="See product volume, penetration, and whether every delivered sale has been marked Yes or No."
        >
        <div className="fi-center-table-wrap fi-center-desktop-table" tabIndex={0}>
          <table className="fi-center-table fi-center-product-table">
            <caption className="sr-only">F&amp;I product performance for {scopeLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Sold</th>
                <th scope="col">Penetration</th>
                <th scope="col">Yes / No</th>
                <th scope="col">Details complete</th>
                <th scope="col" aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {analytics.productRows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td><strong>{row.soldCount}</strong> / {row.eligibleDealCount}</td>
                  <td><strong>{rateLabel(row.penetrationRate)}</strong></td>
                  <td>
                    <span className="fi-center-cell-stack">
                      <span>{row.soldCount} Yes · {row.noCount} No</span>
                      <small>{row.unmarkedCount} missing</small>
                    </span>
                  </td>
                  <td>
                    <span className="fi-center-cell-stack">
                      <strong>{rateLabel(row.trackingCompletionRate)}</strong>
                      <small>{row.recordedCount} of {row.eligibleDealCount} complete</small>
                    </span>
                  </td>
                  <td>
                    <ViewDealsButton
                      filter={row.key}
                      label={row.label}
                      visibleLabel={`View ${row.key === "serviceContract" ? "service" : row.key === "tireWheel" ? "T&W" : "GAP"}`}
                      onSelect={selectEvidence}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="fi-center-phone-disclosures">
          {analytics.productRows.map((row) => (
            <details key={row.key} className="fi-center-mobile-detail">
              <summary>
                <span>
                  <strong>{row.label}</strong>
                  <small>{row.soldCount} of {row.eligibleDealCount} sold</small>
                </span>
                <span className="fi-center-summary-rate">{rateLabel(row.penetrationRate)}</span>
                <ChevronDown aria-hidden="true" />
              </summary>
              <dl>
                <div><dt>Yes / No</dt><dd>{row.soldCount} Yes · {row.noCount} No · {row.unmarkedCount} missing</dd></div>
                <div><dt>Details complete</dt><dd>{rateLabel(row.trackingCompletionRate)} · {row.recordedCount} of {row.eligibleDealCount}</dd></div>
              </dl>
              <ViewDealsButton filter={row.key} label={row.label} onSelect={selectEvidence} />
            </details>
          ))}
        </div>
        </Section>
      </div>

      <div
        id={`${idPrefix}-financing-panel`}
        className="fi-center-view"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-financing-tab`}
        hidden={activeView !== "financing"}
      >
      <Section
        id={`${idPrefix}-financing`}
        title="Financing"
        description="See how many delivered sales were financed through the dealership and how products performed on those sales."
      >
        <div className="fi-center-table-wrap fi-center-desktop-table" tabIndex={0}>
          <table className="fi-center-table fi-center-finance-table">
            <caption className="sr-only">Dealer financing cohorts for {scopeLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Financing</th>
                <th scope="col">Deals</th>
                <th scope="col">Share of delivered</th>
                <th scope="col">Any product</th>
                <th scope="col">Product units</th>
                <th scope="col">Total F&amp;I gross</th>
                <th scope="col">Average per deal</th>
                <th scope="col" aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {analytics.financingRows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.dealCount}</td>
                  <td><strong>{rateLabel(row.shareOfDeliveredDealsRate)}</strong></td>
                  <td>{row.products.anyProduct.qualifyingDealCount} · {rateLabel(row.products.anyProduct.penetrationRate)}</td>
                  <td>{row.products.totalProductUnitsSold} · {row.products.averageProductsPerDeliveredDeal?.toFixed(2) ?? "—"} / deal</td>
                  <td>
                    <span className="fi-center-cell-stack">
                      <strong>{formatCurrency(row.fiGrossCents)}</strong>
                      <small>{row.fiGrossEnteredCount} entered · {row.fiGrossMissingCount} missing</small>
                    </span>
                  </td>
                  <td>{amountLabel(row.averageFiGrossPerDealCents)}</td>
                  <td><ViewDealsButton filter={row.key} label={row.label} visibleLabel={`View ${row.label.toLocaleLowerCase()}`} onSelect={selectEvidence} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="fi-center-phone-disclosures">
          {analytics.financingRows.map((row) => (
            <details key={row.key} className="fi-center-mobile-detail">
              <summary>
                <span>
                  <strong>{row.label}</strong>
                  <small>{row.dealCount} of {analytics.population.deliveredDealCount} deals</small>
                </span>
                <span className="fi-center-summary-rate">{rateLabel(row.shareOfDeliveredDealsRate)}</span>
                <ChevronDown aria-hidden="true" />
              </summary>
              <dl>
                <div><dt>Any product</dt><dd>{row.products.anyProduct.qualifyingDealCount} · {rateLabel(row.products.anyProduct.penetrationRate)}</dd></div>
                <div><dt>Product units</dt><dd>{row.products.totalProductUnitsSold} · {row.products.averageProductsPerDeliveredDeal?.toFixed(2) ?? "—"} / deal</dd></div>
                <div><dt>Total F&amp;I gross</dt><dd>{formatCurrency(row.fiGrossCents)} · {row.fiGrossEnteredCount} entered</dd></div>
                <div><dt>Average F&amp;I / deal</dt><dd>{amountLabel(row.averageFiGrossPerDealCents)}</dd></div>
              </dl>
              <ViewDealsButton filter={row.key} label={row.label} onSelect={selectEvidence} />
            </details>
          ))}
        </div>
      </Section>
      </div>

      <div
        id={`${idPrefix}-combinations-panel`}
        className="fi-center-view"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-combinations-tab`}
        hidden={activeView !== "combinations"}
      >
      <Section
        id={`${idPrefix}-mix`}
        title="Product combinations"
        description="See how often products were sold together. An all-three sale also counts in each matching two-product combination."
      >
        <div className="fi-center-split-grid">
          <div className="fi-center-panel">
            <h4>Attachment levels</h4>
            <dl className="fi-center-row-list">
              <div>
                <dt>At least one product</dt>
                <dd>{analytics.products.anyProduct.qualifyingDealCount} · {rateLabel(analytics.products.anyProduct.penetrationRate)}</dd>
              </div>
              <div>
                <dt>Two or more products</dt>
                <dd>{analytics.products.twoOrMoreProducts.qualifyingDealCount} · {rateLabel(analytics.products.twoOrMoreProducts.penetrationRate)}</dd>
              </div>
              <div>
                <dt>All three products</dt>
                <dd>{analytics.products.allThreeProducts.qualifyingDealCount} · {rateLabel(analytics.products.allThreeProducts.penetrationRate)}</dd>
              </div>
              <div>
                <dt>Confirmed no product</dt>
                <dd>{analytics.products.confirmedNoProductDealCount}</dd>
              </div>
              <div>
                <dt>Missing product answers</dt>
                <dd>{analytics.products.anyProduct.undeterminedDealCount}</dd>
              </div>
            </dl>
            <div className="fi-center-panel-actions" role="group" aria-label="Attachment level deal shortcuts">
              <ViewDealsButton
                filter="anyProduct"
                label="at least one product sold"
                visibleLabel={`View ${countLabel(analytics.products.anyProduct.qualifyingDealCount, "deal")}: 1+ products`}
                onSelect={selectEvidence}
              />
              <ViewDealsButton
                filter="twoOrMoreProducts"
                label="two or more products sold"
                visibleLabel={`View ${countLabel(analytics.products.twoOrMoreProducts.qualifyingDealCount, "deal")}: 2+ products`}
                onSelect={selectEvidence}
              />
              <ViewDealsButton
                filter="allThreeProducts"
                label="all three products sold"
                visibleLabel={`View ${countLabel(analytics.products.allThreeProducts.qualifyingDealCount, "deal")}: all 3 products`}
                onSelect={selectEvidence}
              />
              <ViewDealsButton
                filter="confirmedNoProduct"
                label="confirmed no products sold"
                visibleLabel={`View ${countLabel(analytics.products.confirmedNoProductDealCount, "deal")}: no products`}
                onSelect={selectEvidence}
              />
            </div>
          </div>

          <div className="fi-center-panel">
            <h4>Inclusive bundles</h4>
            <div
              className="fi-center-compact-table-wrap"
              role="region"
              aria-label={`${scopeLabel} inclusive product bundles table`}
              tabIndex={0}
            >
              <table className="fi-center-table fi-center-compact-table">
                <caption className="sr-only">Inclusive product bundles</caption>
                <thead>
                  <tr><th scope="col">Combination</th><th scope="col">Sales</th><th scope="col">Penetration</th></tr>
                </thead>
                <tbody>
                  {analytics.bundleRows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>{row.dealCount}</td>
                      <td>{rateLabel(row.penetrationRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <details className="fi-center-exact-mix">
          <summary>
            <span><strong>Exact product mix</strong><small>Mutually exclusive groups; incomplete records stay separate</small></span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="fi-center-exact-grid">
            {exactMixRows.map(([label, count]) => (
              <div key={label}><span>{label}</span><strong>{count}</strong></div>
            ))}
          </div>
        </details>
      </Section>
      </div>

      <div
        id={`${idPrefix}-overview-panel`}
        className="fi-center-view"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-overview-tab`}
        hidden={activeView !== "overview"}
      >
        <Section
          id={`${idPrefix}-money`}
          title="F&I gross & commission"
          description="One total F&I gross amount is tracked for each sale. That amount is used to estimate F&I commission."
        >
        <div className="fi-center-split-grid">
          <details className="fi-center-panel fi-center-money-detail">
            <summary>
              <span><strong>Gross details</strong><small>Front, F&amp;I, averages, and mix</small></span>
              <span>{formatCurrency(analytics.gross.totalGrossCents)}</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <dl className="fi-center-row-list">
              <div><dt>Front gross</dt><dd>{formatCurrency(analytics.gross.front.totalCents)}</dd></div>
              <div><dt>Total F&amp;I gross</dt><dd>{formatCurrency(analytics.gross.fi.totalCents)}</dd></div>
              <div className="is-total"><dt>Combined recorded gross</dt><dd>{formatCurrency(analytics.gross.totalGrossCents)}</dd></div>
              <div><dt>Average front gross / deal</dt><dd>{amountLabel(analytics.gross.front.averagePerDeliveredDealCents)}</dd></div>
              <div><dt>Average F&amp;I gross / deal</dt><dd>{amountLabel(analytics.gross.fi.averagePerDeliveredDealCents)}</dd></div>
              <div><dt>F&amp;I share of combined gross</dt><dd>{rateLabel(analytics.gross.fiShareOfTotalGrossRate, 1)}</dd></div>
              <div><dt>Positive F&amp;I gross deals</dt><dd>{analytics.gross.fi.positiveCount} · {rateLabel(analytics.gross.fi.positiveAmountPenetrationRate)}</dd></div>
            </dl>
          </details>

          <details className="fi-center-panel fi-center-money-detail">
            <summary>
              <span><strong>Commission details</strong><small>Front, F&amp;I, bonus, and payroll</small></span>
              <span>{formatCurrency(analytics.commission.estimatedCommissionCents)}</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <dl className="fi-center-row-list">
              <div><dt>Front commission</dt><dd>{formatCurrency(analytics.commission.frontCommissionCents)}</dd></div>
              <div><dt>F&amp;I commission</dt><dd>{formatCurrency(analytics.commission.fiCommissionCents)}</dd></div>
              <div><dt>Core commission</dt><dd>{formatCurrency(analytics.commission.coreCommissionCents)}</dd></div>
              <div><dt>Bonus included</dt><dd>{formatCurrency(analytics.commission.bonusIncludedCents)}</dd></div>
              <div className="is-total"><dt>Estimated commission</dt><dd>{formatCurrency(analytics.commission.estimatedCommissionCents)}</dd></div>
              <div><dt>Average estimated / deal</dt><dd>{amountLabel(analytics.commission.averageEstimatedCommissionPerDeliveredDealCents)}</dd></div>
              <div><dt>Actual paid</dt><dd>{amountLabel(analytics.commission.actualPaidCents, analytics.commission.actualPaidCents !== null)}</dd></div>
              <div><dt>Payroll variance</dt><dd>{amountLabel(analytics.commission.payrollVarianceCents, analytics.commission.payrollVarianceCents !== null)}</dd></div>
            </dl>
          </details>
        </div>

        </Section>

        <Section
          id={`${idPrefix}-quality`}
          title="Missing details"
          description="Missing answers stay separate from No so the percentages remain honest."
        >
        {hasMissingDetails ? <div className="fi-center-quality-grid">
          <div className="fi-center-quality-item">
            <span className="fi-center-quality-icon" data-ready={analytics.quality.incompletelyTrackedProductDealCount === 0}>
              {analytics.quality.incompletelyTrackedProductDealCount === 0 ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            </span>
            <div><strong>Product answers</strong><span>{rateLabel(productTrackingRate)} complete</span><small>{analytics.quality.unmarkedProductOutcomeCount} of {analytics.quality.eligibleDealCount * 3} answers missing</small></div>
            {analytics.quality.unmarkedProductOutcomeCount > 0 ? <ViewDealsButton filter="productUnmarked" label="deals with unmarked products" onSelect={selectEvidence} /> : null}
          </div>
          <div className="fi-center-quality-item">
            <span className="fi-center-quality-icon" data-ready={analytics.quality.unmarkedFinanceOutcomeCount === 0}>
              {analytics.quality.unmarkedFinanceOutcomeCount === 0 ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            </span>
            <div><strong>Financing answers</strong><span>{rateLabel(financeTrackingRate)} complete</span><small>{analytics.quality.unmarkedFinanceOutcomeCount} of {analytics.quality.eligibleDealCount} answers missing</small></div>
            {analytics.quality.unmarkedFinanceOutcomeCount > 0 ? <ViewDealsButton filter="unmarked" label="deals with unmarked financing" onSelect={selectEvidence} /> : null}
          </div>
          <div className="fi-center-quality-item">
            <span className="fi-center-quality-icon" data-ready={analytics.quality.fiGrossMissingCount === 0}>
              {analytics.quality.fiGrossMissingCount === 0 ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            </span>
            <div><strong>Total F&amp;I gross</strong><span>{analytics.quality.fiGrossEnteredCount} of {analytics.quality.eligibleDealCount} entered</span><small>{analytics.quality.fiGrossMissingCount} missing · $0 stays distinct from missing</small></div>
            {analytics.quality.fiGrossMissingCount > 0 ? <ViewDealsButton filter="fiGrossMissing" label="deals missing total F&I gross" onSelect={selectEvidence} /> : null}
          </div>
          <div className="fi-center-quality-item">
            <span className="fi-center-quality-icon" data-ready={analytics.quality.frontGrossMissingCount === 0}>
              {analytics.quality.frontGrossMissingCount === 0 ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
            </span>
            <div><strong>Front gross</strong><span>{analytics.quality.frontGrossEnteredCount} of {analytics.quality.eligibleDealCount} entered</span><small>{analytics.quality.frontGrossMissingCount} missing · $0 stays distinct from missing</small></div>
          </div>
        </div> : (
          <div className="fi-center-all-clear">
            <CheckCircle2 aria-hidden="true" />
            <span><strong>All F&amp;I details are complete</strong><small>Products, financing, front gross, and total F&amp;I gross are entered for all {analytics.quality.eligibleDealCount} delivered sales.</small></span>
          </div>
        )}
        </Section>
      </div>

      <section
        id={`${idPrefix}-deals-panel`}
        className="fi-center-section fi-center-evidence fi-center-view"
        role="tabpanel"
        aria-labelledby={`${idPrefix}-deals-tab`}
        hidden={activeView !== "deals"}
      >
        <header className="fi-center-section__header">
          <div>
            <h3 id={`${idPrefix}-evidence`} ref={evidenceHeadingRef} tabIndex={-1}>Deals behind these totals</h3>
            <p>Filter the delivered sales in {scopeLabel} to verify any result above.</p>
          </div>
          <span className="fi-center-result-count" aria-live="polite">{filteredDeals.length} of {eligibleDeals.length} deals</span>
        </header>

        <div className="fi-center-evidence-controls">
          <label>
            <span><Filter aria-hidden="true" /> Show</span>
            <select value={evidenceFilter} onChange={(event) => setEvidenceFilter(event.target.value as EvidenceFilter)}>
              {EVIDENCE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span><Search aria-hidden="true" /> Find a deal</span>
            <Input
              type="search"
              value={evidenceSearch}
              onChange={(event) => setEvidenceSearch(event.target.value)}
              placeholder={includeLastNames ? "Stock, vehicle, or last name" : "Stock or vehicle"}
            />
          </label>
        </div>

        <p className="fi-center-filter-summary" aria-live="polite">
          Showing <strong>{selectedFilter.label}</strong>{evidenceSearch.trim() ? ` matching “${evidenceSearch.trim()}”` : ""}.
        </p>

        {filteredDeals.length === 0 ? (
          <div className="fi-center-empty">
            <strong>No deals match this view</strong>
            <p>Change the filter or clear the search to see other eligible deals.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setEvidenceFilter("all"); setEvidenceSearch(""); }}>
              Show all deals
            </Button>
          </div>
        ) : (
          <>
            <div className="fi-center-table-wrap fi-center-evidence-table" tabIndex={0}>
              <table className="fi-center-table">
                <caption className="sr-only">Filtered deal evidence for {scopeLabel}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    {includeLastNames ? <th scope="col">Customer</th> : null}
                    <th scope="col">Stock</th>
                    <th scope="col">Vehicle</th>
                    <th scope="col">Products</th>
                    <th scope="col">Financing</th>
                    <th scope="col">F&amp;I gross</th>
                    <th scope="col">Credited units</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((item) => (
                    <tr key={item.sale.id}>
                      <td>{format(parseISO(item.sale.saleDate), "MMM d")}</td>
                      {includeLastNames ? <td>{item.sale.customerLastName || "—"}</td> : null}
                      <th scope="row">{item.sale.stockNumber || "—"}</th>
                      <td>{item.sale.vehicleDescription || "—"}</td>
                      <td><ProductOutcomeBadges sale={item.sale} /></td>
                      <td><span className="fi-evidence-finance" data-state={outcomeLabel(item.sale.dealerFinanced)}>{outcomeLabel(item.sale.dealerFinanced)}</span></td>
                      <td>{item.sale.fiGrossCents === null ? "Not entered" : formatCurrency(item.sale.fiGrossCents)}</td>
                      <td>{formatUnitCredit(item.sale.unitCreditBasis)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fi-center-evidence-cards">
              {filteredDeals.map((item) => (
                <article key={item.sale.id} className="fi-evidence-card">
                  <header>
                    <div><strong>{item.sale.stockNumber || "No stock number"}</strong><span>{format(parseISO(item.sale.saleDate), "MMM d")}</span></div>
                    <span>{formatUnitCredit(item.sale.unitCreditBasis)} units</span>
                  </header>
                  <p>{item.sale.vehicleDescription || "Vehicle not entered"}</p>
                  {includeLastNames ? <small>Customer: {item.sale.customerLastName || "Not entered"}</small> : null}
                  <ProductOutcomeBadges sale={item.sale} />
                  <dl>
                    <div><dt>Dealer financed</dt><dd>{outcomeLabel(item.sale.dealerFinanced)}</dd></div>
                    <div><dt>Total F&amp;I gross</dt><dd>{item.sale.fiGrossCents === null ? "Not entered" : formatCurrency(item.sale.fiGrossCents)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
