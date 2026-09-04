# ADR-005: Weekly goal checkpoints and F&I outcome tracking

## Status

Accepted.

## Context

Salespeople need to manage a monthly delivery target before the month is over, not only review a month-end projection. They also need a fast digital equivalent of the product checkmarks used on a paper sold log. The tracker must add those tools without inventing store policy, product-level gross, future sales, or a second definition of an eligible delivery.

## Decision

### Weekly periods and checkpoints

- A store week runs Monday through Saturday. Sunday is closed and is never a scheduled workday.
- Weeks are clipped to the selected calendar month. A week at a month boundary contains only dates from that month.
- The salesperson’s saved days off are removed from that month’s scheduled workdays.
- Each week-end checkpoint is the monthly delivery goal multiplied by the cumulative share of scheduled workdays through that week, rounded up to a whole delivery and capped at the monthly goal.
- The current-week needed count is the difference between that cumulative checkpoint and valid deliveries recorded to date, never less than zero.
- Past weeks display final recorded results. Future weeks display assigned goal shares and checkpoints but do not forecast unrecorded sales.
- A valid Sunday-dated delivery remains in monthly totals but is identified and excluded from Monday–Saturday weekly pace.

This makes the weekly target responsive to short first/last weeks and personal days off while preserving one monthly goal.

### F&I tracking model

Each sale can record three product outcomes and one separate financing outcome:

- Service contract / warranty
- Tire & Wheel
- GAP
- Finance — financing arranged through the dealership; a payment method, not a product

The app continues to store one total eligible F&I gross amount for the deal. It does not collect, infer, divide, or estimate a dollar amount for an individual product or financing outcome.

Penetration uses valid delivered deals as the denominator, matching the same eligibility rules used for monthly delivered count. One half deal therefore contributes:

- one eligible delivered deal to each penetration denominator; and
- 0.5 credited units to the separate credited-unit metric.

Older records can omit the outcome values. Omitted values remain distinguishable as **Not marked** rather than being presented as a confirmed No. The rate denominator remains all valid delivered deals, and the interface also discloses the not-marked count so the salesperson can judge coverage.

### One shared operational vocabulary

- **Delivered** means a valid delivered deal count.
- **Credited units** remains the sum of deal credit and is not reused as a penetration denominator.
- **Sale commission** means sale-level front plus F&I commission and excludes the monthly volume bonus.
- **Estimated commission** means the monthly sale commissions plus the included cumulative volume bonus.
- Dashboard, Sales, and Reports use the same canonical record-based attention selector.

## Consequences

- Weekly checkpoints are planning math, not a manager assignment, payroll promise, or guarantee of future sales.
- Product and financing outcome rates can be compared week to week and month to month without inventing outcome-specific dollars.
- Legacy records with incomplete outcome coverage require an explicit not-marked state in UI, backup/restore, import, and export paths.
- Report exports may omit customer last names, but private recovery backups remain complete and must stay outside the shareable Export menu.
- Automated tests must cover month boundaries, Sundays, days off, past/current/future periods, current-week needed counts, valid-delivery filtering, half deals, and unrecorded outcomes.

## Acceptance boundary

Automated results and exact browser evidence belong in the release handoff. Hosted production acceptance still requires testing the deployed HTTPS origin, supported work computers/phones, real backup and restore, accessibility checks, and reconciliation against an approved payroll source.
