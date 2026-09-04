import { useMemo, useState } from "react";
import { getPaymentMethod, paymentMethodLabel } from "@/domain/financing";
import {
  ArrowDownAZ,
  ChevronDown,
  CircleAlert,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Undo2,
  X,
} from "lucide-react";
import { useWorkspaceToast } from "@/hooks/useWorkspaceToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeading, ReviewState, StatusBadge } from "@/components/shared";
import { attentionSummary, getAttentionRecords } from "@/domain/attention";
import { calculateMonth } from "@/domain/commission";
import { formatSaleDate, monthKeyFromDate, monthLabel, todayDateOnly } from "@/domain/date";
import { formatCurrency, formatUnitCredit } from "@/domain/money";
import type { SalesDestinationFilter } from "@/domain/navigation";
import { getPayPlanSchedule } from "@/domain/payPlan";
import type { CalculatedSale, EditableSaleStatus, ProfileSettings, Sale } from "@/domain/types";
import { cn } from "@/lib/utils";

type Filter = "all" | EditableSaleStatus | "review" | "deleted";
type Sort =
  | "newest"
  | "oldest"
  | "customer"
  | "pending-first"
  | "review-first"
  | "commission-high"
  | "front-high"
  | "fi-high"
  | "stock";

interface SalesPageProps {
  sales: Sale[];
  settings: ProfileSettings;
  onAddSale: () => void;
  onEditSale: (sale: Sale) => void;
  onDeleteSale: (sale: Sale) => Promise<void>;
  onRestoreSale: (sale: Sale) => Promise<unknown>;
  initialFilter?: SalesDestinationFilter;
}

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "delivered", label: "Delivered" },
  { id: "pending", label: "Pending" },
  { id: "review", label: "Needs review" },
  { id: "deleted", label: "Recently deleted" },
];

const SALES_PAGE_SIZE = 12;

function SaleProductBadges({ sale }: { sale: Sale }) {
  const productOutcomes = [
    ["SC", "Service contract / warranty", sale.serviceContractSold],
    ["T&W", "Tire & Wheel", sale.tireWheelSold],
    ["GAP", "GAP", sale.gapSold],
  ] as const;
  const soldProducts = productOutcomes.filter(([, , value]) => value === true);
  const noProducts = productOutcomes.filter(([, , value]) => value === false);
  const unmarkedProducts = productOutcomes.filter(([, , value]) => value === undefined);
  const paymentMethod = getPaymentMethod(sale);
  const accessibleLabel = [
    `F&I products sold: ${soldProducts.length ? soldProducts.map(([, label]) => label).join(", ") : "none recorded"}`,
    noProducts.length ? `F&I products marked No: ${noProducts.map(([, label]) => label).join(", ")}` : null,
    unmarkedProducts.length ? `F&I products not marked: ${unmarkedProducts.map(([, label]) => label).join(", ")}` : null,
    `Payment method: ${paymentMethodLabel(sale)}`,
  ].filter((part): part is string => part !== null).join(". ");
  const badges = [
    ...soldProducts.map(([short, label]) => [short, label] as const),
    ...(["dealer_financed", "cash", "outside_financing"].includes(paymentMethod)
      ? [[paymentMethod === "dealer_financed" ? "Finance" : paymentMethod === "cash" ? "Cash" : "Outside Finance", paymentMethodLabel(sale)] as const] : []),
  ];
  if (!badges.length) {
    const hasUnmarkedOutcome = unmarkedProducts.length > 0 || paymentMethod === "unmarked" || paymentMethod === "not_dealer_financed";
    return (
      <span role="group" className="sale-products sale-products--empty" aria-label={accessibleLabel}>
        {hasUnmarkedOutcome ? "Needs details" : "No products"}
      </span>
    );
  }
  return (
    <span role="group" className="sale-products" aria-label={accessibleLabel}>
      {badges.map(([short, label]) => <span key={short} title={label} aria-hidden="true">{short}</span>)}
    </span>
  );
}

function SaleMilestoneLink({ item, onOpen }: { item: CalculatedSale; onOpen: (sale: Sale) => void }) {
  if (!item.milestone) return null;
  return (
    <button
      type="button"
      className="sale-milestone-link"
      onClick={() => onOpen(item.sale)}
      aria-label={`View delivery ${item.milestone.deliveryOrdinal} milestone for ${item.sale.customerLastName || item.sale.stockNumber}`}
    >
      <TrendingUp aria-hidden="true" />
      <span>Milestone <span className="sale-milestone-link__amount">+{formatCurrency(item.milestone.extraEarningsUnlockedCents)}{item.milestone.missingPriorFrontGrossCount > 0 ? " so far" : ""}</span></span>
    </button>
  );
}

