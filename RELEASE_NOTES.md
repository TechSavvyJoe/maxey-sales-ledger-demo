# Maxey Sales Ledger 1.9.0

## Version 1.9 improvements

- Rebuilt Reports into a scope-first center for **Month**, **Week**, **Year through the selected month**, and **Payroll**, with compact in-page navigation and explicit current, closed, future, and comparison wording.
- Added full product performance reporting for **Service contract / warranty**, **Tire & Wheel**, and **GAP**, plus **Finance Penetration** and a clear **Finance**, **Cash**, or **Outside Finance** payment-method breakdown. Every product outcome keeps Yes, No, and Not marked distinct.
- Added penetration, tracking completion, product units per deal, any-product, two-or-more, all-three, confirmed-no-product, exact-mix, inclusive-bundle, financing-cohort, gross, commission, and data-quality analysis.
- Kept one authoritative total F&I gross amount per deal. Matching-product and bundle cohorts show the whole deal total, are explicitly overlapping and non-additive, and never claim unsupported product-level dollars.
- Added filtered deal evidence so product, payment-method, unmarked, and missing-total metrics can be checked against the customer, vehicle, date, and stock-number records behind them.
- Expanded Excel with Product Performance, Financing, Product Mix & Bundles, Weekly Performance, and Data Quality sheets while retaining the customer-name privacy choice and private-backup separation.
- Added previous-month sales/F&I comparison and a selected-year monthly F&I trend, while keeping YTD totals bounded by the selected reporting month.
- Clarified weekly management with this-week sales, target share, cumulative Saturday checkpoint, additional deliveries needed by Saturday, remaining monthly goal, and pace versus expected-to-date as separate measures.
- Replaced wide laptop Sales Detail tables with compact deal summaries and changed phone product/financing reports to disclosures and cards, removing page-level sideways scrolling.
- Reorganized Settings into one stable vertical flow so closed sections do not leave dead columns and open sections do not jump below unrelated content.
- Enlarged and contained the Add/Edit Sale workspace across laptop, tablet, and phone sizes while keeping product outcomes and one combined total F&I gross fast to enter.

## Version 1.8 improvements

- Added a focused **Week** report that divides the selected month into the store’s Monday–Saturday weeks, respects each salesperson’s saved days off, and lets the user inspect one week’s deliveries, credited units, gross, core commission, product results, and deal list.
- Turned the monthly delivery goal into workday-weighted weekly checkpoints. The Dashboard and current-week report state exactly how many additional valid deliveries are needed by week end to reach that checkpoint; past weeks remain final and future weeks are not forecast as sales.
- Added per-deal yes/no outcomes for **Service contract / warranty**, **Tire & Wheel**, and **GAP**, plus a separate **Finance** payment-method choice, without creating unsupported per-product dollar amounts. Total eligible F&I gross remains the only F&I dollar input.
- Added month and week F&I penetration counts/rates using valid delivered deals as the denominator. A half deal contributes one eligible delivered deal to penetration while credited units remain separate; pre-upgrade records with no product selections retain a visible not-marked state.
- Added month-specific delivery and commission goal overrides while preserving the profile defaults for months that do not have an override.
- Replaced conflicting review totals with one canonical attention model shared by Dashboard, Sales, and Reports. One affected sale counts once and can carry both calculation and overdue-pending reasons.
- Added a durable **Deleted** view in Sales so soft-deleted records can be found and restored after the short Undo message disappears.
- Added typed page destinations so Dashboard actions open the intended report tab, Sales filter, or Settings section instead of dropping the user at a generic page.
- Separated shareable report exports from private recovery backups. The customer-name option applies only to Print/PDF, CSV, and Excel; private backups live in Settings and always contain the complete recovery data.
- Added revision-aware editing that refuses to overwrite a newer saved version of the same sale and offers a path to load the latest record.
- Kept month and page selection scoped to each browser tab session so normal navigation in one open tab does not silently replace another tab’s context.
- Added a before-save pay-plan impact preview, effective-dated plan history, and more specific local activity details for pay-plan changes.
- Added a persistent demo-data notice whenever sample records are active so totals and exports cannot quietly look like real production results.
- Added responsive full-year report cards for narrow screens while retaining the denser comparison table where it fits.
- Made report time states explicit: closed months show final recorded results, the current month can show a planning projection, and future full-year rows remain neutral **Upcoming** instead of looking complete at $0.

