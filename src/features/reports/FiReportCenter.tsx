import { useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Filter,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSaleDate } from "@/domain/date";
import { dealerFinancingOutcome, getPaymentMethod, paymentMethodLabel } from "@/domain/financing";
import { formatCurrency, formatUnitCredit } from "@/domain/money";
import type {
  FinancingGroupKey,
  ReportAnalytics,
  ReportProductKey,
} from "@/domain/reportAnalytics";
import type { CalculatedSale, Sale } from "@/domain/types";
import { cn } from "@/lib/utils";
import { PerformanceScorecard } from "./PerformanceScorecard";
import { MetricGuide } from "./MetricGuide";
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
  baseline?: ReportAnalytics | null;
  baselineLabel?: string;
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

export function ReportSaleButton({ sale, onOpenSale }: { sale: Sale; onOpenSale: (sale: Sale) => void }) {
  const label = sale.stockNumber.trim() || "No stock number";
  return (
    <button
      type="button"
      className="report-open-sale"
      aria-label={sale.stockNumber.trim() ? `Open sale ${sale.stockNumber.trim()}` : `Open sale: No stock number, ${formatSaleDate(sale.saleDate)}`}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        onOpenSale(sale);
      }}
    >
      {label}
    </button>
  );
}

export function ReportSaleIdentity({ sale, includeLastNames }: { sale: Sale; includeLastNames: boolean }) {
  const vehicle = sale.vehicleDescription.trim() || "Vehicle not entered";
  return (
    <div className="report-sale-identity">
      <strong className="report-sale-identity__primary">{includeLastNames ? sale.customerLastName.trim() || "Customer not entered" : vehicle}</strong>
      {includeLastNames ? <span className="report-sale-identity__vehicle">{vehicle}</span> : null}
    </div>
  );
}

export function ReportSaleMetadata({ sale, onOpenSale, stacked = false }: { sale: Sale; onOpenSale: (sale: Sale) => void; stacked?: boolean }) {
  return (
    <div className={cn("report-sale-meta", stacked && "report-sale-meta--stacked")}>
      <span className="report-sale-meta__stock">
        {sale.stockNumber.trim() ? <span>Stock</span> : null}
        <ReportSaleButton sale={sale} onOpenSale={onOpenSale} />
      </span>
      <time dateTime={sale.saleDate}>{formatSaleDate(sale.saleDate)}</time>
    </div>
  );
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
    label: "Finance",
    matches: (sale) => getPaymentMethod(sale) === "dealer_financed",
  },
  {
    value: "cash",
    label: "Cash",
    matches: (sale) => getPaymentMethod(sale) === "cash",
  },
  {
    value: "outsideFinancing",
    label: "Outside Finance",
    matches: (sale) => getPaymentMethod(sale) === "outside_financing",
  },
  {
    value: "notDealerFinanced",
    label: "Cash / outside not specified",
    matches: (sale) => getPaymentMethod(sale) === "not_dealer_financed",
  },
  {
    value: "unmarked",
    label: "Financing answer missing",
    matches: (sale) => getPaymentMethod(sale) === "unmarked",
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
      || dealerFinancingOutcome(sale) === undefined,
  },
  {
    value: "fiGrossMissing",
    label: "Awaiting F&I gross",
    matches: (sale) => sale.fiGrossCents === null,
  },
] as const;

