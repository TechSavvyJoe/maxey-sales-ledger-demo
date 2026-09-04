# Firebase private-cloud security

This is a private, online-first cloud workspace, separate from the public local-only demo.
Configuration and automated tests alone are not proof of a secured live deployment.
The September 3, 2026 private deployment is documented in `firebase-pilot-setup.md`.
Its rules were independently hash-matched and anonymous access was denied. The
verified owner account completed live save, edit, reload, delete and restore
checks with one fictional entry; live multi-account acceptance remains separate.
No live user records are needed for the automated tests in this repository.

## Access boundary

- Every sales, settings, history, activity, and editor-draft request requires Firebase
  Authentication, a matching UID in `/users/{uid}`, and
  `/pilotUsers/{uid}.enabled == true`.
- A signed-in user may read their own access document. On their first visit, they may
  create only `/pilotUsers/{their UID}` with exactly their UID, `enabled: true`, and a
  valid creation timestamp. Clients cannot list, update, or delete access documents.
- There is no manager access, public collection, or general authenticated-user
  permission. Unrecognized paths are denied.
- The domain value `profileId: "primary"` is not an authorization boundary. The
  authenticated UID and document path are the boundary.
- Firebase API configuration identifies the project; it is not an administrative
  credential. Never put a service-account private key or admin SDK in this app.

## Self-service personal workspaces

After the intended Firebase project, Authentication providers, and reviewed rules
are deployed, a salesperson signs in with their own Google account or email link.
The app creates one immutable access document for that exact authenticated UID, then
creates the empty settings document inside that same account. No shared collection,
wildcard permission, email-matching rule, or per-person console step is used.

The rule permits the narrowest possible self-service enrollment: a user may create
only their own `pilotUsers/{uid}` record, with the required fields and `enabled` set
to true. It does not let that account list other users, modify its status, or read
another account's ledger. An administrator can still set `enabled = false` through
the Firebase console to disable a workspace, and can separately revoke the Firebase
Auth session when appropriate.

Creating local files or using Firebase CLI does not create an app account. The
separate project, database, providers, hosting, and deployed rules remain required.

## Data and transaction contract

| Path under `/users/{uid}` | Contract |
| --- | --- |
| `settings/primary` | Existing profile shape plus integer `cloudRevision`; starts at zero and advances by exactly one per committed mutation transaction. `id` and `createdAt` cannot change. |
| `sales/{saleId}` | Exact supported Sale fields, `id` matching the path, `profileId = primary`; creates at revision one; each update advances one revision and preserves `createdAt`. |
| `saleHistory/{saleId}/versions/{revision}` | Exact prior Sale, revision as canonical decimal document ID, created atomically with its replacement; immutable afterward. |
| `auditEvents/{eventId}` | Domain activity with numeric `id` equal to the transaction's resulting `cloudRevision`; document ID is unique; append-only. |
| `drafts/{key}` | Separate incomplete editor data, bounded nested values and original Sale baseline, keyed `new-sale` or `sale:{id}`; an independent integer revision prevents cross-tab replacement. Not included in sales, reports, payroll, backups or account activity. |

Each sale, history, or activity write requires the settings revision to advance
in the same atomic transaction. An updated sale must preserve its exact previous
version in history. Soft deletes retain a timestamped sale and prior version;
physical deletion is denied. Imports, full restores, and demo mutations are
disabled in both the cloud adapter and cloud interface. Only manual sale sources
and supported activity actions are accepted by these rules.

Transactions compare the editor's original sale revision and timestamp, or the
original settings timestamp, with the latest server value. They must repeat that
comparison on every transaction retry, never silently accept a refreshed expected
version. `cloudRevision` is a snapshot/export consistency barrier, not a replacement
for that comparison. Client domain timestamps are not trusted server audit times.

