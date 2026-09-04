import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, setLogLevel, writeBatch } from 'firebase/firestore';

// Never fall through to a real Firebase project if the emulator is unavailable.
const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorAddress) throw new Error('FIRESTORE_EMULATOR_HOST is required. Run through firebase emulators:exec --only firestore.');
const emulator = new URL(`http://${emulatorAddress}`);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(emulator.hostname)) {
  throw new Error('Rules tests only connect to a loopback Firestore emulator.');
}
// Expected permission-denied cases should not flood the test report.
setLogLevel('silent');

const FIRST = '2026-09-03T12:00:00.000Z';
const NEXT = '2026-09-03T12:00:01.000Z';
const ownerId = 'fictional-pilot-a';
const otherId = 'fictional-pilot-b';
const disabledId = 'fictional-disabled';
let environment;

function settings(overrides = {}) {
  const payPlan = {
    version: 'Fictional test plan', effectiveMonth: '2026-01', baseFrontRateBps: 3000,
    acceleratedFrontRateBps: 3500, acceleratedThresholdExclusive: 9, fiRateBps: 2000,
    minimumFrontCommissionCents: 30000, bonusTiers: [],
  };
  return {
    id: 'primary', salespersonName: 'Fictional Test User', storeName: 'Fictional Test Store',
    monthlyGoal: 15, monthlyCommissionGoalCents: null, deliveryGoalsByMonth: {},
    commissionGoalsByMonth: {}, daysOffByMonth: {}, selectedMonth: '2026-09',
    selectedView: 'dashboard', actualPaidByMonth: {}, payPlan, payPlanHistory: [payPlan],
    onboardingDismissed: false, lastBackupAt: null, createdAt: FIRST, updatedAt: FIRST,
    cloudRevision: 0, ...overrides,
  };
}

function sale(overrides = {}) {
  return {
    id: 'fictional-sale', profileId: 'primary', saleDate: '2026-09-03', customerLastName: 'Example',
    stockNumber: 'TEST-001', vehicleDescription: 'Fictional vehicle', status: 'delivered',
    unitCreditBasis: 1000, frontGrossCents: 120000, fiGrossCents: null, notes: '',
    createdAt: FIRST, updatedAt: FIRST, revision: 1, source: 'manual', ...overrides,
  };
}

function audit(overrides = {}) {
  return { id: 1, profileId: 'primary', action: 'sale.created', entityId: 'fictional-sale',
    occurredAt: FIRST, summary: 'Synthetic test activity.', ...overrides };
}

function draft(overrides = {}) {
  return { key: 'new-sale', revision: 1, updatedAt: FIRST, payload: {
    draftId: 'fictional-sale', baseSale: null,
    values: { status: 'delivered', saleDate: '', customerLastName: 'Example', stockNumber: '',
      vehicleDescription: '', unitCredit: '1', frontGross: '-', fiGross: '1.',
      manualFrontCommissionEnabled: false, frontCommissionOverride: '', notes: '' },
    fiProducts: { serviceContractSold: true },
  }, ...overrides };
}

function ownerDb(uid = ownerId) { return environment.authenticatedContext(uid).firestore(); }
function ref(database, uid, suffix) { return doc(database, `users/${uid}/${suffix}`); }

async function seed(uid = ownerId, { profile = settings(), record } = {}) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    if (profile) await setDoc(ref(database, uid, 'settings/primary'), profile);
    if (record) await setDoc(ref(database, uid, `sales/${record.id}`), record);
  });
}

function createSaleBatch(database, { uid = ownerId, record = sale(), profile = settings(), event = audit() } = {}) {
  const batch = writeBatch(database);
  batch.set(ref(database, uid, 'settings/primary'), { ...profile, cloudRevision: profile.cloudRevision + 1 });
  batch.set(ref(database, uid, `sales/${record.id}`), record);
  if (event) batch.set(ref(database, uid, 'auditEvents/create-event'), event);
  return batch;
}

