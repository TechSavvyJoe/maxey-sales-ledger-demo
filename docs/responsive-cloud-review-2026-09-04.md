# Firebase workspace review — September 4, 2026

## Scope

The primary product is the private Firebase edition at `https://maxey-sales-ledger-private.web.app/`. Google sign-in, account-scoped storage, server-acknowledged autosave, and cross-device access belong to this edition. The public GitHub Pages demo is a separate local-storage demonstration. Screenshots of its Google Drive or recovery-folder controls are not evidence of the Firebase interface.

## Changes in this release candidate

- Settings now has one stable five-destination category strip. Categories do not become a side rail or a masonry-style grid when the window changes size. Expanding a section cannot leave an empty neighboring card.
- Navigation labels adapt to available content width without truncation. Touch targets remain at least 44 pixels, with arrow-key navigation and visible focus.
- Days off uses a bounded, centered calendar workspace; profile inputs avoid excessively long lines on ultrawide displays.
- Report tables switch to equivalent cards based on the space inside the report, not a broad device label. Record order, customer/vehicle identity, totals, and edit actions are preserved.
- Sales filters wrap intentionally on phones and intermediate widths. Customer and vehicle identity is an accessible action separate from the card's financial details.
- Short landscape Dashboard disclosures start closed; manual choices persist within the current density mode. Compact navigation rails use the official dealership link in the header instead of squeezing a full footer into a narrow rail.
- The sale editor keeps one compact commission summary in short landscape windows and uses an opaque sticky header. Toast close controls are 44 pixels; toast surfaces do not block unrelated actions.
- Typography uses the supplied font weights consistently. Cloud loading and sharing copy now describe the account-based edition.

## Historical requirements checked against the current code

- 30% front commission through 10 deliveries, with 35% retroactive to the first delivery above 10; 20% eligible F&I commission.
- Cumulative bonus additions of $300, $800, $1,000, $1,500, $2,000, and $2,500 at 11, 15, 20, 25, 30, and 35 deliveries.
- Configurable $300 Mini; half-credit Mini is $150. A manual/spiff payout is the amount paid to the salesperson and is not split again. Negative front gross remains in gross reporting without reducing commission on another sale.
- Per-sale commission and additional milestone impact are separate from monthly totals, preventing double counting.
- Customer/vehicle-first identity, stock number, MM/DD/YYYY sale dates, compact split-deal control, and visible vehicle/notes fields.
- Finance, Cash, and Outside Finance; service contract, Tire & Wheel, and GAP outcomes; one optional total F&I gross entered when available, not separate product gross fields.
- Month, week, and year reporting, workday-based unit and earnings pacing, days off, whole-vehicle action counts, and export workflows.

## Verification boundaries

Automated unit, browser, access-rule, and compiled-artifact results are recorded in the release handoff. Responsive evidence covers phones, short landscape, tablets, laptop/intermediate panels, desktop, and ultrawide Settings. The compiled Firebase checks specifically assert cloud saving, the absence of Drive setup, acknowledged edits, reload persistence, and no service worker.

Test-harness corrections preserve the user-facing assertions: Year tests accept whichever equivalent table/card representation is visible; a full-screen phone editor closes through its visible control rather than a nonexistent backdrop; valid Settings changes are verified after autosave instead of racing its disabled manual button.

The shared desktop, phone, and tablet browser workflows now run on independent GitHub runners on every main update and pull request. Cloud access rules and Chrome/phone/WebKit saving journeys remain a separate Firebase validation workflow. Failed runs retain traces; tests do not automatically retry until they happen to pass.

## Before broad coworker rollout

This is a polished personal-workspace pilot, not a guarantee of defect-free operation or an official payroll system. These operational acceptance items remain distinct from interface quality:

1. Complete hosted sign-in and isolation testing with a second real account, plus a real phone and the managed Windows browser used at work.
2. Reconcile actual payroll for exactly-10 and above-10 months, including Mini, spiff, F&I adjustments, and rounding.
3. Choose and enable an appropriate disaster-recovery backup/retention plan, with a tested restore procedure. Cloud autosave is not a scheduled backup or point-in-time recovery service.
4. Confirm the intended self-service enrollment policy and identify an owner for support, recovery, and security updates. This release does not enable billing or widen account access.

For release rollback, use the preceding known-good Firebase Hosting release. Do not restore a prior database snapshot merely to roll back presentation changes; that could overwrite newer sales.
