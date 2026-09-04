import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import "./sales-v2.css";
import "./sale-autosave.css";
import { AlertCircle, Calculator, Check, CloudCheck, LoaderCircle, ShieldCheck } from "lucide-react";
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
  getMinimumFrontCommissionCents,
  getPayPlanForMonth,
  getPayPlanSchedule,
  hasPayPlanCoverage,
  payPlanCoverageMessage,
} from "@/domain/payPlan";
import type { PaymentMethod, ProfileSettings, Sale } from "@/domain/types";
import {
  type SaleFormErrors,
  type SaleFormValues,
  validateSaleForm,
} from "@/domain/validation";
import { cn } from "@/lib/utils";
import { isSaleWriteConflictError } from "@/persistence/errors";
import { CLOUD_BUILD } from "@/persistence/database";
import {
  saleEditorProducts,
  useSaleEditorAutosave,
  type SaleSaveOptions,
} from "./useSaleEditorAutosave";

interface SaleFormSheetProps {
  open: boolean;
  saleToEdit: Sale | null;
  settings: ProfileSettings;
  sales: Sale[];
  returnFocusRef: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSave: (sale: Sale, isNew: boolean, options?: SaleSaveOptions) => Promise<Sale>;
  onLoadLatestSale: (saleId: string) => Promise<void>;
  onUnsavedChange?: (unsafe: boolean) => void;
}

const fiProductOptions: Array<{ key: "serviceContractSold" | "tireWheelSold" | "gapSold"; label: string }> = [
  { key: "serviceContractSold", label: "Service contract / warranty" },
  { key: "tireWheelSold", label: "Tire & Wheel" },
  { key: "gapSold", label: "GAP" },
];