function rateLabel(rate: number | null, fractionDigits = 0): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(fractionDigits)}%`;
}

function amountLabel(amount: number | null, entered = true): string {
  return !entered || amount === null ? "—" : formatCurrency(amount);
}

function grossCoverage(entered: number, total: number): string {
  if (!total) return "No delivered sales in this period";
  return entered === total ? `Gross entered on all ${total} sales` : `Partial · gross entered on ${entered} of ${total} sales`;
}

function outcomeNote(count: number, total: number, missing: number): string {
  return `${count} of ${total} sales${missing ? ` · ${missing} unmarked` : ""}`;
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
  baseline = null,
  baselineLabel = "No earlier covered months",
  onOpenSale,
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
  const financingRows = analytics.financingRows.filter((row) =>
    row.dealCount > 0 || (row.key !== "notDealerFinanced" && row.key !== "unmarked"),
  );
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
          label="F&I gross per sale (PVR)"
          value={amountLabel(analytics.gross.fi.averagePerDeliveredDealCents, analytics.gross.fi.enteredCount > 0)}
          note={`${amountLabel(analytics.gross.fi.totalCents, analytics.gross.fi.enteredCount > 0)} total recorded · ${analytics.gross.fi.enteredCount}/${analytics.gross.fi.eligibleDealCount} entered`}
        />
        <Metric
          label="Deals with tracked products"
          value={rateLabel(analytics.products.anyProduct.penetrationRate)}
          note={outcomeNote(analytics.products.anyProduct.qualifyingDealCount, analytics.products.anyProduct.eligibleDealCount, analytics.products.anyProduct.undeterminedDealCount)}
        />
        <Metric
          label="Finance Penetration"
          value={rateLabel(analytics.finance.dealerFinance.penetrationRate)}
          note={outcomeNote(analytics.finance.dealerFinance.yesCount, analytics.finance.dealerFinance.eligibleDealCount, analytics.finance.dealerFinance.unmarkedCount)}
        />
        <Metric
          label="Tracked products per sale (PPD)"
          value={analytics.products.averageProductsPerDeliveredDeal?.toFixed(2) ?? "—"}
          note={`${analytics.products.totalProductUnitsSold} products · ${analytics.products.incompletelyTrackedDealCount ? `${analytics.products.incompletelyTrackedDealCount} sales incomplete` : "3 categories tracked"}`}
        />
        <Metric
          label="Est. F&I commission"
          value={amountLabel(analytics.commission.fiCommissionCents, analytics.gross.fi.enteredCount > 0)}
          note={`${amountLabel(analytics.commission.averageFiCommissionPerDeliveredDealCents)} per delivered sale`}
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
          description="Penetration is each product's sold count divided by all delivered sales."
        >
        <div className="fi-center-table-wrap fi-center-desktop-table" tabIndex={0}>
          <table className="fi-center-table fi-center-product-table">
            <caption className="sr-only">F&amp;I product performance for {scopeLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Sold</th>
                <th scope="col">Penetration <span className="fi-center-column-note">% of all sales</span></th>
                <th scope="col" aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {analytics.productRows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.label}
                    {row.unmarkedCount > 0 && <small className="fi-product-missing">{countLabel(row.unmarkedCount, "answer")} missing</small>}
                  </th>
                  <td><strong>{row.soldCount}</strong> / {row.eligibleDealCount}</td>
                  <td><strong>{rateLabel(row.penetrationRate)}</strong></td>
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
            <article key={row.key} className="fi-center-product-card">
              <div>
                <strong>{row.label}</strong>
                <small>{row.soldCount} of {row.eligibleDealCount} sold</small>
                {row.unmarkedCount > 0 && <small className="fi-product-missing">{countLabel(row.unmarkedCount, "answer")} missing</small>}
              </div>
              <span className="fi-center-summary-rate" aria-label={`${rateLabel(row.penetrationRate)} of all sales`}>{rateLabel(row.penetrationRate)}</span>
              <ViewDealsButton filter={row.key} label={row.label} onSelect={selectEvidence} />
            </article>
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
        description="Compare dealership financing, cash, and outside financing. Finance Penetration uses all delivered sales; product rates within each group use that group's sales."
      >
        <div className="fi-finance-highlight">
          <div>
            <strong>GAP on dealer-financed sales</strong>
            <p>{outcomeNote(analytics.finance.gapOnDealerFinanced.yesCount, analytics.finance.gapOnDealerFinanced.eligibleDealCount, analytics.finance.gapOnDealerFinanced.unmarkedCount)} · GAP marked sold within dealer-financed sales</p>
          </div>
          <strong>{rateLabel(analytics.finance.gapOnDealerFinanced.penetrationRate, 1)}</strong>
        </div>
        <div className="fi-center-table-wrap fi-center-desktop-table" tabIndex={0}>
          <table className="fi-center-table fi-center-finance-table">
            <caption className="sr-only">Dealer financing cohorts for {scopeLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Financing</th>
                <th scope="col">Deals</th>
                <th scope="col">Share of delivered</th>
                <th scope="col">1+ tracked products</th>
                <th scope="col">Tracked products</th>
                <th scope="col">Total F&amp;I gross</th>
                <th scope="col">F&amp;I per sale</th>
                <th scope="col" aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {financingRows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.dealCount}</td>
                  <td><strong>{rateLabel(row.shareOfDeliveredDealsRate)}</strong></td>
                  <td>{row.products.anyProduct.qualifyingDealCount} · {rateLabel(row.products.anyProduct.penetrationRate)}</td>
                  <td>{row.products.totalProductUnitsSold} · {row.products.averageProductsPerDeliveredDeal?.toFixed(2) ?? "—"} / deal</td>
                  <td>
                    <span className="fi-center-cell-stack">
                      <strong>{amountLabel(row.fiGrossCents, row.fiGrossEnteredCount > 0)}</strong>
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
          {financingRows.map((row) => (
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
                <div><dt>1+ tracked products</dt><dd>{row.products.anyProduct.qualifyingDealCount} · {rateLabel(row.products.anyProduct.penetrationRate)}</dd></div>
                <div><dt>Tracked products</dt><dd>{row.products.totalProductUnitsSold} · {row.products.averageProductsPerDeliveredDeal?.toFixed(2) ?? "—"} / sale</dd></div>
                <div><dt>Total F&amp;I gross</dt><dd>{amountLabel(row.fiGrossCents, row.fiGrossEnteredCount > 0)} · {row.fiGrossEnteredCount} entered · {row.fiGrossMissingCount} missing</dd></div>
                <div><dt>F&amp;I gross per sale</dt><dd>{amountLabel(row.averageFiGrossPerDealCents)}</dd></div>
              </dl>
              <ViewDealsButton filter={row.key} label={row.label} onSelect={selectEvidence} />
            </details>
          ))}
        </div>
        <details className="fi-center-exact-mix">
          <summary><span><strong>Products by financing group</strong><small>Sold ÷ sales within each financing group</small></span><ChevronDown aria-hidden="true" /></summary>
          <table className="fi-center-table fi-finance-products-table">
            <caption className="sr-only">Product penetration within financing groups</caption>
            <thead><tr><th scope="col">Financing</th><th scope="col">Service contract</th><th scope="col">Tire &amp; Wheel</th><th scope="col">GAP</th></tr></thead>
            <tbody>{financingRows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {(["serviceContract", "tireWheel", "gap"] as const).map((product) => (
                  <td key={product}><span className="fi-center-cell-stack"><strong>{rateLabel(row.products[product].penetrationRate)}</strong><small>{row.products[product].yesCount} of {row.dealCount}{row.products[product].unmarkedCount ? ` · ${row.products[product].unmarkedCount} unmarked` : ""}</small></span></td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </details>
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
                <dt>No tracked products sold</dt>
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
          description={grossCoverage(analytics.gross.fi.enteredCount, analytics.gross.fi.eligibleDealCount)}
        >
        <div className="fi-center-split-grid fi-center-money-grid">
          <section className="fi-center-panel fi-center-money-detail" aria-labelledby={`${idPrefix}-gross-details-heading`}>
            <header className="fi-center-money-header">
              <div><h4 id={`${idPrefix}-gross-details-heading`}>Gross details</h4><small>Front, F&amp;I, averages, and mix</small></div>
              <span>{formatCurrency(analytics.gross.totalGrossCents)}</span>
            </header>
            <dl className="fi-center-row-list">
              <div><dt>Recorded front gross</dt><dd>{amountLabel(analytics.gross.front.totalCents, analytics.gross.front.enteredCount > 0)}</dd></div>
              <div><dt>Commissionable front gross<small>Negative gross excluded; payouts calculated per sale</small></dt><dd>{amountLabel(analytics.commission.commissionableFrontGrossCents, analytics.gross.front.enteredCount > 0)}</dd></div>
              <div><dt>Recorded total F&amp;I gross</dt><dd>{amountLabel(analytics.gross.fi.totalCents, analytics.gross.fi.enteredCount > 0)}</dd></div>
              <div className="is-total"><dt>Combined recorded gross</dt><dd>{formatCurrency(analytics.gross.totalGrossCents)}</dd></div>
              <div><dt>Front gross per sale</dt><dd>{amountLabel(analytics.gross.front.averagePerDeliveredDealCents)}</dd></div>
              <div><dt>F&amp;I gross per sale (PVR)</dt><dd>{amountLabel(analytics.gross.fi.averagePerDeliveredDealCents)}</dd></div>
              <div><dt>Combined gross per sale</dt><dd>{amountLabel(analytics.gross.averageTotalGrossPerDeliveredDealCents)}</dd></div>
              <div><dt>F&amp;I commission per sale</dt><dd>{amountLabel(analytics.commission.averageFiCommissionPerDeliveredDealCents)}</dd></div>
            </dl>
          </section>

          <section className="fi-center-panel fi-center-money-detail" aria-labelledby={`${idPrefix}-commission-details-heading`}>
            <header className="fi-center-money-header">
              <div><h4 id={`${idPrefix}-commission-details-heading`}>Commission details</h4><small>Front, F&amp;I, bonus, and payroll</small></div>
              <span>{formatCurrency(analytics.commission.estimatedCommissionCents)}</span>
            </header>
            <dl className="fi-center-row-list">
              <div><dt>Front commission<small>{analytics.commission.miniDealCount} Mini · {analytics.commission.manualFrontCommissionCount} manual/spiff</small></dt><dd>{formatCurrency(analytics.commission.frontCommissionCents)}</dd></div>
              <div><dt>F&amp;I commission</dt><dd>{formatCurrency(analytics.commission.fiCommissionCents)}</dd></div>
              <div><dt>Sales commission</dt><dd>{formatCurrency(analytics.commission.coreCommissionCents)}</dd></div>
              <div><dt>Bonus included</dt><dd>{formatCurrency(analytics.commission.bonusIncludedCents)}</dd></div>
              <div className="is-total"><dt>Estimated commission</dt><dd>{formatCurrency(analytics.commission.estimatedCommissionCents)}</dd></div>
              <div><dt>Est. commission per sale</dt><dd>{amountLabel(analytics.commission.averageEstimatedCommissionPerDeliveredDealCents)}</dd></div>
              <div><dt>Actual paid</dt><dd>{amountLabel(analytics.commission.actualPaidCents, analytics.commission.actualPaidCents !== null)}</dd></div>
              <div><dt>Payroll variance</dt><dd>{amountLabel(analytics.commission.payrollVarianceCents, analytics.commission.payrollVarianceCents !== null)}</dd></div>
            </dl>
          </section>
        </div>

        </Section>

        <PerformanceScorecard analytics={analytics} baseline={baseline} baselineLabel={baselineLabel} />
        <MetricGuide />

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
              {analytics.quality.fiGrossMissingCount === 0 ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            </span>
            <div><strong>{analytics.quality.fiGrossMissingCount > 0 ? "Awaiting F&I gross" : "Total F&I gross"}</strong><span>{analytics.quality.fiGrossEnteredCount} of {analytics.quality.eligibleDealCount} entered</span><small>{analytics.quality.fiGrossMissingCount} awaiting · add amounts when your F&amp;I manager provides them</small></div>
            {analytics.quality.fiGrossMissingCount > 0 ? <ViewDealsButton filter="fiGrossMissing" label="deals awaiting F&I gross" onSelect={selectEvidence} /> : null}
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
                    <th scope="col">{includeLastNames ? "Customer / vehicle" : "Vehicle"}</th>
                    <th scope="col">Stock / date</th>
                    <th scope="col">Products</th>
                    <th scope="col">Financing</th>
                    <th scope="col">F&amp;I gross</th>
                    <th scope="col">Credited units</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((item) => (
                    <tr key={item.sale.id} className="report-openable-sale" onClick={(event) => openSaleFromReportRow(event, item.sale, onOpenSale)}>
                      <th scope="row"><ReportSaleIdentity sale={item.sale} includeLastNames={includeLastNames} /></th>
                      <td><ReportSaleMetadata sale={item.sale} onOpenSale={onOpenSale} stacked /></td>
                      <td><ProductOutcomeBadges sale={item.sale} /></td>
                      <td><span className="fi-evidence-finance" data-state={outcomeLabel(dealerFinancingOutcome(item.sale))}>{paymentMethodLabel(item.sale)}</span></td>
                      <td>{item.sale.fiGrossCents === null ? "Not entered" : formatCurrency(item.sale.fiGrossCents)}</td>
                      <td>{formatUnitCredit(item.sale.unitCreditBasis)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fi-center-evidence-cards">
              {filteredDeals.map((item) => (
                <article key={item.sale.id} className="fi-evidence-card report-openable-sale" onClick={(event) => openSaleFromReportRow(event, item.sale, onOpenSale)}>
                  <header>
                    <ReportSaleIdentity sale={item.sale} includeLastNames={includeLastNames} />
                    <span>{formatUnitCredit(item.sale.unitCreditBasis)} units</span>
                  </header>
                  <ReportSaleMetadata sale={item.sale} onOpenSale={onOpenSale} />
                  <ProductOutcomeBadges sale={item.sale} />
                  <dl>
                    <div><dt>Payment method</dt><dd>{paymentMethodLabel(item.sale)}</dd></div>
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
