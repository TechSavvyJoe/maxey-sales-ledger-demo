# ADR-011: Account-scoped editor drafts and exact save acknowledgements

**Status:** Accepted for implementation; deploy after emulator and browser acceptance
**Date:** 2026-09-03
**Deciders:** Owner-requested autosaving; implementation review by the Sales Ledger agents

## Context

Salespeople expect entries to survive ordinary navigation without manually making
backups. Incomplete text (a blank stock number, a trailing decimal, an unfinished
manual payout) is not yet a valid Sale and must not silently alter commissions.
Two devices must not silently overwrite the same editor draft. The private pilot
must retain its approved-account boundary and memory-only shared-device cache.

## Decision

Store bounded raw editor data separately from authoritative sales. Local mode uses
a separate IndexedDB database; cloud mode uses `users/{uid}/drafts/{key}` only.
Every save/clear compares the editor's original draft revision inside a transaction.
Clears retain a content-free incremented tombstone to prevent stale resurrection.
No draft write changes the account's sale revision barrier, audit or reports.

Authoritative Sale and Settings persistence returns the exact committed record.
Refresh is a separate operation, so a post-commit read failure cannot reset the
editor to a stale revision or invite a duplicate new-sale submission. The new-sale
draft includes a stable eventual Sale ID for recovery after interrupted cleanup.

Google is the primary sign-in action and email links are a secondary disclosed
option. An own-account approval subscription precedes mounting the ledger. It
distinguishes waiting for approval from connection errors and opens automatically
once approved. Session-only authentication remains the shared-device default.

## Alternatives and trade-offs

- Saving incomplete entries as sales would simplify storage but pollute volume,
  commission and product reporting; rejected.
- Browser-only cloud drafts would survive some offline failures but retain account
  data on shared devices and require an account-scoped offline outbox; deferred.
- Last-write-wins drafts would be simpler but silently lose concurrent edits;
  rejected in favor of explicit conflict recovery.

Cloud drafts remain online-first and need a server acknowledgement. Offline entries
stay visible in the open editor, but a browser crash before acknowledgement can
lose those latest keystrokes. Do not call this offline sync or disaster recovery.
The separate draft store is not part of the existing ledger backup format.

## Verification

Targeted tests cover raw-input recovery, unknown F&I answers, nested size bounds,
wrong-account denial, transaction retries, stale clear/recreate prevention,
late responses after sign-out, admission/revocation, and saved-warning separation.
Run Firestore emulator and responsive browser journeys before deployment. No live
accounts, billing, IAM or production data are changed by this implementation.

The 22-test Firestore security suite passed locally on September 3, 2026,
including five draft-boundary tests. Browser acceptance and live deployment remain
separate gates; this result does not assert those have happened.

Primary references: [Firebase transactions](https://firebase.google.com/docs/firestore/manage-data/transactions),
[authentication persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence),
[Google sign-in](https://firebase.google.com/docs/auth/web/google-signin).
