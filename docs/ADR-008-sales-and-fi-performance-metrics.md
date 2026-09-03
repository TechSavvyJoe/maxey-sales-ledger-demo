# Sales and F&I performance metrics

Accepted 2026-09-02. Supplements ADR-006; reporting and presentation changes only.

## Purpose and priorities

Sales Ledger helps a salesperson record delivered deals, understand commission, monitor goals and working-day pace, and review sales and F&I results. It records front gross, one commissionable total F&I gross, three product outcomes (Service contract, Tire & Wheel, GAP), dealer financing, and separate split credit. It does not record presentations, leads, funding, lender terms, product costs, finance reserve, cancellations, or product eligibility.

The reporting priorities are delivered sales, earned commission and goal progress; gross and commission per sale; product volume/penetration and products per sale; financing-group results; and comparisons with the salesperson's own history. Missing details belong beside the metric they affect.

## Metric decisions

| Metric | Definition | Presentation |
| --- | --- | --- |
| F&I gross per sale (PVR) | Recorded F&I gross / eligible delivered sales | Primary KPI; total gross and entered-deal count alongside it. |
| F&I commission per sale | Allocated F&I commission / eligible delivered sales | Replaces the positive-gross-deal statistic and appears with estimated F&I commission. |
| Tracked products per sale (PPD) | Recorded Yes answers across the three product fields / eligible delivered sales | States the three-category scope and incomplete-record count. |
| Deals with tracked products | Sales with at least one tracked product marked Yes / eligible delivered sales | Count, denominator, rate; incomplete outcomes remain separate. |
| Product penetration | Product's Yes count / eligible delivered sales | Each product row says percentage of all sales; no product-level dollar attribution. |
| Finance Penetration | Dealer-arranged financing Yes count / eligible delivered sales | User-requested metric name; cash and outside financing are outside the numerator. |
| GAP on dealer-financed sales | GAP Yes and dealer financing Yes / dealer financing Yes | Additional financing-group measure. It is not an eligibility-adjusted rate or all-financed-sales measure. |
| Front/combined gross per sale | Recorded relevant gross / eligible delivered sales | Supporting gross detail. |

Actual delivered records are the denominator, including a split deal once. Credited units remain a separate descriptive field. Do not reapply split percentages to gross or rewrite the configured retroactive rates or bonus rules.

The positive-F&I-gross count adds little decision value and has been removed from report UI and exports. It cannot establish product attachment. F&I share of combined gross was also removed from the main report detail; front-end losses can make that ratio exceed 100%, and it does not directly measure the salesperson's earnings. The Products report keeps Product, Sold / delivered, Penetration, and View deals. Redundant Yes/No and completion columns are removed; missing-answer notices appear only when needed.

## Payment methods and compatibility

The salesperson can select Dealership financing, Cash, or Outside financing on Add/Edit sale, or leave the method unmarked to enter later. `Sale.paymentMethod` is optional and authoritative when present. The legacy `dealerFinanced` boolean remains compatible and is normalized on write/import/restore. Existing real/imported No records cannot establish cash versus an outside loan and remain a separate "Cash / outside not specified" cohort until edited. Explicit methods, legacy-unresolved No, and wholly-unmarked methods form mutually exclusive report groups; totals reconcile to all delivered sales. Finance Penetration remains dealership financing / all delivered sales, including cash and outside financing in the denominator.

At the user's request, generated fictional demo records receive stable sample payment choices. New demo data includes all three methods; existing active generated-demo records missing a method are enriched once on published-demo initialization. Explicit choices, real/imported data, and deleted rows are not overwritten. Stable sample choices prevent report totals from shuffling on refresh.

## Missing data and comparisons

An entered $0 is complete data. Missing gross remains in the delivered-sale denominator, so partially entered averages are recorded-to-date figures. When no gross has been entered, averages display a dash. Unmarked product/financing outcomes remain unknown; a financing No cannot establish that no products sold.

The salesperson normally receives F&I gross from the F&I manager at the beginning of the following month. Blank gross is a normal awaiting state, not a confirmed $0 or a product/financing reporting failure. Earnings and projections use recorded gross with an awaiting notice; incomplete amounts do not justify a below-goal judgment or an unfavorable month-over-month earnings comparison. Enter later-supplied gross against the original delivery, retaining its delivery month.

Month and Week F&I comparisons pool deals from the prior three completed calendar months within saved pay-plan coverage. Year-to-date compares January through the selected month with the same months of the previous year. Pool numerators and denominators; never average monthly percentages or monthly PVRs equally. Display baseline dates and sample counts. Suppress change indicators when a relevant outcome or gross entry is incomplete. Percentage changes in penetration use percentage points.

The dashboard's full-prior-month total comparison uses a neutral label rather than a pace judgment. Week-end goal labels show the actual selected week end, including a month-ending partial week. Existing workday projections retain Sundays/days off and the configured nonlinear commission/bonus model.

## Research and benchmark boundaries

- [StoneEagle, first-half/Q2 2026 results, released August 31, 2026](https://www.se-fi.com/post/stoneeagle-first-half-highs-for-f-i-pvr-f-i-income-per-dealer): first-half provider-sample references are $1,989 F&I PVR, 1.55 PPD, 45% service contract and 10% Tire & Wheel penetration. Its product menu and dealer population are broader than this ledger. The public GAP denominator is not specified, so its GAP percentage is not presented as a comparable target.
- [JM&A, Q2 2026 report](https://www.jmagroup.com/resources/operations/automotive-trends-report): participating-dealership data is explicitly not nationally representative; F&I reporting includes product and finance-reserve income. This ledger's commissionable gross may cover a different scope.
- [MenuMetric calculation guidance](https://support.menumetric.com/other): GAP uses finance deals while other product goals use total units, supporting explicit denominators rather than an unlabeled universal penetration rate.
- [Automotive Training Network finance definition](https://www.automotivetrainingnetwork.com/glossary/finance-penetration/): finance penetration measures dealership-arranged financing against retail sales. Training target ranges are not measured national averages.

Research figures appear in an optional dated guide with source links. They do not create pass/fail grades, change personal goals, or imply that a customer should purchase an unsuitable product. No closing ratio, product profitability, reserve split, lost-revenue estimate, or eligibility score is inferred from unavailable inputs.

## Responsive report contract

Choose a table or cards using the report's available width. Every card needs a styled expanded body at every width where it can appear. Keep the same numbers, labels, missing states, and drill-down actions on desktop and phone. Expanded financing-group product detail is available to both. Month arrows use fixed 44-pixel targets and the full selector has a bounded width.

Gross details and Commission details remain visible together without independent collapse controls. They sit side by side when space allows and stack on phones. Report sales open the existing sale editor directly; saving returns to the same report context, and keyboard users can open a sale from its stock-number button. Sale commission means front plus F&I commission, excluding the separate monthly volume bonus.

## Verification targets

Weighted baselines across unequal-volume months and year boundaries; GAP financing/all-sales denominator distinction; split-credit independence; missing vs zero amounts; correct commission per sale; spreadsheet numeric percentage formats; live product/financing drill-down; screenshot-equivalent intermediate widths, narrow phones, keyboard month stepping, print layout, and deployed asset parity.
