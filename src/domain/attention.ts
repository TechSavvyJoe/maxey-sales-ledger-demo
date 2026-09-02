import type { CalculatedSale, Sale, SaleReviewFlag } from "@/domain/types";

export type AttentionReasonKind = "calculation" | "pending-follow-up";

export interface AttentionReason {
  id: string;
  kind: AttentionReasonKind;
  label: string;
  severity: "warning" | "error";
}
export interface AttentionRecord {
  id: string;
  sale: Sale;
  stockLabel: string;
  reasons: AttentionReason[];
  severity: "warning" | "error";
  ageDays: number | null;
}

function calendarDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

function reviewReason(flag: SaleReviewFlag): AttentionReason {
  return {
    id: flag.code,
    kind: "calculation",
    label: flag.label,
    severity: flag.severity,
  };
}

/**
 * Creates one actionable record per sale. The same selector is shared by the
 * Dashboard, Sales log, and Reports so their counts and destinations agree.
 */
export function getAttentionRecords(
  calculatedSales: CalculatedSale[],
  todayDate: string,
): AttentionRecord[] {
  const todayDay = calendarDayNumber(todayDate);

  return calculatedSales
    .map((item): AttentionRecord | null => {
      const reasons = item.flags.map(reviewReason);
      const saleDay = calendarDayNumber(item.sale.saleDate);
      const isPastPending = item.sale.status === "pending"
        && saleDay !== null
        && todayDay !== null
        && saleDay < todayDay;

      if (isPastPending) {
        reasons.push({
          id: "overdue-pending",
          kind: "pending-follow-up",
          label: "Pending date has passed — update the status or date",
          severity: "warning",
        });
      }

      if (reasons.length === 0) return null;

      return {
        id: item.sale.id,
        sale: item.sale,
        stockLabel: item.sale.stockNumber || "Missing stock",
        reasons,
        severity: reasons.some((reason) => reason.severity === "error") ? "error" : "warning",
        ageDays: isPastPending && saleDay !== null && todayDay !== null
          ? todayDay - saleDay
          : null,
      };
    })
    .filter((record): record is AttentionRecord => record !== null)
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      if ((a.ageDays ?? -1) !== (b.ageDays ?? -1)) return (b.ageDays ?? -1) - (a.ageDays ?? -1);
      return b.sale.saleDate.localeCompare(a.sale.saleDate) || a.stockLabel.localeCompare(b.stockLabel);
    });
}

export function attentionSummary(record: AttentionRecord): string {
  const [first, ...rest] = record.reasons;
  if (!first) return "";
  return rest.length ? `${first.label} +${rest.length}` : first.label;
}