The cloud workspace uses memory-only Firestore caching, no durable offline write queue, and
reports success only after a server acknowledgement. Failed saves preserve the
editor and say that changes are unsaved. Account changes must detach old listeners,
invalidate pending responses, and clear the previous account's displayed state.
Session-local navigation must not produce cloud writes. Automatic local-folder
backup integrations require account isolation before they can be enabled here.

Editor drafts use server-acknowledged transactions with their own original revision
check. They preserve raw incomplete numeric text and unanswered product fields;
they never bypass Sale validation or enter commission totals. Clearing a draft
removes its payload and retains only a revision/time tombstone, preventing a stale
tab from resurrecting discarded entries. Cloud drafts never fall back to the
local-only IndexedDB draft database. In-flight draft results are invalidated when
the account/repository changes. A draft acknowledgement must not clear a failed
authoritative sale-save warning. Sale/settings writes return the exact committed
record so a subsequent refresh failure cannot be confused with a failed commit.

The admission screen reads only the signed-in account's access entry before mounting
the ledger. If it does not exist, the app creates the validated entry for that same
UID and confirms it from the server before opening the workspace. A disabled entry
removes the ledger tree. A prior UID or Firestore instance's access cannot be reused
by the next session. A temporary listener interruption does not eject someone from
an already open workspace; the visible cloud-status control guides reconnection.

## Validation limits and honest claims

The rules enforce allowed top-level fields, scalar sale types and size/range
bounds, IDs, selected enums, revision transitions, access, and immutable history.
They validate ISO-shaped timestamp strings, not independent clock accuracy, and
date shape is not proof of a real calendar date. Nested monthly maps, historical
pay-plan entries, bonus-tier lists, and activity details receive container/size
checks; these are **not fully recursive server-side business validation**.

The adapter must validate nested values and semantic rules before every write and
after every read, including real dates, pay-plan coverage, finite whole-cents
amounts, and supported nested schemas. A compromised authorized client can still
write its own malformed nested data or fabricated activity within these limits.
Do not describe the client-authored activity log as a tamper-proof payroll audit,
or the service as end-to-end encrypted. Server/Admin SDK access bypasses these
rules and must be controlled separately through IAM.

Firestore sync is not an independent recovery backup. Keep approved private full
exports and test recovery separately. Never upload sensitive customer identity,
credit documents, credentials, or dealership internal reports for testing.

## Local emulator verification

Run the repository's Firestore rules test command through the Firebase emulator.
The current Firebase CLI requires Java 21 or newer. A portable verified Java
runtime (JRE or JDK) can be supplied in that command's `PATH`; no global Java
installation change is needed. For example, with an appropriate runtime selected:

```sh
pnpm exec firebase emulators:exec --only firestore --project demo-sales-ledger-rules \
  'node --test tests/firestore.rules.test.mjs'
```

The test script requires `FIRESTORE_EMULATOR_HOST`, rejects non-loopback hosts,
and uses the `demo-sales-ledger-rules` project ID. Every fixture is fictional.
Coverage includes self-service account creation, two separate accounts, disabled and
unauthenticated clients, cross-account denials, malformed fields, revision conflicts,
mandatory immutable history, physical-delete denial, append-only activity, and access
revocation.
The September 3 autosave implementation passed 22 emulator tests, including five
new tests for bounded incomplete drafts, owner-only access, tombstone revisions,
nested malformed data and separation from authoritative sales. The emulator was
stopped after the suite; no live project data was used.

Local emulator success does not verify deployed rules, Auth provider settings,
authorized domains, IAM, or account-switch behavior in the actual browser app.
Those are separate release gates.

Primary references: [Firebase security rules](https://firebase.google.com/docs/firestore/security/get-started),
[field-validation limits](https://firebase.google.com/docs/firestore/security/rules-fields),
[transaction behavior](https://firebase.google.com/docs/firestore/manage-data/transactions),
[offline cache behavior](https://firebase.google.com/docs/firestore/manage-data/enable-offline).
