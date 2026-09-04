import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import { createDefaultSettings } from "@/persistence/localDatabase";
import { SaleWriteConflictError } from "@/persistence/errors";
import { profileSchema } from "@/lib/files";
import type { ProfileSettings, Sale } from "@/domain/types";
import { EditorDraftConflictError, type EditorDraftPayload } from "@/persistence/editorDraftSchema";
import {
  CloudDataValidationError,
  SettingsWriteConflictError,
  createFirebaseRepository,
} from "@/cloud/firebaseRepository";

type Data = Record<string, unknown>;
type Ref = { path: string; id: string };
type Snapshot = {
  id: string;
  exists: () => boolean;
  data: () => Data | undefined;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};

const server = vi.hoisted(() => ({
  documents: new Map<string, Data>(),
  nextId: 0,
  transactionAttempts: 0,
  retry: undefined as undefined | (() => void),
  queryHook: undefined as undefined | ((path: string) => void),
  commitGate: undefined as undefined | Promise<void>,
  commitError: undefined as undefined | Error,
  listener: undefined as undefined | ((snapshot: Snapshot) => void),
  listenerError: undefined as undefined | ((error: Error) => void),
  unsubscribe: vi.fn(),
}));

vi.mock("firebase/firestore", () => {
  function ref(parent: Ref | object, ...segments: string[]): Ref {
    const prefix = "path" in parent ? (parent as Ref).path : "";
    const path = [prefix, ...segments].filter(Boolean).join("/");
    return { path, id: path.split("/").at(-1)! };
  }

  function snapshot(reference: Ref): Snapshot {
    const data = structuredClone(server.documents.get(reference.path));
    return {
      id: reference.id,
      exists: () => data !== undefined,
      data: () => structuredClone(data),
      metadata: { fromCache: false, hasPendingWrites: false },
    };
  }

  return {
    collection: vi.fn(ref),
    doc: vi.fn((parent: Ref | object, ...segments: string[]) => ref(parent, ...(
      segments.length ? segments : [`event-${++server.nextId}`]
    ))),
    getDocFromServer: vi.fn(async (reference: Ref) => snapshot(reference)),
    getDocsFromServer: vi.fn(async (reference: Ref) => {
      const prefix = `${reference.path}/`;
      const docs = [...server.documents.keys()]
        .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map((path) => snapshot({ path, id: path.split("/").at(-1)! }));
      server.queryHook?.(reference.path);
      return { docs };
    }),
    runTransaction: vi.fn(async (_firestore: object, callback: (transaction: object) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        server.transactionAttempts += 1;
        const writes: Array<[string, Data]> = [];
        const result = await callback({
          get: async (reference: Ref) => snapshot(reference),
          set: (reference: Ref, data: Data) => { writes.push([reference.path, structuredClone(data)]); },
        });
        if (writes.length && server.retry) {
          const retry = server.retry;
          server.retry = undefined;
          retry();
          continue;
        }
        if (writes.length) {
          await server.commitGate;
          if (server.commitError) throw server.commitError;
          for (const [path, data] of writes) server.documents.set(path, data);
        }
        return result;
      }
      throw new Error("Too many retries in test server.");
    }),
    onSnapshot: vi.fn((_reference: Ref, _options: object, listener: (snapshot: Snapshot) => void, onError: (error: Error) => void) => {
      server.listener = listener;
      server.listenerError = onError;
      return server.unsubscribe;
    }),
  };
});

const firestore = {} as Firestore;
const settingsPath = "users/pilot-user/settings/primary";
const salePath = "users/pilot-user/sales/sale-one";
const draftPath = "users/pilot-user/drafts/new-sale";

const sampleDraft: EditorDraftPayload = {
  draftId: "sale-one", baseSale: null,
  values: { status: "delivered", saleDate: "", customerLastName: "Example", stockNumber: "",
    vehicleDescription: "Fictional vehicle", unitCredit: "1", frontGross: "-", fiGross: "",
    manualFrontCommissionEnabled: false, frontCommissionOverride: "", notes: "" },
  fiProducts: { serviceContractSold: true },
};

const sampleSale: Sale = {
  id: "sale-one",
  profileId: "primary",
  saleDate: "2026-08-10",
  customerLastName: "Example",
  stockNumber: "TEST-001",
  vehicleDescription: "Fictional test vehicle",
  status: "delivered",
  unitCreditBasis: 1_000,
  frontGrossCents: 200_000,
  fiGrossCents: 50_000,
  notes: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  revision: 1,
  source: "manual",
};