function updateSaleBatch(database, { uid = ownerId, previous = sale(), next = sale({ revision: 2, updatedAt: NEXT, notes: 'Reviewed' }),
  profile = settings(), history = previous, historyId = String(previous.revision), includeHistory = true } = {}) {
  const batch = writeBatch(database);
  batch.set(ref(database, uid, 'settings/primary'), { ...profile, cloudRevision: profile.cloudRevision + 1 });
  batch.set(ref(database, uid, `sales/${previous.id}`), next);
  if (includeHistory) batch.set(ref(database, uid, `saleHistory/${previous.id}/versions/${historyId}`), history);
  batch.set(ref(database, uid, 'auditEvents/update-event'), audit({ id: profile.cloudRevision + 1, action: 'sale.updated' }));
  return batch;
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-sales-ledger-rules',
    firestore: {
      host: emulator.hostname.replace(/^\[|\]$/g, ''), port: Number(emulator.port),
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, `pilotUsers/${ownerId}`), { enabled: true });
    await setDoc(doc(database, `pilotUsers/${otherId}`), { enabled: true });
    await setDoc(doc(database, `pilotUsers/${disabledId}`), { enabled: false });
  });
});

after(async () => { await environment?.cleanup(); });

describe('private incomplete editor drafts', () => {
  it('allows incomplete bounded values without writing a sale, audit or account revision', async () => {
    await seed();
    const database = ownerDb();
    await assertSucceeds(setDoc(ref(database, ownerId, 'drafts/new-sale'), draft()));
    assert.equal((await getDoc(ref(database, ownerId, 'settings/primary'))).data().cloudRevision, 0);
    assert.equal((await getDocs(collection(database, `users/${ownerId}/sales`))).size, 0);
    assert.equal((await getDocs(collection(database, `users/${ownerId}/auditEvents`))).size, 0);
  });

  it('denies cross-account and unapproved draft access', async () => {
    await seed();
    await assertSucceeds(setDoc(ref(ownerDb(), ownerId, 'drafts/new-sale'), draft()));
    for (const database of [environment.unauthenticatedContext().firestore(), ownerDb(otherId), ownerDb(disabledId), ownerDb('unapproved')]) {
      await assertFails(getDoc(ref(database, ownerId, 'drafts/new-sale')));
      await assertFails(setDoc(ref(database, ownerId, 'drafts/new-sale'), draft({ revision: 2, updatedAt: NEXT })));
      await assertFails(getDocs(collection(database, `users/${ownerId}/drafts`)));
    }
    await assertFails(setDoc(ref(ownerDb(disabledId), disabledId, 'drafts/new-sale'), draft()));
  });

  it('requires incrementing versions and retains a content-free tombstone', async () => {
    const database = ownerDb();
    const target = ref(database, ownerId, 'drafts/new-sale');
    await assertSucceeds(setDoc(target, draft()));
    await assertFails(setDoc(target, draft({ updatedAt: NEXT })));
    await assertFails(setDoc(target, draft({ revision: 2 })));
    await assertSucceeds(setDoc(target, draft({ revision: 2, updatedAt: NEXT, payload: null })));
    await assertFails(setDoc(target, draft()));
    await assertFails(deleteDoc(target));
  });

  it('validates nested draft keys, product values, identity and bounded strings', async () => {
    const database = ownerDb();
    for (const invalid of [
      draft({ extra: true }),
      draft({ revision: 2 }),
      draft({ key: 'another-key' }),
      draft({ payload: { ...draft().payload, extra: true } }),
      draft({ payload: { ...draft().payload, values: { ...draft().payload.values, frontGross: 'x'.repeat(81) } } }),
      draft({ payload: { ...draft().payload, fiProducts: { gapSold: 'yes' } } }),
      draft({ payload: { ...draft().payload, fiProducts: { unknownProduct: true } } }),
      draft({ payload: { ...draft().payload, draftId: 'wrong/path' } }),
      draft({ payload: { ...draft().payload, baseSale: sale({ id: 'wrong-sale' }) } }),
    ]) await assertFails(setDoc(ref(database, ownerId, 'drafts/new-sale'), invalid));
    await assertFails(setDoc(ref(database, ownerId, 'drafts/sale:other-sale'), draft({ key: 'sale:other-sale' })));
  });

  it('supports an existing sale draft without mutating the original sale', async () => {
    await seed(ownerId, { record: sale() });
    const database = ownerDb();
    const record = draft({ key: 'sale:fictional-sale', payload: { ...draft().payload, baseSale: sale() } });
    await assertSucceeds(setDoc(ref(database, ownerId, 'drafts/sale:fictional-sale'), record));
    assert.deepEqual((await getDoc(ref(database, ownerId, 'sales/fictional-sale'))).data(), sale());
  });
});

