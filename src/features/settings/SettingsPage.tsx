import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  HardDrive,
  History,
  Info,
  Laptop,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useWorkspaceToast } from "@/hooks/useWorkspaceToast";
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
import { PageHeading, SectionHeader } from "@/components/shared";
import {
  AutomaticBackupCard,
  type AutomaticBackupController,
} from "@/features/settings/AutomaticBackupCard";
import { GoogleDriveBackupCard } from "@/features/settings/GoogleDriveBackupCard";
import {
  applySettingsNumber,
  createBonusRowIdentity,
  hasUnfinishedSettingsNumbers,
  parseSettingsNumber,
  settingsNumberText,
  type SettingsNumberField,
} from "@/features/settings/settingsNumberDraft";
import { comparableSettingsDraft, rebaseSettingsAfterSave, type LocalSettingsDraft } from "./settingsAutosave";
import { calculateMonth } from "@/domain/commission";
import {
  buildDemoSales,
  createPublicDemoHistoricPlan,
  DEMO_DATASET_LABEL,
  DEMO_DATASET_TITLE,
  demoRangeDescription,
  IS_PUBLIC_DEMO_BUILD,
} from "@/domain/demo";
import { monthKeyFromDate, monthLabel, shiftMonth, todayDateOnly } from "@/domain/date";
import {
  getCommissionGoalForMonth,
  getDeliveryGoalForMonth,
  normalizeCommissionGoalsByMonth,
  normalizeDeliveryGoalsByMonth,
} from "@/domain/goals";
import { formatCurrency } from "@/domain/money";
import {
  getWorkScheduleDays,
  normalizeDaysOffByMonth,
  normalizeDaysOffForMonth,
} from "@/domain/pacing";
import {
  getEarliestPayPlanMonth,
  getMinimumFrontCommissionCents,
  getPayPlanSchedule,
  hasPayPlanCoverage,
  upsertPayPlan,
  validatePayPlan,
} from "@/domain/payPlan";
import type {
  AuditEvent,
  BackupEnvelope,
  ImportPreview,
  ProfileSettings,
  Sale,
} from "@/domain/types";
import {
  createDiagnostics,
  downloadBlob,
  downloadPreparedBackup,
  parseBackupFile,
  prepareBackupFile,
  type PreparedBackupFile,
} from "@/lib/files";
import { previewLegacyWorkbook } from "@/lib/legacyImport";
import { exportWorkspaceBackup } from "@/lib/workspaceBackup";
import {
  getStorageHealth,
  CLOUD_BUILD,
  captureStorageContext,
  loadBackupSnapshot,
  importSales,
  loadDemoSales,
  removeDemoSales,
  replaceDatabaseFromBackup,
  requestPersistentStorage,
} from "@/persistence/database";
import { cn } from "@/lib/utils";
import "./settings-density.css";
import "./settings-v2.css";

export type SettingsInitialSection = "profile" | "schedule" | "pay-plan" | "data";

export interface SettingsPageProps {
  sales: Sale[];
  auditEvents: AuditEvent[];
  settings: ProfileSettings;
  onSaveSettings: (settings: ProfileSettings) => Promise<ProfileSettings>;
  onRefresh: () => Promise<void>;
  onBackupExported: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  automaticBackup: AutomaticBackupController;
  initialSection?: SettingsInitialSection;
}

type StorageHealth = Awaited<ReturnType<typeof getStorageHealth>>;

type SettingsFieldKey =
  | "salespersonName"
  | "monthlyGoal"
  | "monthlyCommissionGoal"
  | "payPlanVersion"
  | "payPlanEffectiveMonth"
  | "baseFrontRate"
  | "acceleratedFrontRate"
  | "acceleratedThreshold"
  | "fiRate"
  | "mini"
  | `bonusMinimum-${number}`
  | `bonusAmount-${number}`;

type SettingsCategory = "profile" | "schedule" | "pay-plan" | "bonuses" | "data";

interface SettingsValidationIssue {
  field: SettingsFieldKey;
  message: string;
}

interface SettingsDisclosureProps {
  title: string;
  description: string;
  summary: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  sectionRef?: RefObject<HTMLElement | null>;
}

function SettingsDisclosure({
  title,
  description,
  summary,
  icon,
  children,
  className,
  sectionRef,
}: SettingsDisclosureProps) {
  return (
    <section
      ref={sectionRef}
      className={cn("panel settings-section settings-disclosure settings-primary-section", className)}
      tabIndex={-1}
    >
      <header className="settings-disclosure__summary">
        <span className="settings-disclosure__icon" aria-hidden="true">{icon}</span>
        <span className="settings-disclosure__title">
          <strong role="heading" aria-level={2}>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="settings-disclosure__status">{summary}</span>
      </header>
      <div className="settings-disclosure__body">{children}</div>
    </section>
  );
}

function SettingsSecondaryDisclosure({
  title,
  description,
  summary,
  icon,
  children,
  className,
}: SettingsDisclosureProps) {
  return (
    <details className={cn("panel settings-section settings-disclosure settings-secondary-disclosure", className)}>
      <summary className="settings-disclosure__summary">
        <span className="settings-disclosure__icon" aria-hidden="true">{icon}</span>
        <span className="settings-disclosure__title">
          <strong role="heading" aria-level={2}>{title}</strong>
          <small>{description}</small>
        </span>
        <span className="settings-disclosure__status">{summary}</span>
        <ChevronDown className="settings-disclosure__chevron" aria-hidden="true" />
      </summary>
      <div className="settings-disclosure__body">{children}</div>
    </details>
  );
}

function categoryForInitialSection(section?: SettingsInitialSection): SettingsCategory {
  if (section === "schedule") return "schedule";
  if (section === "pay-plan") return "pay-plan";
  if (section === "data") return "data";
  return "profile";
}

function categoryForValidationField(field: SettingsFieldKey): SettingsCategory {
  if (field.startsWith("bonus")) return "bonuses";
  if (
    field === "payPlanVersion"
    || field === "payPlanEffectiveMonth"
    || field === "baseFrontRate"
    || field === "acceleratedFrontRate"
    || field === "acceleratedThreshold"
    || field === "fiRate"
    || field === "mini"
  ) {
    return "pay-plan";
  }
  return "profile";
}

function settingsErrorId(field: SettingsFieldKey): string {
  return `settings-${field.replace(/([A-Z])/g, "-$1").toLowerCase()}-error`;
}

