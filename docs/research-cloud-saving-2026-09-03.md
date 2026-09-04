# Sales Ledger: simpler cloud saving

**Status:** Research recommendation, not implemented or approved for purchase
**Research date:** September 3, 2026
**Decision owner:** Joe

## Recommendation

Use **Firebase Authentication + Cloud Firestore** for private salesperson accounts and automatic cross-device saving. Keep the current Sales Ledger interface and commission calculations. Use a managed hosting service for the private application; the GitHub Pages demo can remain a separate demonstration.

This is an engineering recommendation based on the existing application, official provider documentation, and the user's priorities—not a claim that every alternative was benchmarked or that the integration is already working. Firebase offers the strongest combination here of self-service accounts, documented browser offline synchronization, and documented scheduled database recovery. It removes the need to operate a server, but not the need for an application owner.

**Runner-up:** Dexie Cloud is the closest fit to the existing local database and deserves consideration if minimizing code changes becomes the overriding priority. Its account licensing and unverified hosted backup retention require resolution before calling it a complete recovery solution.

## What the salesperson should experience

1. Open the Sales Ledger link in a supported browser.
2. Choose **Continue with Google**, or **Email me a sign-in link**. The latter does not require a Google account or another password.
3. A private ledger is created automatically. Returning users get their existing ledger.
4. Enter and save sales normally. A small status distinguishes **Saving**, **Saved to cloud**, **Saved on this device—waiting for connection**, and an actionable failure.
5. On a different computer or phone, sign in with the same account to retrieve cloud-saved records, goals, work schedule, pay plan, and payroll comparisons.