export function SalesPage({
  sales,
  settings,
  onAddSale,
  onEditSale,
  onDeleteSale,
  onRestoreSale,
  initialFilter,
}: SalesPageProps) {
  const toast = useWorkspaceToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter ?? "all");
  const [sort, setSort] = useState<Sort>("newest");
  const [visibleCount, setVisibleCount] = useState(SALES_PAGE_SIZE);
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [restoringSaleId, setRestoringSaleId] = useState<string | null>(null);
  const payPlanSchedule = useMemo(
    () => getPayPlanSchedule(settings),
    [settings],
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
  const attentionRecords = useMemo(
    () => getAttentionRecords(summary.calculatedSales, todayDateOnly()),
    [summary.calculatedSales],
  );
  const attentionBySaleId = useMemo(
    () => new Map(attentionRecords.map((record) => [record.sale.id, record])),
    [attentionRecords],
  );

  const deletedSales = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    return sales
      .filter((sale) => sale.deletedAt && monthKeyFromDate(sale.saleDate) === settings.selectedMonth)
      .filter((sale) => !normalizedQuery || [sale.customerLastName, sale.stockNumber, sale.vehicleDescription]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery))
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  }, [query, sales, settings.selectedMonth]);

  const filteredSales = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    const matches = summary.calculatedSales.filter((item) => {
      if (filter === "deleted") return false;
      if (filter === "review" && !attentionBySaleId.has(item.sale.id)) return false;
      if ((filter === "delivered" || filter === "pending") && item.sale.status !== filter) return false;
      if (!normalizedQuery) return true;
      return [item.sale.customerLastName, item.sale.stockNumber, item.sale.vehicleDescription]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalizedQuery);
    });
    const newestFirst = (a: CalculatedSale, b: CalculatedSale) =>
      b.sale.saleDate.localeCompare(a.sale.saleDate) || b.sale.updatedAt.localeCompare(a.sale.updatedAt);
    const nullableAmountDescending = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    };
    return matches.sort((a, b) => {
      if (sort === "oldest") return a.sale.saleDate.localeCompare(b.sale.saleDate);
      if (sort === "customer") {
        const aName = a.sale.customerLastName.trim();
        const bName = b.sale.customerLastName.trim();
        if (!aName && bName) return 1;
        if (aName && !bName) return -1;
        return aName.localeCompare(bName, "en-US", { numeric: true, sensitivity: "base" }) || newestFirst(a, b);
      }
      if (sort === "pending-first") {
        const statusOrder: Record<EditableSaleStatus, number> = { pending: 0, delivered: 1 };
        const aStatus = a.sale.status === "void" ? "pending" : a.sale.status;
        const bStatus = b.sale.status === "void" ? "pending" : b.sale.status;
        return statusOrder[aStatus] - statusOrder[bStatus] || newestFirst(a, b);
      }
      if (sort === "review-first") {
        return Number(attentionBySaleId.has(b.sale.id)) - Number(attentionBySaleId.has(a.sale.id)) || newestFirst(a, b);
      }
      if (sort === "commission-high") return b.estimatedCommissionCents - a.estimatedCommissionCents;
      if (sort === "front-high") {
        return nullableAmountDescending(a.sale.frontGrossCents, b.sale.frontGrossCents) || newestFirst(a, b);
      }
      if (sort === "fi-high") {
        return nullableAmountDescending(a.sale.fiGrossCents, b.sale.fiGrossCents) || newestFirst(a, b);
      }
      if (sort === "stock") {
        return a.sale.stockNumber.localeCompare(b.sale.stockNumber, "en-US", { numeric: true, sensitivity: "base" }) || newestFirst(a, b);
      }
      return newestFirst(a, b);
    });
  }, [attentionBySaleId, filter, query, sort, summary.calculatedSales]);

  const statusCounts: Record<Filter, number> = {
    all: summary.calculatedSales.length,
    delivered: summary.calculatedSales.filter((item) => item.sale.status === "delivered").length,
    pending: summary.calculatedSales.filter((item) => item.sale.status === "pending").length,
    review: attentionRecords.length,
    deleted: sales.filter((sale) => sale.deletedAt && monthKeyFromDate(sale.saleDate) === settings.selectedMonth).length,
  };
  const hasActiveFilters = query.trim().length > 0 || filter !== "all";
  const filteredContext = useMemo(() => {
    const validDeliveries = filteredSales.filter((item) => item.countsTowardVolume);
    return {
      delivered: validDeliveries.length,
      frontGrossCents: validDeliveries.reduce(
        (total, item) => total + (item.sale.frontGrossCents ?? 0),
        0,
      ),
      fiGrossCents: validDeliveries.reduce(
        (total, item) => total + (item.sale.fiGrossCents ?? 0),
        0,
      ),
    };
  }, [filteredSales]);
  const headingDescription = filter === "deleted"
    ? `${deletedSales.length} recently deleted ${deletedSales.length === 1 ? "sale" : "sales"} · restore any sale without replacing the rest of your data`
    : hasActiveFilters
    ? `Showing ${filteredSales.length} of ${summary.calculatedSales.length} sales · ${filteredContext.delivered} delivered · ${formatCurrency(filteredContext.frontGrossCents)} front gross · ${formatCurrency(filteredContext.fiGrossCents)} total F&I gross`
    : `${summary.deliveredCount} delivered · ${formatCurrency(summary.frontGrossCents)} front gross · ${formatCurrency(summary.fiGrossCents)} total F&I gross`;

  function clearFilters() {
    setQuery("");
    setFilter("all");
    setVisibleCount(SALES_PAGE_SIZE);
  }

  function reviewReason(item: CalculatedSale) {
    const record = attentionBySaleId.get(item.sale.id);
    return record ? attentionSummary(record) : "";
  }

  async function confirmDelete() {
    if (!saleToDelete) return;
    setIsDeleting(true);
    try {
      await onDeleteSale(saleToDelete);
      setSaleToDelete(null);
    } catch {
      // The parent keeps this dialog open and shows the actionable error.
    } finally {
      setIsDeleting(false);
    }
  }

  async function restoreDeletedSale(sale: Sale) {
    setRestoringSaleId(sale.id);
    try {
      await onRestoreSale(sale);
      toast.success("Sale restored.", {
        description: `${sale.stockNumber || "Missing stock"} is back in the active sales log.`,
      });
    } catch {
      toast.error("Sale could not be restored.", {
        description: "The deleted record is still available. Refresh and try again.",
      });
    } finally {
      setRestoringSaleId(null);
    }
  }

  function SaleActions({ item }: { item: CalculatedSale }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for stock ${item.sale.stockNumber || "missing"}`}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEditSale(item.sale)}>
            <Pencil aria-hidden="true" /> Edit sale
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setSaleToDelete(item.sale)}>
            <Trash2 aria-hidden="true" /> Delete sale
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="page-stack sales-page">
      <PageHeading
        eyebrow={monthLabel(settings.selectedMonth)}
        title="Sales"
        description={headingDescription}
        action={<ReviewState count={attentionRecords.length} />}
      />

      <section className="sales-toolbar" aria-label="Search and filter sales">
        <div className="search-field">
          <Search aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleCount(SALES_PAGE_SIZE);
            }}
            placeholder="Search last name, stock, or vehicle"
            aria-label="Search sales"
          />
        </div>
        <div className="filter-chips" aria-label="Filter sales records">
          {filters.map((item) => (
            <button
              type="button"
              key={item.id}
              className={cn(
                "filter-chip",
                statusCounts[item.id] === 0 && item.id !== "all" && "is-empty",
                filter === item.id && "is-active",
              )}
              aria-pressed={filter === item.id}
              onClick={() => {
                setFilter(item.id);
                setVisibleCount(SALES_PAGE_SIZE);
              }}
            >
              {item.label}
              <span>{statusCounts[item.id]}</span>
            </button>
          ))}
        </div>
        <div className="sales-toolbar__actions">
          <label className="sort-control">
            <ArrowDownAZ aria-hidden="true" />
            <span className="sr-only">Sort sales</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as Sort);
                setVisibleCount(SALES_PAGE_SIZE);
              }}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="customer">Customer A–Z</option>
              <option value="pending-first">Pending first</option>
              <option value="review-first">Needs review first</option>
              <option value="commission-high">Highest commission</option>
              <option value="front-high">Highest front gross</option>
              <option value="fi-high">Highest F&amp;I gross</option>
              <option value="stock">Stock number</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="ghost"
              className="sales-clear-button"
              aria-label="Clear search and filters"
              onClick={clearFilters}
            >
              <X aria-hidden="true" /> Clear
            </Button>
          ) : null}
        </div>
      </section>

      <section className="sales-surface" aria-label="Sales records">
        {filter === "deleted" ? (
          deletedSales.length ? (
            <>
              <div className="sales-table-wrap" role="region" aria-label={`${monthLabel(settings.selectedMonth)} recently deleted sales table`} tabIndex={0}>
                <table className="sales-table sales-table--deleted">
                  <thead>
                    <tr>
                      <th scope="col">Sale date</th>
                      <th scope="col">Customer / vehicle</th>
                      <th scope="col">Stock</th>
                      <th scope="col">Deleted</th>
                      <th scope="col"><span className="sr-only">Restore</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedSales.slice(0, visibleCount).map((sale) => (
                      <tr key={sale.id}>
                        <td><time dateTime={sale.saleDate}>{formatSaleDate(sale.saleDate)}</time></td>
                        <td><strong>{sale.customerLastName || "No last name"}</strong><small>{sale.vehicleDescription || "Vehicle not entered"}</small></td>
                        <td><span className="stock-number">{sale.stockNumber || "—"}</span></td>
                        <td>{sale.deletedAt ? new Date(sale.deletedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</td>
                        <td>
                          <Button type="button" variant="outline" size="sm" disabled={restoringSaleId === sale.id} onClick={() => void restoreDeletedSale(sale)}>
                            <Undo2 aria-hidden="true" /> {restoringSaleId === sale.id ? "Restoring…" : "Restore"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sales-card-list">
                {deletedSales.slice(0, visibleCount).map((sale) => (
                  <article key={sale.id} className="sale-card sale-card--deleted">
                    <div className="sale-card__main">
                      <span className="sale-card__topline">
                        <time dateTime={sale.saleDate}>{formatSaleDate(sale.saleDate)}</time>
                        <span className="status-badge status-badge--deleted">Deleted</span>
                      </span>
                      <strong>{sale.customerLastName || "No last name"}</strong>
                      <span className="sale-card__vehicle">{sale.vehicleDescription || "Vehicle not entered"}</span>
                      <span className="sale-card__stock">Stock {sale.stockNumber || "not entered"}</span>
                    </div>
                    <Button type="button" variant="outline" disabled={restoringSaleId === sale.id} onClick={() => void restoreDeletedSale(sale)}>
                      <Undo2 aria-hidden="true" /> {restoringSaleId === sale.id ? "Restoring…" : "Restore sale"}
                    </Button>
                  </article>
                ))}
              </div>
              {deletedSales.length > visibleCount ? (
                <div className="load-more">
                  <span>Showing {visibleCount} of {deletedSales.length} deleted sales</span>
                  <Button variant="outline" onClick={() => setVisibleCount((count) => count + SALES_PAGE_SIZE)}>
                    Show {SALES_PAGE_SIZE} more
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="No recently deleted sales"
              description="Deleted records from this month will appear here so they can be restored later."
              action={hasActiveFilters && query ? <Button variant="outline" onClick={clearFilters}><X aria-hidden="true" /> Clear search</Button> : undefined}
            />
          )
        ) : filteredSales.length ? (
          <>
            <div className="sales-table-wrap" role="region" aria-label={`${monthLabel(settings.selectedMonth)} sales table`} tabIndex={0}>
              <table className="sales-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Customer / vehicle</th>
                    <th scope="col">Stock</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="numeric">Unit credit</th>
                    <th scope="col" className="numeric">Front gross</th>
                    <th scope="col" className="numeric">F&amp;I gross</th>
                    <th scope="col">Products &amp; financing</th>
                    <th scope="col" className="numeric">Est. commission</th>
                    <th scope="col"><span className="sr-only">Review and actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSales.slice(0, visibleCount).map((item) => (
                    <tr key={item.sale.id} className={cn(attentionBySaleId.has(item.sale.id) && "needs-review", item.sale.source === "demo" && "is-demo")}>
                      <td>
                        <time dateTime={item.sale.saleDate}>{formatSaleDate(item.sale.saleDate)}</time>
                      </td>
                      <td>
                        <button type="button" className="row-primary-action" onClick={() => onEditSale(item.sale)}>
                          <strong>{item.sale.customerLastName || "No last name"}</strong>
                          <small>{item.sale.vehicleDescription || "Vehicle not entered"}{item.sale.source === "demo" ? " · Demo" : ""}</small>
                        </button>
                      </td>
                      <td><span className="stock-number">{item.sale.stockNumber || "—"}</span></td>
                      <td><StatusBadge status={item.sale.status} /></td>
                      <td className="numeric">{formatUnitCredit(item.sale.unitCreditBasis)}</td>
                      <td className="numeric">{item.sale.frontGrossCents === null ? "—" : formatCurrency(item.sale.frontGrossCents)}</td>
                      <td className="numeric">{item.sale.fiGrossCents === null ? "—" : formatCurrency(item.sale.fiGrossCents)}</td>
                      <td><SaleProductBadges sale={item.sale} /></td>
                      <td className="numeric estimate-cell">
                        <strong>{formatCurrency(item.estimatedCommissionCents)}</strong>
                        {item.frontCommissionMethod === "mini" ? <small>Mini</small> : item.frontCommissionMethod === "manual" ? <small>Manual/spiff</small> : null}
                        <SaleMilestoneLink item={item} onOpen={onEditSale} />
                        {attentionBySaleId.has(item.sale.id) ? (
                          <span
                            className="table-review"
                            aria-label={`Needs review: ${attentionBySaleId.get(item.sale.id)?.reasons.map((reason) => reason.label).join(", ")}`}
                            title={attentionBySaleId.get(item.sale.id)?.reasons.map((reason) => reason.label).join(", ")}
                          >
                            <CircleAlert aria-hidden="true" /> {reviewReason(item)}
                          </span>
                        ) : null}
                      </td>
                      <td><SaleActions item={item} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sales-card-list">
              {filteredSales.slice(0, visibleCount).map((item) => (
                <article key={item.sale.id} className={cn("sale-card", attentionBySaleId.has(item.sale.id) && "needs-review", item.sale.source === "demo" && "is-demo")}>
                  <button type="button" className="sale-card__main" onClick={() => onEditSale(item.sale)}>
                    <span className="sale-card__topline">
                      <time dateTime={item.sale.saleDate}>{formatSaleDate(item.sale.saleDate)}</time>
                      <StatusBadge status={item.sale.status} />
                    </span>
                    <strong>{item.sale.customerLastName || "No last name"}</strong>
                    <span className="sale-card__vehicle">{item.sale.vehicleDescription || "Vehicle not entered"}</span>
                    <span className="sale-card__stock">Stock {item.sale.stockNumber || "not entered"}{item.sale.source === "demo" ? " · Demo" : ""}</span>
                    <dl>
                      <div><dt>Front</dt><dd>{item.sale.frontGrossCents === null ? "—" : formatCurrency(item.sale.frontGrossCents)}</dd></div>
                      <div><dt>F&amp;I</dt><dd>{item.sale.fiGrossCents === null ? "—" : formatCurrency(item.sale.fiGrossCents)}</dd></div>
                      <div><dt>Est. commission</dt><dd>{formatCurrency(item.estimatedCommissionCents)}</dd></div>
                    </dl>
                    <SaleProductBadges sale={item.sale} />
                  </button>
                  <div className="sale-card__actions">
                    <div className="sale-card__indicators">
                      {attentionBySaleId.has(item.sale.id) ? (
                      <span
                        className="table-review"
                        aria-label={`Needs review: ${attentionBySaleId.get(item.sale.id)?.reasons.map((reason) => reason.label).join(", ")}`}
                        title={attentionBySaleId.get(item.sale.id)?.reasons.map((reason) => reason.label).join(", ")}
                      >
                        <CircleAlert aria-hidden="true" /> {reviewReason(item)}
                      </span>
                      ) : item.frontCommissionMethod === "mini" ? <small>Mini</small> : item.frontCommissionMethod === "manual" ? <small>Manual/spiff</small> : null}
                      <SaleMilestoneLink item={item} onOpen={onEditSale} />
                    </div>
                    <SaleActions item={item} />
                  </div>
                </article>
              ))}
            </div>

            {filteredSales.length > visibleCount ? (
              <div className="load-more">
                <span>Showing {visibleCount} of {filteredSales.length} sales</span>
                <Button variant="outline" onClick={() => setVisibleCount((count) => count + SALES_PAGE_SIZE)}>
                  Show {SALES_PAGE_SIZE} more
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            title={summary.calculatedSales.length ? "No matching sales" : "No sales in this month yet"}
            description={
              summary.calculatedSales.length
                ? "Change the filter or clear the search."
                : "Add a delivered or pending vehicle to start tracking this month."
            }
            action={
              summary.calculatedSales.length ? (
                <Button variant="outline" onClick={clearFilters}>
                  <SlidersHorizontal aria-hidden="true" /> Clear filters
                </Button>
              ) : (
                <Button onClick={onAddSale}><Plus aria-hidden="true" /> Add sale</Button>
              )
            }
          />
        )}
      </section>

      <Dialog open={Boolean(saleToDelete)} onOpenChange={(open) => !open && setSaleToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this sale?</DialogTitle>
            <DialogDescription>
              Stock {saleToDelete?.stockNumber || "(missing)"} will be removed from calculations.
              You can restore it later from Recently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaleToDelete(null)} disabled={isDeleting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={isDeleting}>
              <Trash2 aria-hidden="true" /> {isDeleting ? "Deleting…" : "Delete sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