function payPlanIssueField(
  issue: string,
  payPlan: ProfileSettings["payPlan"],
): SettingsFieldKey {
  if (issue.startsWith("Plan name")) return "payPlanVersion";
  if (issue.startsWith("Effective month")) return "payPlanEffectiveMonth";
  if (issue.startsWith("Base front rate")) return "baseFrontRate";
  if (issue.startsWith("Higher front rate")) return "acceleratedFrontRate";
  if (issue.startsWith("Higher-rate threshold")) return "acceleratedThreshold";
  if (issue.startsWith("F&I rate")) return "fiRate";
  if (issue.startsWith("Mini")) return "mini";

  const tierMinimumMatch = issue.match(/^Bonus tier (\d+) delivery minimum/);
  if (tierMinimumMatch) return `bonusMinimum-${Number(tierMinimumMatch[1]) - 1}`;
  const tierAmountMatch = issue.match(/^Bonus tier (\d+) must be/);
  if (tierAmountMatch) return `bonusAmount-${Number(tierAmountMatch[1]) - 1}`;

  if (issue.startsWith("Bonus delivery thresholds")) {
    const invalidIndex = payPlan.bonusTiers.findIndex(
      (tier, index, tiers) => index > 0 && tier.minimumDelivered <= tiers[index - 1].minimumDelivered,
    );
    return `bonusMinimum-${Math.max(0, invalidIndex)}`;
  }
  if (issue.startsWith("Bonus amounts cannot decrease")) {
    const invalidIndex = payPlan.bonusTiers.findIndex(
      (tier, index, tiers) => index > 0 && tier.amountCents < tiers[index - 1].amountCents,
    );
    return `bonusAmount-${Math.max(0, invalidIndex)}`;
  }
  if (issue.startsWith("Use no more than")) return "bonusMinimum-0";
  return "payPlanVersion";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "Not available";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function activityLabel(action: AuditEvent["action"]): string {
  const labels: Record<AuditEvent["action"], string> = {
    "sale.created": "Sale added",
    "sale.updated": "Sale updated",
    "sale.deleted": "Sale deleted",
    "sale.restored": "Sale restored",
    "settings.updated": "Settings updated",
    "import.completed": "Import completed",
    "restore.completed": "Backup restored",
    "backup.exported": "Backup download started",
    "demo.loaded": "Demo data loaded",
    "demo.removed": "Demo data removed",
  };
  return labels[action];
}

export function SettingsPage({
  sales,
  auditEvents,
  settings,
  onSaveSettings,
  onRefresh,
  onBackupExported,
  onDirtyChange,
  automaticBackup,
  initialSection,
}: SettingsPageProps) {
  const toast = useWorkspaceToast();
  const [localDraft, setLocalDraft] = useState<LocalSettingsDraft | null>(null);
  const [bonusRowIdentity] = useState(createBonusRowIdentity);
  const draft = localDraft?.value ?? settings;
  bonusRowIdentity.snapshot(draft.payPlan.bonusTiers);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveFailure, setSaveFailure] = useState<{ key: string; message: string } | null>(null);
  const saveSettingsRef = useRef<(background?: boolean) => Promise<void>>(async () => {});
  const [storageHealth, setStorageHealth] = useState<StorageHealth>({
    usageBytes: null,
    quotaBytes: null,
    persisted: null,
  });
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [backupPreview, setBackupPreview] = useState<BackupEnvelope | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [safetyBackupCreated, setSafetyBackupCreated] = useState(false);
  const [safetyBackupDownloadStarted, setSafetyBackupDownloadStarted] = useState(false);
  const [removeDemoOpen, setRemoveDemoOpen] = useState(false);
  const [validationIssues, setValidationIssues] = useState<SettingsValidationIssue[]>([]);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    () => categoryForInitialSection(initialSection),
  );
  const legacyInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const profileSectionRef = useRef<HTMLElement>(null);
  const scheduleSectionRef = useRef<HTMLElement>(null);
  const scheduleDetailsRef = useRef<HTMLDetailsElement>(null);
  const payPlanDetailsRef = useRef<HTMLElement>(null);
  const dataDetailsRef = useRef<HTMLElement>(null);
  const validationControlRefs = useRef<Partial<Record<SettingsFieldKey, HTMLElement | null>>>({});
  const [scheduleAnnouncement, setScheduleAnnouncement] = useState("");
  const selectedMonthName = monthLabel(settings.selectedMonth);
  const selectedDeliveryGoal = Object.hasOwn(
    draft.deliveryGoalsByMonth ?? {},
    settings.selectedMonth,
  )
    ? draft.deliveryGoalsByMonth?.[settings.selectedMonth] ?? draft.monthlyGoal
    : getDeliveryGoalForMonth(draft, settings.selectedMonth);
  const selectedCommissionGoalCents = Object.hasOwn(
    draft.commissionGoalsByMonth ?? {},
    settings.selectedMonth,
  )
    ? draft.commissionGoalsByMonth?.[settings.selectedMonth] ?? null
    : getCommissionGoalForMonth(draft, settings.selectedMonth);
  const openScheduleDays = useMemo(
    () => getWorkScheduleDays(settings.selectedMonth).filter((day) => !day.isSunday),
    [settings.selectedMonth],
  );
  const selectedDaysOff = useMemo(
    () => normalizeDaysOffForMonth(
      settings.selectedMonth,
      draft.daysOffByMonth[settings.selectedMonth] ?? [],
    ),
    [draft.daysOffByMonth, settings.selectedMonth],
  );
  const scheduledWorkdays = openScheduleDays.length - selectedDaysOff.length;
  const isDirty = useMemo(
    () => Boolean(localDraft && (
      comparableSettingsDraft(draft) !== localDraft.baseComparable
      || hasUnfinishedSettingsNumbers(draft, localDraft.numberText, settings.selectedMonth)
    )),
    [draft, localDraft, settings.selectedMonth],
  );
  const numberValidationIssues = useMemo<SettingsValidationIssue[]>(() => (
    Object.entries(localDraft?.numberText ?? {}).flatMap(([field, text]) => {
      const parsed = parseSettingsNumber(field as SettingsNumberField, text ?? "");
      return parsed.valid ? [] : [{ field: field as SettingsNumberField, message: parsed.message }];
    })
  ), [localDraft?.numberText]);
  const hasInvalidPlanNumber = numberValidationIssues.some((issue) => (
    issue.field !== "monthlyGoal" && issue.field !== "monthlyCommissionGoal"
  ));
  const externalSettingsChange = Boolean(
    localDraft
    && localDraft.baseComparable !== comparableSettingsDraft(settings)
    && isDirty,
  );
  const savedPayPlanHistory = useMemo(
    () => getPayPlanSchedule(settings),
    [settings],
  );
  const normalizedDraftPayPlan = useMemo(
    () => ({ ...draft.payPlan, version: draft.payPlan.version.trim() }),
    [draft.payPlan],
  );
  const payPlanImpact = useMemo(() => {
    const validation = validatePayPlan(normalizedDraftPayPlan);
    const existingSchedule = getPayPlanSchedule(settings);
    const proposedSchedule = upsertPayPlan(existingSchedule, normalizedDraftPayPlan);
    const effectiveMonthValid = /^\d{4}-(0[1-9]|1[0-2])$/.test(
      normalizedDraftPayPlan.effectiveMonth,
    );
    const followingPlan = effectiveMonthValid
      ? proposedSchedule.find(
        (plan) => plan.effectiveMonth > normalizedDraftPayPlan.effectiveMonth,
      )
      : undefined;
    const rangeEndMonth = followingPlan ? shiftMonth(followingPlan.effectiveMonth, -1) : null;
    const rangeLabel = !effectiveMonthValid
      ? "Enter a valid effective month"
      : rangeEndMonth
        ? `${monthLabel(normalizedDraftPayPlan.effectiveMonth)} through ${monthLabel(rangeEndMonth)}`
        : `${monthLabel(normalizedDraftPayPlan.effectiveMonth)} onward`;

    if (!validation.valid || hasInvalidPlanNumber) {
      return {
        valid: false,
        rangeLabel,
        affectedMonthCount: 0,
        commissionDeltaCents: 0,
      };
    }

    const affectedMonthKeys = [...new Set(
      sales
        .filter((sale) => !sale.deletedAt)
        .map((sale) => monthKeyFromDate(sale.saleDate))
        .filter((monthKey) => (
          monthKey >= normalizedDraftPayPlan.effectiveMonth
          && (!rangeEndMonth || monthKey <= rangeEndMonth)
        )),
    )].sort();

    try {
      const commissionDeltaCents = affectedMonthKeys.reduce((total, monthKey) => {
        const existingEstimate = hasPayPlanCoverage(existingSchedule, monthKey)
          ? calculateMonth(sales, monthKey, existingSchedule).estimatedCommissionCents
          : 0;
        const proposedEstimate = calculateMonth(
          sales,
          monthKey,
          proposedSchedule,
        ).estimatedCommissionCents;
        return total + proposedEstimate - existingEstimate;
      }, 0);
      return {
        valid: true,
        rangeLabel,
        affectedMonthCount: affectedMonthKeys.length,
        commissionDeltaCents,
      };
    } catch {
      return {
        valid: false,
        rangeLabel,
        affectedMonthCount: affectedMonthKeys.length,
        commissionDeltaCents: 0,
      };
    }
  }, [normalizedDraftPayPlan, sales, settings, hasInvalidPlanNumber]);
  const hasBackgroundValidationIssue = !draft.salespersonName.trim()
    || numberValidationIssues.length > 0
    || !Number.isInteger(selectedDeliveryGoal) || selectedDeliveryGoal < 1 || selectedDeliveryGoal > 100
    || (selectedCommissionGoalCents !== null && (!Number.isInteger(selectedCommissionGoalCents)
      || selectedCommissionGoalCents < 100 || selectedCommissionGoalCents > 100_000_000))
    || !payPlanImpact.valid;

  useEffect(() => {
    // Storage estimates are optional; unavailable browser APIs must not reject
    // the settings screen's initialization.
    void getStorageHealth().then(setStorageHealth).catch(() => undefined);
  }, [sales.length]);

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!initialSection) return;
    const animationFrame = window.requestAnimationFrame(() => {
      setActiveCategory(categoryForInitialSection(initialSection));
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [initialSection]);

  useEffect(() => {
    if (!initialSection || activeCategory !== categoryForInitialSection(initialSection)) return;
    const animationFrame = window.requestAnimationFrame(() => {
      let scrollTarget: HTMLElement | null = null;
      let focusTarget: HTMLElement | null = null;

      if (initialSection === "profile") {
        scrollTarget = profileSectionRef.current;
        focusTarget = profileSectionRef.current;
      } else if (initialSection === "schedule") {
        scrollTarget = scheduleSectionRef.current;
        if (scheduleDetailsRef.current) scheduleDetailsRef.current.open = true;
        focusTarget = scheduleDetailsRef.current?.querySelector("summary") ?? null;
      } else {
        const section = initialSection === "pay-plan"
          ? payPlanDetailsRef.current
          : dataDetailsRef.current;
        scrollTarget = section;
        focusTarget = section;
      }

      scrollTarget?.scrollIntoView({ behavior: "smooth", block: "start" });
      focusTarget?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeCategory, initialSection]);

  function clearValidationFor(fields: SettingsFieldKey[]) {
    setValidationIssues((current) => current.filter((issue) => !fields.includes(issue.field)));
  }

  function draftBase(current: LocalSettingsDraft | null): string {
    return current?.baseComparable ?? comparableSettingsDraft(settings);
  }

  function settleDraft(next: LocalSettingsDraft): LocalSettingsDraft | null {
    return comparableSettingsDraft(next.value) === next.baseComparable
      && !hasUnfinishedSettingsNumbers(next.value, next.numberText, settings.selectedMonth)
      ? null : next;
  }

  function updateNumber(field: SettingsNumberField, text: string, normalize = false) {
    if (!normalize) clearValidationFor([field]);
    if (!normalize) setSaveFailure(null);
    const parsed = parseSettingsNumber(field, text);
    setLocalDraft((current) => {
      const previous = current?.value ?? settings;
      const value = parsed.valid && parsed.text !== settingsNumberText(previous, field, settings.selectedMonth)
        ? applySettingsNumber(previous, field, parsed.value, settings.selectedMonth, current?.baseValue ?? settings)
        : previous;
      if (value.payPlan.bonusTiers !== previous.payPlan.bonusTiers) {
        bonusRowIdentity.edited(previous.payPlan.bonusTiers, value.payPlan.bonusTiers);
      }
      return settleDraft({
        value,
        baseValue: current?.baseValue ?? settings,
        baseComparable: draftBase(current),
        numberText: {
          ...current?.numberText,
          [field]: normalize && parsed.valid ? parsed.text : text,
        },
      });
    });
  }

  function numberInputProps(field: SettingsNumberField) {
    return {
      type: "text",
      inputMode: field === "monthlyGoal" || field === "acceleratedThreshold"
        || field.startsWith("bonusMinimum-") ? "numeric" as const : "decimal" as const,
      value: localDraft?.numberText[field] ?? settingsNumberText(draft, field, settings.selectedMonth),
      onChange: (event: ChangeEvent<HTMLInputElement>) => updateNumber(field, event.target.value),
      onBlur: (event: ChangeEvent<HTMLInputElement>) => updateNumber(field, event.target.value, true),
    };
  }

  function updateDraft<Key extends keyof ProfileSettings>(key: Key, value: ProfileSettings[Key]) {
    setSaveFailure(null);
    if (key === "salespersonName") clearValidationFor(["salespersonName"]);
    if (key === "monthlyGoal" || key === "deliveryGoalsByMonth") {
      clearValidationFor(["monthlyGoal"]);
    }
    if (key === "monthlyCommissionGoalCents" || key === "commissionGoalsByMonth") {
      clearValidationFor(["monthlyCommissionGoal"]);
    }
    setLocalDraft((current) => {
      const currentValue = current?.value ?? settings;
      return settleDraft({
        value: { ...currentValue, [key]: value },
        baseValue: current?.baseValue ?? settings,
        baseComparable: draftBase(current),
        numberText: current?.numberText ?? {},
      });
    });
  }

  function updateSelectedMonthDaysOff(dates: string[]) {
    const monthKey = settings.selectedMonth;
    const normalizedDates = normalizeDaysOffForMonth(monthKey, dates);
    const nextByMonth = {
      ...normalizeDaysOffByMonth(draft.daysOffByMonth),
      [monthKey]: normalizedDates,
    };
    if (normalizedDates.length === 0) delete nextByMonth[monthKey];
    updateDraft("daysOffByMonth", nextByMonth);
  }

  function toggleDayOff(date: string) {
    const isCurrentlyOff = selectedDaysOff.includes(date);
    const nextDates = isCurrentlyOff
      ? selectedDaysOff.filter((savedDate) => savedDate !== date)
      : [...selectedDaysOff, date];
    updateSelectedMonthDaysOff(nextDates);
    const nextScheduledWorkdays = openScheduleDays.length - nextDates.length;
    const dateLabel = format(parseISO(date), "EEEE, MMMM d");
    setScheduleAnnouncement(
      `${dateLabel} marked as ${isCurrentlyOff ? "working" : "a day off"}. ${monthLabel(settings.selectedMonth)} now has ${nextScheduledWorkdays} scheduled workdays.`,
    );
  }

  function clearSelectedMonthDaysOff() {
    updateSelectedMonthDaysOff([]);
    setScheduleAnnouncement(
      `${monthLabel(settings.selectedMonth)} days off cleared. The month now has ${openScheduleDays.length} scheduled workdays.`,
    );
  }

  function updatePayPlan<Key extends keyof ProfileSettings["payPlan"]>(
    key: Key,
    value: ProfileSettings["payPlan"][Key],
  ) {
    setSaveFailure(null);
    const validationFields: SettingsFieldKey[] =
      key === "version" ? ["payPlanVersion"]
        : key === "effectiveMonth" ? ["payPlanEffectiveMonth"]
          : key === "baseFrontRateBps" || key === "acceleratedFrontRateBps"
            ? ["baseFrontRate", "acceleratedFrontRate"]
            : key === "acceleratedThresholdExclusive" ? ["acceleratedThreshold"]
              : key === "fiRateBps" ? ["fiRate"]
                : key === "minimumFrontCommissionCents" ? ["mini"]
                : key === "bonusTiers"
                  ? validationIssues
                    .map((issue) => issue.field)
                    .filter((field) => field.startsWith("bonus"))
                  : [];
    clearValidationFor(validationFields);
    setLocalDraft((current) => {
      const currentValue = current?.value ?? settings;
      return settleDraft({
        value: {
          ...currentValue,
          payPlan: {
            ...currentValue.payPlan,
            [key]: value,
          },
        },
        baseValue: current?.baseValue ?? settings,
        baseComparable: draftBase(current),
        numberText: current?.numberText ?? {},
      });
    });
  }

  async function saveSettings(background = false) {
    if (savingRef.current) return;
    if (externalSettingsChange) {
      if (!background) toast.error("Settings changed in another tab. Load the latest settings before saving.");
      return;
    }
    // Canonicalize valid visible text even when a different field blocks saving.
    if (!background) setLocalDraft((current) => current ? settleDraft({
      ...current,
      numberText: Object.fromEntries(Object.entries(current.numberText).map(([field, text]) => {
        const parsed = parseSettingsNumber(field as SettingsNumberField, text ?? "");
        return [field, parsed.valid ? parsed.text : text];
      })),
    }) : null);
    const normalizedPayPlan = normalizedDraftPayPlan;
    const nextValidationIssues: SettingsValidationIssue[] = [];
    if (!draft.salespersonName.trim()) {
      nextValidationIssues.push({
        field: "salespersonName",
        message: "Enter the salesperson name used on reports.",
      });
    }
    nextValidationIssues.push(...numberValidationIssues);
    if (
      !Number.isInteger(selectedDeliveryGoal)
      || selectedDeliveryGoal < 1
      || selectedDeliveryGoal > 100
    ) {
      nextValidationIssues.push({
        field: "monthlyGoal",
        message: `${selectedMonthName} delivery goal must be a whole number from 1 to 100.`,
      });
    }
    if (
      selectedCommissionGoalCents !== null
      && (
        !Number.isInteger(selectedCommissionGoalCents)
        || selectedCommissionGoalCents < 100
        || selectedCommissionGoalCents > 100_000_000
      )
    ) {
      nextValidationIssues.push({
        field: "monthlyCommissionGoal",
        message: `${selectedMonthName} commission goal must be blank or between $1 and $1,000,000.`,
      });
    }
    const payPlanValidation = validatePayPlan(normalizedPayPlan);
    payPlanValidation.issues.forEach((message) => {
      nextValidationIssues.push({
        field: payPlanIssueField(message, normalizedPayPlan),
        message,
      });
    });
    if (nextValidationIssues.length) {
      if (background) {
        setValidationIssues(nextValidationIssues);
        return;
      }
      setValidationIssues(nextValidationIssues);
      const firstInvalidField = nextValidationIssues[0].field;
      setActiveCategory(categoryForValidationField(firstInvalidField));
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const firstInvalidControl = validationControlRefs.current[firstInvalidField];
          firstInvalidControl?.scrollIntoView({ block: "center", inline: "nearest" });
          firstInvalidControl?.focus({ preventScroll: true });
        });
      });
      toast.error(nextValidationIssues[0].message);
      return;
    }
    setValidationIssues([]);
    savingRef.current = true;
    setIsSaving(true);
    const submitted = draft;
    const attemptKey = JSON.stringify(localDraft);
    try {
      const payPlanHistory = upsertPayPlan(getPayPlanSchedule(settings), normalizedPayPlan);
      const next = {
        ...settings,
        salespersonName: draft.salespersonName.trim(),
        storeName: draft.storeName.trim(),
        monthlyGoal: draft.monthlyGoal,
        monthlyCommissionGoalCents: draft.monthlyCommissionGoalCents,
        deliveryGoalsByMonth: normalizeDeliveryGoalsByMonth(draft.deliveryGoalsByMonth),
        commissionGoalsByMonth: normalizeCommissionGoalsByMonth(draft.commissionGoalsByMonth),
        daysOffByMonth: normalizeDaysOffByMonth(draft.daysOffByMonth),
        payPlan: payPlanHistory.at(-1) ?? normalizedPayPlan,
        payPlanHistory,
      };
      const committed = await onSaveSettings(next);
      setLocalDraft((current) => current ? settleDraft(rebaseSettingsAfterSave(current, submitted, committed)) : null);
      setSaveFailure(null);
      if (!background) toast.success("Settings saved and calculations refreshed.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Settings were not saved. Your changes are still here. Try again when connected.";
      setSaveFailure({ key: attemptKey, message });
      if (!background) toast.error(message);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  useEffect(() => { saveSettingsRef.current = saveSettings; });
  useEffect(() => {
    if (!localDraft || isSaving || externalSettingsChange
      || comparableSettingsDraft(localDraft.value) === localDraft.baseComparable
      || saveFailure?.key === JSON.stringify(localDraft)) return;
    const timer = window.setTimeout(() => void saveSettingsRef.current(true), 1200);
    return () => window.clearTimeout(timer);
  }, [localDraft, isSaving, externalSettingsChange, hasBackgroundValidationIssue, saveFailure]);
  useEffect(() => {
    const retry = () => setSaveFailure(null);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  function fieldError(field: SettingsFieldKey): string | undefined {
    return validationIssues.find((issue) => issue.field === field)?.message;
  }

  function loadLatestSettings() {
    setLocalDraft(null);
    setValidationIssues([]);
    setSaveFailure(null);
    toast.info("Latest settings loaded.");
  }

  async function exportBackup(): Promise<string | null> {
    if (isDirty) {
      toast.error("Save Settings before creating a backup.");
      return null;
    }
    try {
      const assertCurrent = captureStorageContext();
      const fileName = await exportWorkspaceBackup({
        loadSnapshot: () => CLOUD_BUILD ? loadBackupSnapshot() : { settings, sales, auditEvents },
        assertCurrent,
        onExported: onBackupExported,
      });
      toast.success("Verified full backup download started. Confirm the file was saved.");
      return fileName;
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not create the backup.");
      return null;
    }
  }

  async function prepareGoogleDriveBackup(): Promise<PreparedBackupFile | null> {
    if (isDirty) {
      toast.error("Save Settings before creating a Google Drive backup.");
      return null;
    }
    return prepareBackupFile(settings, sales, auditEvents);
  }

  function downloadGoogleDriveBackup(prepared: PreparedBackupFile): void {
    downloadPreparedBackup(prepared);
    void onBackupExported()
      .then(() => toast.success("Verified backup download started. Upload it in the Google Drive tab."))
      .catch(() => toast.info("Backup download started. Confirm the file was saved before uploading it."));
  }

  async function handleLegacyFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (isDirty) {
      toast.error("Save Settings before importing sales.");
      return;
    }
    try {
      setImportPreview(
        await previewLegacyWorkbook(
          file,
          getEarliestPayPlanMonth(getPayPlanSchedule(settings)),
        ),
      );
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not read the workbook.");
    }
  }

  async function applyLegacyImport() {
    if (!importPreview) return;
    setIsImporting(true);
    try {
      const result = await importSales(importPreview.validSales, importPreview.sourceName);
      await onRefresh();
      setImportPreview(null);
      toast.success(
        result.alreadyPresent
          ? `Import complete: ${result.added} added; ${result.alreadyPresent} already present and left unchanged.`
          : `Import complete: ${result.added} added.`,
      );
    } catch {
      toast.error("Import could not be completed. Your preview is still here. Reload to check saved sales before trying again.");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (isDirty) {
      toast.error("Save Settings before restoring a backup.");
      return;
    }
    try {
      setBackupPreview(await parseBackupFile(file));
      setSafetyBackupCreated(false);
      setSafetyBackupDownloadStarted(false);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not validate the backup.");
    }
  }

  async function reviewAutomaticBackup() {
    if (isDirty) {
      toast.error("Save Settings before reviewing a folder backup.");
      return;
    }
    try {
      setBackupPreview(await automaticBackup.readLatestBackup());
      setSafetyBackupCreated(false);
      setSafetyBackupDownloadStarted(false);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not check the folder backup.");
    }
  }

  async function createSafetyBackup() {
    const fileName = await exportBackup();
    if (!fileName) return;
    setSafetyBackupCreated(false);
    setSafetyBackupDownloadStarted(true);
  }

  async function applyBackupRestore() {
    if (!backupPreview || !safetyBackupCreated) return;
    const backup = backupPreview;
    setIsImporting(true);
    try {
      await replaceDatabaseFromBackup(
        backup.data.profile,
        backup.data.sales,
        backup.data.auditEvents,
      );
      await onRefresh();
      setLocalDraft(null);
      setBackupPreview(null);
      setSafetyBackupCreated(false);
      toast.success(`Backup restored with ${backup.data.sales.length} sales.`);
    } catch {
      toast.error("The restore could not be completed. Keep your backup file and reload to check saved data before trying again.");
    } finally {
      setIsImporting(false);
    }
  }

  async function makePersistent() {
    const result = await requestPersistentStorage();
    setStorageHealth(await getStorageHealth());
    if (!result.supported) toast.info("This browser could not add extra protection for saved sales.");
    else if (result.persisted) toast.success("Extra protection was added to your saved sales.");
    else toast.info("Browser kept standard storage. Regular backups are still recommended.");
  }

  async function loadDemo() {
    if (isDirty) {
      toast.error("Save Settings before loading demonstration data.");
      return;
    }
    try {
      const asOfDate = todayDateOnly();
      const result = await loadDemoSales(
        buildDemoSales(settings.selectedMonth, asOfDate),
        IS_PUBLIC_DEMO_BUILD ? { historicDemoPlan: createPublicDemoHistoricPlan(asOfDate) } : undefined,
      );
      await onRefresh();
      const restoredDetail = result.restored > 0 ? ` ${result.restored} previously removed record${result.restored === 1 ? " was" : "s were"} restored.` : "";
      toast.success(demoSalesCount > 0 ? "Sample data reset." : IS_PUBLIC_DEMO_BUILD ? "Sample history loaded." : `${DEMO_DATASET_TITLE} demo loaded.`, {
        description: `${demoRangeDescription(asOfDate)} · fictional sales only.${restoredDetail}`,
      });
    } catch (error) {
      const demoName = IS_PUBLIC_DEMO_BUILD ? "sample history" : `${DEMO_DATASET_LABEL} demo`;
      toast.error(error instanceof Error
        ? `Could not load the ${demoName}: ${error.message}`
        : `Could not load the ${demoName}.`);
    }
  }

  async function removeDemo() {
    if (isDirty) {
      toast.error("Save Settings before removing demonstration data.");
      return;
    }
    setIsImporting(true);
    try {
      const removed = await removeDemoSales();
      await onRefresh();
      setRemoveDemoOpen(false);
      toast.success(`${removed} sample ${removed === 1 ? "sale" : "sales"} removed.`);
    } catch {
      toast.error("Demo removal could not be completed. Reload to check saved sales before trying again.");
    } finally {
      setIsImporting(false);
    }
  }

  async function downloadDiagnostics() {
    const health = await getStorageHealth();
    downloadBlob(createDiagnostics(settings, sales, health), "sales-ledger-support-file.json");
    toast.success("Privacy-safe support file downloaded.");
  }

  const activeSales = sales.filter((sale) => !sale.deletedAt);
  const demoSalesCount = activeSales.filter((sale) => sale.source === "demo").length;
  const settingsCategories: Array<{
    id: SettingsCategory;
    label: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      id: "profile",
      label: "Profile & goals",
      description: `${selectedMonthName} targets`,
      icon: <Users />,
    },
    {
      id: "schedule",
      label: "Days off",
      description: `${scheduledWorkdays} workdays · ${selectedDaysOff.length} off`,
      icon: <CalendarDays />,
    },
    {
      id: "pay-plan",
      label: "Pay plan",
      description: `${draft.payPlan.baseFrontRateBps / 100}% front · ${draft.payPlan.fiRateBps / 100}% F&I`,
      icon: <CheckCircle2 />,
    },
    {
      id: "bonuses",
      label: "Volume bonuses",
      description: `${draft.payPlan.bonusTiers.length} levels · ${formatCurrency(draft.payPlan.bonusTiers.at(-1)?.amountCents ?? 0)} max`,
      icon: <Sparkles />,
    },
    {
      id: "data",
      label: CLOUD_BUILD ? "Cloud saving" : "Data & backups",
      description: `${activeSales.length.toLocaleString()} active sales`,
      icon: <Database />,
    },
  ];

  return (
    <div className={cn("page-stack settings-page", isDirty && "has-unsaved-settings")}>
      <PageHeading
        eyebrow="Personal workspace"
        title="Settings"
        description={CLOUD_BUILD ? "Manage your goals, schedule, pay plan, and cloud saving." : "Manage your goals, schedule, pay plan, and backups."}
        action={<Button variant="outline" size="sm" onClick={() => void saveSettings()} disabled={!isDirty || isSaving || externalSettingsChange}><Save aria-hidden="true" /> {isSaving ? "Saving…" : localDraft && saveFailure ? "Try saving again" : "Save settings"}</Button>}
      />
      {isDirty ? <Button className="settings-mobile-save" variant="outline" onClick={() => void saveSettings()} disabled={isSaving || externalSettingsChange}>
        <Save aria-hidden="true" /> {isSaving ? "Saving…" : localDraft && saveFailure ? "Try saving again" : "Save settings"}
      </Button> : null}
      <p className="settings-dirty-state" role="status" aria-live="polite">
        {isSaving ? "Saving changes…" : externalSettingsChange ? "Saving paused — review the newer settings below."
          : localDraft && saveFailure ? `Not saved yet. ${saveFailure.message}`
          : localDraft && hasBackgroundValidationIssue ? "Finish the highlighted setting before it can be saved."
          : isDirty ? "Changes save automatically when you finish typing." : "All changes saved. Settings save automatically."}
      </p>
      {externalSettingsChange ? (
        <div className="form-summary-error settings-external-change" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Settings changed in another tab</strong>
            <p>Sales Ledger paused saving so newer profile or pay-plan information cannot be overwritten. Load the latest settings, then re-enter any change you still need.</p>
            <Button type="button" variant="outline" onClick={loadLatestSettings}>Load latest settings</Button>
          </div>
        </div>
      ) : null}
      {validationIssues.length ? (
        <div className="form-summary-error settings-validation-summary" role="alert" aria-labelledby="settings-validation-heading">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong id="settings-validation-heading">Review the highlighted settings</strong>
            <ul>
              {[...new Set(validationIssues.map((issue) => issue.message))].map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="settings-layout settings-v2-layout">
        <nav className="settings-category-nav" aria-label="Settings categories">
          {settingsCategories.map((category) => {
            const isActive = activeCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                className={cn("settings-category-button", isActive && "is-active")}
                aria-current={isActive ? "page" : undefined}
                aria-controls={`settings-panel-${category.id}`}
                // Normalize the old field only after this click has activated
                // its target; a disappearing draft banner must not move it
                // between pointer press and release.
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  setActiveCategory(category.id);
                  event.currentTarget.focus({ preventScroll: true });
                }}
              >
                <span className="settings-category-button__icon" aria-hidden="true">{category.icon}</span>
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.description}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="settings-category-content">
          <div
            id="settings-panel-profile"
            className="settings-category-panel"
            hidden={activeCategory !== "profile"}
          >
            <section
              ref={profileSectionRef}
              className="panel settings-section"
              aria-labelledby="profile-settings-heading"
              tabIndex={-1}
            >
          <SectionHeader id="profile-settings-heading" title="Profile & goals" description="Your name and monthly targets" />
          <div className="settings-form-grid">
            <div className="field-group field-group--full">
              <Label htmlFor="salesperson-name">Salesperson name *</Label>
              <Input
                ref={(node) => { validationControlRefs.current.salespersonName = node; }}
                id="salesperson-name"
                value={draft.salespersonName}
                onChange={(event) => updateDraft("salespersonName", event.target.value)}
                placeholder="Enter your name"
                aria-invalid={fieldError("salespersonName") ? true : undefined}
                aria-describedby={fieldError("salespersonName") ? settingsErrorId("salespersonName") : undefined}
              />
              {fieldError("salespersonName") ? <span id={settingsErrorId("salespersonName")} className="field-error">{fieldError("salespersonName")}</span> : null}
            </div>
            <div className="field-group field-group--full">
              <Label htmlFor="store-name">Store</Label>
              <Input
                id="store-name"
                value={draft.storeName}
                readOnly
                aria-readonly="true"
              />
              <span className="field-help">This tracker is configured only for Bob Maxey Ford of Howell.</span>
            </div>
            <div className="field-group">
              <Label htmlFor="monthly-goal">{selectedMonthName} delivery goal</Label>
              <Input
                ref={(node) => { validationControlRefs.current.monthlyGoal = node; }}
                id="monthly-goal"
                {...numberInputProps("monthlyGoal")}
                aria-invalid={fieldError("monthlyGoal") ? true : undefined}
                aria-describedby={fieldError("monthlyGoal") ? settingsErrorId("monthlyGoal") : undefined}
              />
              <span className="field-help">Applies only to {selectedMonthName}; other months keep their own goal or the default.</span>
              {fieldError("monthlyGoal") ? <span id={settingsErrorId("monthlyGoal")} className="field-error">{fieldError("monthlyGoal")}</span> : null}
            </div>
            <div className="field-group">
              <Label htmlFor="monthly-commission-goal">{selectedMonthName} commission goal <span className="optional-label">optional</span></Label>
              <div className="money-input settings-goal-input">
                <span aria-hidden="true">$</span>
                <Input
                  ref={(node) => { validationControlRefs.current.monthlyCommissionGoal = node; }}
                  id="monthly-commission-goal"
                  {...numberInputProps("monthlyCommissionGoal")}
                  placeholder="Example: 7500"
                  aria-invalid={fieldError("monthlyCommissionGoal") ? true : undefined}
                  aria-describedby={`monthly-commission-goal-help${fieldError("monthlyCommissionGoal") ? ` ${settingsErrorId("monthlyCommissionGoal")}` : ""}`}
                />
              </div>
              <span id="monthly-commission-goal-help" className="field-help">Used only for {selectedMonthName} commission pace. Leave blank for no target that month.</span>
              {fieldError("monthlyCommissionGoal") ? <span id={settingsErrorId("monthlyCommissionGoal")} className="field-error">{fieldError("monthlyCommissionGoal")}</span> : null}
            </div>
            <div className="profile-sharing-note field-group--full">
              <Users aria-hidden="true" />
              <span>
                <strong>One workspace per salesperson</strong>
                <small>Each salesperson keeps their own sales and backups.</small>
              </span>
            </div>
          </div>
            </section>
          </div>

          <div
            id="settings-panel-pay-plan"
            className="settings-category-panel"
            hidden={activeCategory !== "pay-plan"}
          >

        <SettingsDisclosure
          sectionRef={payPlanDetailsRef}
          className="pay-plan-settings"
          title="Pay plan"
          description="Rates, Mini, and the month this plan begins"
          summary={`${draft.payPlan.baseFrontRateBps / 100}% front · ${draft.payPlan.acceleratedFrontRateBps / 100}% above ${draft.payPlan.acceleratedThresholdExclusive} · ${draft.payPlan.fiRateBps / 100}% F&I`}
          icon={<CheckCircle2 />}
        >
          <div className="pay-plan-version">
            <Info aria-hidden="true" />
            <span>
              <strong>Plan name</strong>
              <Input
                ref={(node) => { validationControlRefs.current.payPlanVersion = node; }}
                id="pay-plan-version"
                aria-label="Pay plan name"
                value={draft.payPlan.version}
                onChange={(event) => updatePayPlan("version", event.target.value)}
                aria-invalid={fieldError("payPlanVersion") ? true : undefined}
                aria-describedby={fieldError("payPlanVersion") ? settingsErrorId("payPlanVersion") : undefined}
              />
              {fieldError("payPlanVersion") ? <span id={settingsErrorId("payPlanVersion")} className="field-error">{fieldError("payPlanVersion")}</span> : null}
            </span>
            <span>
              <strong>Applies beginning</strong>
              <Input
                ref={(node) => { validationControlRefs.current.payPlanEffectiveMonth = node; }}
                id="pay-plan-effective-month"
                aria-label="Pay plan effective month"
                type="month"
                value={draft.payPlan.effectiveMonth}
                onChange={(event) => updatePayPlan("effectiveMonth", event.target.value)}
                aria-invalid={fieldError("payPlanEffectiveMonth") ? true : undefined}
                aria-describedby={fieldError("payPlanEffectiveMonth") ? settingsErrorId("payPlanEffectiveMonth") : undefined}
              />
              {fieldError("payPlanEffectiveMonth") ? <span id={settingsErrorId("payPlanEffectiveMonth")} className="field-error">{fieldError("payPlanEffectiveMonth")}</span> : null}
            </span>
          </div>
          <div className="pay-plan-grid">
            <div className="pay-plan-field">
              <Label htmlFor="base-front-rate">Base front rate</Label>
              <div><Input ref={(node) => { validationControlRefs.current.baseFrontRate = node; }} id="base-front-rate" {...numberInputProps("baseFrontRate")} aria-invalid={fieldError("baseFrontRate") ? true : undefined} aria-describedby={fieldError("baseFrontRate") ? settingsErrorId("baseFrontRate") : undefined} /><em>%</em></div>
              {fieldError("baseFrontRate") ? <span id={settingsErrorId("baseFrontRate")} className="field-error">{fieldError("baseFrontRate")}</span> : null}
            </div>
            <div className="pay-plan-field">
              <Label htmlFor="accelerated-front-rate">Higher front rate</Label>
              <div><Input ref={(node) => { validationControlRefs.current.acceleratedFrontRate = node; }} id="accelerated-front-rate" {...numberInputProps("acceleratedFrontRate")} aria-invalid={fieldError("acceleratedFrontRate") ? true : undefined} aria-describedby={fieldError("acceleratedFrontRate") ? settingsErrorId("acceleratedFrontRate") : undefined} /><em>%</em></div>
              {fieldError("acceleratedFrontRate") ? <span id={settingsErrorId("acceleratedFrontRate")} className="field-error">{fieldError("acceleratedFrontRate")}</span> : null}
            </div>
            <div className="pay-plan-field">
              <Label htmlFor="accelerated-threshold">Higher rate starts above</Label>
              <div><Input ref={(node) => { validationControlRefs.current.acceleratedThreshold = node; }} id="accelerated-threshold" {...numberInputProps("acceleratedThreshold")} aria-invalid={fieldError("acceleratedThreshold") ? true : undefined} aria-describedby={fieldError("acceleratedThreshold") ? settingsErrorId("acceleratedThreshold") : undefined} /><em>delivered</em></div>
              {fieldError("acceleratedThreshold") ? <span id={settingsErrorId("acceleratedThreshold")} className="field-error">{fieldError("acceleratedThreshold")}</span> : null}
            </div>
            <div className="pay-plan-field">
              <Label htmlFor="fi-rate">F&amp;I rate</Label>
              <div><Input ref={(node) => { validationControlRefs.current.fiRate = node; }} id="fi-rate" {...numberInputProps("fiRate")} aria-invalid={fieldError("fiRate") ? true : undefined} aria-describedby={fieldError("fiRate") ? settingsErrorId("fiRate") : undefined} /><em>%</em></div>
              {fieldError("fiRate") ? <span id={settingsErrorId("fiRate")} className="field-error">{fieldError("fiRate")}</span> : null}
            </div>
          </div>
          <div className="pay-plan-mini">
            <div className="pay-plan-field">
              <Label htmlFor="mini">Mini</Label>
              <div><em aria-hidden="true">$</em><Input ref={(node) => { validationControlRefs.current.mini = node; }} id="mini" {...numberInputProps("mini")} aria-invalid={fieldError("mini") ? true : undefined} aria-describedby={fieldError("mini") ? `${settingsErrorId("mini")} mini-help` : "mini-help"} /></div>
              {fieldError("mini") ? <span id={settingsErrorId("mini")} className="field-error">{fieldError("mini")}</span> : null}
            </div>
            <p id="mini-help">Minimum front commission per full deal. Split deals receive their share. A manual/spiff payout replaces the front calculation; F&amp;I stays separate.</p>
          </div>
          <div className="pay-plan-impact" aria-live="polite">
            <div className="pay-plan-impact__heading">
              <strong role="heading" aria-level={3}>How this change affects saved months</strong>
              <small>Compares your saved pay plan with these changes.</small>
            </div>
            <dl>
              <div>
                <dt>Effective range</dt>
                <dd>{payPlanImpact.rangeLabel}</dd>
              </div>
              <div>
                <dt>Saved sale months affected</dt>
                <dd>{payPlanImpact.affectedMonthCount}</dd>
              </div>
              <div>
                <dt>Estimated commission change</dt>
                <dd className={cn(
                  payPlanImpact.commissionDeltaCents > 0 && "is-positive",
                  payPlanImpact.commissionDeltaCents < 0 && "is-negative",
                )}>
                  {payPlanImpact.valid
                    ? `${payPlanImpact.commissionDeltaCents > 0 ? "+" : ""}${formatCurrency(payPlanImpact.commissionDeltaCents)}`
                    : "Complete the plan fields"}
                </dd>
              </div>
            </dl>
            {payPlanImpact.valid && payPlanImpact.affectedMonthCount === 0 ? (
              <p>No saved sale months fall in this effective range, so existing estimates do not change.</p>
            ) : null}
          </div>
          <div className="pay-plan-rule">
            <CheckCircle2 aria-hidden="true" />
            <p>
              Sell more than {draft.payPlan.acceleratedThresholdExclusive} valid delivered vehicles in a month to apply
              {` ${draft.payPlan.acceleratedFrontRateBps / 100}%`} to each sale’s front gross retroactively. Each sale pays the higher of its percentage commission or Mini, unless a manual/spiff payout is entered.
              Pending, missing-stock, and duplicate delivered records do not trigger it.
            </p>
          </div>
          <div className="pay-plan-caveat">
            <AlertTriangle aria-hidden="true" />
            <p>
              Rates and Mini apply beginning with the month above, until the next saved plan. Earlier months keep their own plan. Manual/spiff payouts do not change.
            </p>
          </div>
          <div className="pay-plan-history">
            <strong role="heading" aria-level={3}>Pay plan history</strong>
            <ol>
              {savedPayPlanHistory.map((plan) => (
                <li key={`${plan.effectiveMonth}-${plan.version}`}>
                  <span>
                    <strong>{plan.version}</strong>
                    <small>Begins {monthLabel(plan.effectiveMonth)} · Mini {formatCurrency(getMinimumFrontCommissionCents(plan))}</small>
                  </span>
                  {plan.effectiveMonth === settings.payPlan.effectiveMonth
                    && plan.version === settings.payPlan.version
                    ? <em>Current</em>
                    : null}
                </li>
              ))}
            </ol>
          </div>
        </SettingsDisclosure>

          </div>

          <div
            id="settings-panel-schedule"
            className="settings-category-panel"
            hidden={activeCategory !== "schedule"}
          >

        <section
          ref={scheduleSectionRef}
          className="panel settings-section schedule-settings"
          aria-labelledby="work-schedule-heading"
        >
          <SectionHeader
            id="work-schedule-heading"
            title="Days off"
            description="Sundays are already excluded from pacing"
          />
          <details ref={scheduleDetailsRef} className="work-schedule-details">
            <summary>
              <span className="work-schedule-details__icon" aria-hidden="true"><CalendarDays /></span>
              <span className="work-schedule-details__summary">
                <strong>{monthLabel(settings.selectedMonth)}</strong>
                <small>{scheduledWorkdays} scheduled workdays · {selectedDaysOff.length} {selectedDaysOff.length === 1 ? "day" : "days"} off</small>
              </span>
              <span className="work-schedule-details__action">Edit days off</span>
              <ChevronDown className="work-schedule-details__chevron" aria-hidden="true" />
            </summary>
            <div className="work-schedule-details__body">
              <div className="work-schedule-intro">
                <CalendarDays aria-hidden="true" />
                <div>
                  <strong>Select only your personal days off</strong>
                  <p>Sundays are already excluded because the store is closed. Select a Monday–Saturday date to mark it off; select it again to undo.</p>
                </div>
              </div>
              <div className="work-schedule-weekdays" aria-hidden="true">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => <span key={weekday}>{weekday}</span>)}
              </div>
              <div className="work-schedule-grid" role="group" aria-label={`${monthLabel(settings.selectedMonth)} personal days off`}>
                {openScheduleDays.map((day, index) => {
                  const isOff = selectedDaysOff.includes(day.date);
                  const dateLabel = format(parseISO(day.date), "EEEE, MMMM d");
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={cn("work-schedule-day", isOff && "is-off")}
                      style={index === 0 ? { gridColumnStart: day.weekdayIndex + 1 } : undefined}
                      aria-pressed={isOff}
                      aria-label={`${dateLabel} — ${isOff ? "day off. Select to mark working." : "working. Select to mark day off."}`}
                      onClick={() => toggleDayOff(day.date)}
                    >
                      <span>{day.dayNumber}</span>
                      {isOff ? <small>Off</small> : null}
                    </button>
                  );
                })}
              </div>
              <div className="work-schedule-actions">
                <p>Select your days off, then save before changing months.</p>
                {selectedDaysOff.length ? (
                  <Button type="button" variant="outline" onClick={clearSelectedMonthDaysOff}>
                    <RotateCcw aria-hidden="true" /> Clear {monthLabel(settings.selectedMonth, "short")} days off
                  </Button>
                ) : null}
              </div>
            </div>
          </details>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{scheduleAnnouncement}</p>
        </section>

          </div>

          <div
            id="settings-panel-bonuses"
            className="settings-category-panel"
            hidden={activeCategory !== "bonuses"}
          >

        <SettingsDisclosure
          className="bonus-settings"
          title="Volume bonuses"
          description="Bonus earned at each delivered-sales milestone"
          summary={`${draft.payPlan.bonusTiers.length} levels · ${formatCurrency(draft.payPlan.bonusTiers.at(-1)?.amountCents ?? 0)} maximum`}
          icon={<Sparkles />}
        >
          <div className="bonus-tier-table">
            <div className="bonus-tier-table__header">
              <span>Delivered sales</span><span>Bonus added</span><span>Total bonus</span>
            </div>
            {draft.payPlan.bonusTiers.map((tier, index) => {
              return (
              <div key={bonusRowIdentity.key(tier)} className="bonus-tier-row">
                <div className="bonus-tier-field">
                  <div className="bonus-tier-control">
                    <Input
                      ref={(node) => { validationControlRefs.current[`bonusMinimum-${index}`] = node; }}
                      id={`bonus-minimum-${index}`}
                      aria-label={`Tier ${index + 1} minimum delivered`}
                      {...numberInputProps(`bonusMinimum-${index}`)}
                      aria-invalid={fieldError(`bonusMinimum-${index}`) ? true : undefined}
                      aria-describedby={fieldError(`bonusMinimum-${index}`) ? settingsErrorId(`bonusMinimum-${index}`) : undefined}
                    />
                    <span>sales</span>
                  </div>
                  {fieldError(`bonusMinimum-${index}`) ? <span id={settingsErrorId(`bonusMinimum-${index}`)} className="field-error">{fieldError(`bonusMinimum-${index}`)}</span> : null}
                </div>
                <div className="bonus-tier-field">
                  <div className="money-input">
                    <span aria-hidden="true">$</span>
                    <Input
                      ref={(node) => { validationControlRefs.current[`bonusAmount-${index}`] = node; }}
                      id={`bonus-amount-${index}`}
                      aria-label={`Tier ${index + 1} bonus added at milestone`}
                      {...numberInputProps(`bonusAmount-${index}`)}
                      aria-invalid={fieldError(`bonusAmount-${index}`) ? true : undefined}
                      aria-describedby={fieldError(`bonusAmount-${index}`) ? settingsErrorId(`bonusAmount-${index}`) : undefined}
                    />
                  </div>
                  {fieldError(`bonusAmount-${index}`) ? <span id={settingsErrorId(`bonusAmount-${index}`)} className="field-error">{fieldError(`bonusAmount-${index}`)}</span> : null}
                </div>
                <div className="bonus-tier-total">
                  <span className="mobile-only-label">Total bonus</span>
                  <strong>{formatCurrency(tier.amountCents)}</strong>
                  {index === 0 ? <small>Demo bonus</small> : null}
                </div>
              </div>
              );
            })}
          </div>
        </SettingsDisclosure>

          </div>

          <div
            id="settings-panel-data"
            className="settings-category-panel settings-category-panel--data"
            hidden={activeCategory !== "data"}
          >

        <SettingsDisclosure
          sectionRef={dataDetailsRef}
          className="data-settings"
          title={CLOUD_BUILD ? "Cloud saving" : "Data & backups"}
          description={CLOUD_BUILD ? "Your account, saving, and recovery" : "Backup, restore, import, and privacy"}
          summary={CLOUD_BUILD ? `${activeSales.length.toLocaleString()} active sales · Account storage` : `${activeSales.length.toLocaleString()} active sales · ${settings.lastBackupAt ? "backup recorded" : "backup recommended"}`}
          icon={<Database />}
        >
          {CLOUD_BUILD ? <div className="cloud-data-copy">
            <p><strong>Save here. Open it on your next computer.</strong></p>
            <p>Saved sales and settings are stored with your signed-in account. No folder connection or manual upload is needed. Use the same account on another device.</p>
            <p>This pilot needs an internet connection to save. If saving fails, keep your entries open and reconnect. A saved message appears only after the cloud accepts the change.</p>
            <p>Accidentally deleted a sale? Open <strong>Sales → Recently deleted</strong> to restore it. Earlier sale revisions are retained for owner-assisted recovery. Scheduled disaster-recovery backups are not enabled in this pilot.</p>
            <p>Your ledger is separate from other salespeople’s ledgers. The app owner can administer stored records. Importing an existing ledger will be a separate, reviewed step.</p>
            <Button variant="outline" disabled={isDirty} onClick={() => void exportBackup()}><FileJson aria-hidden="true" /> Download a copy</Button>
          </div> : <>
          <div className="storage-card">
            <span className="storage-card__icon"><HardDrive aria-hidden="true" /></span>
            <span>
              <strong>{activeSales.length.toLocaleString()} active sales</strong>
              <small>{formatBytes(storageHealth.usageBytes)} used · {storageHealth.persisted === true ? "extra protection on" : storageHealth.persisted === false ? "standard protection" : "protection status unavailable"}</small>
            </span>
            <Button variant="outline" onClick={() => void makePersistent()}>
              <LockKeyhole aria-hidden="true" /> Protect saved sales
            </Button>
          </div>
          <AutomaticBackupCard
            controller={automaticBackup}
            onReviewBackup={reviewAutomaticBackup}
          />
          <GoogleDriveBackupCard
            disabled={isDirty}
            onPrepareBackup={prepareGoogleDriveBackup}
            onDownloadBackup={downloadGoogleDriveBackup}
          />
          <div className="data-action-grid">
            <button type="button" disabled={isDirty} onClick={() => void exportBackup()}>
              <span><FileJson aria-hidden="true" /></span>
              <strong>Download backup</strong>
              <small>Includes last names, gross and commission values, days off, deleted rows, settings, and activity.</small>
            </button>
            <button type="button" disabled={isDirty} onClick={() => legacyInputRef.current?.click()}>
              <span><FileSpreadsheet aria-hidden="true" /></span>
              <strong>Import sales</strong>
              <small>Excel tracker, Sales Detail export, or CSV. Totals are recalculated; explicit manual payouts are preserved.</small>
            </button>
            <button type="button" disabled={isDirty} onClick={() => backupInputRef.current?.click()}>
              <span><RotateCcw aria-hidden="true" /></span>
              <strong>Restore from backup</strong>
              <small>Checks the backup file before replacing your saved data.</small>
            </button>
            <button type="button" onClick={() => void downloadDiagnostics()}>
              <span><Database aria-hidden="true" /></span>
              <strong>Create support file</strong>
              <small>Creates a privacy-safe support file without customer details.</small>
            </button>
          </div>
          <input ref={legacyInputRef} className="sr-only" type="file" tabIndex={-1} aria-label="Select an Excel or CSV sales file to import" accept=".xlsx,.xls,.csv" onChange={(event) => void handleLegacyFile(event)} />
          <input ref={backupInputRef} className="sr-only" type="file" tabIndex={-1} aria-label="Select a Sales Ledger backup file to restore" accept="application/json,.json" onChange={(event) => void handleBackupFile(event)} />

          {!CLOUD_BUILD && (activeSales.length === 0 || demoSalesCount > 0) ? (
            <div className="demo-data-callout">
              <Sparkles aria-hidden="true" />
              <span>
                <strong>{demoSalesCount > 0 ? `${IS_PUBLIC_DEMO_BUILD ? "Sample history" : "Demo data"}: ${demoSalesCount} fictional sales` : "Want to explore before entering real sales?"}</strong>
                <small>{demoSalesCount > 0 ? `${demoRangeDescription()} · Reset restores the original sample sales. Sales you entered stay unchanged.` : IS_PUBLIC_DEMO_BUILD ? `Load fictional sales from ${demoRangeDescription()} with commissions, F&I, pacing, and milestones.` : `Load a clearly labeled ${DEMO_DATASET_LABEL} walkthrough with delivered, pending, F&I, bonus, and pacing examples.`}</small>
              </span>
              {demoSalesCount > 0
                ? <>
                    <Button variant="outline" disabled={isDirty} onClick={() => void loadDemo()}><RotateCcw aria-hidden="true" /> {IS_PUBLIC_DEMO_BUILD ? "Reset sample data" : `Reset ${DEMO_DATASET_LABEL} demo`}</Button>
                    <Button variant="outline" disabled={isDirty} onClick={() => setRemoveDemoOpen(true)}><Trash2 aria-hidden="true" /> Remove sample data</Button>
                  </>
                : <Button variant="outline" disabled={isDirty} onClick={() => void loadDemo()}>{IS_PUBLIC_DEMO_BUILD ? "Load sample history" : `Load ${DEMO_DATASET_LABEL} demo`}</Button>}
            </div>
          ) : null}

          <div className="backup-reminder">
            <Archive aria-hidden="true" />
            <span>
              <strong>Last manual backup download started</strong>
              <small>{settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString("en-US") : "No backup download recorded yet"}</small>
            </span>
          </div>
          </>}
        </SettingsDisclosure>

        <SettingsSecondaryDisclosure
          className="privacy-settings"
          title="What you can save here"
          description="Keep sensitive identity and finance details in dealership systems"
          summary="Last name and stock number are okay"
          icon={<ShieldCheck />}
        >
          <div className="privacy-grid">
            <div className="privacy-allowed">
              <ShieldCheck aria-hidden="true" />
              <span>
                <strong>Safe to save</strong>
                <p>Customer last name, stock number, vehicle, delivery date, credited gross, general status, and non-sensitive notes.</p>
              </span>
            </div>
            <div className="privacy-blocked">
              <LockKeyhole aria-hidden="true" />
              <span>
                <strong>Never enter here</strong>
                <p>SSNs, credit applications or reports, banking, license images, insurance, passwords, lender stipulations, paystubs, or deal-jacket documents.</p>
              </span>
            </div>
          </div>
          <p className="local-only-explanation">
            <Laptop aria-hidden="true" /> This workspace is for one salesperson. Each person keeps separate sales and backups.
          </p>
        </SettingsSecondaryDisclosure>

        <SettingsSecondaryDisclosure
          className="activity-settings"
          title="Recent changes"
          description={CLOUD_BUILD ? "Changes saved to your cloud account" : "Changes saved in this browser"}
          summary={auditEvents.length ? `${Math.min(auditEvents.length, 8)} recent events` : "No activity yet"}
          icon={<History />}
        >
          {auditEvents.length ? (
            <ol className="activity-list">
              {auditEvents.slice(0, 8).map((event) => (
                <li key={event.id ?? `${event.occurredAt}-${event.action}`}>
                  <span className="activity-dot" aria-hidden="true" />
                  <span>
                    <strong>{activityLabel(event.action)}</strong>
                    <small>{event.summary}</small>
                  </span>
                  <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                </li>
              ))}
            </ol>
          ) : <p className="settings-empty">Activity will appear after your first saved change.</p>}
        </SettingsSecondaryDisclosure>

        <section className="about-strip">
          <span><Info aria-hidden="true" /> Sales Ledger</span>
          <span>{CLOUD_BUILD ? "Cloud pilot · Internet connection required to save" : "Saved in this browser · Works offline after the first load"}</span>
        </section>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(importPreview)} onOpenChange={(open) => !open && setImportPreview(null)}>
        <DialogContent className="import-dialog">
          <DialogHeader>
            <DialogTitle>Review sales import</DialogTitle>
            <DialogDescription>
              Sales Ledger imports the sale details and explicit manual/spiff payouts, then recalculates every total using your pay plan.
            </DialogDescription>
          </DialogHeader>
          {importPreview ? (
            <div className="import-preview">
              <div className="import-preview__file"><FileSpreadsheet aria-hidden="true" /><span><strong>{importPreview.sourceName}</strong><small>File checked and ready</small></span></div>
              <div className="import-preview__counts">
                <span><strong>{importPreview.validSales.length}</strong> ready</span>
                <span className={cn(importPreview.rejectedRows.length > 0 && "has-errors")}><strong>{importPreview.rejectedRows.length}</strong> rejected</span>
              </div>
              {importPreview.warnings.length ? <ul className="import-warnings">{importPreview.warnings.map((warning) => <li key={warning}><AlertTriangle aria-hidden="true" />{warning}</li>)}</ul> : null}
              {importPreview.rejectedRows.length ? (
                <div className="rejected-rows"><strong>Rows not imported</strong><ul>{importPreview.rejectedRows.slice(0, 8).map((row) => <li key={row.row}>Row {row.row}: {row.reason}</li>)}</ul>{importPreview.rejectedRows.length > 8 ? <small>Plus {importPreview.rejectedRows.length - 8} more</small> : null}</div>
              ) : null}
              <p>Sales already imported from this file stay unchanged, so a repeat import cannot replace later edits or restore deleted records. All other valid rows will add. Duplicate delivered stocks remain visible and are excluded pending review.</p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button onClick={() => void applyLegacyImport()} disabled={isImporting || !importPreview?.validSales.length}>
              <Upload aria-hidden="true" /> {isImporting ? "Importing…" : `Import ${importPreview?.validSales.length ?? 0} sales`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(backupPreview)} onOpenChange={(open) => !open && setBackupPreview(null)}>
        <DialogContent className="restore-dialog">
          <DialogHeader>
            <DialogTitle>Restore this full backup?</DialogTitle>
            <DialogDescription>
              This replaces the current profile, sales, settings, and activity with the checked backup.
            </DialogDescription>
          </DialogHeader>
          {backupPreview ? (
            <div className="restore-preview">
              <div><span>Salesperson</span><strong>{backupPreview.data.profile.salespersonName || "Not entered"}</strong></div>
              <div><span>Sales records</span><strong>{backupPreview.data.sales.length}</strong></div>
              <div><span>Created</span><strong>{new Date(backupPreview.exportedAt).toLocaleString("en-US")}</strong></div>
              <p><CheckCircle2 aria-hidden="true" /> Backup file checked and ready.</p>
              <label className="confirmation-check safety-check">
                <Checkbox
                  checked={safetyBackupCreated}
                  disabled={!safetyBackupDownloadStarted}
                  onCheckedChange={(checked) => setSafetyBackupCreated(checked === true)}
                />
                I found the downloaded safety backup and can open it
              </label>
              {!safetyBackupDownloadStarted ? (
                <Button variant="outline" className="w-full" onClick={() => void createSafetyBackup()}>
                  <Download aria-hidden="true" /> Download current safety backup first
                </Button>
              ) : <small>Confirm the file exists before replacing this workspace. A started browser download is not proof that the file was saved.</small>}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupPreview(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void applyBackupRestore()} disabled={!safetyBackupCreated || isImporting}>
              <RotateCcw aria-hidden="true" /> {isImporting ? "Restoring…" : "Replace with backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeDemoOpen} onOpenChange={setRemoveDemoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove sample data?</DialogTitle>
            <DialogDescription>
              This removes {demoSalesCount} fictional sample {demoSalesCount === 1 ? "sale" : "sales"} from totals and reports. Sales you entered or imported stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveDemoOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void removeDemo()} disabled={isImporting}>
              <Trash2 aria-hidden="true" /> {isImporting ? "Removing…" : "Remove sample data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
