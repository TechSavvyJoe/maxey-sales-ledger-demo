# Production-readiness record

## Honest release scope

Sales Ledger is a production-grade local-first personal sales tracker for one salesperson on a trusted browser profile. The same hosted application can be shared with coworkers, but each person has an isolated browser database and controls their own private recovery folder and manual backups.

It is not a centrally managed multi-user system, official dealership DMS/CRM, payroll system, authoritative audit ledger, or cross-device synchronization service. Optional OneDrive/Google Drive folder use is a verified local recovery-file write, not proof of cloud upload. The Google Drive website handoff checks the downloaded file but cannot confirm the user uploaded it.

## Engineering verification completed

- Strict TypeScript production build.
- Lint with warnings treated as failures for application code.
- Unit and integration coverage for commission boundaries, F&I gross, tracked product penetration, Monday–Saturday week boundaries/checkpoints, half-deal denominator behavior, cumulative bonuses, duplicate stocks, workday pacing, month-specific goals, Detroit date boundaries, rounding, year totals, Excel mapping, IndexedDB initialization, revision-aware writes, soft delete/restore, and backup compatibility.
- Desktop, phone, and tablet browser flows for fast sale entry, tracked F&I outcomes, weekly drilldown, commission calculation, truthful closed/current/future report states, cumulative bonus editing and impact preview, canonical attention destinations, recently deleted restore, shareable exports, month picker/navigation, per-tab period context, payroll-month isolation, private backup separation, backup-restore safety, responsive Year cards, and automated WCAG A/AA scans of fresh and populated views.
- Coherent vector/raster product-mark family across the app, print reports, recovery page, favicon, touch icon, and PWA manifest.
- PWA manifest, generated versioned service worker, hashed application assets, and static-host cache/security header template with an exact inline-script hash.
- Stable loopback launcher checks for exact-origin persistence, complete-build identity, port-collision safety, extracted-package layout, and path/symlink containment.
- Versioned, schema-validated, size-limited, checksum-verified JSON backup and restore.
- Optional user-selected automatic recovery folder with separate device-only handle storage, user-gesture permissions, serialized cross-tab writes, daily recovery history, read-after-write validation, and external-change conflict blocking.
- No-admin Google Drive handoff with exact-file round-trip validation, safe external linking, and no Google account/token access.
- Unmodified official Bob Maxey Ford of Howell logo linked to the official Howell homepage while the independent Sales Ledger mark remains the product/file identity.
- Excel import preview with row-level rejection, deterministic IDs, source filename/hash, no macro execution, recognized entry-column values, and app-side commission recalculation.
- CSV formula-injection protection and optional customer-last-name omission.
- Local audit history with pay-plan change details, cross-tab refresh notification, and stale-revision protection that prevents one editor from silently replacing a newer sale.
- Persistent demo-data labeling across the workspace while sample records are included in totals and exports.

Exact executed results for the release package are recorded in the final handoff rather than hard-coded here so this document cannot become stale.

## Payroll reconciliation checks

- Reconcile a real exactly-10-delivery month and a real more-than-10-delivery month against an official payroll record.
- Review eligible F&I gross, corrections, chargebacks, and payroll rounding when comparing results.
- Compare tracked service-contract/warranty, Tire & Wheel, and GAP product outcomes—and the separate dealer-financing outcome—with the source sold log. Confirm Yes, No, and Not marked remain distinct. Only one total eligible F&I gross value is stored for each deal.

The app should remain labeled an estimate until these are complete.

## Hosted deployment acceptance required

- Deploy the contents of `dist/` on an approved HTTPS static host.
- Confirm the host applies equivalent CSP, frame, MIME, referrer, permissions, and cache headers from `public/_headers`.
- Open the exact production URL in supported desktop and phone browsers.
- Exercise add/edit/void/delete/undo/Recently Deleted restore, month switch, weekly checkpoint/drilldown, outcome tracking, Month/Week/Year/Payroll reports, Excel/CSV/PDF, and JSON backup.
- Confirm Month uses the selected month, Week uses the selected Monday-through-Saturday window, Year YTD ends at the selected month, and Payroll remains isolated to the selected month.
- With deals that have multiple recorded outcomes, confirm each cohort includes a matching deal's one total F&I gross once, cohort gross is labeled non-additive, and dealer financing is not presented as a product.
- Compare the same populated report at wide and narrow widths; the table and cards must preserve the selected scope, row order, labels, values, states, and record-level action.
- Install the app, reload it once online, disconnect the network, then reopen it. The automated production check covers offline reload, adding a sale, primary-page navigation, and CSV export; complete a hosted manual edit plus Excel/PDF/JSON export check on supported deployment devices.
- Restore a real backup into a separate test profile and reconcile record/totals counts.
- Import a copy of the current real tracker and review every rejected/duplicate row without exposing sensitive customer data.
- Complete the manual accessibility script in `accessibility-audit.md`.
- Ask at least one salesperson unfamiliar with the app to add a sale with product and financing outcomes, change months, explain the current-week needed count, narrow to a week, find YTD through the selected month, restore a deleted sale, and create and confirm a backup file without coaching.
- On a real managed Windows workstation, test Edge folder selection, cancellation, permission denial/reconnect, browser and Windows restart, OneDrive online/offline/paused states, and visible upload confirmation in OneDrive itself.
- With a permitted Google account, upload the checked Google Drive backup, download it again, validate it, and restore it in a separate test profile. If Google Drive for desktop is already installed, separately test its online/offline/paused behavior and confirm cloud arrival.

## Operational controls

- Assign an owner for static hosting, dependency/security updates, release rollback, and user support.
- Keep immutable release archives and a known-good prior deployment.
- Communicate that clearing browser/site data deletes local records unless restored from JSON.
- Recommend weekly and post-import backups to an approved access-controlled location.
- Never claim that a report was received by payroll or that the estimate is an official pay statement.

## Known limitations

- No centralized recovery, user authentication, authorization, manager dashboard, or remote observability.
- Automatic recovery folders require current desktop Edge or Chrome and a secure hosted/localhost origin. Browser policy may block access, permissions may need reconnection, and Sales Ledger cannot detect OneDrive or Google Drive upload completion.
- The Google Drive website handoff is manual. Sales Ledger cannot choose the remote folder, browse Drive, confirm upload, or restore directly from Google Drive.
- Local activity history is useful for user review but is not tamper-evident.
- Browser storage persistence is requested, not guaranteed.
- A compromised/unlocked device, browser profile, extension, or deployment origin can expose local data.
- PDF export uses the browser's print/save-PDF facility.
- Pay-plan exceptions outside the configured fields require manual payroll reconciliation.
- Weekly goal checkpoints are mathematical workday-weighted allocations of the monthly goal, not management assignments or guaranteed sales forecasts.
- Penetration uses valid delivered deals as the denominator. A half deal is one denominator deal while credited units remain separate; pre-upgrade records without saved outcome selections may remain not marked until reviewed.
- Product and financing outcomes may be Yes, No, or Not marked. Sales Ledger stores one total deal-level F&I gross only and cannot attribute dollars, commission, chargebacks, or cancellations to an individual outcome. Matching-outcome cohort gross can overlap and is not additive across rows.
- Delete and demo removal are soft deletes; there is no permanent purge/retention scheduler.
- Complete JSON backups always include last names, gross/payroll values, deleted rows, settings, and activity.
