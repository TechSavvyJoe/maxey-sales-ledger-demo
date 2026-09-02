# ADR-006: Reports Center scope and outcome grammar

## Status

Accepted product contract.

## Context

Reports must make their time scope obvious and keep outcome metrics from implying dollar allocation that the ledger does not record. The same report also needs to remain understandable when it changes from a desktop table to phone-sized cards.

## Decision

### Scope comes first

- **Month** reports the selected calendar month.
- **Week** reports one selected Monday-through-Saturday window clipped to the selected month. A valid Sunday delivery remains in Month totals but not in weekly pace.
- **Year** reports the selected calendar year. **YTD** means January through the selected month, even when later months remain visible for full-year context.
- **Payroll** reconciles the selected month's estimate with the actual-paid amount entered for that same month.

The active scope must remain visible in the report heading, controls, empty states, and exports. Changing Month, Week, Year, or Payroll changes the scope of the same Reports Center; it does not create a second definition of a valid delivery, commission, or outcome.

### Outcomes and F&I gross

Service contract / warranty, Tire & Wheel, and GAP are product outcomes. **Dealer financed** is a separate financing outcome, not a product.

Every outcome has three report states:

- **Yes** — the outcome was recorded for the deal.
- **No** — the outcome was explicitly recorded as not occurring.
- **Not marked** — no answer was recorded; it must not be presented as No.

Each deal has one total eligible F&I gross value. The tracker does not collect, allocate, or infer a dollar amount for an individual product or financing outcome.

An outcome cohort may show the sum of that one deal-level total for deals matching the cohort. A matching deal contributes once within a cohort, but one deal can match multiple cohorts. Cohort gross is therefore overlapping and non-additive: it cannot be summed across outcome rows or described as gross earned by an individual product or financing choice.

### Responsive presentation

The wide table and narrow-screen cards are two presentations of the same report. They must preserve the selected scope, row order, labels, values, states, and available record-level action. A phone card must not silently omit information that changes the report's meaning.

### Trust boundary

Sales Ledger is local-first. Reports reflect records in the current browser profile and the selected period. They are personal estimates and reconciliation aids, not DMS, CRM, manager, or payroll-authoritative records. Exporting a report does not send it to payroll or prove that anyone received or approved it. Full recovery backups remain separate from shareable report exports.

## Consequences

- Outcome labels and counts remain honest when older or incomplete records exist.
- Gross can support matching-deal analysis without implying unsupported product attribution.
- YTD comparisons remain controlled by the user's selected month rather than silently following today's date.
- Desktop, phone, print, and exported reports can be checked against one shared semantic contract.

## Acceptance checks

- Each report identifies Month, Week, Year, or Payroll and its selected period before presenting metrics.
- Outcome reporting distinguishes Yes, No, and Not marked, and presents dealer financing separately from products.
- Only the deal-level total F&I gross is accepted as the source F&I dollar input; matching-cohort gross is labeled non-additive.
- Year YTD totals end at the selected month.
- Wide tables and narrow cards expose the same material records and meanings.
- Reports and exports retain the local-first, estimate-only, and private-backup boundaries.
