# Pay-plan settings and calculation rules

This page records the calculation settings used by Sales Ledger. Its figures are estimates for personal tracking and payroll reconciliation.

## Implemented rules supplied for this build

| Rule | Current behavior |
|---|---|
| Base front-end rate | 30% of the salesperson's credited front-end gross |
| Higher front-end rate | 35% when the month has more than 10 valid delivered vehicles |
| Retroactive treatment | Once above 10, 35% applies to every qualifying delivery in that month, including the first |
| F&I commission rate | 20% of the entered total eligible F&I gross |
| Mini | $300 per full deal by default, configurable in Settings. Automatic front pay is the greater of nonnegative percentage commission and the Mini share. |
| Negative front gross | Remains negative in actual gross totals and averages; never offsets commissionable front gross or another sale's commission. |
| Spiff / manual front commission | Exact front payout to this salesperson, replacing automatic pay. Not added to calculated pay and not split again. F&I and monthly bonuses remain separate. |
| Status | Delivered may count and pay; Pending does not. Delete a deal that does not deliver. |
| Stock number | Required for a countable delivery |
| Duplicate delivered stock | Every active record in the global duplicate group is flagged and excluded until corrected |
| Unit credit | Prorates the Mini ($150 for a half deal at the $300 default). Does not multiply already-credited gross, percentage pay, manual pay, threshold count, or bonus count. |
| Money precision | Integer cents and basis points. Front pay is rounded per sale, then summed; monthly aggregates reconcile to sale detail. |

Front and F&I gross fields represent the salesperson's credited share. For a split deal, enter only the gross credited to that salesperson.

A -$316.61 front-gross full deal pays a $300 Mini. A $2,000 front-gross full deal pays $600 at 30%; the loss on the first deal does not reduce that $600. A $500 manual payout stays $500 when the Mini or month-wide rate changes. An entered $0 manual payout is explicit, not empty. Clearing the manual option restores automatic calculation.

Blank front gross stays unknown, rather than being treated as a zero-gross Mini. A known manual payout can be saved while front gross remains blank: commission is known, but gross reporting still shows missing coverage. Negative or zero front gross is a normal Mini scenario, not a correction warning.

Retroactive increases compare each sale's pay at the base and higher rates after applying its Mini or fixed manual amount. An unchanged Mini and a manual payout receive no fictional rate increase. Projections use the same rule for existing sales; future sales use the observed automatic-pay mix, not repeated one-off manual payouts.

## Cumulative bonus schedule

| Valid delivered milestone | Added at that milestone | Running monthly total |
|---:|---:|---:|
| 11 | $300 demo bonus | $300 |
| 15 | $800 | $1,100 |
| 20 | $1,000 | $2,100 |
| 25 | $1,500 | $3,600 |
| 30 | $2,000 | $5,600 |
| 35 | $2,500 | $8,100 |

Each reached milestone adds to the prior awards. The tracker stores and calculates the running total, while Settings and exports show both the add-on and the total. The earned running total is included in Estimated Commission.

The schedule begins with the configured January 2026 pay-plan version. The $300 amount at 11 is labeled as the demo bonus.

Pay-plan versions are effective-dated. Correcting an existing effective-month version can recalculate that month and later months until another version begins, so compare affected results with payroll.

The app never applies a future plan to an earlier sale. Entry, import, restore, and month navigation are blocked before the earliest configured plan month. Add a historical plan version effective in or before the older sale month first. In a year with only partial pay-plan coverage, full-year views show only covered months rather than fabricating estimates for uncovered months.

## Payroll comparison

Compare at least one 10-delivery month and one more-than-10-delivery month against the payroll record. Keep paystubs and other sensitive payroll documents out of the tracker.
