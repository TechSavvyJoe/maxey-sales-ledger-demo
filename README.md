# Maxey Sales Ledger

Maxey Sales Ledger is a personal sales and commission tracker for individual Bob Maxey Ford of Howell salespeople. Its private Firebase edition gives each signed-in salesperson an isolated cloud workspace with background saving and cross-device access. A separate local/demo edition remains available for offline use and demonstrations. Both replace the fragile month-tab workbook workflow with one clear month switcher, fast sales entry, deterministic calculations, and weekly, monthly, and yearly reporting.

## What is included

- Dashboard with delivered units, estimated commission, effective front rate, unit and commission pacing, the current week’s goal checkpoint, F&I penetration, previous-month context, selected-year trend, recent sales, and shared attention alerts.
- Compact, collapsible month-specific Work schedule for personal days off; Sundays are always excluded from pace calculations.
- Fast guided Add Sale form with large required fields first, optional details kept one tap away, a live commission preview, three product outcomes, and separate Finance, Cash, and Outside Finance choices.
- Searchable and filterable sales ledger with recorded deal outcomes, visible attention reasons, practical sorting, revision-safe editing, soft delete, immediate undo, and a persistent Recently Deleted restore view.
- Monthly, Monday–Saturday weekly, selected-year, and payroll-reconciliation reports, including the deliveries needed by the current week’s end to stay at the month’s workday-weighted checkpoint.
- Product and Finance Penetration counts and rates based on valid delivered deals, alongside total F&I gross, F&I commission, and gross per delivery.
- Shareable CSV, Excel, and print/PDF reports kept visibly separate from full-fidelity private JSON recovery backups.
- Validated import of the prior Excel tracker and checksum-verified JSON restore.
- Local audit history, duplicate-stock review, automatic verified recovery-folder copies, a no-admin Google Drive handoff, manual backup reminders, storage diagnostics, and optional demo data.
- Month-specific delivery and commission goals, effective-dated pay-plan history, a before-save pay-plan impact preview, and detailed pay-plan change activity.
- Per-browser-tab month/page context, direct destinations from Dashboard actions, a persistent demo-data marker, and responsive full-year cards on narrow screens.
- Installable PWA behavior and offline operation after the first successful hosted load.
- Responsive desktop and phone layouts, keyboard operation, visible focus, reduced-motion support, and accessible chart alternatives.
- Private Google sign-in with an email-link fallback, account-scoped cloud data, background editor drafts, acknowledged autosave, conflict protection, and safe account switching.

## Pay-plan logic

The calculation engine currently implements the rules supplied for the Howell used-car pay plan:

- Exactly 10 valid delivered vehicles: 30% of credited front-end gross.
- More than 10 valid delivered vehicles: 35% of credited front-end gross, retroactive to the first qualifying delivery that month.
- Commission on total eligible F&I gross: 20%.
- Pending, invalid, missing-stock, and duplicate delivered records do not count toward the threshold or commission. A deal that does not deliver should be deleted from the log.
- Unit credit is reported as a metric; gross should already be the salesperson's credited share and is not multiplied again.

Service contract / warranty, Tire & Wheel, and GAP are product outcomes. **Finance** means financing arranged through the dealership and is measured as **Finance Penetration**; Cash and Outside Finance are tracked separately. Financing is a payment method, not a product. Reports distinguish **Yes**, **No**, and **Not marked**, so an unanswered outcome is never presented as a confirmed No. Sales Ledger stores one total eligible F&I gross amount for the deal and never invents a dollar amount for an individual outcome. Outcome rates use valid delivered deals as their denominator. A half deal is one eligible delivered deal for an outcome rate while its credited-unit value remains 0.5.

Reports are scope-first: **Month** uses the selected month, **Week** uses one Monday-through-Saturday window clipped to that month, **Year** uses the selected calendar year with YTD ending at the selected month, and **Payroll** reconciles that selected month's estimate. An outcome cohort can sum the one total deal-level F&I gross for its matching deals, but cohorts may overlap, so those gross figures are non-additive and are not product attribution. Wide tables and narrow-screen cards preserve the same report meaning and material data.

The volume schedule is cumulative: $300 at 11, then add $800 at 15, $1,000 at 20, $1,500 at 25, $2,000 at 30, and $2,500 at 35. The tracker shows both each add-on and its running monthly total and includes the earned total in Estimated Commission. See [Pay-plan calculation rules](docs/pay-plan-assumptions.md).

## Run locally

Requirements: Node.js 22 or newer. The local launcher always uses `http://127.0.0.1:4180/` so the browser does not create a different data workspace on each launch.

On macOS, double-click **Start Maxey Sales Ledger.command**. On Windows, double-click **Start Maxey Sales Ledger.cmd**. Keep the launcher window open while using the app.

Do not double-click `index.html` or `dist/index.html`. If that happens, the page now explains how to recover instead of appearing blank.

For development, install pnpm 10 or newer and run:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. Use **Explore full-year demo** on a new workspace, or **Settings → Load full-year demo**, for a safe demonstration dataset.

## Verify and build

```bash
pnpm check
pnpm test:e2e
pnpm test:launcher
pnpm test:production
pnpm audit --prod
pnpm verify:release
pnpm preview
```