function seedSettings(overrides: Partial<ProfileSettings> = {}, cloudRevision = 0): ProfileSettings {
  const settings = profileSchema.parse({
    ...createDefaultSettings(new Date("2026-09-03T12:00:00.000Z")),
    ...overrides,
  });
  server.documents.set(settingsPath, { ...settings, cloudRevision });
  return settings;
}

function events(): Data[] {
  return [...server.documents.entries()]
    .filter(([path]) => path.startsWith("users/pilot-user/auditEvents/"))
    .map(([, value]) => value);
}

function serverSnapshot(options: Partial<Snapshot["metadata"]> = {}): Snapshot {
  return {
    id: "primary",
    exists: () => server.documents.has(settingsPath),
    data: () => structuredClone(server.documents.get(settingsPath)),
    metadata: { fromCache: false, hasPendingWrites: false, ...options },
  };
}

describe("Firebase online-first repository", () => {
  beforeEach(() => {
    server.documents.clear();
    server.nextId = 0;
    server.transactionAttempts = 0;
    server.retry = undefined;
    server.queryHook = undefined;
    server.commitGate = undefined;
    server.commitError = undefined;
    server.listener = undefined;
    server.listenerError = undefined;
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
  });

  it("stores incomplete drafts separately without advancing sale totals, audit, or account revision", async () => {
    seedSettings();
    const repository = createFirebaseRepository(firestore, "pilot-user");
    expect(await repository.loadEditorDraft("new-sale")).toMatchObject({ revision: 0, payload: null });
    const saved = await repository.saveEditorDraft("new-sale", sampleDraft, 0);
    expect(await repository.loadEditorDraft("new-sale")).toEqual(saved);
    expect(saved.payload?.values.frontGross).toBe("-");
    expect(server.documents.get(settingsPath)?.cloudRevision).toBe(0);
    expect(server.documents.has(salePath)).toBe(false);
    expect(events()).toHaveLength(0);
  });

  it("does not acknowledge a cloud draft until the server commits", async () => {
    let commit!: () => void;
    server.commitGate = new Promise<void>((resolve) => { commit = resolve; });
    let acknowledged = false;
    const saving = createFirebaseRepository(firestore, "pilot-user").saveEditorDraft("new-sale", sampleDraft, 0).then(() => { acknowledged = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(server.documents.has(draftPath)).toBe(false);
    commit(); await saving;
    expect(acknowledged).toBe(true);
  });

  it("keeps the original draft version on a transaction retry", async () => {
    const repository = createFirebaseRepository(firestore, "pilot-user");
    const first = await repository.saveEditorDraft("new-sale", sampleDraft, 0);
    server.retry = () => server.documents.set(draftPath, { ...first, revision: 2, updatedAt: "2026-09-03T12:00:01.000Z", payload: { ...sampleDraft, values: { ...sampleDraft.values, customerLastName: "Other device" } } });
    await expect(repository.saveEditorDraft("new-sale", sampleDraft, first.revision)).rejects.toBeInstanceOf(EditorDraftConflictError);
    expect((server.documents.get(draftPath)!.payload as EditorDraftPayload).values.customerLastName).toBe("Other device");
  });

  it("uses a content-free draft tombstone so a stale tab cannot recreate discarded entries", async () => {
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await repository.saveEditorDraft("new-sale", sampleDraft, 0);
    const cleared = await repository.clearEditorDraft("new-sale", 1);
    expect(cleared).toMatchObject({ revision: 2, payload: null });
    await expect(repository.saveEditorDraft("new-sale", sampleDraft, 0)).rejects.toBeInstanceOf(EditorDraftConflictError);
    await expect(repository.clearEditorDraft("new-sale", 1)).rejects.toBeInstanceOf(EditorDraftConflictError);
  });

  it("never queues an offline draft and never touches a different account's slot", async () => {
    const owner = createFirebaseRepository(firestore, "pilot-user");
    await owner.saveEditorDraft("new-sale", sampleDraft, 0);
    expect(await createFirebaseRepository(firestore, "other-user").loadEditorDraft("new-sale")).toMatchObject({ revision: 0, payload: null });
    vi.stubGlobal("navigator", { onLine: false });
    await expect(owner.saveEditorDraft("new-sale", sampleDraft, 1)).rejects.toThrow("offline");
    expect(server.documents.get(draftPath)?.revision).toBe(1);
    vi.unstubAllGlobals();
  });

  it("initializes a fresh account without copying local records or writing an initialization audit", async () => {
    const repository = createFirebaseRepository(firestore, "pilot-user");
    const result = await repository.loadTrackerData();
    expect(result.settings.id).toBe("primary");
    expect(result.sales).toEqual([]);
    expect(result.auditEvents).toEqual([]);
    expect(server.documents.get(settingsPath)).toMatchObject({ cloudRevision: 0, salespersonName: "" });
    expect(server.documents.size).toBe(1);
  });

  it("writes a sale, account revision and audit atomically only after server acknowledgement", async () => {
    seedSettings();
    const status = vi.fn();
    let acknowledge!: () => void;
    server.commitGate = new Promise<void>((resolve) => { acknowledge = resolve; });
    const repository = createFirebaseRepository(firestore, "pilot-user", { onWriteStatus: status });
    let resolved = false;
    const saving = repository.persistSale(sampleSale, true).then(() => { resolved = true; });
    await vi.waitFor(() => expect(server.transactionAttempts).toBe(1));
    expect(resolved).toBe(false);
    expect(server.documents.has(salePath)).toBe(false);
    expect(events()).toEqual([]);
    expect(status.mock.calls.map(([value]) => value)).toEqual(["saving"]);
    acknowledge();
    await saving;
    expect(server.documents.get(salePath)).toMatchObject({ revision: 1, stockNumber: "TEST-001" });
    expect(server.documents.get(settingsPath)?.cloudRevision).toBe(1);
    expect(events()).toMatchObject([{ id: 1, action: "sale.created", entityId: "sale-one" }]);
    expect(status.mock.calls.map(([value]) => value)).toEqual(["saving", "saved"]);
  });

  it("fails offline without creating a transaction or reporting saved", async () => {
    seedSettings();
    vi.stubGlobal("navigator", { onLine: false });
    const status = vi.fn();
    const repository = createFirebaseRepository(firestore, "pilot-user", { onWriteStatus: status });
    await expect(repository.persistSale(sampleSale, true)).rejects.toThrow(/offline/);
    expect(server.transactionAttempts).toBe(0);
    expect(server.documents.has(salePath)).toBe(false);
    expect(status).not.toHaveBeenCalledWith("saved");
  });

  it("does not leave a partial sale, history, audit, or revision after a rejected commit", async () => {
    seedSettings();
    const before = structuredClone([...server.documents]);
    server.commitError = new Error("Connection unavailable.");
    await expect(createFirebaseRepository(firestore, "pilot-user").persistSale(sampleSale, true)).rejects.toThrow(/Connection unavailable/);
    expect([...server.documents]).toEqual(before);
  });

  it("keeps the exact previous version for an update, deletion, and restore", async () => {
    seedSettings();
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await repository.persistSale(sampleSale, true);
    const first = (await repository.loadTrackerData()).sales[0];
    await repository.persistSale({ ...first, notes: "Reviewed", revision: 2 }, false, first);
    const updated = (await repository.loadTrackerData()).sales[0];
    expect(server.documents.get("users/pilot-user/saleHistory/sale-one/versions/1")).toEqual(first);
    expect(updated.updatedAt).not.toBe(first.updatedAt);
    const deleted = await repository.softDeleteSale(updated);
    expect(server.documents.get("users/pilot-user/saleHistory/sale-one/versions/2")).toEqual(updated);
    const restored = await repository.restoreSale(deleted);
    expect(server.documents.get("users/pilot-user/saleHistory/sale-one/versions/3")).toEqual(deleted);
    expect(restored).toMatchObject({ revision: 4, notes: "Reviewed" });
    expect(restored.deletedAt).toBeUndefined();
    expect(events().map((event) => event.action)).toEqual(["sale.created", "sale.updated", "sale.deleted", "sale.restored"]);
    expect(server.documents.get(settingsPath)?.cloudRevision).toBe(4);
  });

  it("compares the original revision AND timestamp again after an SDK retry", async () => {
    seedSettings();
    server.documents.set(salePath, { ...sampleSale });
    server.retry = () => {
      server.documents.set(salePath, { ...sampleSale, notes: "Other device", updatedAt: "2026-08-10T12:00:00.001Z" });
    };
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await expect(repository.persistSale({ ...sampleSale, revision: 2, notes: "Stale editor" }, false, sampleSale))
      .rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(server.transactionAttempts).toBe(2);
    expect(server.documents.get(salePath)?.notes).toBe("Other device");
    expect(events()).toEqual([]);
    expect(server.documents.has("users/pilot-user/saleHistory/sale-one/versions/1")).toBe(false);
  });

  it("requires the original version token and never overwrites an existing ID as a create", async () => {
    seedSettings();
    server.documents.set(salePath, { ...sampleSale });
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await expect(repository.persistSale({ ...sampleSale, revision: 2 }, false)).rejects.toBeInstanceOf(SaleWriteConflictError);
    await expect(repository.persistSale(sampleSale, true)).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(server.documents.get(salePath)).toEqual(sampleSale);
  });

  it("rejects stale delete and restore requests", async () => {
    seedSettings();
    server.documents.set(salePath, { ...sampleSale, revision: 2 });
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await expect(repository.softDeleteSale(sampleSale)).rejects.toBeInstanceOf(SaleWriteConflictError);
    await expect(repository.restoreSale({ ...sampleSale, deletedAt: sampleSale.updatedAt })).rejects.toBeInstanceOf(SaleWriteConflictError);
    expect(events()).toEqual([]);
  });

  it("re-reads a backup whose collection reads straddle another committed change", async () => {
    seedSettings();
    let queryCalls = 0;
    server.queryHook = (path) => {
      if (!path.endsWith("/sales")) return;
      queryCalls += 1;
      if (queryCalls !== 1) return;
      server.documents.set(salePath, { ...sampleSale });
      server.documents.set(settingsPath, { ...server.documents.get(settingsPath), cloudRevision: 1 });
      server.documents.set("users/pilot-user/auditEvents/concurrent", {
        id: 1, profileId: "primary", action: "sale.created", occurredAt: sampleSale.updatedAt, summary: "Added test record.",
      });
    };
    const result = await createFirebaseRepository(firestore, "pilot-user").loadBackupSnapshot();
    expect(queryCalls).toBe(2);
    expect(result.sales).toEqual([sampleSale]);
    expect(result.auditEvents).toHaveLength(1);
    expect(result.settings).not.toHaveProperty("cloudRevision");
  });

  it.each([
    { frontGrossCents: Number.NaN },
    { profileId: "another-profile" },
    { id: "another-document" },
    { updatedAt: "yesterday" },
    { unexpected: "must not be silently stripped" },
    { paymentMethod: "cash", dealerFinanced: true },
  ])("fails malformed cloud records without repairing them: %j", async (corruption) => {
    seedSettings();
    server.documents.set(salePath, { ...sampleSale, ...corruption });
    await expect(createFirebaseRepository(firestore, "pilot-user").loadTrackerData()).rejects.toBeInstanceOf(CloudDataValidationError);
  });

  it("does not normalize malformed remote settings into apparently valid settings", async () => {
    seedSettings();
    server.documents.set(settingsPath, { ...server.documents.get(settingsPath), actualPaidByMonth: { "2026-09": 1.5 } });
    await expect(createFirebaseRepository(firestore, "pilot-user").loadTrackerData()).rejects.toBeInstanceOf(CloudDataValidationError);
  });

  it("rejects stale settings and loss of pay-plan coverage for any saved sale", async () => {
    const settings = seedSettings();
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await expect(repository.persistSettings({ ...settings, updatedAt: sampleSale.updatedAt })).rejects.toBeInstanceOf(SettingsWriteConflictError);
    server.documents.set(salePath, { ...sampleSale, deletedAt: sampleSale.updatedAt });
    const laterPlan = { ...settings.payPlan, effectiveMonth: "2026-09" };
    await expect(repository.persistSettings({ ...settings, payPlan: laterPlan, payPlanHistory: [laterPlan] })).rejects.toThrow(/pay plan/i);
    expect(server.documents.get(settingsPath)?.updatedAt).toBe(settings.updatedAt);
    expect(events()).toEqual([]);
  });

  it("saves settings and audit together while retaining device-only fields in their proper scope", async () => {
    const settings = seedSettings();
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await repository.persistSettings({
      ...settings,
      salespersonName: "Test salesperson",
      monthlyGoal: 20,
      selectedMonth: "2026-08",
      selectedView: "settings",
      lastBackupAt: sampleSale.updatedAt,
    });
    expect(server.documents.get(settingsPath)).toMatchObject({
      salespersonName: "Test salesperson", monthlyGoal: 20,
      selectedMonth: "2026-09", selectedView: "dashboard", lastBackupAt: null,
      createdAt: settings.createdAt, cloudRevision: 1,
    });
    expect(server.documents.get(settingsPath)?.updatedAt).not.toBe(settings.updatedAt);
    expect(events()).toMatchObject([{ id: 1, action: "settings.updated", details: { payPlanChanged: false } }]);
  });

  it("compares the original settings timestamp after an SDK retry", async () => {
    const settings = seedSettings();
    server.retry = () => {
      server.documents.set(settingsPath, {
        ...server.documents.get(settingsPath),
        salespersonName: "Other device",
        updatedAt: "2026-09-03T12:00:00.001Z",
      });
    };
    await expect(createFirebaseRepository(firestore, "pilot-user").persistSettings({
      ...settings, salespersonName: "Stale settings editor",
    })).rejects.toBeInstanceOf(SettingsWriteConflictError);
    expect(server.documents.get(settingsPath)?.salespersonName).toBe("Other device");
    expect(events()).toEqual([]);
  });

  it("rechecks all sales if one arrives while settings are being committed", async () => {
    const settings = seedSettings();
    const laterPlan = { ...settings.payPlan, effectiveMonth: "2026-09" };
    server.retry = () => {
      server.documents.set(salePath, { ...sampleSale });
      server.documents.set(settingsPath, { ...server.documents.get(settingsPath), cloudRevision: 1 });
    };
    await expect(createFirebaseRepository(firestore, "pilot-user").persistSettings({
      ...settings, payPlan: laterPlan, payPlanHistory: [laterPlan],
    })).rejects.toThrow(/pay plan/i);
    expect(server.documents.get(settingsPath)?.updatedAt).toBe(settings.updatedAt);
    expect(server.documents.get(salePath)).toEqual(sampleSale);
    expect(events()).toEqual([]);
  });

  it("keeps month/view navigation device-local and narrowly merges onboarding into latest settings", async () => {
    const stale = seedSettings();
    const repository = createFirebaseRepository(firestore, "pilot-user");
    const navigated = await repository.updateSelectedContext(stale, { selectedMonth: "2026-08", selectedView: "sales" });
    expect(navigated).toMatchObject({ selectedMonth: "2026-08", selectedView: "sales", updatedAt: stale.updatedAt });
    expect(server.transactionAttempts).toBe(0);
    expect(server.documents.get(settingsPath)?.selectedMonth).toBe("2026-09");
    seedSettings({ salespersonName: "Changed elsewhere", actualPaidByMonth: { "2026-09": 500_000 } });
    const updated = await repository.updateSelectedContext(stale, { onboardingDismissed: true });
    expect(updated).toMatchObject({ salespersonName: "Changed elsewhere", onboardingDismissed: true, selectedMonth: "2026-08" });
    expect(server.documents.get(settingsPath)).toMatchObject({ selectedView: "dashboard", actualPaidByMonth: { "2026-09": 500_000 }, cloudRevision: 1 });
  });

  it("preserves latest settings when recording a backup download", async () => {
    const stale = createDefaultSettings();
    const latest = seedSettings({ salespersonName: "Latest settings", monthlyGoal: 22 });
    const repository = createFirebaseRepository(firestore, "pilot-user");
    const updated = await repository.recordBackupExport(stale);
    expect(updated).toMatchObject({ salespersonName: "Latest settings", monthlyGoal: 22, lastBackupAt: expect.any(String) });
    expect(events()).toMatchObject([{ id: 1, action: "backup.exported" }]);
    expect(server.documents.get(settingsPath)).toMatchObject({ updatedAt: latest.updatedAt, lastBackupAt: null });
    expect((await repository.loadTrackerData()).settings.lastBackupAt).toBe(updated.lastBackupAt);
  });

  it("separates account paths without changing domain profile IDs", async () => {
    seedSettings();
    server.documents.set(salePath, { ...sampleSale });
    const other = await createFirebaseRepository(firestore, "other-pilot").loadTrackerData();
    expect(other.settings.id).toBe("primary");
    expect(other.sales).toEqual([]);
    expect(server.documents.has("users/other-pilot/settings/primary")).toBe(true);
  });

  it("rejects dangerous path IDs before talking to Firestore", async () => {
    expect(() => createFirebaseRepository(firestore, "another/account")).toThrow(CloudDataValidationError);
    const repository = createFirebaseRepository(firestore, "pilot-user");
    await expect(repository.persistSale({ ...sampleSale, id: "other/sale" }, true)).rejects.toBeInstanceOf(CloudDataValidationError);
    expect(server.transactionAttempts).toBe(0);
  });

  it("does not publish cached or pending snapshots as cloud changes and cleans up the listener", () => {
    seedSettings();
    const onChange = vi.fn();
    const onError = vi.fn();
    const stop = createFirebaseRepository(firestore, "pilot-user").subscribe(onChange, onError);
    server.listener?.(serverSnapshot({ fromCache: true }));
    server.listener?.(serverSnapshot({ hasPendingWrites: true }));
    expect(onChange).not.toHaveBeenCalled();
    server.listener?.(serverSnapshot());
    expect(onChange).toHaveBeenCalledTimes(1);
    server.listener?.(serverSnapshot({ fromCache: true }));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    server.listener?.(serverSnapshot());
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    expect(server.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
