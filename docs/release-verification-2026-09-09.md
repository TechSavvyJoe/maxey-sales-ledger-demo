# Complete downloads and history access — release verification

## Changes in this release

- Settings offers an independent, complete 18-sheet Excel workbook and an open JSON data file. Each uses a fresh saved snapshot of the initiating account, not the visible month or search results. Cancellation, sign-out and account changes invalidate the pending download.
- Excel includes the saved sales, customer last names, vehicles, stock numbers, notes, product outcomes, payment methods, commissions, Mini/manual payouts, milestones, reporting, pay plans, goals, work schedule, retained deleted sales and activity. A compact Report sheet has a month selector and native formulas. Full spreadsheet limits are documented in `portable-workbook-validation-2026-09-09.md`.
- **Sales → All months** finds older records and retained deleted sales without changing the selected Dashboard/Reports month. Financial results still use each sale's original month and pay plan.
- Settings descriptions wrap; report status labels retain their width; loading offers useful delayed/offline guidance without replacing an already-open editor.
- Settings saves can recover an acknowledgement that was lost after the server committed. Recovery requires the exact attempted settings, revision and unique audit event, verified together in a completed read-only transaction. An unchanged server, newer revision, mismatch, denied read, failed verification or changed account remains a visible failure. No security rules were loosened.

## Executed September 9, 2026

| Check | Result |
| --- | --- |
| Full unit/component suite | 685 passed across 53 files |
| Type checking and application lint | Passed |
| Production dependency advisory audit | No known vulnerabilities reported |
| Service-worker cache identity | 4 passed |
| Compiled local/public production journeys | 10 passed |
| Focused current-source responsive/keyboard/accessibility journeys | 20 passed |
| Compiled Firebase journeys, including complete downloads and lost acknowledgement | 5 passed |
| Source Firebase journeys: Chrome, phone, native WebKit | 12 passed |
| Firestore security-rule tests | 22 passed |
| Local launcher/package/persistence checks | All 9 checks passed |
| Independent spreadsheet recalculation | 72,163 formula cells compared, zero mismatches |

The deterministic interrupted-save browser check also passed twice consecutively before the complete compiled-cloud run. It distinguishes a real server commit with a failed response from a truly rejected save, then verifies reload and explicit Retry. The initial failure artifacts were retained rather than reclassified as a pass.

Responsive evidence includes narrow 320/390px phones, the problematic 520–641px intermediate widths, tablets, short landscape, laptops and large 2560px windows. Representative final screenshots of the Bonuses panel, F&I evidence, all-history sales, and complete-download card were visually inspected. Report printing was independently rendered and checked for intact headings, page breaks and readable text.

Older tests assumed four Settings data sections, an obsolete demo-removal label, or a sale visible on the first paginated screen. Test-only updates now account for the new export section, use the current controls, and search for the saved sale after restart. The launcher check was strengthened to reopen the sale and verify its exact saved name, stock and gross values.

### Legacy folder-backup browser regression

The first interface CI run (`34361134179`) passed 191 checks and failed only the same local folder-backup scenario on the three screen-size projects. Chrome had updated from 152.0.7977.82 to 153.0.8010.36. A minimal empty-page probe, containing no Sales Ledger code, reproduced a Chrome SIGTRAP when a native origin-private directory handle was retrieved from IndexedDB in an ephemeral/incognito context. The identical probe passed in bundled Chromium 151 and, importantly, in the same installed Chrome 153 using a fresh persistent profile.

The original complete application scenario then passed nine times using isolated persistent Chrome 153 profiles (desktop, phone and tablet, three repetitions each). It still checks actual backup-file contents after a sale and reconnection after reload. This diagnoses a browser/test-storage boundary; it does not establish a Google-confirmed browser issue or justify weakening application persistence. Firebase saving and the new complete downloads do not use this legacy folder handle. No application code or assertions were removed, no browser version was pinned, and the failed traces remain available in `/tmp/sales-ledger-local-backup-ci-repro-20260909-r2` and the native-probe artifacts.

The scenario now lives in `e2e/automatic-folder-backup.spec.ts` with an owned, fresh persistent profile for each case and inherited browser/device settings. It additionally verifies the exact saved synthetic name, stock, gross values and checksum shape. The final dedicated test passed nine further repetitions, with evidence in `/tmp/sales-ledger-backup-persistent-final-20260909-r2`; type checking, scoped lint and whitespace validation also passed. All other interface tests retain their original isolated contexts.

## Reproduction and evidence

- `pnpm test --maxWorkers=3`, `pnpm typecheck`, `pnpm lint`, `pnpm audit --prod`, `pnpm test:service-worker-cache`
- `VITE_PUBLIC_DEMO=true pnpm build`, then `pnpm exec playwright test --config playwright.production.config.ts`
- `node scripts/test-launcher.mjs`
- `pnpm test:cloud:compiled`, `pnpm test:cloud:e2e`, `pnpm test:cloud:rules`, sequentially with Java 21 and loopback emulators
- `e2e/bonus-panel-responsive.spec.ts`, `report-midwidth-text.spec.ts`, `sales-history.spec.ts`, `sales-responsive-geometry.spec.ts`, `sale-form-responsive.spec.ts`, `selector-interactions.spec.ts`, `settings-density.spec.ts`
- Workbook reproduction instructions and independent recalculation artifacts are described in `portable-workbook-validation-2026-09-09.md`.

Temporary browser evidence is retained in `test-results/production-release-final`, `test-results/ui-release-20260909/final`, `/tmp/sales-ledger-cloud-final-20260909`, and `/tmp/sales-ledger-cloud-journeys-final-20260909`. Synthetic workbooks and private environment files are not release source files.

## Release boundary

Application release `668278e075de883f03b3a6217ba6aab9b40bf37c` was published to both the private Firebase app and the public GitHub Pages demo. Independent downloaded-file comparisons matched all 53 private files and all 45 public files to their respective tested builds. GitHub Pages run `34361134172` and cloud-validation run `34361134514` both completed successfully.

The exact private sign-in route was checked in Chrome and WebKit at 390px and 1280px. On the exact public demo route, a fresh 18-sheet Excel download was opened independently and all-history access was checked at 320px, 641px and 1440px with no horizontal page overflow or page errors. The public demo made no Firebase requests. Artifacts are retained in `test-results/live-portability-20260909`.

These publication checks do not substitute for an authenticated coworker's real-device acceptance. No existing live sales, account access records, billing or database rules were modified by these tests or this hosting-only deployment.

The workbook remains usable independently after download but is not the entire web application: it cannot sign in, sync, recover unfinished drafts, or recreate prior sale versions. It is not a scheduled server backup. Real coworker/phone/managed-Windows acceptance, official payroll reconciliation, owner-supported retention and scheduled-backup/restore arrangements remain the operational gates described in `production-readiness.md`.

Product Grammar, Accessibility Review and the spreadsheet skill informed the hierarchy, wording, responsive acceptance and independent formula validation. Firebase's documented [transaction consistency](https://firebase.google.com/docs/firestore/manage-data/transactions) and [isolation behavior](https://firebase.google.com/docs/firestore/transaction-data-contention) informed the narrow save-receipt verification.