const paymentOptions: Array<{ value: PaymentMethod; label: string }> = [
  { value: "dealer_financed", label: "Finance" },
  { value: "cash", label: "Cash" },
  { value: "outside_financing", label: "Outside Finance" },
];

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
        manualFrontCommissionEnabled: sale.frontCommissionOverrideCents != null,
        frontCommissionOverride: formatCurrencyInput(sale.frontCommissionOverrideCents ?? null),
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
        manualFrontCommissionEnabled: false,
        frontCommissionOverride: "",
        notes: "",
      };
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
  onUnsavedChange,
}: SaleFormSheetProps) {
  const [initialSnapshot] = useState(() => ({
    values: valuesForSale(saleToEdit, settings.selectedMonth),
    fiProducts: saleEditorProducts(saleToEdit),
  }));
  const [errors, setErrors] = useState<SaleFormErrors>({});
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [manualSaveError, setSaveError] = useState<string | null>(null);
  const [manualConflictSaleId, setConflictSaleId] = useState<string | null>(null);
  const [isLoadingLatest, setIsLoadingLatest] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [loadLatestDialogOpen, setLoadLatestDialogOpen] = useState(false);
  const [startFreshDialogOpen, setStartFreshDialogOpen] = useState(false);
  const [commissionAnnouncement, setCommissionAnnouncement] = useState("");
  const allowCloseRef = useRef(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const stockRef = useRef<HTMLInputElement>(null);
  const vehicleRef = useRef<HTMLInputElement>(null);
  const unitRef = useRef<HTMLButtonElement>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const fiRef = useRef<HTMLInputElement>(null);
  const manualFrontRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const focusedReadyRef = useRef(false);
  const focusFreshDraftRef = useRef(false);
  const payPlanSchedule = useMemo(
    () => getPayPlanSchedule(settings),
    [settings],
  );
  const earliestPayPlanMonth = useMemo(
    () => getEarliestPayPlanMonth(payPlanSchedule),
    [payPlanSchedule],
  );
  const autosave = useSaleEditorAutosave({
    open,
    initialSale: saleToEdit,
    initialSnapshot,
    sales,
    validate: ({ values: candidate }) => {
      const nextErrors = validateSaleForm(candidate);
      const saleMonth = monthKeyFromDate(candidate.saleDate);
      if (!nextErrors.saleDate && saleMonth && !hasPayPlanCoverage(payPlanSchedule, saleMonth)) {
        nextErrors.saleDate = payPlanCoverageMessage(payPlanSchedule, saleMonth);
      }
      return nextErrors;
    },
    canCommit: ({ values: candidate }, baselineId) => duplicateConfirmed || candidate.status !== "delivered" || !sales.some((sale) =>
      !sale.deletedAt && sale.id !== baselineId && sale.status === "delivered"
      && normalizeStock(sale.stockNumber) === normalizeStock(candidate.stockNumber),
    ),
    onSave,
  });
  const { values, setValues, fiProducts, setFiProducts } = autosave;
  const saveError = manualSaveError ?? autosave.error?.message ?? null;
  const conflictSaleId = manualConflictSaleId ?? (isSaleWriteConflictError(autosave.error) ? autosave.error.saleId : null);
  const draftConflict = Boolean(autosave.error && "code" in autosave.error && autosave.error.code === "EDITOR_DRAFT_CONFLICT");
  const currentSale = autosave.baselineSale ?? saleToEdit;
  const previewMonthKey = monthKeyFromDate(values.saleDate) || settings.selectedMonth;
  const previewHasPayPlan = hasPayPlanCoverage(payPlanSchedule, previewMonthKey);
  const enteredManualFront = parseCurrencyToCents(values.frontCommissionOverride);
  const hasManualFront = values.manualFrontCommissionEnabled && enteredManualFront !== null
    && Number.isSafeInteger(enteredManualFront) && enteredManualFront >= 0 && enteredManualFront <= 100_000_000;
  const isManualFrontIncomplete = values.manualFrontCommissionEnabled && !hasManualFront;
  const isDirty = autosave.hasChanges;

  useEffect(() => {
    if (!open || (!autosave.needsUnloadWarning && !isSaving)) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [open, autosave.needsUnloadWarning, isSaving]);

  useEffect(() => {
    onUnsavedChange?.(open && (autosave.needsUnloadWarning || isSaving));
    return () => onUnsavedChange?.(false);
  }, [open, autosave.needsUnloadWarning, isSaving, onUnsavedChange]);

  useEffect(() => {
    if (!open || !autosave.ready || focusedReadyRef.current) return;
    focusedReadyRef.current = true;
    customerRef.current?.focus();
  }, [open, autosave.ready]);

  const duplicateMatches = useMemo(() => {
    const key = normalizeStock(values.stockNumber);
    if (!key || values.status !== "delivered") return [];
    return sales.filter(
      (sale) =>
        !sale.deletedAt &&
        sale.id !== currentSale?.id &&
        sale.status === "delivered" &&
        normalizeStock(sale.stockNumber) === key,
    );
  }, [currentSale?.id, sales, values.status, values.stockNumber]);

  const preview = useMemo(() => {
    const monthKey = monthKeyFromDate(values.saleDate) || settings.selectedMonth;
    if (!hasPayPlanCoverage(payPlanSchedule, monthKey)) return null;
    const frontGrossCents = parseCurrencyToCents(values.frontGross);
    const fiGrossCents = parseCurrencyToCents(values.fiGross);
    const frontCommissionOverrideCents = values.manualFrontCommissionEnabled
      ? parseCurrencyToCents(values.frontCommissionOverride)
      : null;
    const draftId = currentSale?.id ?? "__draft__";
    const timestamp = currentSale?.createdAt ?? new Date().toISOString();
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
      frontCommissionOverrideCents: frontCommissionOverrideCents !== null
        && Number.isSafeInteger(frontCommissionOverrideCents)
        && frontCommissionOverrideCents >= 0 && frontCommissionOverrideCents <= 100_000_000
        ? frontCommissionOverrideCents : null,
      notes: values.notes.trim(),
      createdAt: timestamp,
      updatedAt: new Date().toISOString(),
      revision: currentSale?.revision ?? 1,
      source: currentSale?.source ?? "manual",
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
  }, [payPlanSchedule, currentSale, sales, settings.actualPaidByMonth, settings.selectedMonth, values]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCommissionAnnouncement(
        isManualFrontIncomplete
          ? "Enter your manual front commission to calculate this sale’s total."
          : preview
          ? `Estimated commission on this sale ${formatCurrency(preview.sale?.estimatedCommissionCents ?? 0, true)}.`
          : payPlanCoverageMessage(payPlanSchedule, previewMonthKey),
      );
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [isManualFrontIncomplete, payPlanSchedule, preview, previewMonthKey]);

  function updateValue<Key extends keyof SaleFormValues>(key: Key, value: SaleFormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    if (!conflictSaleId) setSaveError(null);
    if (key === "stockNumber" || key === "status") setDuplicateConfirmed(false);
  }

  function updateFiProduct(key: "serviceContractSold" | "tireWheelSold" | "gapSold", checked: boolean) {
    setFiProducts((current) => ({ ...current, [key]: checked }));
    if (!conflictSaleId) setSaveError(null);
  }

  function toggleManualFrontCommission(enabled: boolean) {
    setValues((current) => ({
      ...current,
      manualFrontCommissionEnabled: enabled,
      frontCommissionOverride: enabled ? current.frontCommissionOverride : "",
    }));
    setErrors((current) => ({ ...current, frontCommissionOverride: undefined }));
    if (!conflictSaleId) setSaveError(null);
    if (enabled) window.requestAnimationFrame(() => manualFrontRef.current?.focus());
  }

  function updatePaymentMethod(paymentMethod: PaymentMethod | undefined) {
    setFiProducts((current) => ({ ...current, paymentMethod, dealerFinanced: paymentMethod === undefined ? undefined : paymentMethod === "dealer_financed" }));
    if (!conflictSaleId) setSaveError(null);
  }

  async function loadLatestSale() {
    if (isLoadingLatest) return;
    if (draftConflict) {
      setLoadLatestDialogOpen(false);
      setSaveError(null);
      autosave.retryOpening();
      return;
    }
    if (!conflictSaleId) return;
    setIsLoadingLatest(true);
    try {
      await autosave.discardDraft();
      setLoadLatestDialogOpen(false);
      await onLoadLatestSale(conflictSaleId);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "The latest sale could not be opened. Your draft is still here.");
    } finally {
      setIsLoadingLatest(false);
    }
  }

  async function startFreshDraft() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await autosave.discardNewDraft();
      setErrors({});
      setDuplicateConfirmed(false);
      setSaveError(null);
      setConflictSaleId(null);
      focusFreshDraftRef.current = true;
      setStartFreshDialogOpen(false);
      window.setTimeout(() => {
        focusFreshDraftRef.current = false;
        customerRef.current?.focus();
      }, 0);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Your draft could not be cleared. Its entries are still here.");
      setStartFreshDialogOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  function closeWithoutPrompt() {
    allowCloseRef.current = true;
    setDiscardDialogOpen(false);
    onOpenChange(false);
  }

  async function requestOpenChange(nextOpen: boolean) {
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
    if (!autosave.ready && !isDirty) {
      closeWithoutPrompt();
      return;
    }
    setIsSaving(true);
    try {
      await autosave.saveNow();
      closeWithoutPrompt();
    } catch {
      if (autosave.canCloseSafely()) closeWithoutPrompt();
      else setDiscardDialogOpen(true);
    } finally {
      setIsSaving(false);
    }
  }

  async function submit(event: FormEvent, addAnother = false) {
    event.preventDefault();
    if (isSaving || conflictSaleId || !autosave.ready) return;
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
        frontCommissionOverride: manualFrontRef,
        notes: notesRef,
      };
      const firstInvalid = (Object.keys(nextErrors) as Array<keyof SaleFormValues>)
        .find((key) => Boolean(nextErrors[key]));
      window.requestAnimationFrame(() => firstInvalid && refs[firstInvalid]?.current?.focus());
      return;
    }
    if (duplicateMatches.length > 0 && !duplicateConfirmed) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const wasNew = autosave.isNew;
      const saved = await autosave.saveNow(wasNew);
      if (!saved) return;
      if (addAnother && wasNew) {
        const nextValues = valuesForSale(
          null,
          monthKeyFromDate(values.saleDate) || settings.selectedMonth,
        );
        autosave.startAnother({ values: nextValues, fiProducts: saleEditorProducts(null) });
        setErrors({});
        setDuplicateConfirmed(false);
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
  const hasNonstandardCredit = Number(values.unitCredit) !== 1 && Number(values.unitCredit) !== 0.5;
  const footerEstimate = isManualFrontIncomplete ? "—" : preview
    ? formatCurrency(preview.sale?.estimatedCommissionCents ?? 0, true)
    : "Not calculated";
  const enteredFrontGross = parseCurrencyToCents(values.frontGross);
  const enteredFiGross = parseCurrencyToCents(values.fiGross);
  const hasFrontGross = enteredFrontGross !== null && !Number.isNaN(enteredFrontGross);
  const hasFiGross = enteredFiGross !== null && !Number.isNaN(enteredFiGross);
  const hasFrontPay = hasManualFront || (!values.manualFrontCommissionEnabled && hasFrontGross);
  const frontEstimate = preview && hasFrontPay ? formatCurrency(preview.sale?.frontCommissionCents ?? 0, true) : "—";
  const fiEstimate = preview && hasFiGross ? formatCurrency(preview.sale?.fiCommissionCents ?? 0, true) : "—";
  const frontMethod = preview?.sale?.frontCommissionMethod;
  const frontMethodLabel = isManualFrontIncomplete ? "Enter amount"
    : frontMethod === "mini" ? "Mini"
    : frontMethod === "manual" ? "Manual"
    : frontMethod === "percentage" && preview ? formatPercent(preview.month.frontRateBps)
    : null;
  const frontExplanation = isManualFrontIncomplete ? "Enter your front payout"
    : frontMethod === "manual" ? "Your entered front payout; not split again"
    : frontMethod === "mini" ? `${formatCurrency(preview?.sale?.minimumFrontCommissionCents ?? 0, true)} mini${Number(values.unitCredit) === 0.5 ? " · half-deal share" : ""}`
    : hasFrontGross && preview ? `${formatPercent(preview.month.frontRateBps)} of ${formatCurrency(enteredFrontGross!, true)} front gross`
    : "Awaiting front gross";

  return (
    <>
    <Sheet open={open} onOpenChange={(next) => void requestOpenChange(next)}>
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
              <SheetTitle>{autosave.isNew ? "Add sale" : "Edit sale"}</SheetTitle>
              <SheetDescription>
                {autosave.isNew ? "Your draft saves automatically. Add it when the details are ready." : "Changes save automatically as you work."}
              </SheetDescription>
            </SheetHeader>

            {autosave.restored && isDirty ? (
              <div className="sale-draft-restored">
                <p>Your unfinished {autosave.isNew ? "sale" : "changes"} are restored. Continue where you left off.</p>
                {autosave.isNew ? <Button type="button" variant="ghost" size="sm" disabled={isSaving || !autosave.ready} onClick={() => setStartFreshDialogOpen(true)}>Start fresh</Button> : null}
              </div>
            ) : null}

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
                  <strong>{!autosave.ready ? "Draft could not open" : "Changes need attention"}</strong>
                  <span>{saveError}</span>
                  {conflictSaleId || draftConflict ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="form-summary-error__action"
                      disabled={isLoadingLatest}
                      onClick={() => setLoadLatestDialogOpen(true)}
                    >
                      {isLoadingLatest ? "Loading latest…" : draftConflict ? "Reload saved draft" : "Load latest"}
                    </Button>
                  ) : !autosave.ready ? (
                    <Button type="button" variant="outline" size="sm" className="form-summary-error__action" onClick={autosave.retryOpening}>Try again</Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" className="form-summary-error__action" disabled={autosave.working} onClick={() => { setSaveError(null); void autosave.saveNow().catch(() => {}); }}>Retry save</Button>
                  )}
                </div>
              </div>
            ) : null}

            <fieldset className="sale-editor-fields" disabled={!autosave.ready || isSaving} aria-busy={!autosave.ready}>
            <fieldset className="form-section sale-status-section">
              <legend>Sale status</legend>
              <div className="sale-status-controls">
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
                <div className="sale-credit-controls">
                  <label htmlFor="split-deal-credit" className="sale-split-credit">
                    <Checkbox
                      ref={unitRef}
                      id="split-deal-credit"
                      checked={Number(values.unitCredit) === 0.5}
                      aria-invalid={Boolean(errors.unitCredit)}
                      aria-describedby={`unit-credit-help${errors.unitCredit ? " unit-credit-error" : ""}`}
                      onCheckedChange={(checked) => updateValue("unitCredit", checked === true ? "0.5" : "1")}
                    />
                    <span>Split deal</span>
                  </label>
                  {hasNonstandardCredit ? <small className="sale-existing-credit">Existing credit: {values.unitCredit}</small> : null}
                </div>
              </div>
              <p className="status-choice-help">{selectedStatus.description}</p>
              <span id="unit-credit-help" className="sr-only">Check for half a unit of credit and half the mini{previewPayPlan ? ` (${formatCurrency(getMinimumFrontCommissionCents(previewPayPlan) / 2)})` : ""}. Percentage commission uses your entered gross; enter your share of gross on a split deal. A manual front payout is never split again. An existing custom credit is kept unless you change this option.</span>
              {errors.unitCredit ? <span id="unit-credit-error" className="field-error">{errors.unitCredit}</span> : null}
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

              <div className="field-group sale-vehicle-field">
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
                <label htmlFor="manual-front-commission" className="sale-manual-payout-toggle">
                  <Checkbox
                    id="manual-front-commission"
                    checked={values.manualFrontCommissionEnabled}
                    aria-controls={values.manualFrontCommissionEnabled ? "manual-front-commission-fields" : undefined}
                    onCheckedChange={(checked) => toggleManualFrontCommission(checked === true)}
                  />
                  <span>Spiff / manual front commission</span>
                </label>
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
                <span id="fi-gross-help" className="field-help">Add the total when F&amp;I provides it. Blank means not received yet.</span>
                {errors.fiGross ? <span id="fi-gross-error" className="field-error">{errors.fiGross}</span> : null}
              </div>
              {values.manualFrontCommissionEnabled ? (
                <div id="manual-front-commission-fields" className="sale-manual-payout-fields">
                  <div className="field-group">
                    <Label htmlFor="front-commission-override">Your front commission</Label>
                    <div className="money-input">
                      <span aria-hidden="true">$</span>
                      <Input
                        ref={manualFrontRef}
                        id="front-commission-override"
                        inputMode="decimal"
                        autoComplete="off"
                        value={values.frontCommissionOverride}
                        aria-required="true"
                        aria-invalid={Boolean(errors.frontCommissionOverride)}
                        aria-describedby={`front-commission-override-help${errors.frontCommissionOverride ? " front-commission-override-error" : ""}`}
                        onChange={(event) => updateValue("frontCommissionOverride", event.target.value)}
                        onBlur={() => {
                          const cents = parseCurrencyToCents(values.frontCommissionOverride);
                          if (cents !== null && Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000) {
                            updateValue("frontCommissionOverride", formatCurrencyInput(cents));
                          }
                        }}
                        placeholder="500.00"
                      />
                    </div>
                    {errors.frontCommissionOverride ? <span id="front-commission-override-error" className="field-error">{errors.frontCommissionOverride}</span> : null}
                  </div>
                  <p id="front-commission-override-help" className="field-help">Replaces calculated front pay—not added to it. Enter your share; F&amp;I stays separate.</p>
                </div>
              ) : null}
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
                Select each product sold.
              </p>
              <fieldset className="sale-payment-method">
                <legend>Payment method</legend>
                <div className="sale-payment-options">
                  {paymentOptions.map((option) => (
                    <label key={option.value} className={cn("sale-payment-choice", fiProducts.paymentMethod === option.value && "is-selected")}>
                      <input type="radio" name="payment-method" value={option.value} checked={fiProducts.paymentMethod === option.value} onChange={() => updatePaymentMethod(option.value)} aria-describedby="fi-financing-help" />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <div className="sale-payment-footer">
                  <p id="fi-financing-help" className="field-help">Finance: through us. Cash: no loan. Outside Finance: the customer’s lender.</p>
                  {fiProducts.paymentMethod !== undefined ? <button type="button" className="sale-payment-clear" onClick={() => updatePaymentMethod(undefined)}>Clear choice</button> : null}
                </div>
                {fiProducts.paymentMethod === undefined && fiProducts.dealerFinanced === false ? <p className="field-help">Choose Cash or Outside Finance when known.</p> : null}
              </fieldset>
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

            <div className="form-section sale-notes-section">
              <div className="field-group">
                <Label htmlFor="sale-notes">Notes <span className="optional-label">optional</span></Label>
                <Textarea
                  ref={notesRef}
                  id="sale-notes"
                  rows={2}
                  value={values.notes}
                  aria-invalid={Boolean(errors.notes)}
                  aria-describedby={`notes-character-count${errors.notes ? " sale-notes-error" : ""}`}
                  onChange={(event) => updateValue("notes", event.target.value)}
                  placeholder="Optional notes about this sale"
                />
                <span id="notes-character-count" className="character-count">{values.notes.length}/500</span>
                {errors.notes ? <span id="sale-notes-error" className="field-error">{errors.notes}</span> : null}
              </div>

              <div className="privacy-note">
                <ShieldCheck aria-hidden="true" />
                <p>
                  Keep credit, banking, ID, insurance details, and passwords out of this log.
                </p>
              </div>
            </div>

            <span className="sr-only" role="status" aria-live="polite">{commissionAnnouncement}</span>
            <section className="commission-preview sale-commission-preview" aria-labelledby="sale-commission-heading">
              <div className="commission-preview__heading">
                <Calculator aria-hidden="true" />
                <span>
                  <h3 id="sale-commission-heading">This sale’s commission</h3>
                  <small>{previewHasPayPlan ? "Front + F&I · monthly volume bonus is separate" : "Commission unavailable"}</small>
                </span>
              </div>
              {preview && previewPayPlan ? (
                <>
                  <dl className="sale-commission-components">
                    <div>
                      <dt>Front commission</dt>
                      <dd><strong>{frontEstimate}</strong><small>{frontExplanation}</small></dd>
                    </div>
                    <div>
                      <dt>F&amp;I commission</dt>
                      <dd><strong>{fiEstimate}</strong><small>{hasFiGross ? `${formatPercent(previewPayPlan.fiRateBps)} of ${formatCurrency(enteredFiGross!, true)} F&I gross` : "Awaiting F&I gross"}</small></dd>
                    </div>
                    <div className="sale-commission-total">
                      <dt>Sale total</dt>
                      <dd><strong>{footerEstimate}</strong><small>{isManualFrontIncomplete ? "Enter your front payout" : hasManualFront ? (hasFiGross ? "Manual front + F&I commission" : "Manual front; awaiting F&I gross") : hasFrontGross && hasFiGross ? "Estimated from this sale’s gross" : "From gross entered so far"}</small></dd>
                    </div>
                  </dl>
                  <p>
                    {values.status !== "delivered"
                      ? "Pending delivery — this sale does not count toward commission yet."
                      : values.manualFrontCommissionEnabled
                        ? "Manual payout replaces the rate and mini for this sale. Gross reporting and monthly bonuses stay unchanged."
                      : frontMethod === "mini"
                        ? `${formatCurrency(preview.sale?.minimumFrontCommissionCents ?? 0, true)} mini applies because percentage commission is lower.${hasFrontGross && enteredFrontGross! < 0 ? " Negative front gross affects gross reporting, not this payout." : ""}`
                      : isAccelerated
                        ? `${formatPercent(previewPayPlan.acceleratedFrontRateBps)} front rate includes the retroactive increase for selling over ${previewPayPlan.acceleratedThresholdExclusive} vehicles in ${monthLabel(preview.month.monthKey)}.`
                        : `This sale’s front rate becomes ${formatPercent(previewPayPlan.acceleratedFrontRateBps)} retroactively when the month finishes with over ${previewPayPlan.acceleratedThresholdExclusive} delivered vehicles.`}
                  </p>
                  {preview.sale?.milestone && !isManualFrontIncomplete ? (
                    <section className="sale-milestone-summary" aria-labelledby="sale-milestone-heading">
                      <div className="sale-milestone-summary__heading">
                        <div>
                          <h4 id="sale-milestone-heading">Extra earnings unlocked</h4>
                          <span>Delivery {preview.sale.milestone.deliveryOrdinal}{preview.sale.milestone.isPartial ? " · partial estimate" : ""}</span>
                        </div>
                        <strong>{formatCurrency(preview.sale.milestone.extraEarningsUnlockedCents, true)}</strong>
                      </div>
                      <dl className="sale-milestone-summary__lines">
                        {preview.sale.milestone.unlocksHigherRate ? (
                          <div>
                            <dt>Prior-sales rate increase <small>{formatPercent(preview.sale.milestone.frontRateBps, preview.sale.milestone.frontRateBps % 100 === 0 ? 0 : preview.sale.milestone.frontRateBps % 10 === 0 ? 1 : 2)} retroactive rate</small></dt>
                            <dd>{formatCurrency(preview.sale.milestone.priorSalesRetroactiveCents, true)}</dd>
                          </div>
                        ) : null}
                        {preview.sale.milestone.bonusAddedCents > 0 ? (
                          <div><dt>Added volume bonus</dt><dd>{formatCurrency(preview.sale.milestone.bonusAddedCents, true)}</dd></div>
                        ) : null}
                        <div className="sale-milestone-summary__total">
                          <dt>Milestone impact <small>This sale + extra earnings unlocked</small></dt>
                          <dd>{formatCurrency(preview.sale.milestone.totalMilestoneImpactCents, true)}</dd>
                        </div>
                      </dl>
                      {preview.sale.milestone.isPartial ? (
                        <p className="sale-milestone-summary__partial">
                          {preview.sale.milestone.missingPriorFrontGrossCount > 0
                            ? `Rate increase is partial: front gross is missing on ${preview.sale.milestone.missingPriorFrontGrossCount} earlier ${preview.sale.milestone.missingPriorFrontGrossCount === 1 ? "sale" : "sales"}.`
                            : "Milestone impact is partial until this sale’s missing gross is entered."}
                        </p>
                      ) : null}
                      <p className="sale-milestone-summary__note">Already included in monthly totals. These amounts explain this delivery’s impact; they are not added again.</p>
                    </section>
                  ) : null}
                </>
              ) : (
                <p>{payPlanCoverageMessage(payPlanSchedule, previewMonthKey)}</p>
              )}
            </section>
            </fieldset>
          </div>

          <div className="sale-form__footer">
            <div className={cn("sale-form__save-state", saveError && "has-error")} role="status" aria-live="polite" aria-atomic="true">
              {autosave.working || isSaving || (!autosave.ready && !saveError) ? <LoaderCircle className="sale-save-spinner" aria-hidden="true" /> : saveError ? <AlertCircle aria-hidden="true" /> : <CloudCheck aria-hidden="true" />}
              <span>{saveError ? (autosave.hasProtectedDraft ? "Draft saved · changes need attention" : "Changes not saved")
                : !autosave.ready ? "Opening your draft…"
                : autosave.working || isSaving ? "Saving…"
                : autosave.hasProtectedDraft ? (autosave.isNew ? `Draft saved ${CLOUD_BUILD ? "to cloud" : "on this device"} · not in your sales yet` : "Draft saved · complete the fields to update this sale")
                : isDirty ? "Changes waiting to save…"
                : autosave.isNew ? "Draft saves automatically · add the sale when ready"
                : CLOUD_BUILD ? "Saved to cloud" : "Saved on this device"}</span>
            </div>
            <div className="sale-form__footer-estimate sale-footer-breakdown" role="group" aria-label="This sale’s estimated commission">
              <span><small>Front</small><strong>{frontEstimate}</strong>{frontMethodLabel ? <span className="sale-footer-method">{frontMethodLabel}</span> : null}</span>
              <span><small>F&amp;I</small><strong>{fiEstimate}</strong></span>
              <span className="sale-footer-total"><small>Sale total</small><strong>{footerEstimate}</strong></span>
            </div>
            <div className="sale-form__footer-actions">
              {autosave.isNew || saveError || (isDirty && autosave.hasProtectedDraft) ? (
                <Button type="button" variant="outline" onClick={() => void requestOpenChange(false)} disabled={isSaving}>Close</Button>
              ) : null}
              {autosave.isNew ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSaving || !autosave.ready || Boolean(conflictSaleId) || (duplicateMatches.length > 0 && !duplicateConfirmed)}
                  onClick={(event) => void submit(event as unknown as FormEvent, true)}
                >
                  Add &amp; enter next
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={isSaving || !autosave.ready || Boolean(conflictSaleId) || (duplicateMatches.length > 0 && !duplicateConfirmed)}
              >
                {isSaving ? "Saving…" : autosave.isNew ? "Add sale" : "Done"}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>These changes have not saved yet</DialogTitle>
            <DialogDescription>
              Keep this editor open and reconnect to save. Closing now can lose your latest entries; earlier saved changes will remain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDiscardDialogOpen(false)}>
              Continue editing
            </Button>
            <Button type="button" variant="destructive" onClick={closeWithoutPrompt}>
              Close without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={loadLatestDialogOpen} onOpenChange={setLoadLatestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace this draft with the saved {draftConflict ? "draft" : "sale"}?</DialogTitle>
            <DialogDescription>{draftConflict ? "This draft" : "The sale"} changed in another tab or device. Loading the latest version discards the unfinished changes shown here. Previously saved changes remain.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLoadLatestDialogOpen(false)}>Keep editing</Button>
            <Button type="button" disabled={isLoadingLatest} onClick={() => void loadLatestSale()}>{isLoadingLatest ? "Loading…" : "Load latest"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={startFreshDialogOpen} onOpenChange={(next) => { if (!isSaving) setStartFreshDialogOpen(next); }}>
        <DialogContent onCloseAutoFocus={(event) => {
          if (!focusFreshDraftRef.current) return;
          event.preventDefault();
        }}>
          <DialogHeader>
            <DialogTitle>Start a fresh sale?</DialogTitle>
            <DialogDescription>This removes only this unfinished draft and its entries. No saved sales or commission totals will change.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSaving} onClick={() => setStartFreshDialogOpen(false)}>Keep draft</Button>
            <Button type="button" variant="destructive" disabled={isSaving} onClick={() => void startFreshDraft()}>{isSaving ? "Clearing draft…" : "Discard draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
