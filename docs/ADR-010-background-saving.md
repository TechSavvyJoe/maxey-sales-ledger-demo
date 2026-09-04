# ADR 010 — Background saving without premature sales

Date: 2026-09-03
Status: Implemented; release acceptance is tracked separately.

## Decision

Google sign-in is the primary cloud entry point. Account admission remains private and explicit; this release does not open enrollment or enable billing. The access screen distinguishes successful sign-in awaiting approval from a connection failure.

Valid edits to existing sales save after a short typing pause. Unfinished input and new sales are protected in a separate account-scoped draft store; a new draft is not a delivered sale and never enters sales, commission, or bonus totals. An explicit Add sale commits a new record. Settings and payroll amounts also save after a pause, with manual save available as a fallback.

Writes are serialized per editor. Each next edit uses the exact committed revision, not an unverified optimistic value or a later snapshot belonging to a different editor. A failed follow-up read does not change a successful write acknowledgement into a failed write. Text entered during a write is retained. Conflicting edits stop for review rather than silently overwrite another device.

Blank numeric input is not zero. Validation blocks incomplete or invalid settings and sale updates. A draft preserves unfinished sale text independently of the last valid sale. Draft revisions and deletion tombstones prevent stale editors from resurrecting a discarded draft.

## Safety and limits

- Account-scoped authorization applies to sales, settings, history, and drafts. Browser clients cannot grant pilot access.
- The cloud build does not upload an existing local ledger or fall back to a different device ledger.
- Shared-device sign-in remains session-scoped by default. Persistent device sign-in requires the user's explicit choice.
- Firestore transactions require a working connection. Offline cloud changes remain visibly unsaved in the open editor; this is not an offline-sync guarantee. Never claim a cloud save before acknowledgement.
- A saved draft can be recovered; an unacknowledged offline draft can be lost if its tab is discarded. Close/sign-out guards must describe that risk honestly.
- Per-change history is not an independent disaster-recovery backup. Scheduled backup/PITR and broader enrollment require a separate operational decision.
- Old and new overlapping edits cannot be made conflict-free by cosmetic status indicators. Conflict recovery remains an explicit user action.

## Verification requirements

Cover new draft → close → reopen; valid edit → autosave → reload; text entered during a slow write; invalid numeric text; duplicate stock; interrupted write; stale sale and draft revisions; approval changes; account switching; unchanged local/demo data; and all responsive states. Validate Firestore rules in the emulator before deploying them, then verify the exact hosted build and a synthetic live workflow.

Technical references: [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [transaction contention](https://firebase.google.com/docs/firestore/transaction-data-contention), and [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