Firebase documents both [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin) and [passwordless email-link sign-in](https://firebase.google.com/docs/auth/web/email-link-auth). Its [persistent browser authentication](https://firebase.google.com/docs/auth/web/auth-state-persistence) can survive closing the browser, subject to logout, browser settings, and security events. This is not a promise that users will never need to sign in again.

Google sign-in identifies the person; **the ledger would be stored in the application's private Firebase database, not in their Google Drive**. No Drive-file permission is needed for this design.

Do not promise Google login inside every embedded browser. Google [restricts OAuth in controlled embedded user agents](https://developers.google.com/identity/protocols/oauth2/policies#use_secure_browsers). Test the actual supported browsers and provide a normal-browser handoff. Email-link instructions must make clear that the link should be opened on the device/browser the person intends to use.

## Current application facts

Inspection confirms that Sales Ledger is a static React/TypeScript application using Dexie and IndexedDB. Its three local tables hold sales, settings, and activity. Data refresh currently follows local changes and messages between browser tabs. There is no account system or remote synchronization service.

The existing recovery folder writes local backup files; Google Drive handoff downloads a verified file for manual upload. Neither is an account-based cloud database. They were reasonable ways to avoid an app-owned backend, but they leave recovery work with the salesperson.

Migration is substantive, not a login-button change: the application currently uses a shared local profile identifier, a singleton settings record, numeric activity IDs, and browser-only conflict checks. Account-specific ownership, remote change notifications, and cross-device conflict protection must be added. All existing calculations and report formats should remain independent of the storage provider.

## Options and trade-offs

### 1. Firebase — recommended production direction

- Native Google login and an email-link alternative support self-service account creation without provisioning an infrastructure account for every salesperson.
- Firestore documents persistent offline caching and synchronization when connectivity returns. Its default same-document conflict behavior is last-write-wins, so this app still needs explicit protection against stale edits. Persistent browser caches are not automatically cleared between sessions. [Offline behavior](https://firebase.google.com/docs/firestore/manage-data/enable-offline)
- Server-enforced rules can restrict each user to their own records. Login alone does not create that protection; rules must be implemented and tested. [Security rules](https://firebase.google.com/docs/firestore/security/rules-conditions)
- Scheduled daily and weekly backups are documented, with retention up to 14 weeks. A provider backup restore creates a new database; it is an administrator recovery operation, not a built-in salesperson undo button. [Backups and restore](https://firebase.google.com/docs/firestore/backups)
- Pricing is usage-based. Current database allowances include 1 GiB stored data, 50,000 reads/day, and 20,000 writes/day. Backup storage and restore operations require billing and have no free allowance. [Pricing](https://firebase.google.com/pricing), [billable recovery features](https://firebase.google.com/docs/firestore/quotas)

For an initial group of roughly 10–25 salespeople recording a few dozen sales monthly, ordinary database usage should be modest if queries and synchronization are efficient. That is a workload estimate, not a dollar quote or cost guarantee. Enable billing for backups, measure a pilot, and keep notifications enabled. Budget alerts do not cap Firestore spending. [Billing controls](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills)

### 2. Dexie Cloud — closest fit to current code

- Adds cloud synchronization to the database library already in the app. Built-in email-code login does not need a custom authentication server; social login is also supported after provider configuration. [Authentication](https://dexie.org/docs/cloud/authentication)
- Published pricing lists three free production users and paid capacity starting at **€3/month per 25 seats**. Some older seat references on the same page conflict, so confirm the applicable terms before purchasing. [Pricing](https://dexie.org/pricing)
- Unknown users normally receive 30 active evaluation days. Someone must promote them to production; documented unattended promotion uses an owner-provided webhook endpoint. Paying for seats is not the same as assigning them. [New-user webhook](https://dexie.org/docs/cloud/web-hooks#web-hook-for-new-user)
- Export/import is documented. I did **not** verify a hosted automatic-backup schedule, historical restore-point retention, or equivalent recovery commitment. The one-month grace period for deleting a whole database is not a deleted-sale recovery guarantee. [CLI and recovery tools](https://dexie.org/docs/cloud/cli)

This is a credible low-cost pilot option, but not an evidence-backed promise of unattended recovery. Its globally unique IDs, private singletons, migration rules, and operation-level conflict behavior also require deliberate integration. [Best practices](https://dexie.org/docs/cloud/best-practices), [consistency](https://dexie.org/docs/cloud/consistency)

### 3. Supabase — flexible conventional database, more integration

Pro starts at **$25/month** and includes daily database backups with seven-day retention. Free projects can pause after a week of inactivity and do not include automatic backups. [Pricing](https://supabase.com/pricing)

Supabase supports Google and email-code login, but production email needs a configured email service: its default sender is limited to project-team addresses and currently two messages/hour. [Email setup](https://supabase.com/docs/guides/auth/auth-smtp)

Postgres and row-level security are attractive if the product later needs substantial centralized reporting or integrations. However, the current Dexie app would need a custom offline synchronization layer or another synchronization product. Supabase lists [PowerSync](https://supabase.com/partners/integrations/powersync) as one such integration. That extra layer is not justified solely to simplify this personal ledger's saving experience.

### 4. Personal Google Drive, OneDrive, or Dropbox — feasible, not preferred

These can keep files in each person's own storage account, but an app owner still configures provider access and implements reliable file synchronization. Repeated authorization, work-account restrictions, and conflicting full-file updates undermine the desired simplicity.

- Google's browser token model requires user-driven renewal after expiry; durable refresh-token handling uses its backend code flow. The narrow `drive.file` and `drive.appdata` scopes are **non-sensitive**, not restricted. [Token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [code model](https://developers.google.com/identity/oauth2/web/guides/use-code-model), [scope classification](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- Microsoft supports browser authorization, but SPA refresh tokens last 24 hours before authorization must restart; this is not necessarily a daily password prompt. Work-account administrators can restrict consent. [Token lifetime](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens), [consent controls](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview)
- Dropbox supports browser PKCE and recommends short-lived tokens for browser-only applications. It still requires a registered app and custom file coordination. [OAuth guide](https://developers.dropbox.com/oauth-guide)

These are optional export destinations, not the recommended primary saving system. A blocked workplace policy is not something this design should bypass.

### 5. Puter.js — investigate only if no developer-owned backend is essential

Puter documents frontend-only authentication and per-user app storage without developer API keys or database provisioning. Usage belongs to each user's account. [Security model](https://docs.puter.com/security/), [user-pays model](https://docs.puter.com/user-pays-model/)

It would introduce a Puter account for each salesperson and still require synchronization and recovery engineering. I did not verify comparable retained-backup/PITR guarantees. It is worth a synthetic-data pilot if Joe rejects ownership of any backend account, but it is not the present production recommendation.

Convex was also reviewed: it offers managed realtime data, but explicitly lacks full offline synchronization, and its first-party Auth remains beta. It does not improve this particular migration enough to displace the shortlist. [Sync limitations](https://www.convex.dev/sync), [authentication](https://docs.convex.dev/auth/convex-auth)

## What Joe would and would not manage

**No routine server work:** no always-on home computer, installed desktop sync client, manually uploaded coworker backups, or separate cloud-project setup for each salesperson.

**An owner remains necessary:** one service account/project, billing, reachable recovery contact, access configuration, service notices, tested application updates, and occasional recovery/support. Google explicitly requires current owner/contact information for OAuth projects. [Owner responsibilities](https://developers.google.com/identity/protocols/oauth2/policies#maintain_a_list_of_relevant_contacts_for_the_project)

Private between coworkers does not mean invisible to authorized infrastructure administrators. Do not market this as end-to-end encrypted or inaccessible to Joe/provider administrators. Limit privileged access and keep it out of the public app. Customer last names do not need to be excluded from the proposed ledger, but personal commission records should not be public or put into the public demo repository.

## Proposed implementation and acceptance gates

1. **Separate demo and private accounts.** Keep synthetic demo records separate. Never automatically upload demonstration data or attach an existing browser ledger to an arbitrary newly signed-in account.
2. **Integrate account-owned persistence.** Store sales and business settings under the authenticated owner, using server-enforced authorization. Keep device navigation and file handles local. Avoid two independent authoritative caches or overlapping sync engines.
3. **Migrate explicitly and safely.** Offer a one-time review/import for existing local records. Preserve the original local data and verify counts, IDs, settings, gross, commissions, Mini/spiff amounts, and milestones before declaring migration complete. Repeated imports must not duplicate sales.
4. **Make saving honest.** Show cloud success only after server acknowledgment. Retain unsent changes on the originating device; explain that closing/clearing that device before synchronization can still lose unsent work. Handle expired login, denied writes, and conflicting edits without silent loss.
5. **Design account switching.** Do not expose the previous user's cached ledger after logout or account changes. Offer appropriate session behavior on shared computers and avoid losing queued changes during sign-out.
6. **Separate sync from recovery.** Configure managed historical backups. Preserve per-sale recovery/history for ordinary user mistakes; do not roll back everyone's database to restore one salesperson's record. Keep manual JSON and report exports available as optional portability tools, not required chores.
7. **Simplify Settings.** Lead with Account and cloud-save status. Move optional download/import/recovery tools behind a compact advanced area. Remove storage-provider setup from the normal onboarding path.
8. **Run a two-person, two-device pilot with synthetic records.** Verify fresh signup, return login, account isolation including direct API attempts, cross-device updates, offline edits and restart, simultaneous edits, cloud failures, lost-browser recovery, individual deleted-sale recovery, and a full provider-backup restore. Confirm pricing and usable login on the actual work browser before broad rollout.

No provider account was created, no data was uploaded, no paid service was enabled, and no application code was changed during this research. The next decision is approval of the account owner and backend direction; deployment and billing require separate authorization.
