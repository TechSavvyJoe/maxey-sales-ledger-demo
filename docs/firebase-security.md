# Firebase private-pilot security

This is a private, online-first pilot, separate from the public local-only demo.
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
- A signed-in user may read their own pilot-status document, including a disabled
  status. Clients cannot list, create, modify, or delete pilot-status documents.
- There is no manager access, public collection, or general authenticated-user
  permission. Unrecognized paths are denied.
- The domain value `profileId: "primary"` is not an authorization boundary. The
  authenticated UID and document path are the boundary.
- Firebase API configuration identifies the project; it is not an administrative
  credential. Never put a service-account private key or admin SDK in this app.

## Provisioning the first pilot owner

Only after the user authorizes provisioning and the intended Firebase project is
verified:

1. Enable the intended sign-in provider, let the owner sign in, and verify that
   exact account's UID in **Firebase Console → Authentication → Users**. Do not
   infer a UID from an email address or enter credentials into chat.
2. Using the verified project's administrator console, create the Firestore
   document **pilotUsers / the verified UID**, with one Boolean field:
   **enabled = true**. Do not create a public allowlist, wildcard entry, or email
   matching rule. An authorized server Admin SDK can create this same document;
   it must run outside the browser with appropriately restricted IAM.
3. Deploy the reviewed rules through the authorized release workflow before
   letting the app create its empty settings document. Verify own-account access
   succeeds and a different non-enabled account fails.
4. To revoke pilot data access, the administrator sets **enabled = false**.
   Separately handle Firebase Auth account/session revocation when needed.

Creating local files does not create an Auth user or allowlist entry. The separate
private project, database, providers and hosting have now been provisioned. The
first owner entry was created only after an exact Auth lookup confirmed the app
UID, verified email and Google provider. Follow the same verification before any
additional enrollment. Setup/CLI authentication is not evidence of an app Auth user.

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
disabled in both the cloud adapter and pilot interface. Only manual sale sources
and supported pilot activity actions are accepted by these rules.

Transactions compare the editor's original sale revision and timestamp, or the
original settings timestamp, with the latest server value. They must repeat that
comparison on every transaction retry, never silently accept a refreshed expected
version. `cloudRevision` is a snapshot/export consistency barrier, not a replacement
for that comparison. Client domain timestamps are not trusted server audit times.

The pilot uses memory-only Firestore caching, no durable offline write queue, and
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

The admission screen subscribes only to the signed-in account's pilot entry before
mounting the ledger. Waiting for approval is a normal sign-in state, not a claim
that saved data could not open. Approval opens the workspace automatically;
revocation removes the ledger tree. A prior UID or Firestore instance's approval
cannot be reused by the next session. This does not broaden enrollment permissions.

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
Coverage includes two enabled accounts, non-enabled and unauthenticated clients,
cross-account denials, malformed fields, revision conflicts, mandatory immutable
history, physical-delete denial, append-only activity, and pilot revocation.
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
