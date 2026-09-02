# ADR-001: Local-first sales commission PWA

**Status:** Accepted for version 1.0\\
**Decision date:** 2026-08-30

## Context

The prior Excel tracker could calculate the pay plan, but workbook locking, repair warnings, month/year navigation, dense entry rows, and file sharing made it difficult for salespeople who are not comfortable with Excel. The first production release needs to work well for one salesperson, remain useful without a network connection, and avoid introducing an unreviewed cloud store for customer-linked commission data.

## Decision

Build a static React and strict-TypeScript progressive web app with these boundaries:

- IndexedDB is the authoritative store for each browser profile.
- Commission and reporting calculations are pure domain functions using integer cents and basis points.
- Dexie provides schema-versioned local persistence and transactions.
- Versioned JSON is the only full-fidelity backup and restore format.
- Excel, CSV, and print/PDF are reports, not recovery copies.
- The service worker caches only the same-origin application shell. Sales data stays in IndexedDB.
- No accounts, analytics, telemetry, remote API, third-party CDN, or hidden cloud synchronization are present.
- A `BroadcastChannel` refreshes another open tab after local changes.

## Why this architecture

It removes workbook repair and locking problems, supports a significantly clearer period and entry workflow, works offline after first hosted load, and limits data exposure. It is operationally honest: production-grade for one salesperson on a trusted browser profile, not a centralized dealership platform.

## Consequences

- Clearing browser data or losing the device can remove records; JSON backup discipline is required.
- Coworkers can use the same deployed app but do not see each other's records.
- There is no centralized recovery, manager dashboard, cross-device sync, or tamper-evident audit trail.
- A shared or unlocked operating-system/browser account can expose local data.
- PWA installation and offline behavior require HTTPS or localhost; opening `index.html` directly is not the supported deployment.

## Recovery and import rules

- Backups include the profile, sales, settings, pay plan, payroll comparisons, and local activity log in a versioned envelope with a SHA-256 checksum.
- Restore validates the schema and checksum and requires the user to create a current safety backup first.
- Full backups include customer last names and soft-deleted records. The report-level omit-last-names option does not alter recovery files.
- Deletes remain recoverable soft deletes in version 1.0; permanent purge/retention requires a separate approved policy and implementation.
- Legacy Excel import does not execute macros and ignores workbook commission/calculation columns. It reads displayed values from recognized entry columns, then recomputes commissions in the app.
- CSV export protects text values that spreadsheet software might interpret as formulas.
- Customer last names can be omitted from report exports with the share-safe option; stock number remains the operational identifier.

## Future shared-team path

A future multi-user version should add authenticated dealer workspaces, salesperson ownership, role-based access, a server-authoritative database, centrally managed pay-plan versions, tenant isolation, encrypted transport/storage, retention policy, append-only audit events, conflict resolution, and a tested JSON migration. Until then, IndexedDB is the source of truth rather than a cache.
