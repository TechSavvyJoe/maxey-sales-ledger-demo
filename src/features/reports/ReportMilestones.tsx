import { Flag } from "lucide-react";
import { formatSaleDate } from "@/domain/date";
import { formatCurrency, formatPercent } from "@/domain/money";
import type { CalculatedSale, Sale } from "@/domain/types";
import "./report-milestones.css";

function milestoneLabel(item: CalculatedSale): string {
  const milestone = item.milestone;
  if (!milestone) return "";
  return [
    milestone.unlocksHigherRate ? `${formatPercent(milestone.frontRateBps, milestone.frontRateBps % 100 === 0 ? 0 : milestone.frontRateBps % 10 === 0 ? 1 : 2)} front rate` : "",
    milestone.bonusAddedCents > 0 ? "volume bonus" : "",
  ].filter(Boolean).join(" + ");
}

export function ReportMilestoneIndicator({ item }: { item: CalculatedSale }) {
  if (!item.milestone) return null;
  return (
    <span className="report-milestone-indicator" title={milestoneLabel(item)}>
      <Flag aria-hidden="true" />
      <span>Milestone · Delivery {item.deliveryOrdinal}</span>
    </span>
  );
}

function partialImpactNote(item: CalculatedSale): string {
  if (!item.milestone?.isPartial) return "";
  const missing = [
    !item.commissionReady ? "this sale’s front gross" : "",
    item.sale.fiGrossCents === null ? "this sale’s F&I gross" : "",
    item.milestone.missingPriorFrontGrossCount > 0
      ? `front gross on ${item.milestone.missingPriorFrontGrossCount} earlier ${item.milestone.missingPriorFrontGrossCount === 1 ? "sale" : "sales"}`
      : "",
  ].filter(Boolean);
  return `Partial impact — awaiting ${missing.join(" and ") || "gross amounts"}.`;
}

export function ReportMilestones({
  calculatedSales,
  includeLastNames,
  onOpenSale,
}: {
  calculatedSales: CalculatedSale[];
  includeLastNames: boolean;
  onOpenSale: (sale: Sale) => void;
}) {
  const milestones = calculatedSales.filter((item) => item.milestone != null)
    .sort((a, b) => a.deliveryOrdinal! - b.deliveryOrdinal!);
  return (
    <section className="report-milestones" aria-labelledby="report-milestone-heading">
      <header className="report-milestones__header">
        <h2 id="report-milestone-heading">Milestone earnings</h2>
        <p>Sales that unlocked a higher front rate or a volume bonus. Already included in the month’s estimate. Don’t add again.</p>
      </header>
      {milestones.length ? (
        <ol className="report-milestones__list" aria-label="Sales that unlocked milestone earnings">
          {milestones.map((item) => {
            const milestone = item.milestone!;
            const vehicle = item.sale.vehicleDescription.trim() || "Vehicle not entered";
            const customer = item.sale.customerLastName.trim() || "Customer not entered";
            return (
              <li className="report-milestone-row" key={item.sale.id}>
                <div className="report-milestone-row__identity">
                  <span className="report-milestone-row__level">Delivery {milestone.deliveryOrdinal} · {milestoneLabel(item)}</span>
                  <button className="report-milestone-open" type="button" onClick={() => onOpenSale(item.sale)} aria-label={`Open milestone sale: ${includeLastNames ? `${customer}, ` : ""}${vehicle}`}>
                    <strong className="report-sale-identity__primary">{includeLastNames ? customer : vehicle}</strong>
                    {includeLastNames ? <span className="report-sale-identity__vehicle">{vehicle}</span> : null}
                  </button>
                  <span className="report-milestone-row__meta"><time dateTime={item.sale.saleDate}>{formatSaleDate(item.sale.saleDate)}</time> · Stock {item.sale.stockNumber || "not entered"}</span>
                </div>
                <dl className="report-milestone-row__amounts">
                  <div><dt>Sale commission</dt><dd>{formatCurrency(item.estimatedCommissionCents, true)}<small>Front + F&amp;I</small></dd></div>
                  <div><dt>Extra unlocked</dt><dd>{formatCurrency(milestone.extraEarningsUnlockedCents, true)}<small>{milestone.unlocksHigherRate ? <>{formatCurrency(milestone.priorSalesRetroactiveCents, true)} rate increase on earlier sales<br /></> : null}{milestone.bonusAddedCents > 0 ? <>{formatCurrency(milestone.bonusAddedCents, true)} added bonus</> : null}</small></dd></div>
                  <div className="report-milestone-row__impact"><dt>Milestone impact</dt><dd>{formatCurrency(milestone.totalMilestoneImpactCents, true)}<small>Sale + extra unlocked{milestone.isPartial ? " · partial" : ""}</small></dd></div>
                </dl>
                {milestone.isPartial ? <p className="report-milestone-row__partial">{partialImpactNote(item)}</p> : null}
              </li>
            );
          })}
        </ol>
      ) : <p className="report-milestones__empty">No earnings milestone reached this month. Qualifying deliveries will appear here automatically.</p>}
      <p className="report-milestones__note">Delivery order follows delivery date, then entry order for same-day sales. Sale commission is front + F&amp;I, with Mini and manual payouts honored. Extra unlocked = the rate increase on earlier sales + the added bonus. Milestone impact = this sale’s commission + extra unlocked.</p>
    </section>
  );
}
