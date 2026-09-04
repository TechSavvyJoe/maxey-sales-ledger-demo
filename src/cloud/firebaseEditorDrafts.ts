import { doc, getDocFromServer, runTransaction, type Firestore } from "firebase/firestore";
import {
  assertDraftRevision, editorDraftKeySchema, EditorDraftConflictError, emptyEditorDraft,
  parseEditorDraftRecord, prepareEditorDraftPayload,
  type EditorDraftPayload, type EditorDraftRecord, type EditorDraftRepository,
} from "@/persistence/editorDraftSchema";

function assertOnline() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You are offline. Keep this editor open and reconnect to save your draft.");
  }
}

/** Server-confirmed drafts are private, bounded, and excluded from sale totals. */
export function createFirebaseEditorDraftRepository(firestore: Firestore, uid: string): EditorDraftRepository {
  if (!uid || uid.length > 128 || uid.includes("/") || uid === "." || uid === ".." || /^__.*__$/.test(uid)) throw new Error("The draft account could not be verified.");
  const reference = (key: string) => doc(firestore, "users", uid, "drafts", editorDraftKeySchema.parse(key));
  async function loadEditorDraft(key: string): Promise<EditorDraftRecord> {
    assertOnline();
    const snapshot = await getDocFromServer(reference(key));
    return snapshot.exists() ? parseEditorDraftRecord(snapshot.data(), key) : emptyEditorDraft(key);
  }

  async function replaceDraft(key: string, payload: EditorDraftPayload | null, expectedRevision: number): Promise<EditorDraftRecord> {
    assertOnline();
    assertDraftRevision(expectedRevision);
    const ref = reference(key);
    const prepared = payload ? prepareEditorDraftPayload(key, payload) : null;
    return runTransaction(firestore, async (transaction) => {
      assertOnline();
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists() ? parseEditorDraftRecord(snapshot.data(), key) : emptyEditorDraft(key);
      // Keep the editor's original expectation on every Firestore retry.
      if (current.revision !== expectedRevision) throw new EditorDraftConflictError();
      const next: EditorDraftRecord = {
        key, revision: expectedRevision + 1, payload: prepared,
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt ? Date.parse(current.updatedAt) + 1 : 0)).toISOString(),
      };
      transaction.set(ref, next);
      return next;
    }, { maxAttempts: 3 });
  }
  return {
    loadEditorDraft,
    saveEditorDraft: (key, payload, expectedRevision) => replaceDraft(key, payload, expectedRevision),
    clearEditorDraft: (key, expectedRevision) => replaceDraft(key, null, expectedRevision),
  };
}
