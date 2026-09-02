export interface SaleVersionToken {
  revision: number;
  updatedAt: string;
}

/**
 * Raised when a sale changed after the editor loaded it. The message is safe
 * to show to an end user; callers can use the class to offer conflict-specific
 * recovery without parsing text.
 */
export class SaleWriteConflictError extends Error {
  readonly code = "SALE_WRITE_CONFLICT";
  readonly saleId: string;

  constructor(saleId: string, stockNumber?: string) {
    const label = stockNumber?.trim() || "This sale";
    super(`${label} changed in another tab. Your entries were not saved. Load the latest sale, review your changes, and try again.`);
    this.name = "SaleWriteConflictError";
    this.saleId = saleId;
  }
}

export function isSaleWriteConflictError(error: unknown): error is SaleWriteConflictError {
  return error instanceof SaleWriteConflictError;
}
