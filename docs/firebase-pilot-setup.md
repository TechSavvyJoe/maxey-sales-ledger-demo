# Private cloud pilot — setup and release checklist

Status: private pilot deployed on September 3, 2026 at [Sales Ledger Private](https://maxey-sales-ledger-private.web.app), with self-service personal workspaces released on September 4. The current candidate passed the complete local, compiled, security-rules and cloud-emulator release gates on September 4. The original owner-account live create/edit/reload/delete/restore checks used the earlier explicit-approval build; current self-service and multi-account behavior has emulator coverage but still needs the live acceptance listed below. This is not a general production-readiness sign-off.

## Current deployment

- Firebase project: `maxey-sales-ledger-private`, owned by the app owner's Firebase account.
- Hosting: `maxey-sales-ledger-private.web.app`; authorized alias: `maxey-sales-ledger-private.firebaseapp.com`. No localhost or public-demo domain is authorized for live Auth.
- Firestore: `(default)`, Native / Standard, `nam5` US multi-region; free tier and database deletion protection enabled. Scheduled backups and point-in-time recovery are not enabled.
- Billing is disabled with no linked billing account. Auth reports subtype `IDENTITY_PLATFORM`; it was observed before the narrow email-provider change and preserved, not changed by that patch. Do not claim the project has never used Identity Platform.
- Google sign-in and email links are configured; anonymous sign-in is disabled. Email sign-in has `enabled=true` and `passwordRequired=false`. There is no password-login UI, but that does not mean password authentication is impossible through the underlying API.
- Current private release: the live owner dashboard rendered after a fresh reload with the cloud account connected and no document-level horizontal overflow. No current-build console errors appeared; three older Firestore transport warnings from a prior asset remained in the long-lived tab log. All 45 deployed files matched the tested local build hashes. The root and index return `Cache-Control: no-store`; all 31 versioned assets retain immutable caching. Firebase's auth handler and its JavaScript remain accessible with their own normal cache policy. No service worker is registered in the cloud build.
- The current release uses the tested Firestore rules with local SHA-256 `31a6a60661284cec9f7a5c9498829697333ddc30b79d4ffcebf281dbf14b033b`. Anonymous requests to pilot status, settings and sales are expected to remain denied with `403 PERMISSION_DENIED`; recheck that response after every rules deployment.
- A Firebase administration login is separate from an app account. Under the current self-service rules, a signed-in browser can create only its own immutable enabled profile and empty workspace; it cannot list or change access profiles or access another UID. No prior local sales are uploaded. The existing GitHub Pages demo remains separate.

### Live owner verification

The checks in this subsection were completed on September 3 against the earlier explicit-approval build. They verify the data path for that build, not current live multi-account self-service acceptance.

The owner signed in using Google and an administrator created the then-required access record. The private dashboard opened empty. A clearly fictional `TEST-CLOUD-SETUP` record verified:

- Negative front gross of -$100 remained in gross reporting while front commission used the $300 Mini; $1,200 F&I gross generated $240 commission, for a $540 sale total.
- The saved sale and $540 total survived a full page reload.
- A $500 manual front payout replaced the Mini, producing a $740 sale total without altering gross reporting.
- Delete, restore and final deletion were acknowledged online; restoration preserved the $740 total.
- Independent server reads confirmed sale revision 5, settings revision 5, four prior sale versions and five matching activity events.

After the current release was deployed, a second fictional `QA-AUTOSAVE-20260903` record verified the new editor behavior end to end: the sale was explicitly added at $2,300 front gross, an existing-sale edit to $2,400 reached the visible **Saved to cloud** state without a save button, the resulting $720 commission survived a full reload, and the record was then moved to Recently deleted. The dashboard was again left with zero active deliveries and $0 commission.

Both fictional records remain only in Recently deleted/history, not active sales or commission totals. This tested one live account; separate-account isolation, cross-device behavior and offline conflict cases have emulator evidence, not yet live multi-account acceptance. Email-link delivery also remains untested live.

## What the pilot does

- Google sign-in, with an email sign-in link alternative. No Drive connection, desktop installation, or account-specific developer configuration.
- Each signed-in account has its own settings, sales and activity. On first sign-in, the app creates only that account's private workspace. Firestore rules enforce the signed-in UID; the app owner retains administrative access.
- A successful save means Firestore acknowledged it. Updates also record the prior sale revision for owner-assisted recovery; deleted records can be restored through Recently deleted.
- Fresh accounts start empty.        Existing local/demo records are never uploaded just because someone signs in.
- Shared computers use session-only authentication by default. Remembering an account is an explicit choice. Data uses memory cache, not a persistent shared-device ledger cache.
- The local-only/GitHub Pages demo remains a separate build and continues working as before.

## Deliberate pilot limits

This first pilot is **online-first**, not offline synchronization. Existing open editors remain visible when a save fails. The user must reconnect and retry; closing the browser can lose unsaved entries. There is no hidden queued upload or silent last-write-wins behavior.

Import, demo loading, whole-ledger replacement and old folder/Drive backup connections are disabled in the cloud pilot. Bulk migration needs its own reviewed workflow and count/commission validation. Downloading a copy remains available.

Revision history is not disaster-recovery backup. Scheduled Firestore backups and point-in-time recovery require billing and have not been enabled. Enabling a billing account is a separate owner decision; a budget alert is not a hard spending cap. Before ordinary production use, decide retention, test recovery, and establish an owner support process. [Firestore quotas and paid backup features](https://firebase.google.com/docs/firestore/quotas), [scheduled backups](https://firebase.google.com/docs/firestore/backups)

Google sign-in is the primary free-pilot path. Firebase currently allows only **five email sign-in emails per day on Spark**, so email links are a low-volume fallback, not an unlimited team login service. Recheck this limit before enrollment expands. [Authentication limits](https://firebase.google.com/docs/auth/limits)

The current Identity Platform / Spark configuration permits 3,000 daily active users for Tier 1 providers, including Google and email. This is separate from the five-per-day sign-in email delivery limit. Do not enable billing or other providers merely to bypass a pilot limit. [Authentication usage limits](https://firebase.google.com/docs/auth/limits)

## Owner setup (one time, not per salesperson)

1. Sign into Firebase with the intended owner Google account. Create a separate Sales Ledger pilot project without attaching billing or enabling unrelated AI/analytics products. Keep the existing GitHub Pages demo unchanged.
2. Register a Web app. Create the default Firestore database in an agreed US location using **closed rules**, never expiring test/open rules. Deploy the repository's tested `firestore.rules` before allowing any user data.
3. Enable Google Authentication with the correct support email. Enable Email/Password's **email-link/passwordless** option separately; the app does not expose password login. Add the exact private hosting domains to authorized domains. For local development, add loopback only if intentionally testing live auth; emulator testing needs no live domain registration.
4. Put Firebase's public web configuration into the ignored `.env.cloud.local` file. Use `.env.example` as the template. Set `VITE_FIREBASE_ENABLED=true`, `VITE_PUBLIC_DEMO=false`, and keep `VITE_FIREBASE_EMULATORS` unset/false. Never place admin credentials or a service-account key in any `VITE_*` value.
5. Build with `pnpm build:cloud`. This produces `dist-cloud`; it does not replace the local/demo `dist`. Deployment must specify the verified pilot project explicitly: `firebase deploy --project VERIFIED_PILOT_PROJECT_ID --only firestore:rules,firestore:indexes,hosting`. Do not paste the placeholder as a real project ID.
6. Share the private site. A salesperson signs in normally with Google or an email link; the app creates only that account's immutable `pilotUsers/{uid}` access record and empty workspace. The user cannot read other accounts, list accounts, or alter access records. See `firebase-security.md`.
7. Test the actual hosted address in normal Chrome/Edge and Safari, not only an embedded app browser. Google may reject embedded user agents; an ordinary browser or the email fallback is the supported handoff, never user-agent spoofing.

Only the public web config identifies the app; it does not grant access to ledgers. Security comes from authentication and rules. The owner must separately configure quotas, support, privacy/retention terms and operational recovery before wider sharing.

**Firebase MCP deployment caveat:** its installed deployment tool accepts service names such as `firestore,hosting`, not CLI colon-subtargets. A call using `firestore:rules,firestore:indexes,hosting` silently deployed only Hosting during setup. Use `only: "firestore,hosting"` after verifying the active project and directory, then independently inspect the live rules release. A successful Hosting job alone is not rules-deployment evidence. The direct CLI command above supports colon-subtargets.

## Local verification

Install dependencies using the project's normal package manager. Firebase CLI 15.28.2 requires Java 21 or newer for emulators; a temporary JRE is sufficient. Do not replace a user's global Java setting solely for this test.

- `pnpm typecheck` and `pnpm lint`
- `pnpm test --maxWorkers=3` (bounds resource use on the laptop)
- `pnpm test:cloud:rules` — security suite against a synthetic `demo-` project
- `pnpm test:cloud:e2e` — Auth + Firestore emulators and a separate browser test server on port 4210

The emulator configuration binds only to loopback. The tests refuse non-loopback targets. Synthetic fixtures do not authorize uploading real ledger data. Do not run both emulator commands simultaneously on the same ports; the browser test uses those ports after the rules suite.

### Verification record

- On September 4, 594 unit/component tests passed, including account-switch, export, delayed-refresh, autosave, safe update recovery and client-lifecycle regressions. Type checking, lint and whitespace checks passed.
- On September 4, 22 Firestore rules tests passed against the local emulator, including cross-account denial, account-scoped editor drafts and immutable revision history.
- On September 4, nine cloud browser tests passed across Chromium desktop, Pixel-sized Chromium and WebKit: email-link sign-in, acknowledged saves, second-browser sales/settings visibility, download, stale-write rejection, offline draft retention/retry, sign-out and account isolation. These are emulator results, not proof of live Google sign-in or deployment.
- Six autosave-quality browser tests passed, covering draft recovery, automatic saving after changes, incomplete or invalid input, stale-conflict protection, retry behavior and close/reopen continuity.
- On September 4, the complete local browser matrix passed **176 of 176 applicable journeys** across desktop, phone and tablet projects; 79 project-inapplicable variants were intentionally skipped. The compiled production build separately passed all 10 release journeys, and the packaged launcher passed persistence, version, traversal and port-collision checks.
- The responsive browser matrix covers widths **320, 390, 720, 721, 768, 844, 1024, 1041, 1280, 1440, 1920, 2560, 3440, 3840 and 5120 CSS pixels**, including the 844 × 390 short-landscape case.
- The compiled public-demo build passed desktop and phone smoke checks with no Firebase requests, Firebase SDK chunks, external requests, page errors or horizontal overflow across the checked screens. Its 17 downloaded JavaScript files were inspected.
- The production dependency audit reported no known vulnerabilities at the time of the check.

The cloud client explicitly uses Firebase's long-polling transport. In a controlled WebKit comparison, the default transport stalled a post-save read after a successful commit; long polling passed the same assertions without increasing timeouts. WebKit browser tests use a loopback-only deny proxy and no browser request interception, because interception itself disturbed its streaming connections. Firebase documents long polling as a workaround for buffering proxies/antivirus, with a possible performance cost; recheck it when upgrading the SDK. [Firebase transport setting](https://firebase.google.com/docs/reference/js/v8/firebase.firestore.Settings#experimentalforcelongpolling)

The dedicated `cloud-validation` GitHub Actions workflow runs the Firestore rules suite, the three-browser source-mode cloud journeys, and a Chromium smoke test of the compiled private-cloud build on every pull request and push to `main`. It uses Node 22 and Java 21, installs only the required Chromium and WebKit engines, and uploads Playwright traces when either browser check fails. The manual `verify:release` command includes all three private-cloud checks too, so Java 21 or newer is required for a complete release check.

Cloud snapshots carry a server revision so overlapping reads cannot roll the displayed ledger backward. Exports and notifications are bound to the initiating account session; late work from a signed-out account cannot download data or operate on the next account.

## Required live acceptance evidence

- Correct project and owner; billing still off unless explicitly approved.
- Deployed assets and access rules match the tested build. Public demo remains local-only and makes no Firebase service requests.
- Real Google sign-in and email-link delivery work on the hosted origin; normal browser fallback is understandable.
- Account A creates a sale; a second browser signed into A reads the same saved sale and settings.
- Account B cannot read, edit, delete or export A's records. Signing out and then into B exposes no A data.
- Concurrent edits/deletion reject the stale version; saving offline fails visibly without closing the editor.
- Mini, split, spiff, retroactive percentage, cumulative bonuses and milestone totals are identical to local calculations.
- Deletion/restore, consistent download, and owner-assisted revision recovery are verified using fictional entries.
- Migration and scheduled recovery remain disabled until their separate acceptance criteria and authority are satisfied.

The Architecture and Software Engineering skills guided the separate pilot boundary, explicit ownership checks, original-version conflict handling and conservative release gates.