## Version 1.7 improvements

- Rebuilt Dashboard, Reports, and Settings around a 1280×800 everyday laptop target, with compact widescreen layouts and purpose-built phone stacking that greatly reduces scrolling without shrinking operational text below 11px or controls below 44px.
- Combined unit and commission pacing into one monthly performance center; made secondary Dashboard insights and trends collapsible on phones; and kept recent sales directly editable.
- Made Reports content-first with one-row report tabs, a compact Export menu, collapsible calculation and sales detail, readable mobile sale cards, and automatic expansion of full detail for print/PDF.
- Organized Settings so the salesperson profile and work-schedule summary stay immediately visible while pay plan, bonuses, backup/import, privacy, and local activity open from concise status summaries; validation automatically opens and focuses the section needing attention.
- Added compact commission pacing with the current estimate, projected month-end range, projected deliveries, and an optional personal monthly commission goal.
- Kept projections honest by using scheduled workdays, current average recorded gross, the effective monthly pay plan, integer delivery scenarios, retroactive front rate, and cumulative bonus levels; projections are clearly labeled as planning estimates rather than guaranteed payroll.
- Added front and F&I gross per delivery, F&I entry coverage, previous-three-month average, selected-year totals, and the higher-rate opportunity without inferring unsupported product penetration or coworker rankings.
- Added commission pace, performance details, selected-year YTD through the selected month, and reconciled-payroll metrics to reports and Excel exports.
- Made the Work schedule calendar smaller and collapsed by default, with one clear summary showing the selected month, scheduled workdays, and personal days off.
- Made Sales easier to scan with filter-aware totals, a one-click clear action, visible review reasons, practical sorting, denser phone controls, and null gross values sorted last.
- Added direct edit actions from Dashboard attention/recent-sale rows and flags pending dates that have passed.
- Fixed page-change scroll/focus, sale-form focus return, report rate wording, static chart keyboard behavior, and several undersized action targets.
- Expanded calculation, migration, backup, Excel, keyboard, responsive, and automated WCAG A/AA coverage for the new workflow.

## Version 1.6 improvements

- Added a no-admin Google Drive recovery option that prepares and round-trip validates the exact JSON backup before download.
- Opens Google Drive in a separate tab with three plain upload steps; Google handles sign-in and Sales Ledger never receives a Google account, password, access token, or Drive permission.
- Expanded the existing automatic-folder option to support a private Google Drive for desktop folder when it is already visible in File Explorer or Finder.
- Kept both Google paths honest: the web handoff is manual, the folder path depends on Google's desktop sync client, and Sales Ledger cannot confirm either cloud upload.
- Added the exact unmodified dealership logo currently served by the official Bob Maxey Ford of Howell website and made it an accessible link to the Howell homepage.
- Kept the independent Sales Ledger product mark for reports, installed-app icons, and file identity.
- Added checked-file, safe-external-link, responsive-brand, and Google Drive handoff regression coverage.

Direct Google OAuth was intentionally not added. It would require a Google Cloud project, OAuth client ownership, authorized production origins, consent-screen maintenance, and repeated browser-token reconnection. The manual handoff provides the requested Google option without dealership IT or ongoing account administration.

## Version 1.5 improvements