describe('personal cloud workspace and account isolation', () => {
  it('lets an authenticated user create exactly one profile for their own isolated workspace', async () => {
    const selfId = 'fictional-self-service';
    const database = ownerDb(selfId);
    const profile = { uid: selfId, enabled: true, createdAt: FIRST };
    await assertSucceeds(setDoc(doc(database, `pilotUsers/${selfId}`), profile));
    await assertSucceeds(getDoc(doc(database, `pilotUsers/${selfId}`)));
    await assertFails(getDoc(doc(database, `pilotUsers/${ownerId}`)));
    await assertFails(getDocs(collection(database, 'pilotUsers')));
    await assertFails(setDoc(doc(database, `pilotUsers/${selfId}`), { ...profile, enabled: false }));
    await assertFails(setDoc(doc(database, `pilotUsers/${selfId}`), { ...profile, uid: ownerId }));
    await assertFails(setDoc(doc(database, `pilotUsers/${selfId}`), { ...profile, extra: true }));
    await assertFails(setDoc(doc(database, `pilotUsers/${selfId}`), profile));
    await assertFails(deleteDoc(doc(database, `pilotUsers/${selfId}`)));
  });

  it('rejects unauthenticated, cross-account, and disabled data writes until a personal profile exists', async () => {
    await seed();
    const selfId = 'fictional-not-enrolled';
    const self = ownerDb(selfId);
    await assertFails(setDoc(ref(self, selfId, 'settings/primary'), settings()));
    await assertSucceeds(setDoc(doc(self, `pilotUsers/${selfId}`), { uid: selfId, enabled: true, createdAt: FIRST }));
    await assertSucceeds(setDoc(ref(self, selfId, 'settings/primary'), settings()));
    for (const database of [environment.unauthenticatedContext().firestore(), ownerDb(disabledId)]) {
      await assertFails(getDoc(ref(database, ownerId, 'settings/primary')));
      await assertFails(setDoc(ref(database, disabledId, 'settings/primary'), settings()));
    }
    await assertFails(setDoc(ref(ownerDb(otherId), ownerId, 'settings/primary'), settings()));
  });

  it('allows two enabled accounts to create and read only their own workspace', async () => {
    for (const uid of [ownerId, otherId]) {
      await assertSucceeds(setDoc(ref(ownerDb(uid), uid, 'settings/primary'), settings()));
      await assertSucceeds(getDoc(ref(ownerDb(uid), uid, 'settings/primary')));
    }
    await assertFails(getDoc(ref(ownerDb(otherId), ownerId, 'settings/primary')));
    await assertFails(setDoc(ref(ownerDb(otherId), ownerId, 'settings/primary'), settings({ cloudRevision: 1 })));
  });

  it('rejects cross-account sales, audit, and history reads and writes', async () => {
    await seed(ownerId, { record: sale() });
    const database = ownerDb(otherId);
    for (const suffix of ['sales/fictional-sale', 'auditEvents/unknown', 'saleHistory/fictional-sale/versions/1']) {
      await assertFails(getDoc(ref(database, ownerId, suffix)));
      await assertFails(setDoc(ref(database, ownerId, suffix), sale()));
      await assertFails(deleteDoc(ref(database, ownerId, suffix)));
    }
    await assertFails(getDocs(collection(database, `users/${ownerId}/sales`)));
    await assertFails(getDocs(collection(database, 'users')));
  });

  it('keeps unknown collections and alternate settings IDs closed', async () => {
    const database = ownerDb();
    await assertFails(setDoc(ref(database, ownerId, 'settings/secondary'), settings()));
    await assertFails(setDoc(ref(database, ownerId, 'exports/private'), { data: 'not allowed' }));
    await assertFails(setDoc(doc(database, `users/${ownerId}`), { enabled: true }));
  });
});

