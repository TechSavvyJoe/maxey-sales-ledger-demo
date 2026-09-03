import { isValidDateOnly, todayDateOnly } from "@/domain/date";
import { parseCurrencyToCents } from "@/domain/money";
import type { EditableSaleStatus } from "@/domain/types";

export interface SaleFormValues {
  status: EditableSaleStatus;
  saleDate: string;
  customerLastName: string;
  stockNumber: string;
  vehicleDescription: string;
  unitCredit: string;
  frontGross: string;
  fiGross: string;
  manualFrontCommissionEnabled: boolean;
  frontCommissionOverride: string;
  notes: string;
}

export type SaleFormErrors = Partial<Record<keyof SaleFormValues, string>>;

export function validateSaleForm(values: SaleFormValues): SaleFormErrors {
  const errors: SaleFormErrors = {};
  if (!isValidDateOnly(values.saleDate)) errors.saleDate = "Enter a valid date.";
  if (
    values.status === "delivered" &&
    isValidDateOnly(values.saleDate) &&
    values.saleDate > todayDateOnly()
  ) {
    errors.saleDate = "A future delivery must stay Pending until the vehicle is delivered.";
  }
  if (values.status === "delivered" && !values.stockNumber.trim()) {
    errors.stockNumber = "Stock number is required for a delivered vehicle.";
  }
  if (values.stockNumber.length > 40) errors.stockNumber = "Use 40 characters or fewer.";
  if (values.customerLastName.length > 60) {
    errors.customerLastName = "Use 60 characters or fewer.";
  }
  if (values.vehicleDescription.length > 120) {
    errors.vehicleDescription = "Use 120 characters or fewer.";
  }
  if (values.notes.length > 500) errors.notes = "Use 500 characters or fewer.";

  const unitCreditText = values.unitCredit.trim();
  const unitCredit = Number(unitCreditText);
  if (!unitCreditText) {
    errors.unitCredit = "Enter deal credit between 0 and 2.";
  } else if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(unitCreditText)
    || !Number.isFinite(unitCredit) || unitCredit < 0 || unitCredit > 2) {
    errors.unitCredit = "Deal credit must be between 0 and 2.";
  } else if ((unitCreditText.split(".")[1]?.length ?? 0) > 3) {
    errors.unitCredit = "Use up to 3 decimal places for deal credit.";
  }

  const frontGross = parseCurrencyToCents(values.frontGross);
  if (Number.isNaN(frontGross)) errors.frontGross = "Enter dollars, such as 2500 or 2500.00.";
  if (frontGross !== null && Math.abs(frontGross) > 100_000_000) {
    errors.frontGross = "Enter an amount between -$1,000,000 and $1,000,000.";
  }

  const fiGross = parseCurrencyToCents(values.fiGross);
  if (Number.isNaN(fiGross)) errors.fiGross = "Enter dollars, such as 600 or 600.00.";
  if (fiGross !== null && Math.abs(fiGross) > 100_000_000) {
    errors.fiGross = "Enter an amount between -$1,000,000 and $1,000,000.";
  }

  if (values.manualFrontCommissionEnabled) {
    const frontCommissionOverride = parseCurrencyToCents(values.frontCommissionOverride);
    if (frontCommissionOverride === null) {
      errors.frontCommissionOverride = "Enter your front commission, or turn off manual payout.";
    } else if (Number.isNaN(frontCommissionOverride)) {
      errors.frontCommissionOverride = "Enter dollars, such as 500 or 500.00.";
    } else if (frontCommissionOverride < 0 || frontCommissionOverride > 100_000_000) {
      errors.frontCommissionOverride = "Enter an amount from $0 to $1,000,000.";
    }
  }

  return errors;
}
