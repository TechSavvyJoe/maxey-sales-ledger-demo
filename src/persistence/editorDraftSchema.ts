import { z } from "zod";
import { saleSchema } from "@/lib/files";

const documentId = z.string().min(1).max(160).refine((value) => !value.includes("/") && value !== "." && value !== ".." && !/^__.*__$/.test(value));
export const editorDraftKeySchema = z.string().refine((value) => value === "new-sale"
  || (value.startsWith("sale:") && documentId.safeParse(value.slice(5)).success), "Choose a valid sale draft.");
const raw = (maximum: number) => z.string().max(maximum);
function canonicalJson(value: unknown): string {
  function sort(entry: unknown): unknown {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry && typeof entry === "object") return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sort(item)]));
    return entry;
  }
  return JSON.stringify(sort(value));
}

/** Drafts preserve incomplete typing. Only a validated Sale may enter totals. */
export const editorDraftPayloadSchema = z.object({
  draftId: documentId,
  baseSale: saleSchema.nullable(),
  values: z.object({
    status: z.enum(["delivered", "pending"]),
    saleDate: raw(32), customerLastName: raw(120), stockNumber: raw(80),
    vehicleDescription: raw(240), unitCredit: raw(40), frontGross: raw(80),
    fiGross: raw(80), manualFrontCommissionEnabled: z.boolean(),
    frontCommissionOverride: raw(80), notes: raw(1000),
  }).strict(),
  fiProducts: z.object({
    serviceContractSold: z.boolean().optional(), tireWheelSold: z.boolean().optional(),
    gapSold: z.boolean().optional(), dealerFinanced: z.boolean().optional(),
    paymentMethod: z.enum(["dealer_financed", "cash", "outside_financing"]).optional(),
  }).strict(),
}).strict().refine((value) => !value.baseSale || value.baseSale.id === value.draftId, "The draft and its sale must match.");

export type EditorDraftPayload = z.infer<typeof editorDraftPayloadSchema>;
export interface EditorDraftRecord {
  key: string;
  revision: number;
  updatedAt: string | null;
  payload: EditorDraftPayload | null;
}
export interface EditorDraftRepository {
  loadEditorDraft(key: string): Promise<EditorDraftRecord>;
  saveEditorDraft(key: string, payload: EditorDraftPayload, expectedRevision: number): Promise<EditorDraftRecord>;
  clearEditorDraft(key: string, expectedRevision: number): Promise<EditorDraftRecord>;
}

export class EditorDraftConflictError extends Error {
  readonly code = "EDITOR_DRAFT_CONFLICT";
  constructor() {
    super("This draft changed in another tab or device. Your current entries are still here. Reopen the latest draft before continuing.");
    this.name = "EditorDraftConflictError";
  }
}
export function isEditorDraftConflictError(error: unknown): error is EditorDraftConflictError {
  return error instanceof EditorDraftConflictError || (typeof error === "object" && error !== null
    && "code" in error && error.code === "EDITOR_DRAFT_CONFLICT");
}

export function assertDraftRevision(revision: number) {
  if (!Number.isInteger(revision) || revision < 0 || revision >= 2147483647) throw new Error("This draft version could not be verified. Reopen the sale to continue.");
}

export function prepareEditorDraftPayload(key: string, payload: EditorDraftPayload): EditorDraftPayload {
  editorDraftKeySchema.parse(key);
  // Firestore does not accept undefined fields. Missing product flags retain
  // their distinct unknown state instead of becoming false during recovery.
  const prepared = editorDraftPayloadSchema.parse(JSON.parse(JSON.stringify(payload)));
  if (key !== "new-sale" && key !== `sale:${prepared.draftId}`) throw new Error("The draft does not match this sale.");
  return prepared;
}

export function parseEditorDraftRecord(value: unknown, key: string): EditorDraftRecord {
  const parsed = z.object({
    key: editorDraftKeySchema, revision: z.number().int().min(1).max(2147483647),
    updatedAt: z.string().datetime({ precision: 3 }), payload: editorDraftPayloadSchema.nullable(),
  }).strict().parse(value);
  if (parsed.key !== key || canonicalJson(parsed) !== canonicalJson(value)) throw new Error("The saved draft could not be verified.");
  if (parsed.payload) prepareEditorDraftPayload(key, parsed.payload);
  return parsed;
}

export const emptyEditorDraft = (key: string): EditorDraftRecord => ({ key: editorDraftKeySchema.parse(key), revision: 0, updatedAt: null, payload: null });
