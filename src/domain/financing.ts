import type { PaymentMethod, Sale } from "@/domain/types";

type FinancingFields = Pick<Sale, "paymentMethod" | "dealerFinanced">;

export type ResolvedPaymentMethod = PaymentMethod | "not_dealer_financed" | "unmarked";

/** Older No answers do not reveal whether the customer paid cash or used an outside lender. */
export function getPaymentMethod(sale: FinancingFields): ResolvedPaymentMethod {
  if (
    sale.paymentMethod === "dealer_financed"
    || sale.paymentMethod === "cash"
    || sale.paymentMethod === "outside_financing"
  ) return sale.paymentMethod;
  if (sale.dealerFinanced === true) return "dealer_financed";
  if (sale.dealerFinanced === false) return "not_dealer_financed";
  return "unmarked";
}

/** The explicit payment method takes precedence over the compatibility boolean. */
export function dealerFinancingOutcome(sale: FinancingFields): boolean | undefined {
  const method = getPaymentMethod(sale);
  if (method === "unmarked") return undefined;
  return method === "dealer_financed";
}

export function paymentMethodLabel(sale: FinancingFields): string {
  const labels: Record<ResolvedPaymentMethod, string> = {
    dealer_financed: "Dealership financing",
    cash: "Cash",
    outside_financing: "Outside financing",
    not_dealer_financed: "Cash / outside not specified",
    unmarked: "Not marked",
  };
  return labels[getPaymentMethod(sale)];
}

/** Keep older consumers compatible without inventing a payment method for legacy records. */
export function normalizeSaleFinancing<T extends Sale>(sale: T): T {
  if (sale.paymentMethod === undefined) return sale;
  const dealerFinanced = dealerFinancingOutcome(sale);
  return dealerFinanced === sale.dealerFinanced ? sale : { ...sale, dealerFinanced };
}
