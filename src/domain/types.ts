export type SaleStatus = "delivered" | "pending" | "void";

export interface Sale {
  id: string;
  profileId: string;
  saleDate: string;
  customerLastName: string;
  stockNumber: string;
  vehicleDescription: string;
  status: SaleStatus;
  unitCreditBasis: number;
  frontGrossCents: number | null;
  fiGrossCents: number | null;
  /** Tracked F&I outcomes. Omitted values on older records mean "Not marked," not "No." */
  serviceContractSold?: boolean;
  tireWheelSold?: boolean;
  gapSold?: boolean;
  dealerFinanced?: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
  source?: "manual" | "legacy-xlsx" | "json-restore" | "demo";
  sourceReference?: string;
}

export interface BonusTier {
  minimumDelivered: number;
  /** Cumulative bonus earned after reaching this delivery threshold. */
  amountCents: number;
}

export interface PayPlan {
  version: string;
  effectiveMonth: string;
  baseFrontRateBps: number;
  acceleratedFrontRateBps: number;
  acceleratedThresholdExclusive: number;
  fiRateBps: number;
  bonusTiers: BonusTier[];
}

export type AppView = "dashboard" | "sales" | "reports" | "settings";

export interface ProfileSettings {
  id: string;
  salespersonName: string;
  storeName: string;
  monthlyGoal: number;
  monthlyCommissionGoalCents: number | null;
  /** Optional month-specific overrides; the monthly fields above remain the defaults. */
  deliveryGoalsByMonth?: Record<string, number>;
  commissionGoalsByMonth?: Record<string, number | null>;
  daysOffByMonth: Record<string, string[]>;
  selectedMonth: string;
  selectedView: AppView;
  actualPaidByMonth: Record<string, number | null>;
  payPlan: PayPlan;
  payPlanHistory: PayPlan[];
  onboardingDismissed: boolean;
  lastBackupAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuditAction =
  | "sale.created"
  | "sale.updated"
  | "sale.deleted"
  | "sale.restored"
  | "settings.updated"
  | "import.completed"
  | "restore.completed"
  | "backup.exported"
  | "demo.loaded"
  | "demo.removed";

export interface AuditEvent {
  id?: number;
  profileId: string;
  action: AuditAction;
  entityId?: string;
  occurredAt: string;
  summary: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface SaleReviewFlag {
  code:
    | "duplicate-stock"
    | "missing-stock"
    | "missing-front-gross"
    | "zero-front-gross"
    | "negative-gross"
    | "future-delivery"
    | "invalid-date";
  label: string;
  severity: "warning" | "error";
}

export interface CalculatedSale {
  sale: Sale;
  normalizedStock: string;
  monthKey: string;
  countsTowardVolume: boolean;
  commissionReady: boolean;
  frontRateBps: number;
  frontCommissionCents: number;
  fiCommissionCents: number;
  estimatedCommissionCents: number;
  flags: SaleReviewFlag[];
}

export interface MonthSummary {
  monthKey: string;
  payPlanVersion: string;
  payPlanEffectiveMonth: string;
  deliveredCount: number;
  creditedUnitsBasis: number;
  pendingCount: number;
  voidCount: number;
  frontRateBps: number;
  frontGrossCents: number;
  fiGrossCents: number;
  frontCommissionCents: number;
  fiCommissionCents: number;
  coreCommissionCents: number;
  potentialBonusCents: number;
  bonusIncludedCents: number;
  estimatedCommissionCents: number;
  actualPaidCents: number | null;
  payrollVarianceCents: number | null;
  duplicateGroupCount: number;
  reviewCount: number;
  retroactiveUpliftCents: number;
  calculatedSales: CalculatedSale[];
}

export interface BackupEnvelope {
  format: "maxey-sales-command-center";
  schemaVersion: 1 | 2;
  appVersion: string;
  exportedAt: string;
  timezone: "America/Detroit";
  checksum: string;
  data: {
    profile: ProfileSettings;
    sales: Sale[];
    auditEvents: AuditEvent[];
  };
}

export interface ImportPreview {
  sourceName: string;
  sourceHash: string;
  validSales: Sale[];
  rejectedRows: Array<{ row: number; reason: string }>;
  warnings: string[];
}