`pnpm check` runs linting, strict TypeScript checks, unit/integration tests, and the production build. `pnpm test:production` creates a current build before testing production offline reload/navigation. `pnpm verify:release` runs the complete automated release gate. The deployable static application is written to `dist/`.

## Deployment boundary

There are two deliberately separate builds:

- `dist-cloud/` is the authenticated Firebase edition. Each salesperson signs in and receives an isolated personal workspace that follows that account between supported browsers and devices. Valid changes save in the background after the server acknowledges them. It does not import an existing on-device ledger automatically.
- `dist/` is the local/demo edition. Its data belongs to that exact browser profile and origin, works offline after the first hosted load, and relies on user-controlled JSON or recovery-folder backups.

Deploy only the intended build to its matching host. The local build needs the included cache/security headers or equivalent host configuration; `public/_headers` is applied automatically only by hosts that support that convention.

### Public GitHub Pages demo

The repository's GitHub Pages workflow builds and publishes a **demo-only** static site. A new visitor automatically sees believable fictional sales from January two calendar years ago through today, spanning three named calendar years and marked with `DEMO-` stock numbers. It opens on the latest completed month so the first screen tells a complete story; the current month remains one step forward for pacing. No import, sign-in, or setup is required. Each visitor can try changes in their own browser. Reloading preserves those changes and respects an explicit removal of sample data; **Settings → Load sample history** restores it when wanted, while **Reset sample data** returns an active sample to its original records without replacing visitor-entered sales. The historic sample uses a clearly named illustrative plan only inside that demo workspace; it does not backdate the editable Howell pay plan. No visitor-entered sales, backups, browser storage, or account credentials are committed to the repository or sent to GitHub Pages by the app.

GitHub Pages is a helpful way to show the product, but it is not a database, sign-in system, shared ledger, or backup service. Its origin is different from the local launcher, so its browser storage is separate. Do not enter real customer or live-deal information on a public demo site; use a separate, authenticated system with a server-authoritative database for that future workflow.

The app keeps each installed version's page, styles, and code together. After the first visit, reopening a cached workspace does not wait for a fresh page download. Updates download in the background; choose **Update now** when offered to apply the new version. Updating does not clear sales or settings. Do not clear browser site data just to refresh the app.

In current desktop Edge or Chrome, each salesperson can optionally choose a private Documents folder or an existing locally synced OneDrive or Google Drive folder in **Settings → Automatic backup folder**. Sales Ledger writes checksum-verified recovery copies there after committed changes while the app is open. This requires no Sales Ledger account, tenant registration, Graph permission, installation, or managed backend. The folder must already be available on the computer, and browser policy may still block website folder access.

**Settings → Google Drive backup** is the no-install fallback when Google Drive for desktop is unavailable. Sales Ledger checks the complete recovery file, starts its download, and opens Google Drive. The salesperson signs in on Google's website and uploads the displayed filename. Sales Ledger does not connect to or browse the Google account.

Browser storage is scoped to the exact hosted origin and browser profile. Moving to another hostname, port, device, or browser profile creates a different workspace; migrate with a confirmed JSON backup and restore.

The on-device edition is intentionally not described as live cloud-synced or centrally backed up. When a OneDrive- or Google Drive-synced folder is selected, Sales Ledger can confirm only the local verified file write; the selected sync client controls any later upload. The Google Drive web handoff also requires the salesperson to confirm the uploaded file appears in Drive.

The private Firebase edition does provide authenticated, account-scoped synchronization, but it is not manager-visible, dealership-administered, or payroll-authoritative. Scheduled Firestore backups and point-in-time recovery are not enabled on the current no-billing pilot. Before wider rollout, the owner must decide recovery retention, support ownership, and whether self-service Google/email enrollment should remain open or become invite/domain restricted.

Delete and **Remove demo data** are recoverable soft-delete actions. Those rows remain in the local database, appear in Recently Deleted, and remain in complete JSON backups; there is no permanent purge control. A full backup always contains customer last names, gross/payroll values, saved days off, deleted rows, settings, and activity, regardless of the report option to omit last names.

## Documentation

- [User guide](docs/user-guide.md)
- [Architecture decision](docs/ADR-001-local-first-architecture.md)
- [Local-launch architecture](docs/ADR-002-stable-local-launch.md)
- [Automatic recovery-folder architecture](docs/ADR-003-automatic-recovery-folder.md)
- [Google Drive handoff architecture](docs/ADR-004-google-drive-handoff.md)
- [Weekly and F&I tracking architecture](docs/ADR-005-weekly-fi-product-tracking.md)
- [Reports Center product grammar](docs/ADR-006-reports-center-product-grammar.md)
- [Pay-plan calculation rules](docs/pay-plan-assumptions.md)
- [Privacy and backups](docs/privacy-and-backups.md)
- [Accessibility audit](docs/accessibility-audit.md)
- [Production-readiness checklist](docs/production-readiness.md)
- [Private cloud setup and release checklist](docs/firebase-pilot-setup.md)
- [Brand and logo system](docs/brand/README.md)

## Safe data boundary

Customer last name and stock number are supported tracker fields. Do not enter Social Security numbers, driver-license images or numbers, credit applications or reports, bank or card details, insurance documents, passwords, MFA codes, lender stipulations, deal-jacket documents, or other sensitive customer/dealership records.