- Added an optional automatic recovery-folder workflow that needs no Sales Ledger account, application installation, Microsoft Graph setup, tenant registration, or dealership IT involvement.
- Lets each salesperson choose a private Documents or existing OneDrive-synced folder from current desktop Edge or Chrome; the app creates a dedicated `Sales Ledger Backups` subfolder.
- Writes a current full backup and a dated recovery copy after committed sales, settings, import, demo, or restore changes while the app is open.
- Reopens every written file, validates its complete schema and SHA-256 data checksum, and records success only after verification.
- Stores folder permission and status separately from sales data, so restoring a workspace does not erase the selected backup destination.
- Detects missing, damaged, or externally changed folder backups and stops instead of silently overwriting another computer's copy.
- Added explicit reconnect, retry, review, change-folder, and turn-off controls with a compact accessible Settings layout and a permanent manual-download fallback.
- Added automated service, controller, cross-tab race, real-browser OPFS, reload, unsupported-browser, and accessibility coverage.
- Added a reproducible release-packaging command that verifies Local, Deploy, Source, and Visual Review archives and generates checksums.

Automatic folder backups are recovery copies, not live two-way synchronization. OneDrive's desktop client—not Sales Ledger—handles upload, and the tracker cannot confirm that a local write reached Microsoft 365.

## Version 1.4 improvements

- Added workday pacing based on valid delivered vehicles and the dealership's Monday–Saturday schedule; Sundays are always excluded.
- Added a compact monthly Work schedule in Settings where each salesperson can mark personal days off and see the resulting scheduled-workday total.
- Replaced calendar-day projection with scheduled workdays elapsed, scheduled workdays remaining, projected month-end deliveries, and the per-workday pace needed to reach the monthly goal.
- Added clear past, current, future, not-started, goal-reached, and no-workdays-left states without inventing a projection.
- Added pacing details to the monthly report and Excel summary while keeping exact day-off dates out of ordinary shareable reports.
- Added schema-2 backups that preserve work schedules while still restoring older schema-1 backups safely.
- Expanded Detroit-date, leap-month, migration, backup validation, keyboard, responsive, accessibility, and exact-package regression coverage.

## Version 1.3 improvements

- Replaced the superseded single-tier bonus figures with the cumulative schedule: $300 at 11, then add $800 at 15, $1,000 at 20, $1,500 at 25, $2,000 at 30, and $2,500 at 35.
- Shows milestone add-ons and running totals side by side, including the $8,100 total at 35 deliveries.
- Includes the earned cumulative bonus automatically in Estimated Commission.
- Added an idempotent migration that replaces seeded technical plan names while preserving every customized rate, threshold, month, and bonus value.
- Added cumulative-bonus details to the Dashboard, monthly report, full-year report, payroll reconciliation, and Excel exports, including a dedicated Bonus Schedule sheet.
- Removed engine, app-version, schema, checksum, and other implementation labels from everyday screens, reports, restore previews, and local-starter messages.
- Restored stock numbers to monthly report rows and added a column-alignment regression check.
- Expanded boundary, migration, browser, and release regression coverage for all six milestone levels.

## Version 1.2 improvements

- Introduced an original ledger-and-check product identity across desktop, mobile, loading, file recovery, reports, favicons, and installable-app icons.
- Added a complete logo package with primary, reversed, monochrome, lockup, transparent PNG exports, mask-safe app artwork, and a presentation sheet.
- Rebuilt Add Sale around a faster everyday path: customer, stock, gross, and F&I stay prominent while vehicle, credit, and notes remain one tap away.
- Added deliberate first-field focus, a sticky live sale estimate, and a faster **Add & enter next** loop for high-volume months.
- Preserved every existing sale field and all calculation behavior, including the more-than-10 retroactive rate rule and 20% eligible F&I rate.
- Fixed a restore workflow edge case so the preview stays open, the safety-backup confirmation is retained, and restored settings refresh without remounting the page.
- Tightened the local launcher's browser policy to authorize only the exact file-recovery script instead of allowing arbitrary inline scripts.
- Expanded launcher and browser regression coverage for the brand assets, fast-entry workflow, and backup-restore safety.
- Removed unused starter/demo artwork so the shipped product contains one coherent visual system.

