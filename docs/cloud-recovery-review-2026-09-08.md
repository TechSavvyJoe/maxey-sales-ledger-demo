# Cloud recovery and everyday-use review — September 8, 2026

## Scope

This pass targets the Firebase edition at `https://maxey-sales-ledger-private.web.app/`. The public GitHub Pages site remains a separate demonstration. Tests use synthetic, isolated emulator accounts; no owner or coworker records are changed.

Product Grammar and Accessibility Review guided the work: feedback must describe what actually happened, recovery must preserve edits, and essential controls must remain readable and operable across screen sizes.

## Corrected behavior

- Restoring an edited field to its original value clears the obsolete saved draft with a revision check. Reopening no longer resurrects an older incomplete edit. Erasing a new-sale draft also resets its identity; cleanup does not create a sale or a commission revision.
- A failed sale save cannot be hidden by a successful save to another sale, Settings, or an export record. A retry keeps the warning until that resource is acknowledged. Late results and account transitions cannot overwrite a newer account's status.
- Reverting a failed edit clears its warning only after a fresh server read confirms the saved sale still matches the editor's baseline. A changed record requires review instead. Explicit Load latest rechecks the server rather than reopening a cached conflict snapshot; resolving a warning never creates a new saved timestamp.
- Offline and failed-save warnings take priority over background activity. The account bar explains keeping the current tab/editor open; it does not prescribe reloading and losing unsaved input. Sign-out has a minimum 44-pixel target, and the saving indicator respects reduced motion.
- Split-deal entry visibly explains that entered gross is the salesperson's share. This clarifies the existing calculation contract; it does not change Mini, spiff, gross, or commission calculations.
- F&I reports distinguish an empty period, pending-only sales, excluded deliveries, and a filter with no matches. An empty month no longer claims that all F&I details are complete or offers a reset action that cannot produce records.
- Report drill-down and Settings destination scrolling respect reduced motion. Days-off instructions now describe automatic saving.

## Verification

- 635 unit/component tests passed across 46 files; TypeScript, lint, and whitespace checks passed.
- 12 Firebase SDK journey checks passed in desktop Chromium, phone Chromium, and native macOS WebKit. After the final recovery integration, the strengthened failed-write/revert/reload journey passed again in all three projects (3 checks).
- All 3 compiled-cloud smoke tests passed: background saving/reload, Firebase Settings and bonus/report responsiveness, and recovery/split guidance. Layout assertions cover 320 through 2560 pixels. Targeted accessibility checks found no violations; reduced-motion scrolling and 44-pixel account controls are asserted.
- Shared sale-editor, close/recovery, Settings autosave/density, and report-layout checks passed (24 passed, 2 intentional device skips). The separate stale-sale conflict/Load latest check passed on the stable source (1 check).
- Visually inspected compiled-cloud recovery at 440 and 1440 pixels, split guidance at 320 and 1440, bonus settings at 410, and cloud-saving settings at 2560. Full-page captures show fixed navigation at the capture viewport position; this is not a second navigation bar in the page.

Tests use the actual Firebase SDK with local Auth/Firestore emulators. These are not production database writes. The build retains existing bundle-size advisories; those are not silently reclassified as failures or removed by raising the warning threshold. Deployment identity and hosted-file verification are recorded in the release handoff.

## Deliberate limits

- An uncertain failed write is not erased by unrelated reads or draft cleanup. Recovery must verify the intended saved record; unresolved operations continue to show a warning.
- Cloud saving is online-first. Unsaved offline typing needs the tab/editor to stay open until reconnect and acknowledgement. This pass does not add a durable offline write queue.
- Automated cloud tests do not substitute for a real second-person Google sign-in on dealership hardware, real payroll reconciliation, or manual assistive-technology acceptance.
- Scheduled disaster-recovery backups/PITR and a verified restore procedure remain an owner decision; billing is not activated by this release.

Deployment updates application files only. No access-rule, billing, account-enrollment, or database migration is part of this change. A presentation rollback must not restore an older database snapshot over newer sales.