describe('sale shape, revisions, and atomic history', () => {
  it('creates a sale and append-only audit together with the snapshot barrier', async () => {
    await seed();
    const database = ownerDb();
    await assertSucceeds(createSaleBatch(database).commit());
    assert.equal((await getDoc(ref(database, ownerId, 'settings/primary'))).data().cloudRevision, 1);
    await assertSucceeds(getDocs(collection(database, `users/${ownerId}/sales`)));
    await assertSucceeds(getDocs(collection(database, `users/${ownerId}/auditEvents`)));
  });

  it('rejects sale or audit writes without advancing the settings barrier', async () => {
    await seed();
    const database = ownerDb();
    await assertFails(setDoc(ref(database, ownerId, 'sales/fictional-sale'), sale()));
    await assertFails(setDoc(ref(database, ownerId, 'auditEvents/create-event'), audit()));
  });

  it('requires the sale ID inside the data to match the requested document path', async () => {
    await seed();
    const database = ownerDb();
    const batch = writeBatch(database);
    batch.set(ref(database, ownerId, 'settings/primary'), settings({ cloudRevision: 1 }));
    batch.set(ref(database, ownerId, 'sales/different-path-id'), sale());
    await assertFails(batch.commit());
  });

  it('rejects malformed or unexpected sale fields and nonmanual pilot sources', async () => {
    await seed();
    for (const overrides of [
      { revision: 0 }, { revision: 1.5 }, { revision: 2 }, { id: 'mismatched', profileId: 'other' },
      { status: 'void' }, { source: 'demo' }, { notes: 'x'.repeat(501) },
      { frontGrossCents: 1.1 }, { fiGrossCents: 100000001 }, { unitCreditBasis: 2001 },
      { createdAt: 'not-a-date' }, { deletedAt: FIRST }, { customerPhone: 'not permitted' },
      { serviceContractSold: 'yes' }, { paymentMethod: 'unrecognized' }, { frontCommissionOverrideCents: -1 },
    ]) {
      await assertFails(createSaleBatch(ownerDb(), { record: sale(overrides) }).commit());
    }
  });

  it('preserves the exact prior version before accepting an update', async () => {
    await seed(ownerId, { record: sale() });
    const database = ownerDb();
    await assertSucceeds(updateSaleBatch(database).commit());
    assert.deepEqual((await getDoc(ref(database, ownerId, 'saleHistory/fictional-sale/versions/1'))).data(), sale());
    assert.equal((await getDoc(ref(database, ownerId, 'sales/fictional-sale'))).data().revision, 2);
    await assertSucceeds(getDocs(collection(database, `users/${ownerId}/saleHistory/fictional-sale/versions`)));
  });

  it('denies updates without exact matching prior history or canonical version ID', async () => {
    await seed(ownerId, { record: sale() });
    for (const options of [
      { includeHistory: false }, { history: sale({ notes: 'forged' }) }, { historyId: '01' },
      { historyId: '2' }, { next: sale({ revision: 3, updatedAt: NEXT }) },
      { next: sale({ revision: 2 }) }, { next: sale({ revision: 2, createdAt: NEXT, updatedAt: NEXT }) },
    ]) await assertFails(updateSaleBatch(ownerDb(), options).commit());
  });

  it('rejects duplicate creates and stale updates rather than overwriting the new version', async () => {
    await seed(ownerId, { record: sale() });
    await assertFails(createSaleBatch(ownerDb()).commit());
    await assertSucceeds(updateSaleBatch(ownerDb()).commit());
    await assertFails(updateSaleBatch(ownerDb()).commit());
    assert.equal((await getDoc(ref(ownerDb(), ownerId, 'sales/fictional-sale'))).data().revision, 2);
  });

  it('supports a versioned soft delete and restore but denies physical deletion', async () => {
    await seed(ownerId, { record: sale() });
    const database = ownerDb();
    const deleted = sale({ revision: 2, updatedAt: NEXT, deletedAt: NEXT });
    await assertSucceeds(updateSaleBatch(database, { next: deleted }).commit());
    await assertFails(deleteDoc(ref(database, ownerId, 'sales/fictional-sale')));
    // Use a unique event for the subsequent restore transaction.
    const restore = writeBatch(database);
    restore.set(ref(database, ownerId, 'settings/primary'), settings({ cloudRevision: 2 }));
    restore.set(ref(database, ownerId, 'sales/fictional-sale'), sale({ revision: 3, updatedAt: '2026-09-03T12:00:02.000Z' }));
    restore.set(ref(database, ownerId, 'saleHistory/fictional-sale/versions/2'), deleted);
    restore.set(ref(database, ownerId, 'auditEvents/restore-event'), audit({ id: 2, action: 'sale.restored', occurredAt: '2026-09-03T12:00:02.000Z' }));
    await assertSucceeds(restore.commit());
  });

  it('makes history immutable and prevents history fabrication without a sale update', async () => {
    await seed(ownerId, { record: sale() });
    const database = ownerDb();
    await assertFails(setDoc(ref(database, ownerId, 'saleHistory/fictional-sale/versions/1'), sale()));
    const fabricated = writeBatch(database);
    fabricated.set(ref(database, ownerId, 'settings/primary'), settings({ cloudRevision: 1 }));
    fabricated.set(ref(database, ownerId, 'saleHistory/fictional-sale/versions/1'), sale());
    await assertFails(fabricated.commit());
    await assertSucceeds(updateSaleBatch(database).commit());
    await assertFails(setDoc(ref(database, ownerId, 'saleHistory/fictional-sale/versions/1'), sale({ notes: 'changed' })));
    await assertFails(deleteDoc(ref(database, ownerId, 'saleHistory/fictional-sale/versions/1')));
  });
});

