import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getPaymentMethod } from "@/domain/financing";
import { formatCurrencyInput, parseCurrencyToCents } from "@/domain/money";
import type { Sale } from "@/domain/types";
import type { SaleFormErrors, SaleFormValues } from "@/domain/validation";
import { captureStorageContext } from "@/persistence/database";
import {
  clearEditorDraft,
  loadEditorDraft,
  saveEditorDraft,
  type EditorDraftPayload,
  type EditorDraftRecord,
} from "@/persistence/editorDrafts";
import { SaleWriteConflictError, isSaleWriteConflictError, type SaleVersionToken } from "@/persistence/errors";

export type FiProductValues = EditorDraftPayload["fiProducts"];
export type SaleEditorSnapshot = Pick<EditorDraftPayload, "values" | "fiProducts">;
export interface SaleSaveOptions { silent?: boolean; expectedVersion?: SaleVersionToken }

export function saleEditorValues(sale: Sale): SaleFormValues {
  return {
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
  };
}

export function saleEditorProducts(sale: Sale | null): FiProductValues {
  if (!sale) return { serviceContractSold: false, tireWheelSold: false, gapSold: false };
  return {
    serviceContractSold: sale.serviceContractSold,
    tireWheelSold: sale.tireWheelSold,
    gapSold: sale.gapSold,
    dealerFinanced: sale.dealerFinanced,
    paymentMethod: getPaymentMethod(sale) === "dealer_financed" ? "dealer_financed" : sale.paymentMethod,
  };
}

function currencyKey(value: string): number | string | null {
  const cents = parseCurrencyToCents(value);
  return Number.isNaN(cents) ? value.trim() : cents;
}

/** Formatting on blur must not create another financial revision. */
export function saleEditorContentKey(snapshot: SaleEditorSnapshot): string {
  const { values, fiProducts } = snapshot;
  const credit = values.unitCredit.trim() ? Number(values.unitCredit) : Number.NaN;
  return JSON.stringify({
    ...values,
    customerLastName: values.customerLastName.trim(),
    stockNumber: values.stockNumber.trim(),
    vehicleDescription: values.vehicleDescription.trim(),
    unitCredit: Number.isFinite(credit) ? credit : values.unitCredit.trim(),
    frontGross: currencyKey(values.frontGross),
    fiGross: currencyKey(values.fiGross),
    frontCommissionOverride: values.manualFrontCommissionEnabled ? currencyKey(values.frontCommissionOverride) : null,
    notes: values.notes.trim(),
    serviceContractSold: fiProducts.serviceContractSold,
    tireWheelSold: fiProducts.tireWheelSold,
    gapSold: fiProducts.gapSold,
    dealerFinanced: fiProducts.dealerFinanced,
    paymentMethod: fiProducts.paymentMethod,
  });
}

function snapshotForSale(sale: Sale): SaleEditorSnapshot {
  return { values: saleEditorValues(sale), fiProducts: saleEditorProducts(sale) };
}

function buildSale(snapshot: SaleEditorSnapshot, baseline: Sale | null, draftId: string): Sale {
  const { values, fiProducts } = snapshot;
  const now = new Date().toISOString();
  return {
    ...baseline,
    id: baseline?.id ?? draftId,
    profileId: baseline?.profileId ?? "primary",
    saleDate: values.saleDate,
    customerLastName: values.customerLastName.trim(),
    stockNumber: values.stockNumber.trim(),
    vehicleDescription: values.vehicleDescription.trim(),
    status: values.status,
    unitCreditBasis: Math.round(Number(values.unitCredit) * 1_000),
    frontGrossCents: parseCurrencyToCents(values.frontGross),
    fiGrossCents: parseCurrencyToCents(values.fiGross),
    frontCommissionOverrideCents: values.manualFrontCommissionEnabled ? parseCurrencyToCents(values.frontCommissionOverride) : null,
    ...fiProducts,
    // An explicitly cleared payment choice must also clear an older value.
    paymentMethod: fiProducts.paymentMethod,
    dealerFinanced: fiProducts.dealerFinanced,
    notes: values.notes.trim(),
    createdAt: baseline?.createdAt ?? now,
    updatedAt: now,
    revision: baseline ? baseline.revision + 1 : 1,
    source: baseline?.source ?? "manual",
  };
}

