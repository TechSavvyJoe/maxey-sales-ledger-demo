# Pay-plan settings and calculation rules

This page records the calculation settings used by Sales Ledger. Its figures are estimates for personal tracking and payroll reconciliation.

## Implemented rules supplied for this build

| Rule | Current behavior |
|---|---|
| Base front-end rate | 30% of the salesperson's credited front-end gross |
| Higher front-end rate | 35% when the month has more than 10 valid delivered vehicles |
| Retroactive treatment | Once above 10, 35% applies to every qualifying delivery in that month, including the first |
| F&I commission rate | 20% of the entered total eligible F&I gross |
| Status | Delivered may count and pay; Pending does not. Delete a deal that does not deliver. |
| Stock number | Required for a countable delivery |
| Duplicate delivered stock | Every active record in the global duplicate group is flagged and excluded until corrected |
| Unit credit | Reported separately; it does not multiply gross, commission, threshold count, or bonus count |
| Money precision | Integer cents and basis points; monthly aggregates reconcile to sale detail |

Front and F&I gross fields represent the salesperson's credited share. For a split deal, enter only the gross credited to that salesperson.

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