describe('settings and activity constraints', () => {
  it('requires initial revision zero, immutable identity, and exactly incremented settings revisions', async () => {
    const database = ownerDb();
    await assertFails(setDoc(ref(database, ownerId, 'settings/primary'), settings({ cloudRevision: 1 })));
    await assertSucceeds(setDoc(ref(database, ownerId, 'settings/primary'), settings()));
    for (const overrides of [
      { cloudRevision: 0 }, { cloudRevision: 2 }, { cloudRevision: 1.5 },
      { cloudRevision: 1, createdAt: NEXT }, { cloudRevision: 1, id: 'other' },
      { cloudRevision: 1, monthlyGoal: 0 }, { cloudRevision: 1, secret: 'not permitted' },
      { cloudRevision: 1, payPlanHistory: {} }, { cloudRevision: 1, actualPaidByMonth: [] },
    ]) await assertFails(setDoc(ref(database, ownerId, 'settings/primary'), settings(overrides)));
    await assertSucceeds(setDoc(ref(database, ownerId, 'settings/primary'), settings({ cloudRevision: 1, monthlyGoal: 20, updatedAt: NEXT })));
    await assertFails(deleteDoc(ref(database, ownerId, 'settings/primary')));
  });

  it('keeps audit append-only and rejects extra, invalid, and unsupported action fields', async () => {
    await seed();
    const database = ownerDb();
    for (const overrides of [
      { id: 0 }, { id: 2 }, { action: 'demo.loaded' }, { action: 'import.completed' },
      { summary: 'x'.repeat(501) }, { occurredAt: 'invalid' }, { details: [] },
      { profileId: 'other' }, { unexpected: true },
    ]) await assertFails(createSaleBatch(database, { event: audit(overrides) }).commit());
    await assertSucceeds(createSaleBatch(database).commit());
    await assertFails(setDoc(ref(database, ownerId, 'auditEvents/create-event'), audit({ summary: 'Changed' })));
    await assertFails(deleteDoc(ref(database, ownerId, 'auditEvents/create-event')));
  });

  it('revokes user-data access when the administrator disables the pilot entry', async () => {
    await seed();
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), `pilotUsers/${ownerId}`), { enabled: false }));
    await assertFails(getDoc(ref(ownerDb(), ownerId, 'settings/primary')));
    await assertFails(createSaleBatch(ownerDb()).commit());
    await assertSucceeds(getDoc(doc(ownerDb(), `pilotUsers/${ownerId}`)));
  });
});
