# Portable Excel workbook validation — September 9, 2026

## Scope

This validation covers the independent all-history Excel export built by `src/lib/portableWorkbook.ts`, its regression tests, and the compact, month-selectable Report built by `src/lib/portableReportSheet.ts`.

The workbook contains the current saved records supplied to the export, not a reconstructed account history. It includes active sales with customer last names, vehicles, stock numbers, notes, gross, product outcomes and payment choices; retained deleted records separately; saved profile settings, pay-plan history, bonus schedules, goals, days off, payroll entries and activity. No live account data was used for these fixtures.

The 18 sheets cover the starting guide, compact monthly report, raw sales, commissions, monthly/yearly/weekly results, product volume and penetration, payment-type performance, inclusive product combinations, milestone attribution, work schedule, pay plans, bonus tiers, retained deleted records, activity, saved settings and metric definitions.

## Formula verification

The generator writes formulas with cached results. Commission, inclusion, Mini, manual payout, milestones and pacing use the existing application domain calculations for their exported results. These cached values were then compared against values independently recalculated by LibreOffice, rather than relying only on the generated cache or successful file creation.

The final v2 fixtures produced these results:

| Synthetic fixture | Formula cells compared | Mismatches |
| --- | ---: | ---: |
| Three-year realistic history | 31,372 | 0 |
| Mixed edge cases | 13,597 | 0 |
| Closing Sunday and negative-cent F&I correction | 13,597 | 0 |
| Closing Sunday with no scheduled workdays that week | 13,597 | 0 |
| Total | 72,163 | 0 |

Numeric comparisons used a tolerance of `1e-7`, substantially below one cent. Empty formula results were compared as empty, not coerced to zero. The comparison manifests enumerate every formula cell, including reporting formulas and explanatory milestone values.

The Report month selector was also changed to `2025-07` and recalculated. All nine checked core report metrics matched that month's source data, establishing that the report updates when its month changes rather than only displaying an exported screenshot or fixed values.

The starting guide and the two-page Report were rendered and visually inspected. The Report's second page starts at the F&I and payment section, repeats the selected-month heading, and keeps explanatory text within the page. The starting-guide navigation uses a light background so spreadsheet hyperlink styling remains legible. These final cosmetic/print changes did not change financial formulas.

The spreadsheet skill's macro-based recalculation helper timed out in this environment. A separate standard headless LibreOffice XLSX conversion succeeded and was used for the actual recalculation checks above. A helper timeout is not recorded as a passing test.

The successful invocation used the bundled LibreOffice runtime below, with all four v2 XLSX inputs supplied to the same conversion command:

```sh
/Users/joegallant/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override/soffice --headless --convert-to xlsx --outdir /tmp/sales-ledger-portable-review-final /tmp/sales-ledger-portable-review-v2/Sales-Ledger-Three-Year-Synthetic.xlsx /tmp/sales-ledger-portable-review-v2/Sales-Ledger-Edge-Cases.xlsx /tmp/sales-ledger-portable-review-v2/Sales-Ledger-Sunday-Correction-Edges.xlsx /tmp/sales-ledger-portable-review-v2/Sales-Ledger-No-Workdays-Edge.xlsx
```

The temporary comparison utility `/tmp/sales-ledger-portable-review/verify_recalculated.py` compared each converted file against its matching JSON manifest. PDF review used the same runtime's standard `--convert-to pdf` conversion. Temporary utilities and outputs are local verification artifacts, not application runtime dependencies.

## Automated regression coverage

The focused workbook and Report test run passed **11 tests**. TypeScript compilation and the scoped lint checks passed. Cases include:

- All active and retained-deleted records preserved; input snapshot left unchanged.
- Full and half-deal Mini protection, signed front-gross reporting, personal manual/spiff payouts including an explicit zero, and retroactive front-rate/bonus attribution.
- Sale-level F&I allocation that reconciles to the rounded monthly F&I commission.
- Blank gross versus entered zero, missing payroll versus entered zero, and negative-half-cent average rounding.
- Cross-year duplicate stocks, pending sales, invalid dates and future deliveries retained but excluded from applicable financial totals.
- Clear rejection when saved sales, payroll, goals or days off need a historical pay plan that is not present; no silently dropped financial months.
- Closing-Sunday week ownership, the different Sunday rules for weekly counts and monthly goal credit, and unavailable pace when there were no elapsed workdays.
- Finance/Cash/Outside Finance cohorts with service-contract, Tire & Wheel and GAP volumes and cohort-based penetrations.
- Literal formula-like customer text, internal-only hyperlinks, frozen headers, filtering, print settings, Excel serialization, an empty workspace and the binary download wrapper.

Reproduce the focused run and create synthetic workbook/manifest artifacts outside the repository:

```sh
PORTABLE_WORKBOOK_SAMPLE_DIR=/tmp/sales-ledger-portable-review-v2 pnpm exec vitest run src/lib/portableWorkbook.test.ts src/lib/portableReportSheet.test.ts
pnpm exec tsc -b --pretty false
pnpm exec oxlint src/lib/portableWorkbook.ts src/lib/portableWorkbook.test.ts --deny-warnings
```

Generated files are:

- `Sales-Ledger-Three-Year-Synthetic.xlsx` and `formula-cache-manifest.json`
- `Sales-Ledger-Edge-Cases.xlsx` and `edge-formula-cache-manifest.json`
- `Sales-Ledger-Sunday-Correction-Edges.xlsx` and `sunday-formula-cache-manifest.json`
- `Sales-Ledger-No-Workdays-Edge.xlsx` and `no-workdays-formula-cache-manifest.json`

These generated data fixtures should not be committed. Keep originals and recalculated files in different directories so comparisons do not accidentally replace their reference inputs.

## Functional boundaries

The file opens independently without Sales Ledger, sign-in or a network connection. Its Report month chooser and formulas work in the spreadsheet. Existing financial inputs and supported report inputs can recalculate inside the exported model.

It is **not** a complete offline copy of the web application. In particular:

- It does not save or sync changes back to the account, run Firebase, perform sign-in, or provide server recovery.
- Inclusion/exclusion, delivery order, month-to-plan assignments and milestone membership are export-time snapshots. Inserting sales or changing dates, statuses, identities, plan structure or the reporting range requires extending and checking the spreadsheet model.
- Milestone incomplete-information indicators describe the export-time state. Their financial amounts are linked formulas; milestone impact must not be added to monthly earnings a second time.
- Historical sale versions and unfinished editor drafts are not included. The separately offered JSON data file is the structured migration copy of the saved snapshot.
- F&I amounts not yet received remain blank. Projections use recorded amounts, so incomplete F&I can understate an outlook.
- Product-cohort gross is whole-deal F&I gross, not product-specific revenue. Product and inclusive-combination cohorts overlap and their gross figures must not be added together.

Passing these checks is evidence for the tested export and cases, not a guarantee that the entire application, every spreadsheet viewer, every possible future edit or all production workflows are bug-free. Browser download behavior, visual acceptance and any deployment remain separate verification steps.