function isConflict(error: unknown): boolean {
  return isSaleWriteConflictError(error) || (
    typeof error === "object" && error !== null && "code" in error && error.code === "EDITOR_DRAFT_CONFLICT"
  );
}

interface UseSaleEditorAutosaveOptions {
  open: boolean;
  initialSale: Sale | null;
  initialSnapshot: SaleEditorSnapshot;
  sales: Sale[];
  validate: (snapshot: SaleEditorSnapshot) => SaleFormErrors;
  canCommit: (snapshot: SaleEditorSnapshot, baselineId?: string) => boolean;
  onSave: (sale: Sale, isNew: boolean, options?: SaleSaveOptions) => Promise<Sale>;
  delayMs?: number;
}

/**
 * Raw drafts and committed sales have deliberately different lifetimes. A
 * draft can contain incomplete input; only valid sales affect the ledger.
 */
export function useSaleEditorAutosave(options: UseSaleEditorAutosaveOptions) {
  const [snapshot, setSnapshot] = useState(options.initialSnapshot);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [restored, setRestored] = useState(false);
  const [saveCount, setSaveCount] = useState(0);
  const [metadata, setMetadata] = useState({
    baselineSale: options.initialSale,
    committedKey: saleEditorContentKey(options.initialSnapshot),
    protectedRaw: "",
  });
  const [isNew, setIsNew] = useState(!options.initialSale);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [assertStorageContext] = useState(captureStorageContext);
  const optionsRef = useRef(options);
  const snapshotRef = useRef(snapshot);
  const baselineRef = useRef(options.initialSale);
  const initialSnapshotRef = useRef(options.initialSnapshot);
  const draftIdRef = useRef(options.initialSale?.id ?? crypto.randomUUID());
  const draftKeyRef = useRef(options.initialSale ? `sale:${options.initialSale.id}` : "new-sale");
  const draftRecordRef = useRef<EditorDraftRecord | null>(null);
  const committedKeyRef = useRef(saleEditorContentKey(options.initialSnapshot));
  const protectedRawRef = useRef("");
  const workRef = useRef<Promise<Sale | null> | null>(null);
  const lifetimeRef = useRef(0);
  const activeRef = useRef(false);
  const readyRef = useRef(false);
  const errorRef = useRef<Error | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
    snapshotRef.current = snapshot;
  }, [options, snapshot]);

  const publishMetadata = useCallback(() => {
    setMetadata({
      baselineSale: baselineRef.current,
      committedKey: committedKeyRef.current,
      protectedRaw: protectedRawRef.current,
    });
  }, []);

  const assertActive = useCallback((generation = lifetimeRef.current) => {
    assertStorageContext();
    if (!activeRef.current || generation !== lifetimeRef.current) {
      throw new Error("This sale editor is no longer open.");
    }
  }, [assertStorageContext]);

  useEffect(() => {
    if (!options.open) return;
    activeRef.current = true;
    const generation = ++lifetimeRef.current;
    readyRef.current = false;
    errorRef.current = null;
    void loadEditorDraft(draftKeyRef.current).then(async (record) => {
      assertActive(generation);
      draftRecordRef.current = record;
      if (record.payload) {
        const payload = record.payload;
        // A commit may have succeeded immediately before its draft cleanup
        // was interrupted. Reuse that sale, never create a duplicate ID.
        const alreadyCreated = optionsRef.current.sales.find((sale) => sale.id === payload.draftId);
        const restoredSnapshot = { values: payload.values, fiProducts: payload.fiProducts };
        const matchesSavedSale = alreadyCreated && !alreadyCreated.deletedAt
          && saleEditorContentKey(snapshotForSale(alreadyCreated)) === saleEditorContentKey(restoredSnapshot);
        if (matchesSavedSale) {
          const cleared = await clearEditorDraft(draftKeyRef.current, record.revision);
          assertActive(generation);
          draftRecordRef.current = cleared;
          // An interrupted Add sale already reached the ledger. The next Add
          // sale opens a fresh draft instead of quietly duplicating it.
          if (!payload.baseSale && draftKeyRef.current === "new-sale") {
            baselineRef.current = null;
            draftIdRef.current = crypto.randomUUID();
            committedKeyRef.current = saleEditorContentKey(initialSnapshotRef.current);
            snapshotRef.current = initialSnapshotRef.current;
            setSnapshot(initialSnapshotRef.current);
            protectedRawRef.current = "";
            setRestored(false);
            setIsNew(true);
            publishMetadata();
            readyRef.current = true;
            setReady(true);
            return;
          }
        }
        const baseline = matchesSavedSale ? alreadyCreated : payload.baseSale ?? alreadyCreated ?? null;
        draftIdRef.current = payload.draftId;
        baselineRef.current = baseline;
        setIsNew(!baseline);
        const savedSnapshot = baseline ? snapshotForSale(baseline) : initialSnapshotRef.current;
        committedKeyRef.current = saleEditorContentKey(savedSnapshot);
        snapshotRef.current = restoredSnapshot;
        setSnapshot(restoredSnapshot);
        protectedRawRef.current = JSON.stringify(restoredSnapshot);
        setRestored(true);
        if (alreadyCreated?.deletedAt || (!payload.baseSale && alreadyCreated && !matchesSavedSale)) {
          const conflict = new SaleWriteConflictError(alreadyCreated.id, alreadyCreated.stockNumber);
          errorRef.current = conflict;
          setError(conflict);
        }
      } else {
        const baseline = optionsRef.current.initialSale
          ? optionsRef.current.sales.find((sale) => sale.id === optionsRef.current.initialSale?.id) ?? optionsRef.current.initialSale
          : null;
        const next = baseline ? snapshotForSale(baseline) : initialSnapshotRef.current;
        baselineRef.current = baseline;
        draftIdRef.current = baseline?.id ?? draftIdRef.current;
        committedKeyRef.current = saleEditorContentKey(next);
        protectedRawRef.current = "";
        snapshotRef.current = next;
        setSnapshot(next);
        setIsNew(!baseline);
        setRestored(false);
      }
      publishMetadata();
      readyRef.current = true;
      setReady(true);
    }).catch((caught: unknown) => {
      if (!activeRef.current || generation !== lifetimeRef.current) return;
      const nextError = caught instanceof Error ? caught : new Error("Your saved draft could not be opened. Reconnect and try again.");
      errorRef.current = nextError;
      setError(nextError);
    });
    return () => {
      activeRef.current = false;
      lifetimeRef.current += 1;
    };
  }, [options.open, loadAttempt, assertActive, publishMetadata]);

  const saveNow = useCallback(async function saveLatest(commitNew = false): Promise<Sale | null> {
    assertActive();
    if (!readyRef.current || !draftRecordRef.current) {
      throw errorRef.current ?? new Error("Wait for your saved draft to finish opening.");
    }
    if (workRef.current) {
      await workRef.current;
      assertActive();
      return saveLatest(commitNew);
    }
    if (errorRef.current && isConflict(errorRef.current)) throw errorRef.current;

    const current = snapshotRef.current;
    const rawKey = JSON.stringify(current);
    const contentKey = saleEditorContentKey(current);
    const dirty = contentKey !== committedKeyRef.current;
    const shouldCommit = Boolean(baselineRef.current) || commitNew;
    if (!dirty && !(commitNew && !baselineRef.current)) return baselineRef.current;
    const generation = lifetimeRef.current;

    const perform = async (): Promise<Sale | null> => {
      setWorking(true);
      errorRef.current = null;
      setError(null);
      try {
        if (rawKey !== protectedRawRef.current) {
          const record = await saveEditorDraft(draftKeyRef.current, {
            draftId: draftIdRef.current,
            baseSale: baselineRef.current,
            ...current,
          }, draftRecordRef.current!.revision);
          assertActive(generation);
          draftRecordRef.current = record;
          protectedRawRef.current = rawKey;
          publishMetadata();
        }
        const valid = Object.keys(optionsRef.current.validate(current)).length === 0;
        if (!shouldCommit || !valid || !optionsRef.current.canCommit(current, baselineRef.current?.id)) return null;

        const wasNew = !baselineRef.current;
        const submitted = buildSale(current, baselineRef.current, draftIdRef.current);
        const saved = await optionsRef.current.onSave(submitted, wasNew, {
          silent: !wasNew,
          ...(baselineRef.current ? { expectedVersion: { revision: baselineRef.current.revision, updatedAt: baselineRef.current.updatedAt } } : {}),
        });
        assertActive(generation);
        // This exact acknowledgment, not a later live snapshot, is the only
        // safe baseline for the next queued write.
        baselineRef.current = saved;
        committedKeyRef.current = contentKey;
        setIsNew(false);
        setSaveCount((count) => count + 1);
        publishMetadata();

        if (saleEditorContentKey(snapshotRef.current) === contentKey) {
          try {
            const cleared = await clearEditorDraft(draftKeyRef.current, draftRecordRef.current!.revision);
            assertActive(generation);
            draftRecordRef.current = cleared;
            protectedRawRef.current = "";
            setRestored(false);
            publishMetadata();
          } catch (cleanupError) {
            // The sale itself is acknowledged. Stable IDs make an interrupted
            // cleanup safe to resume; do not claim the sale failed or repeat it.
            assertActive(generation);
            if (isConflict(cleanupError)) {
              errorRef.current = cleanupError as Error;
              setError(cleanupError as Error);
            }
          }
        }
        return saved;
      } catch (caught) {
        if (activeRef.current && generation === lifetimeRef.current) {
          const nextError = caught instanceof Error ? caught : new Error("Your changes could not be saved. Keep this editor open and try again.");
          errorRef.current = nextError;
          setError(nextError);
        }
        throw caught;
      } finally {
        if (activeRef.current && generation === lifetimeRef.current) setWorking(false);
      }
    };
    const operation = perform();
    workRef.current = operation;
    try { return await operation; }
    finally { if (workRef.current === operation) workRef.current = null; }
  }, [assertActive, publishMetadata]);

  const rawKey = JSON.stringify(snapshot);
  const hasChanges = saleEditorContentKey(snapshot) !== metadata.committedKey;
  const validationKey = JSON.stringify(options.validate(snapshot));
  const canCommit = options.canCommit(snapshot, metadata.baselineSale?.id);
  useEffect(() => {
    if (!options.open || !ready || !hasChanges || isConflict(errorRef.current)) return;
    const timeout = window.setTimeout(() => { void saveNow().catch(() => {}); }, options.delayMs ?? 1_000);
    return () => window.clearTimeout(timeout);
  }, [rawKey, validationKey, canCommit, options.open, options.delayMs, ready, hasChanges, saveNow]);

  useEffect(() => {
    if (!options.open) return;
    const retryOnline = () => {
      if (readyRef.current && !isConflict(errorRef.current)) void saveNow().catch(() => {});
    };
    window.addEventListener("online", retryOnline);
    return () => window.removeEventListener("online", retryOnline);
  }, [options.open, saveNow]);

  const discardDraft = useCallback(async () => {
    assertActive();
    if (workRef.current) await workRef.current.catch(() => {});
    assertActive();
    if (!draftRecordRef.current) throw new Error("Your saved draft has not finished opening.");
    const cleared = await clearEditorDraft(draftKeyRef.current, draftRecordRef.current.revision);
    assertActive();
    draftRecordRef.current = cleared;
    protectedRawRef.current = "";
    publishMetadata();
    errorRef.current = null;
    setError(null);
  }, [assertActive, publishMetadata]);

  const startAnother = useCallback((next: SaleEditorSnapshot) => {
    assertActive();
    if (isConflict(errorRef.current)) throw errorRef.current;
    baselineRef.current = null;
    draftIdRef.current = crypto.randomUUID();
    initialSnapshotRef.current = next;
    committedKeyRef.current = saleEditorContentKey(next);
    protectedRawRef.current = "";
    publishMetadata();
    snapshotRef.current = next;
    setSnapshot(next);
    setIsNew(true);
    setRestored(false);
    errorRef.current = null;
    setError(null);
  }, [assertActive, publishMetadata]);

  const discardNewDraft = useCallback(async () => {
    const generation = lifetimeRef.current;
    assertActive(generation);
    if (workRef.current) await workRef.current.catch(() => {});
    assertActive(generation);
    if (baselineRef.current) throw new Error("This sale has already been added. Its saved details have not been changed.");
    if (!draftRecordRef.current) throw new Error("Wait for your draft to finish opening.");

    const perform = async (): Promise<null> => {
      setWorking(true);
      try {
        const cleared = await clearEditorDraft(draftKeyRef.current, draftRecordRef.current!.revision);
        assertActive(generation);
        draftRecordRef.current = cleared;
        errorRef.current = null;
        // Never reuse an abandoned ID: a past interrupted Add sale may have
        // reached the ledger even when its response did not reach this editor.
        startAnother(initialSnapshotRef.current);
        return null;
      } catch (caught) {
        if (activeRef.current && generation === lifetimeRef.current) {
          const nextError = caught instanceof Error ? caught : new Error("Your draft could not be cleared. Its entries are still here.");
          errorRef.current = nextError;
          setError(nextError);
        }
        throw caught;
      } finally {
        if (activeRef.current && generation === lifetimeRef.current) setWorking(false);
      }
    };
    // A queued autosave must observe the fresh form only after the discard
    // acknowledgment; otherwise it could recreate the abandoned draft.
    const operation = perform();
    workRef.current = operation;
    try { await operation; }
    finally { if (workRef.current === operation) workRef.current = null; }
  }, [assertActive, startAnother]);

  const setValues = useCallback((change: SaleFormValues | ((current: SaleFormValues) => SaleFormValues)) => {
    setSnapshot((current) => ({ ...current, values: typeof change === "function" ? change(current.values) : change }));
  }, []);
  const setFiProducts = useCallback((change: FiProductValues | ((current: FiProductValues) => FiProductValues)) => {
    setSnapshot((current) => ({ ...current, fiProducts: typeof change === "function" ? change(current.fiProducts) : change }));
  }, []);

  return {
    values: snapshot.values,
    fiProducts: snapshot.fiProducts,
    setValues,
    setFiProducts,
    ready,
    working,
    error,
    restored,
    isNew,
    saveCount,
    baselineSale: metadata.baselineSale,
    hasChanges,
    hasProtectedDraft: hasChanges && metadata.protectedRaw === rawKey,
    needsUnloadWarning: working || (hasChanges && metadata.protectedRaw !== rawKey),
    saveNow,
    discardDraft,
    discardNewDraft,
    startAnother,
    retryOpening: () => {
      setReady(false);
      setError(null);
      setLoadAttempt((attempt) => attempt + 1);
    },
    canCloseSafely: () => saleEditorContentKey(snapshotRef.current) === committedKeyRef.current
      || protectedRawRef.current === JSON.stringify(snapshotRef.current),
  };
}
