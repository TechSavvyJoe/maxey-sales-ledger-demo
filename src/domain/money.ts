export function multiplyCentsByBps(cents: number, basisPoints: number): number {
  const numerator = cents * basisPoints;
  return numerator >= 0
    ? Math.floor((numerator + 5_000) / 10_000)
    : Math.ceil((numerator - 5_000) / 10_000);
}

export function formatCurrency(cents: number | null | undefined, showCents = false): string {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(amount);
}

export function formatCurrencyInput(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2);
}

export function parseCurrencyToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) return Number.NaN;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return Number.NaN;
  const cents = Math.round(amount * 100);
  return Number.isSafeInteger(cents) ? cents : Number.NaN;
}

export function formatPercent(basisPoints: number, fractionDigits = 0): string {
  return `${(basisPoints / 100).toFixed(fractionDigits)}%`;
}

export function formatUnitCredit(unitCreditBasis: number): string {
  return (unitCreditBasis / 1_000).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}
