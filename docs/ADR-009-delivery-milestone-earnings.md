# ADR-009: Delivery milestone earnings

## Product contract

Milestones explain why a delivery matters to the salesperson's earnings. They do not create another commission formula, payroll entry, or stored financial record. The selected month's effective pay plan remains authoritative within this personal estimate tool; current defaults are maintained in the commission engine and pay-plan documentation.

One counted delivered sale has one position in its month. Order is delivery date, then original entry time, then stable record ID when timestamps tie. Split deals count as deliveries under the existing volume rule. Pending, deleted, future-dated, invalid, missing-stock, and duplicate-stock exclusions are unchanged. Backdating, deleting, restoring, importing, or resolving a duplicate can reassign milestones. This is a reconstruction from the current log, not a historical payroll audit.

### Canonical meanings across screens and exports

- **Sale commission:** this sale's front commission plus recorded F&I commission using its month's currently earned rate. Minis and personal spiffs use the existing per-sale rules. Monthly volume bonuses are separate.
- **Extra earnings unlocked:** the added volume bonus at this delivery, plus any retroactive front-commission increase on earlier counted deliveries when this delivery crosses the higher-rate threshold.
- **Milestone impact:** sale commission plus extra earnings unlocked. This is explanatory, not another payment. The rate increase is already included in earlier sale commissions and the bonus is already included once in monthly totals. Do not sum milestone impacts into earnings or payroll totals.

The triggering sale's own higher-rate commission belongs to Sale commission, not the earlier-sales rate increase. Later deliveries do not enlarge the retroactive amount attributed to the trigger. With a custom plan that awards a bonus before the rate threshold, that bonus sale still displays its current settled-month commission; milestone impact is not a historical time-of-entry payment delta. The canonical per-sale calculation determines uplift: a Mini may remain unchanged or become percentage pay; a fixed personal spiff never receives a percentage uplift. Signed front losses remain in gross reporting but cannot reduce these earnings.

### Motivation and uncertainty

The next milestone uses the same effective plan and shows whole deliveries needed, the added bonus rather than cumulative bonus, and the possible rate increase on currently recorded sales. No gross or commission is invented for future deliveries. A completed month shows achieved milestones rather than an instruction to sell in the past.

Missing earlier front gross qualifies the retroactive estimate. A known personal spiff makes that sale's front payout known even if gross is absent. Missing front/F&I on the triggering sale qualifies its total impact; it does not turn a known volume bonus into an unknown amount. Filling in gross later recalculates the same milestone without changing its delivery position.

### Interaction and presentation

Dashboard progress, sale-list indicators, the sale editor, report details, and exports use these same definitions. Customer name and vehicle remain the main record identity. Indicators are compact, neutral, and link to the existing editor; they must not compete with the main commission amount. Wide and narrow views retain the breakdown and qualification without sideways scrolling.

## Acceptance

- Check both sides of each rate and bonus threshold, including a shared threshold.
- Verify exact monthly total remains sum of sale commissions plus monthly bonus, with no milestone amount added a second time.
- Test Mini, split Mini, spiff, zero/negative/missing gross, exclusions, effective-dated plans, stable ordering, edits, and deletion.
- Follow next milestone → triggering delivery → editor breakdown → Reports → exported data in an isolated fictional profile.
- Check desktop, in-between laptop/tablet width, and phone, plus keyboard access and saved-record continuity.