## Version 1.1 improvements

- Added a stable, dependency-free local server and one-click macOS/Windows launchers.
- Locked local data to `http://127.0.0.1:4180/`; the launcher refuses random ports and never stops another process.
- Added a launcher health check with a complete-build fingerprint for safe reopen and collision handling.
- Replaced the blank direct-file failure with clear recovery instructions.
- Added a separate Local package while retaining the HTTPS Deploy package as the recommended coworker path.
- Added a discard confirmation that protects unsaved sale entries across Escape, Cancel, close, and outside-click paths.
- Added persistent Settings error summaries, inline field guidance, and focus on the first invalid entry.
- Increased operational text size, improved control/toast contrast, and corrected empty-state heading structure.
- Configured schema validation for strict-CSP browsers without weakening the browser security policy.

## Release scope

Sales Ledger now has two deliberately separate releases. The private Firebase edition gives each signed-in salesperson an isolated personal cloud workspace with acknowledged background saving and cross-device access. The local/demo edition remains a local-first personal tracker whose data stays in that browser profile unless the user exports or configures a recovery copy.

## Highlights

- One compact, responsive month/year switcher shared by Dashboard, Sales, and Reports.
- Guided sales entry for customer last name, stock number, vehicle, status, an optional split deal, front gross, eligible F&I gross, tracked F&I products, payment method, and notes.
- Tested monthly front/F&I calculation engine using integer cents and effective-dated pay-plan versions.
- More-than-10 delivery rule applies the configured 35% front rate retroactively to the first valid delivery; exactly 10 remains at 30%.
- Cumulative bonus tiers are included in Estimated Commission as milestones are reached.
- Weekly, monthly, full-year, previous-month, goal/pace, trend, and payroll-reconciliation views.
- CSV, Excel, print/PDF, and complete checksum-verified JSON backup/restore.
- Legacy tracker import with preview, row rejection, deterministic IDs, and app-side commission recalculation.
- Private account-based cloud saving through Firebase, plus a separate installable offline-capable local/demo PWA. Neither build uses analytics, telemetry, or a third-party CDN.
- Desktop, tablet, and mobile layouts with keyboard support, visible focus, reduced motion, accessible chart data, and automated WCAG A/AA checks.

## Data and payroll boundaries

- This is an estimate and reconciliation tool, not the DMS, CRM, or official payroll record.
- Customer last names and stock numbers are supported. Do not enter SSNs, license images/numbers, credit or bank data, insurance, credentials, lender stipulations, deal jackets, paystubs, or customer contact/address data.
- Complete JSON backups are unencrypted confidential files containing last names, notes, gross/payroll values, soft-deleted rows, settings, and activity.
- Delete and Remove Demo are soft-delete actions. There is no permanent purge scheduler.
- Eligible F&I definitions, splits, chargebacks, reversals, and rounding remain payroll-reconciliation items.

## Deployment

The public/local build is produced in `dist/` and can be deployed to an approved static HTTPS host with equivalent CSP, frame, MIME, referrer, permissions, and cache rules. Its browser storage belongs to the exact hostname/port and browser profile, so moving origins or devices requires JSON backup and restore.

The private account-based build is produced separately in `dist-cloud/` and deployed only to the reviewed Firebase project with the tested Firestore rules. Signing in never uploads an existing local/demo ledger. Scheduled backups and point-in-time recovery are not enabled; see the private-pilot checklist before a broader coworker rollout.

## Automated release gate

Run:

```bash
pnpm install --frozen-lockfile
pnpm verify:release
```

Hosted acceptance still includes VoiceOver/NVDA, 200% zoom, high contrast, real backup/restore, and comparison against payroll.
