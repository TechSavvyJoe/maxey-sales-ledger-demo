import Dexie, { type EntityTable } from "dexie";
import {
  assertDraftRevision, editorDraftKeySchema, EditorDraftConflictError, emptyEditorDraft,
  parseEditorDraftRecord, prepareEditorDraftPayload, type EditorDraftPayload, type EditorDraftRecord,
} from "./editorDraftSchema";

// A separate local-only store avoids changing the ledger backup/import format.
// Cloud mode never opens this database or falls back to it after a failed save.
export const editorDraftDb = new Dexie("maxey-sales-ledger-editor-drafts-v1") as Dexie & { drafts: EntityTable<EditorDraftRecord, "key"> };
editorDraftDb.version(1).stores({ drafts: "&key" });

export async function loadEditorDraft(key: string): Promise<EditorDraftRecord> {
  editorDraftKeySchema.parse(key);
  const record = await editorDraftDb.drafts.get(key);
  return record ? parseEditorDraftRecord(record, key) : emptyEditorDraft(key);
}

async function replaceDraft(key: string, payload: EditorDraftPayload | null, expectedRevision: number): Promise<EditorDraftRecord> {
  editorDraftKeySchema.parse(key);
  assertDraftRevision(expectedRevision);
  const prepared = payload ? prepareEditorDraftPayload(key, payload) : null;
  return editorDraftDb.transaction("rw", editorDraftDb.drafts, async () => {
    const current = await loadEditorDraft(key);
    if (current.revision !== expectedRevision) throw new EditorDraftConflictError();
    const next: EditorDraftRecord = {
      key, revision: expectedRevision + 1, payload: prepared,
      updatedAt: new Date(Math.max(Date.now(), current.updatedAt ? Date.parse(current.updatedAt) + 1 : 0)).toISOString(),
    };
    await editorDraftDb.drafts.put(next);
    return structuredClone(next);
  });
}

export const saveEditorDraft = (key: string, payload: EditorDraftPayload, expectedRevision: number) => replaceDraft(key, payload, expectedRevision);
// Retain only a revision tombstone. Deleting the slot would let a stale tab
// resurrect an old draft after another tab has already saved/discarded it.
export const clearEditorDraft = (key: string, expectedRevision: number) => replaceDraft(key, null, expectedRevision);
