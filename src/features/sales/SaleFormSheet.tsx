import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import "./sales-v2.css";
import { AlertCircle, Calculator, Check, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { calculateMonth, normalizeStock } from "@/domain/commission";
import { currentMonthKey, monthKeyFromDate, monthLabel, todayDateOnly } from "@/domain/date";
import { formatCurrency, formatCurrencyInput, formatPercent, parseCurrencyToCents } from "@/domain/money";
import {
  getEarliestPayPlanMonth,
  getPayPlanForMonth,
  getPayPlanSchedule,
  hasPayPlanCoverage,
  payPlanCoverageMessage,
} from "@/domain/payPlan";
import type { ProfileSettings, Sale } from "@/domain/types";
import {
  type SaleFormErrors,
  type SaleFormValues,
  validateSaleForm,
} from "@/domain/validation";
import { cn } from "@/lib/utils";
import { isSaleWriteConflictError } from "@/persistence/errors";

interface SaleFormSheetProps {
  open: boolean;
  saleToEdit: Sale | null;
  settings: ProfileSettings;
  sales: Sale[];
  returnFocusRef: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSave: (sale: Sale, isNew: boolean) => Promise<void>;
  onLoadLatestSale: (saleId: string) => Promise<void>;
}

interface FiProductValues {
  serviceContractSold: boolean | undefined;
  tireWheelSold: boolean | undefined;
  gapSold: boolean | undefined;
  dealerFinanced: boolean | undefined;
}

const fiProductOptions: Array<{ key: keyof FiProductValues; label: string }> = [
  { key: "serviceContractSold", label: "Service contract / warranty" },
  { key: "tireWheelSold", label: "Tire & Wheel" },
  { key: "gapSold", label: "GAP" },
];

const financingOption: { key: keyof FiProductValues; label: string } = {
  key: "dealerFinanced",
  label: "Dealer financed",
};

function defaultDateForMonth(monthKey: string): string {
  if (monthKey === currentMonthKey()) return todayDateOnly();
  return `${monthKey}-01`;
}

function valuesForSale(sale: Sale | null, monthKey: string): SaleFormValues {
  return sale
    ? {
        // An interrupted legacy restore can still briefly supply a void row
        // before persistence moves it to Recently deleted. Never offer that
        // retired status as an editable choice.
        status: sale.status === "void" ? "pending" : sale.status,
        saleDate: sale.saleDate,
        customerLastName: sale.customerLastName,
        stockNumber: sale.stockNumber,
        vehicleDescription: sale.vehicleDescription,
        unitCredit: String(sale.unitCreditBasis / 1_000),
        frontGross: formatCurrencyInput(sale.frontGrossCents),
        fiGross: formatCurrencyInput(sale.fiGrossCents),
        notes: sale.notes,
      }
    : {
        status: "delivered",
        saleDate: defaultDateForMonth(monthKey),
        customerLastName: "",
        stockNumber: "",
        vehicleDescription: "",
        unitCredit: "1",
        frontGross: "",
        fiGross: "",
        notes: "",
      };
}

function fiProductsForSale(sale: Sale | null): FiProductValues {
  if (!sale) {
    return {
      serviceContractSold: false,
      tireWheelSold: false,
      gapSold: false,
      dealerFinanced: false,
    };
  }
  return {
    serviceContractSold: sale.serviceContractSold,
    tireWheelSold: sale.tireWheelSold,
    gapSold: sale.gapSold,
    dealerFinanced: sale.dealerFinanced,
  };
}

function normalizedCurrencyValue(value: string): number | string | null {
  const cents = parseCurrencyToCents(value);
  return Number.isNaN(cents) ? value.trim() : cents;
}

function comparableFormValues(values: SaleFormValues): string {
  const unitCredit = values.unitCredit.trim() ? Number(values.unitCredit) : Number.NaN;
  return JSON.stringify({
    status: values.status,
    saleDate: values.saleDate,
    customerLastName: values.customerLastName.trim(),
    stockNumber: values.stockNumber.trim(),
    vehicleDescription: values.vehicleDescription.trim(),
    unitCredit: Number.isFinite(unitCredit) ? unitCredit : values.unitCredit.trim(),
    frontGross: normalizedCurrencyValue(values.frontGross),
    fiGross: normalizedCurrencyValue(values.fiGross),
    notes: values.notes.trim(),
  });
}

const statusOptions: Array<{ value: SaleFormValues["status"]; label: string; description: string }> = [
  { value: "delivered", label: "Delivered", description: "Counts toward monthly volume and commission" },
  { value: "pending", label: "Pending", description: "Planning only; counts after delivery" },
];

export function SaleFormSheet({
  open,
  saleToEdit,
  settings,
  sales,
  returnFocusRef,
  onOpenChange,
  onSave,
  onLoadLatestSale,
}: SaleFormSheetProps) {
  const [initialValues, setInitialValues] = useState<SaleFormValues>(() =>
    valuesForSale(saleToEdit, settings.selectedMonth),
  );
  const [values, setValues] = useState<SaleFormValues>(() => initialValues);
  const [initialFiProducts, setInitialFiProducts] = useState<FiProductValues>(() =>
    fiProductsForSale(saleToEdit),
  );
  const [fiProducts, setFiProducts] = useState<FiProductValues>(() => initialFiProducts);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(() => Boolean(
    saleToEdit &&
    (initialValues.vehicleDescription.trim() || initialValues.notes.trim() || initialValues.unitCredit !== "1"),
  ));
  const [errors, setErrors] = useState<SaleFormErrors>({});
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictSaleId, setConflictSaleId] = useState<string | null>(null);
  const [isLoadingLatest, setIsLoadingLatest] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [commissionAnnouncement, setCommissionAnnouncement] = useState("");
  const allowCloseRef = useRef(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const stockRef = useRef<HTMLInputElement>(null);
  const vehicleRef = useRef<HTMLInputElement>(null);
  const unitRef = useRef<HTMLInputElement>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const fiRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const moreDetailsRef = useRef<HTMLDetailsElement>(null);
  const payPlanSchedule = useMemo(
    () => getPayPlanSchedule(settings),
    [settings],
  );
  const earliestPayPlanMonth = useMemo(
    () => getEarliestPayPlanMonth(payPlanSchedule),
    [payPlanSchedule],
  );
  const previewMonthKey = monthKeyFromDate(values.saleDate) || settings.selectedMonth;
  const previewHasPayPlan = hasPayPlanCoverage(payPlanSchedule, previewMonthKey);
  const isDirty =
    comparableFormValues(values) !== comparableFormValues(initialValues) ||
    JSON.stringify(fiProducts) !== JSON.stringify(initialFiProducts);

  const duplicateMatches = useMemo(() => {
    const key = normalizeStock(values.stockNumber);
    if (!key || values.status !== "delivered") return [];
    return sales.filter(
      (sale) =>
        !sale.deletedAt &&
        sale.id !== saleToEdit?.id &&
        sale.status === "delivered" &&
        normalizeStock(sale.stockNumber) === key,
    );
  }, [saleToEdit?.id, sales, values.status, values.stockNumber]);

  const preview = useMemo(() => {
    const monthKey = monthKeyFromDate(values.saleDate) || settings.selectedMonth;
    if (!hasPayPlanCoverage(payPlanSchedule, monthKey)) return null;
    const frontGrossCents = parseCurrencyToCents(values.frontGross);
    const fiGrossCents = parseCurrencyToCents(values.fiGross);
    const draftId = saleToEdit?.id ?? "__draft__";
    const timestamp = saleToEdit?.createdAt ?? new Date().toISOString();
    const draft: Sale = {
      id: draftId,
      profileId: "primary",
      saleDate: values.saleDate,
      customerLastName: values.customerLastName.trim(),
      stockNumber: values.stockNumber.trim(),
      vehicleDescription: values.vehicleDescription.trim(),
      status: values.status,
      unitCreditBasis: Math.round((Number(values.unitCredit) || 0) * 1_000),
      frontGrossCents: Number.isNaN(frontGrossCents) ? null : frontGrossCents,
      fiGrossCents: Number.isNaN(fiGrossCents) ? null : fiGrossCents,
      notes: values.notes.trim(),
      createdAt: timestamp,
      updatedAt: new Date().toISOString(),
      revision: saleToEdit?.revision ?? 1,
      source: saleToEdit?.source ?? "manual",
    };
    const otherSales = sales.filter((sale) => sale.id !== draftId);
    const month = calculateMonth(
      [...otherSales, draft],
      monthKey,
      payPlanSchedule,
      settings.actualPaidByMonth[monthKey] ?? null,
    );
    return {
      month,
      sale: month.calculatedSales.find((item) => item.sale.id === draftId),
    };
  }, [payPlanSchedule, saleToEdit, sales, settings.actualPaidByMonth, settings.selectedMonth, values]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCommissionAnnouncement(
        preview
          ? `Estimated commission on this sale ${formatCurrency(preview.sale?.estimatedCommissionCents ?? 0, true)}.`
          : payPlanCoverageMessage(payPlanSchedule, previewMonthKey),
      );
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [payPlanSchedule, preview, previewMonthKey]);

  function updateValue<Key extends keyof SaleFormValues>(key: Key, value: SaleFormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    if (!conflictSaleId) setSaveError(null);
    if (key === "stockNumber" || key === "status") setDuplicateConfirmed(false);
  }

  function updateFiProduct(key: keyof FiProductValues, checked: boolean) {
    setFiProducts((current) => ({ ...current, [key]: checked }));
    if (!conflictSaleId) setSaveError(null);
  }

  async function loadLatestSale() {
    if (!conflictSaleId || isLoadingLatest) return;
    setIsLoadingLatest(true);
    try {
      await onLoadLatestSale(conflictSaleId);
    } finally {
      setIsLoadingLatest(false);
    }
  }

  function closeWithoutPrompt() {
    allowCloseRef.current = true;
    setDiscardDialogOpen(false);
    onOpenChange(false);
  }

  function requestOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (isSaving) return;
    if (allowCloseRef.current) {
      allowCloseRef.current = false;
      onOpenChange(false);
      return;
    }
    if (isDirty) {
      setDiscardDialogOpen(true);
      return;
    }
    onOpenChange(false);
  }

  async function submit(event: FormEvent, addAnother = false) {
    event.preventDefault();
    if (isSaving || conflictSaleId) return;
    const nextErrors = validateSaleForm(values);
    const saleMonth = monthKeyFromDate(values.saleDate);
    if (
      !nextErrors.saleDate &&
      saleMonth &&
      !hasPayPlanCoverage(payPlanSchedule, saleMonth)
    ) {
      nextErrors.saleDate = payPlanCoverageMessage(payPlanSchedule, saleMonth);
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const refs: Partial<Record<keyof SaleFormValues, React.RefObject<HTMLElement | null>>> = {
        saleDate: dateRef,
        customerLastName: customerRef,
        stockNumber: stockRef,
        vehicleDescription: vehicleRef,
        unitCredit: unitRef,
        frontGross: frontRef,
        fiGross: fiRef,
        notes: notesRef,
      };
      const firstInvalid = (Object.keys(nextErrors) as Array<keyof SaleFormValues>)
        .find((key) => Boolean(nextErrors[key]));
      if (
        firstInvalid === "vehicleDescription" ||
        firstInvalid === "unitCredit" ||
        firstInvalid === "notes"
      ) {
        setMoreDetailsOpen(true);
      }
      window.requestAnimationFrame(() => firstInvalid && refs[firstInvalid]?.current?.focus());
      return;
    }
    if (duplicateMatches.length > 0 && !duplicateConfirmed) return;

    const now = new Date().toISOString();
    const frontGrossCents = parseCurrencyToCents(values.frontGross);
    const fiGrossCents = parseCurrencyToCents(values.fiGross);
    const sale: Sale = {
      id: saleToEdit?.id ?? crypto.randomUUID(),
      profileId: "primary",
      saleDate: values.saleDate,
      customerLastName: values.customerLastName.trim(),
      stockNumber: values.stockNumber.trim(),
      vehicleDescription: values.vehicleDescription.trim(),
      status: values.status,
      unitCreditBasis: Math.round(Number(values.unitCredit) * 1_000),
      frontGrossCents,
      fiGrossCents,
      ...fiProducts,
      notes: values.notes.trim(),
      createdAt: saleToEdit?.createdAt ?? now,
      updatedAt: now,
      revision: saleToEdit ? saleToEdit.revision + 1 : 1,
      source: saleToEdit?.source ?? "manual",
      sourceReference: saleToEdit?.sourceReference,
    };

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(sale, !saleToEdit);
      if (addAnother && !saleToEdit) {
        const nextValues = valuesForSale(
          null,
          monthKeyFromDate(values.saleDate) || settings.selectedMonth,
        );
        setInitialValues(nextValues);
        setValues(nextValues);
        const nextFiProducts = fiProductsForSale(null);
        setInitialFiProducts(nextFiProducts);
        setFiProducts(nextFiProducts);
        setErrors({});
        setDuplicateConfirmed(false);
        setMoreDetailsOpen(false);
        window.requestAnimationFrame(() => customerRef.current?.focus());
      } else {
        closeWithoutPrompt();
      }
    } catch (caughtError) {
      if (isSaleWriteConflictError(caughtError)) setConflictSaleId(caughtError.saleId);
      setSaveError(
        caughtError instanceof Error
          ? caughtError.message
          : "This sale could not be saved. Your entries are still here; try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const errorCount = Object.values(errors).filter(Boolean).length;
  const previewPayPlan = preview
    ? getPayPlanForMonth(payPlanSchedule, preview.month.monthKey)
    : null;
  const isAccelerated =
    Boolean(preview && previewPayPlan && preview.month.frontRateBps === previewPayPlan.acceleratedFrontRateBps);
  const selectedStatus = statusOptions.find((option) => option.value === values.status) ?? statusOptions[0];
  const creditLabel = values.unitCredit === "1"
    ? "Full deal"
    : values.unitCredit === "0.5"
      ? "Half deal"
      : `${values.unitCredit || "Custom"} credit`;
  const footerEstimate = preview
    ? formatCurrency(preview.sale?.estimatedCommissionCents ?? 0, true)
    : "Not calculated";

  return (
    <>
    <Sheet open={open} onOpenChange={requestOpenChange}>
      <SheetContent
        className="sale-sheet"
        side="right"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
          else document.getElementById("main-content")?.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          customerRef.current?.focus();
        }}
      >
        <form className="sale-form" onSubmit={(event) => void submit(event)} noValidate>
          <div className="sale-form__scroll">
            <SheetHeader className="sale-form__header">
              <SheetTitle>{saleToEdit ? "Edit sale" : "Add sale"}</SheetTitle>
              <SheetDescription>
                Enter the sale details. Your commission estimate updates as you type.
              </SheetDescription>
            </SheetHeader>

            {errorCount > 0 ? (
              <div className="form-summary-error" role="alert">
                <AlertCircle aria-hidden="true" />
                <div>
                  <strong>Check {errorCount} {errorCount === 1 ? "field" : "fields"}</strong>
                  <span>Your entries are still here. Correct the highlighted fields and save again.</span>
                </div>
              </div>
            ) : null}

            {saveError ? (
              <div className="form-summary-error" role="alert">
                <AlertCircle aria-hidden="true" />
                <div>
                  <strong>Sale not saved</strong>
                  <span>{saveError}</span>
                  {conflictSaleId ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="form-summary-error__action"
                      disabled={isLoadingLatest}
                      onClick={() => void loadLatestSale()}
                    >
                      {isLoadingLatest ? "Loading latest…" : "Load latest"}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <fieldset className="form-section sale-status-section">
              <legend>Sale status</legend>
              <div className="status-choice-grid">
                {statusOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={cn("status-choice", values.status === option.value && "is-selected")}
                    aria-pressed={values.status === option.value}
                    aria-label={`${option.label}. ${option.description}`}
                    onClick={() => updateValue("status", option.value)}
                  >
                    <span>{option.label}</span>
                    {values.status === option.value ? <Check aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
              <p className="status-choice-help">{selectedStatus.description}</p>
            </fieldset>

            <div className="form-section form-fields sale-fast-fields">
              <div className="field-group sale-date-field">
                <Label htmlFor="sale-date">
                  {values.status === "pending" ? "Expected delivery date" : "Delivery date"}
                </Label>
                <Input
                  ref={dateRef}
                  id="sale-date"
                  type="date"
                  min={`${earliestPayPlanMonth}-01`}
                  value={values.saleDate}
                  aria-invalid={Boolean(errors.saleDate)}
                  aria-describedby={errors.saleDate ? "sale-date-error" : undefined}
                  onChange={(event) => updateValue("saleDate", event.target.value)}
                />
                {errors.saleDate ? <span id="sale-date-error" className="field-error">{errors.saleDate}</span> : null}
              </div>

              <div className="field-group">
                <Label htmlFor="customer-last-name">Customer last name</Label>
                <Input
                  ref={customerRef}
                  id="customer-last-name"
                  autoComplete="off"
                  value={values.customerLastName}
                  aria-invalid={Boolean(errors.customerLastName)}
                  aria-describedby={errors.customerLastName ? "customer-last-name-error" : undefined}
                  onChange={(event) => updateValue("customerLastName", event.target.value)}
                  placeholder="Example: Miller"
                />
                {errors.customerLastName ? <span id="customer-last-name-error" className="field-error">{errors.customerLastName}</span> : null}
              </div>

              <div className="field-group">
                <Label htmlFor="stock-number">Stock number {values.status === "delivered" ? "*" : ""}</Label>
                <Input
                  ref={stockRef}
                  id="stock-number"
                  autoCapitalize="characters"
                  autoComplete="off"
                  value={values.stockNumber}
                  aria-invalid={Boolean(errors.stockNumber) || duplicateMatches.length > 0}
                  aria-describedby={[
                    errors.stockNumber ? "stock-number-error" : "",
                    duplicateMatches.length > 0 ? "stock-duplicate-warning" : "",
                  ].filter(Boolean).join(" ") || undefined}
                  onChange={(event) => updateValue("stockNumber", event.target.value)}
                  placeholder="Example: T0538U"
                />
                {errors.stockNumber ? <span id="stock-number-error" className="field-error">{errors.stockNumber}</span> : null}
              </div>
            </div>

            <div className="form-section form-fields sale-money-fields">
              <div className="field-group">
                <Label htmlFor="front-gross">Front gross</Label>
                <div className="money-input">
                  <span aria-hidden="true">$</span>
                  <Input
                    ref={frontRef}
                    id="front-gross"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values.frontGross}
                    aria-invalid={Boolean(errors.frontGross)}
                    aria-describedby={errors.frontGross ? "front-gross-error" : undefined}
                    onChange={(event) => updateValue("frontGross", event.target.value)}
                    onBlur={() => {
                      const cents = parseCurrencyToCents(values.frontGross);
                      if (cents !== null && !Number.isNaN(cents)) updateValue("frontGross", formatCurrencyInput(cents));
                    }}
                    placeholder="2,500.00"
                  />
                </div>
                {errors.frontGross ? <span id="front-gross-error" className="field-error">{errors.frontGross}</span> : null}
              </div>
              <div className="field-group">
                <Label htmlFor="fi-gross">Total F&amp;I gross</Label>
                <div className="money-input">
                  <span aria-hidden="true">$</span>
                  <Input
                    ref={fiRef}
                    id="fi-gross"
                    inputMode="decimal"
                    autoComplete="off"
                    value={values.fiGross}
                    aria-invalid={Boolean(errors.fiGross)}
                    aria-describedby={`fi-gross-help${errors.fiGross ? " fi-gross-error" : ""}`}
                    onChange={(event) => updateValue("fiGross", event.target.value)}
                    onBlur={() => {
                      const cents = parseCurrencyToCents(values.fiGross);
                      if (cents !== null && !Number.isNaN(cents)) updateValue("fiGross", formatCurrencyInput(cents));
                    }}
                    placeholder="600.00"
                  />
                </div>
                <span id="fi-gross-help" className="field-help">Enter one combined F&amp;I gross amount for the whole deal.</span>
                {errors.fiGross ? <span id="fi-gross-error" className="field-error">{errors.fiGross}</span> : null}
              </div>
            </div>

            <fieldset className="form-section sale-fi-products">
              <legend>Products &amp; financing</legend>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Products sold">
                {fiProductOptions.map((option) => {
                  const checkboxId = `fi-product-${option.key}`;
                  return (
                    <label
                      key={option.key}
                      htmlFor={checkboxId}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-900"
                    >
                      <Checkbox
                        id={checkboxId}
                        checked={fiProducts[option.key] === undefined ? "indeterminate" : fiProducts[option.key]}
                        aria-describedby="fi-products-help"
                        onCheckedChange={(checked) => updateFiProduct(option.key, checked === true)}
                      />
                      <span>
                        {option.label}
                        {fiProducts[option.key] === undefined
                          ? <small className="block text-[11px] font-medium text-slate-600">Not marked</small>
                          : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p id="fi-products-help" className="field-help">
                Check each product that was sold. Leave it unchecked if it was not sold.
              </p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Financing">
                <label
                  htmlFor={`fi-product-${financingOption.key}`}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-900"
                >
                  <Checkbox
                    id={`fi-product-${financingOption.key}`}
                    checked={fiProducts[financingOption.key] === undefined ? "indeterminate" : fiProducts[financingOption.key]}
                    aria-describedby="fi-financing-help"
                    onCheckedChange={(checked) => updateFiProduct(financingOption.key, checked === true)}
                  />
                  <span>
                    {financingOption.label}
                    {fiProducts[financingOption.key] === undefined
                      ? <small className="block text-[11px] font-medium text-slate-600">Not marked</small>
                      : null}
                  </span>
                </label>
              </div>
              <p id="fi-financing-help" className="field-help">
                Check this when the sale used dealer financing. Total F&amp;I gross stays as one amount for the whole sale.
              </p>
            </fieldset>

            {duplicateMatches.length > 0 ? (
              <div id="stock-duplicate-warning" className="duplicate-warning" role="alert">
                <AlertCircle aria-hidden="true" />
                <div>
                  <strong>Delivered stock already exists</strong>
                  <p>
                    {values.stockNumber} is already recorded in {monthLabel(monthKeyFromDate(duplicateMatches[0].saleDate))}.
                    Saving both will exclude both records from commission until reviewed.
                  </p>
                  <label className="confirmation-check">
                    <Checkbox
                      checked={duplicateConfirmed}
                      onCheckedChange={(checked) => setDuplicateConfirmed(checked === true)}
                    />
                    I reviewed the existing record and want to save this duplicate.
                  </label>
                </div>
              </div>
            ) : null}

            <details
              ref={moreDetailsRef}
              className="sale-more-details"
              open={moreDetailsOpen}
              onToggle={(event) => setMoreDetailsOpen(event.currentTarget.open)}
            >
              <summary>
                <span>
                  <strong>Vehicle &amp; notes</strong>
                  <small>Vehicle, unit credit, notes, and privacy guidance</small>
                </span>
                <span className="sale-more-details__credit">{creditLabel}</span>
              </summary>
              <div className="sale-more-details__body">
                <div className="field-group">
                  <Label htmlFor="vehicle-description">Vehicle <span className="optional-label">optional</span></Label>
                  <Input
                    ref={vehicleRef}
                    id="vehicle-description"
                    autoComplete="off"
                    value={values.vehicleDescription}
                    aria-invalid={Boolean(errors.vehicleDescription)}
                    aria-describedby={errors.vehicleDescription ? "vehicle-description-error" : undefined}
                    onChange={(event) => updateValue("vehicleDescription", event.target.value)}
                    placeholder="Example: 2023 Ford Escape Active"
                  />
                  {errors.vehicleDescription ? <span id="vehicle-description-error" className="field-error">{errors.vehicleDescription}</span> : null}
                </div>

                <fieldset className="sale-detail-group">
                  <legend>Unit credit</legend>
                  <div className="credit-choices">
                    {[{ label: "Full deal", value: "1" }, { label: "Half deal", value: "0.5" }].map((choice) => (
                      <Button
                        type="button"
                        key={choice.value}
                        variant={values.unitCredit === choice.value ? "default" : "outline"}
                        onClick={() => updateValue("unitCredit", choice.value)}
                      >
                        {choice.label}
                      </Button>
                    ))}
                    <div className="credit-custom">
                      <Label htmlFor="unit-credit">Custom</Label>
                      <Input
                        ref={unitRef}
                        id="unit-credit"
                        inputMode="decimal"
                        autoComplete="off"
                        value={values.unitCredit}
                        aria-invalid={Boolean(errors.unitCredit)}
                        aria-describedby={`unit-credit-help${errors.unitCredit ? " unit-credit-error" : ""}`}
                        onChange={(event) => updateValue("unitCredit", event.target.value)}
                        onBlur={() => {
                          if (!validateSaleForm(values).unitCredit) {
                            updateValue("unitCredit", String(Number(values.unitCredit)));
                          }
                        }}
                      />
                    </div>
                  </div>
                  <p id="unit-credit-help" className="field-help">Choose the unit credit you receive. It does not change the gross-based commission estimate.</p>
                  {errors.unitCredit ? <span id="unit-credit-error" className="field-error">{errors.unitCredit}</span> : null}
                </fieldset>

                <div className="field-group">
                  <Label htmlFor="sale-notes">Notes <span className="optional-label">optional</span></Label>
                  <Textarea
                    ref={notesRef}
                    id="sale-notes"
                    value={values.notes}
                    aria-invalid={Boolean(errors.notes)}
                    aria-describedby={`notes-character-count${errors.notes ? " sale-notes-error" : ""}`}
                    onChange={(event) => updateValue("notes", event.target.value)}
                    placeholder="Use general sale notes only — never enter credit, banking, license, or insurance information."
                  />
                  <span id="notes-character-count" className="character-count">{values.notes.length}/500</span>
                  {errors.notes ? <span id="sale-notes-error" className="field-error">{errors.notes}</span> : null}
                </div>

                <div className="privacy-note">
                  <ShieldCheck aria-hidden="true" />
                  <p>
                    Customer last name and stock number are okay here. Do not enter Social Security numbers,
                    credit applications, bank details, license images, insurance information, passwords, or deal-jacket files.
                  </p>
                </div>
              </div>
            </details>

            <section className="commission-preview">
              <span className="sr-only" role="status" aria-live="polite">{commissionAnnouncement}</span>
              <div className="commission-preview__heading">
                <Calculator aria-hidden="true" />
                <span>
                  <small>{previewHasPayPlan ? "Estimated commission" : "Commission unavailable"}</small>
                  <strong>{preview ? formatCurrency(preview.sale?.estimatedCommissionCents ?? 0, true) : "Not calculated"}</strong>
                </span>
              </div>
              {preview && previewPayPlan ? (
                <>
                  <dl>
                    <div>
                      <dt>Month</dt>
                      <dd>{monthLabel(preview.month.monthKey)}</dd>
                    </div>
                    <div>
                      <dt>Delivered</dt>
                      <dd>{preview.month.deliveredCount}</dd>
                    </div>
                    <div>
                      <dt>Front rate</dt>
                      <dd>{formatPercent(preview.month.frontRateBps)}</dd>
                    </div>
                    <div>
                      <dt>Estimated month total</dt>
                      <dd>{formatCurrency(preview.month.estimatedCommissionCents)}</dd>
                    </div>
                  </dl>
                  <p>
                    {values.status !== "delivered"
                      ? "Pending sales stay saved but do not count toward volume or commission."
                      : isAccelerated
                        ? `${formatPercent(previewPayPlan.acceleratedFrontRateBps)} front commission applies to every valid delivered sale this month because the month is above ${previewPayPlan.acceleratedThresholdExclusive} deliveries.`
                        : `Sell more than ${previewPayPlan.acceleratedThresholdExclusive} valid delivered vehicles this month to apply ${formatPercent(previewPayPlan.acceleratedFrontRateBps)} front commission to every valid delivered sale that month.`}
                  </p>
                </>
              ) : (
                <p>{payPlanCoverageMessage(payPlanSchedule, previewMonthKey)}</p>
              )}
            </section>
          </div>

          <div className="sale-form__footer">
            <div className="sale-form__footer-estimate">
              <Calculator aria-hidden="true" />
              <span>
                <small>{previewHasPayPlan ? "Est. commission" : "Commission unavailable"}</small>
                <strong>{footerEstimate}</strong>
              </span>
            </div>
            <div className="sale-form__footer-actions">
              <Button type="button" variant="outline" onClick={() => requestOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
              {!saleToEdit ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSaving || Boolean(conflictSaleId) || (duplicateMatches.length > 0 && !duplicateConfirmed)}
                  onClick={(event) => void submit(event as unknown as FormEvent, true)}
                >
                  Save &amp; add another
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={isSaving || Boolean(conflictSaleId) || (duplicateMatches.length > 0 && !duplicateConfirmed)}
              >
                {isSaving ? "Saving…" : saleToEdit ? "Save changes" : "Save sale"}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your entries have not been saved. Continue editing or discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDiscardDialogOpen(false)}>
              Continue editing
            </Button>
            <Button type="button" variant="destructive" onClick={closeWithoutPrompt}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
